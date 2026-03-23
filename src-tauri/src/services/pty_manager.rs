use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, Weak,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use portable_pty::{native_pty_system, Child, CommandBuilder, ExitStatus, MasterPty, PtySize};
use rusqlite::{params, OptionalExtension, Row};
use tokio::sync::{broadcast, mpsc};

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::{AgentSession, Project},
};

use super::{
    dispatch,
    openclaw::{OpenClawChatService, OpenClawClient},
    project_registry,
    review_router::ReviewRouterService,
    tray,
};

const DEFAULT_PTY_ROWS: u16 = 24;
const DEFAULT_PTY_COLS: u16 = 80;
#[cfg(unix)]
const DISPATCH_BASH_INIT_FILE_NAME: &str = "dispatch-embedded-bash-init.sh";
const SESSION_SOURCE_TERMINAL: &str = "terminal";
const SESSION_KIND_SHELL: &str = "shell";
const SESSION_STATUS_RUNNING: &str = "running";
const SESSION_STATUS_CANCELED: &str = "canceled";
const SESSION_TRANSPORT_PTY: &str = "pty";
const TERMINATION_GRACE_PERIOD: Duration = Duration::from_millis(750);
const TERMINATION_POLL_INTERVAL: Duration = Duration::from_millis(50);

static TERMINAL_SESSION_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub(crate) enum TerminalOutputEvent {
    Data(Vec<u8>),
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateShellSessionRequest {
    pub project_id: String,
    pub task_id: Option<String>,
    pub shell: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateDispatchSessionRequest {
    pub project_id: String,
    pub task_id: Option<String>,
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellLaunchPlan {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalLaunchRequest {
    pub session_id: Option<String>,
    pub project_id: String,
    pub task_id: Option<String>,
    pub source: String,
    pub session_kind: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
}

pub struct ManagedTerminalSession {
    session_id: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    cancel_requested: AtomicBool,
    attachment_active: Mutex<bool>,
    output_sender: broadcast::Sender<TerminalOutputEvent>,
}

impl ManagedTerminalSession {
    fn new(
        session_id: String,
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn std::io::Write + Send>,
        child: Box<dyn Child + Send + Sync>,
        output_sender: broadcast::Sender<TerminalOutputEvent>,
    ) -> Self {
        Self {
            session_id,
            master: Mutex::new(master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            cancel_requested: AtomicBool::new(false),
            attachment_active: Mutex::new(false),
            output_sender,
        }
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn process_id(&self) -> Option<u32> {
        self.child.lock().ok().and_then(|child| child.process_id())
    }

    pub fn cancel_requested(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    pub fn resize(&self, size: PtySize) -> AppResult<()> {
        let master = self
            .master
            .lock()
            .map_err(|_| AppError::new("terminal master mutex was poisoned"))?;

        master
            .resize(size)
            .map_err(|error| AppError::new(format!("failed to resize terminal session: {error}")))
    }

    pub fn get_size(&self) -> AppResult<PtySize> {
        let master = self
            .master
            .lock()
            .map_err(|_| AppError::new("terminal master mutex was poisoned"))?;

        master
            .get_size()
            .map_err(|error| AppError::new(format!("failed to read terminal size: {error}")))
    }

    pub fn write_all(&self, bytes: &[u8]) -> AppResult<()> {
        use std::io::Write;

        let mut writer = self
            .writer
            .lock()
            .map_err(|_| AppError::new("terminal writer mutex was poisoned"))?;

        writer
            .write_all(bytes)
            .and_then(|_| writer.flush())
            .map_err(|error| AppError::new(format!("failed to write terminal input: {error}")))
    }

    pub fn terminate(&self) -> AppResult<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| AppError::new("terminal child mutex was poisoned"))?;

        terminate_child_process(child.as_mut())
    }

    pub fn try_wait(&self) -> AppResult<Option<ExitStatus>> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| AppError::new("terminal child mutex was poisoned"))?;

        child
            .try_wait()
            .map_err(|error| AppError::new(format!("failed to poll terminal child state: {error}")))
    }

    pub(crate) fn subscribe_output(&self) -> broadcast::Receiver<TerminalOutputEvent> {
        self.output_sender.subscribe()
    }

    pub fn mark_cancel_requested(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
    }

    pub fn try_acquire_attachment(self: &Arc<Self>) -> AppResult<TerminalSessionAttachment> {
        let mut attachment_active = self
            .attachment_active
            .lock()
            .map_err(|_| AppError::new("terminal attachment mutex was poisoned"))?;

        if *attachment_active {
            return Err(AppError::new("terminal session is already attached"));
        }

        *attachment_active = true;

        Ok(TerminalSessionAttachment {
            session: self.clone(),
        })
    }

    fn release_attachment(&self) {
        if let Ok(mut attachment_active) = self.attachment_active.lock() {
            *attachment_active = false;
        }
    }
}

pub struct TerminalSessionAttachment {
    session: Arc<ManagedTerminalSession>,
}

impl TerminalSessionAttachment {
    pub fn session(&self) -> &ManagedTerminalSession {
        &self.session
    }
}

impl Drop for TerminalSessionAttachment {
    fn drop(&mut self) {
        self.session.release_attachment();
    }
}

#[derive(Clone)]
struct SessionSupervisionContext {
    database: Arc<Database>,
    manager: Weak<PtyManager>,
    session_logs_dir: PathBuf,
    review_routing: Option<ReviewRoutingContext>,
}

impl SessionSupervisionContext {
    fn session_log_path(&self, session_id: &str) -> PathBuf {
        self.session_logs_dir.join(format!("{session_id}.log"))
    }
}

#[derive(Clone)]
struct ReviewRoutingContext {
    job_sender: mpsc::UnboundedSender<ReviewRoutingJob>,
}

#[derive(Clone)]
struct ReviewRoutingJob {
    database: Arc<Database>,
    session_id: String,
}

impl ReviewRoutingContext {
    fn enqueue(&self, database: Arc<Database>, session_id: String) -> AppResult<()> {
        self.job_sender
            .send(ReviewRoutingJob {
                database,
                session_id,
            })
            .map_err(|_| AppError::new("review routing worker is unavailable"))
    }
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Arc<ManagedTerminalSession>>>,
    supervision: Mutex<Option<SessionSupervisionContext>>,
    review_routing: Mutex<Option<ReviewRoutingContext>>,
    ui_app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl PtyManager {
    pub fn configure_ui(&self, app_handle: tauri::AppHandle) -> AppResult<()> {
        let mut ui_app_handle = self
            .ui_app_handle
            .lock()
            .map_err(|_| AppError::new("terminal UI integration mutex was poisoned"))?;
        *ui_app_handle = Some(app_handle);

        Ok(())
    }

    pub fn configure_supervision(
        &self,
        database: Arc<Database>,
        manager: Weak<PtyManager>,
        session_logs_dir: PathBuf,
    ) -> AppResult<()> {
        fs::create_dir_all(&session_logs_dir).map_err(|error| {
            AppError::new(format!(
                "failed to create terminal session log directory {}: {error}",
                session_logs_dir.display()
            ))
        })?;

        let mut supervision = self
            .supervision
            .lock()
            .map_err(|_| AppError::new("terminal supervision mutex was poisoned"))?;
        *supervision = Some(SessionSupervisionContext {
            database,
            manager,
            session_logs_dir,
            review_routing: None,
        });

        Ok(())
    }

    pub fn configure_review_routing(
        &self,
        openclaw_client: Arc<OpenClawClient>,
        openclaw_chat: Arc<OpenClawChatService>,
        review_router: Arc<ReviewRouterService>,
    ) -> AppResult<()> {
        let (job_sender, mut job_receiver) = mpsc::unbounded_channel::<ReviewRoutingJob>();
        let ui_app_handle = self.ui_app_handle()?;
        tauri::async_runtime::spawn(async move {
            while let Some(job) = job_receiver.recv().await {
                openclaw_chat.bind_database(job.database.clone()).await;

                match review_router
                    .route_session_review(
                        job.database.as_ref(),
                        openclaw_client.as_ref(),
                        &openclaw_chat,
                        &job.session_id,
                    )
                    .await
                {
                    Ok(outcome) => {
                        if let Some(app_handle) = ui_app_handle.as_ref() {
                            let _ = tray::notify_review_outcome(
                                app_handle,
                                job.database.as_ref(),
                                &job.session_id,
                                &outcome,
                            );
                        }
                    }
                    Err(error) => {
                        tracing::warn!(
                            session_id = %job.session_id,
                            error = %error,
                            "automated review routing failed after terminal session completion"
                        );
                    }
                }
            }
        });

        let mut review_routing = self
            .review_routing
            .lock()
            .map_err(|_| AppError::new("review routing mutex was poisoned"))?;
        *review_routing = Some(ReviewRoutingContext { job_sender });

        Ok(())
    }

    pub fn register(&self, session: Arc<ManagedTerminalSession>) -> AppResult<()> {
        let session_id = session.session_id().to_string();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::new("terminal session registry mutex was poisoned"))?;

        if sessions.contains_key(&session_id) {
            return Err(AppError::new(format!(
                "terminal session is already registered: {session_id}"
            )));
        }

        sessions.insert(session_id, session);

        Ok(())
    }

    pub fn get(&self, session_id: &str) -> Option<Arc<ManagedTerminalSession>> {
        self.sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(session_id).cloned())
    }

    pub fn session_count(&self) -> usize {
        self.sessions
            .lock()
            .map(|sessions| sessions.len())
            .unwrap_or(0)
    }

    pub fn terminate_session(&self, session_id: &str) -> AppResult<bool> {
        let session = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| AppError::new("terminal session registry mutex was poisoned"))?;
            sessions.remove(session_id)
        };

        if let Some(session) = session {
            session.mark_cancel_requested();
            session.terminate()?;

            if let Some(supervision_context) = self.supervision_context()? {
                let _ =
                    mark_agent_session_canceled(supervision_context.database.as_ref(), session_id)?;

                if let Some(app_handle) = self.ui_app_handle()? {
                    let _ = tray::refresh_running_session_tooltip(
                        &app_handle,
                        supervision_context.database.as_ref(),
                    );
                }
            }

            return Ok(true);
        }

        Ok(false)
    }

    pub fn remove_session(
        &self,
        session_id: &str,
    ) -> AppResult<Option<Arc<ManagedTerminalSession>>> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::new("terminal session registry mutex was poisoned"))?;

        Ok(sessions.remove(session_id))
    }

    fn supervision_context(&self) -> AppResult<Option<SessionSupervisionContext>> {
        let supervision = self
            .supervision
            .lock()
            .map_err(|_| AppError::new("terminal supervision mutex was poisoned"))?;
        let review_routing = self
            .review_routing
            .lock()
            .map_err(|_| AppError::new("review routing mutex was poisoned"))?;

        Ok(supervision.as_ref().cloned().map(|mut context| {
            context.review_routing = review_routing.clone();
            context
        }))
    }

    fn review_routing_context(&self) -> AppResult<Option<ReviewRoutingContext>> {
        let review_routing = self
            .review_routing
            .lock()
            .map_err(|_| AppError::new("review routing mutex was poisoned"))?;

        Ok(review_routing.clone())
    }

    fn ui_app_handle(&self) -> AppResult<Option<tauri::AppHandle>> {
        let ui_app_handle = self
            .ui_app_handle
            .lock()
            .map_err(|_| AppError::new("terminal UI integration mutex was poisoned"))?;

        Ok(ui_app_handle.clone())
    }

    fn terminate_all_sessions(&mut self) {
        let sessions = match self.sessions.get_mut() {
            Ok(sessions) => sessions,
            Err(_) => return,
        };

        for session in sessions.drain().map(|(_, session)| session) {
            let _ = session.terminate();
        }
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.terminate_all_sessions();
    }
}

pub fn create_shell_session(
    database: &Database,
    pty_manager: &PtyManager,
    request: CreateShellSessionRequest,
) -> AppResult<AgentSession> {
    let project = project_registry::get_project(database, &request.project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;

    let env_shell = std::env::var("SHELL").ok();
    let env_comspec = std::env::var("COMSPEC").ok();
    let launch_plan = resolve_shell_launch(
        &project,
        request.shell.as_deref(),
        env_shell.as_deref(),
        env_comspec.as_deref(),
    )?;

    create_terminal_session(
        database,
        pty_manager,
        TerminalLaunchRequest {
            session_id: None,
            project_id: project.id.clone(),
            task_id: request.task_id,
            source: SESSION_SOURCE_TERMINAL.to_string(),
            session_kind: SESSION_KIND_SHELL.to_string(),
            program: launch_plan.program,
            args: launch_plan.args,
            env: Vec::new(),
            cwd: launch_plan.cwd,
        },
    )
}

pub fn create_dispatch_session(
    database: &Database,
    pty_manager: &PtyManager,
    request: CreateDispatchSessionRequest,
) -> AppResult<AgentSession> {
    let project = project_registry::get_project(database, &request.project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;
    let cwd = resolve_project_cwd(&project)?;

    create_terminal_session(
        database,
        pty_manager,
        TerminalLaunchRequest {
            session_id: None,
            project_id: project.id,
            task_id: request.task_id,
            source: "direct_dispatch".to_string(),
            session_kind: "direct_agent".to_string(),
            program: request.program,
            args: request.args,
            env: request.env,
            cwd,
        },
    )
}

pub fn resolve_shell_launch(
    project: &Project,
    shell_override: Option<&str>,
    env_shell: Option<&str>,
    env_comspec: Option<&str>,
) -> AppResult<ShellLaunchPlan> {
    let program = resolve_shell_program(shell_override, env_shell, env_comspec)?;
    let args = resolve_shell_args(&program)?;
    let cwd = resolve_project_cwd(project)?;

    Ok(ShellLaunchPlan { program, args, cwd })
}

pub fn resolve_shell_program(
    shell_override: Option<&str>,
    env_shell: Option<&str>,
    _env_comspec: Option<&str>,
) -> AppResult<String> {
    if let Some(shell_override) = shell_override {
        let trimmed = shell_override.trim();
        if trimmed.is_empty() {
            return Err(AppError::new("shell override cannot be blank"));
        }

        return Ok(trimmed.to_string());
    }

    #[cfg(unix)]
    {
        if let Some(env_shell) = env_shell {
            let trimmed = env_shell.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }

        Ok("/bin/sh".to_string())
    }

    #[cfg(windows)]
    {
        if let Some(env_comspec) = _env_comspec {
            let trimmed = env_comspec.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }

        Ok("cmd.exe".to_string())
    }
}

fn resolve_shell_args(program: &str) -> AppResult<Vec<String>> {
    #[cfg(unix)]
    {
        if shell_program_name(program) == Some("bash") {
            let init_file_path = ensure_dispatch_bash_init_file()?;
            return Ok(vec![
                "--init-file".to_string(),
                init_file_path.to_string_lossy().into_owned(),
            ]);
        }
    }

    Ok(Vec::new())
}

fn shell_program_name(program: &str) -> Option<&str> {
    Path::new(program).file_name().and_then(|name| name.to_str())
}

#[cfg(unix)]
fn ensure_dispatch_bash_init_file() -> AppResult<PathBuf> {
    let init_file_path = std::env::temp_dir().join(DISPATCH_BASH_INIT_FILE_NAME);

    fs::write(&init_file_path, dispatch_bash_init_contents()).map_err(|error| {
        AppError::new(format!(
            "failed to write Dispatch bash init file {}: {error}",
            init_file_path.display()
        ))
    })?;

    Ok(init_file_path)
}

#[cfg(unix)]
fn dispatch_bash_init_contents() -> &'static str {
    concat!(
        "if [ -n \"$HOME\" ] && [ -f \"$HOME/.bashrc\" ]; then\n",
        "  . \"$HOME/.bashrc\"\n",
        "fi\n",
        "unalias codex 2>/dev/null || true\n",
        "unalias claude 2>/dev/null || true\n",
    )
}

pub fn create_terminal_session(
    database: &Database,
    pty_manager: &PtyManager,
    request: TerminalLaunchRequest,
) -> AppResult<AgentSession> {
    validate_launch_request(&request)?;
    let supervision_context = pty_manager.supervision_context()?;
    let session_id = request
        .session_id
        .clone()
        .unwrap_or_else(next_terminal_session_id);

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: DEFAULT_PTY_ROWS,
            cols: DEFAULT_PTY_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AppError::new(format!("failed to allocate PTY pair: {error}")))?;

    let mut command = CommandBuilder::new(&request.program);
    command.args(&request.args);
    command.cwd(&request.cwd);

    for (key, value) in &request.env {
        command.env(key, value);
    }

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AppError::new(format!("failed to spawn PTY child process: {error}")))?;
    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::new(format!(
                "failed to acquire PTY reader handle: {error}"
            )));
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::new(format!(
                "failed to acquire PTY writer handle: {error}"
            )));
        }
    };

    let now = now_unix_seconds();
    let session = AgentSession {
        id: session_id,
        project_id: request.project_id,
        task_id: request.task_id,
        source: request.source,
        session_kind: request.session_kind,
        status: SESSION_STATUS_RUNNING.to_string(),
        program: request.program,
        args_json: serialize_string_list(&request.args)?,
        env_keys_json: serialize_string_list(&env_keys_from_pairs(&request.env))?,
        cwd: request.cwd.to_string_lossy().into_owned(),
        transport: SESSION_TRANSPORT_PTY.to_string(),
        exit_code: None,
        started_at: Some(now),
        ended_at: None,
        created_at: now,
        updated_at: now,
    };

    if let Err(error) = insert_agent_session(database, &session) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    let (output_sender, _) = broadcast::channel(128);
    let session_log_file = match supervision_context.as_ref() {
        Some(context) => {
            match open_session_log(&context.session_log_path(&session.id), &session.id) {
                Ok(file) => Some(file),
                Err(error) => {
                    let _ = terminate_child_process(child.as_mut());
                    let _ = delete_agent_session(database, &session.id);
                    return Err(error);
                }
            }
        }
        None => None,
    };
    let managed_session = Arc::new(ManagedTerminalSession::new(
        session.id.clone(),
        pair.master,
        writer,
        child,
        output_sender.clone(),
    ));

    if let Err(error) =
        spawn_output_forwarder(reader, output_sender, session.id.clone(), session_log_file)
    {
        let _ = managed_session.terminate();
        let _ = delete_agent_session(database, &session.id);
        return Err(error);
    }

    if let Err(error) = pty_manager.register(managed_session.clone()) {
        managed_session.terminate()?;
        let _ = delete_agent_session(database, &session.id);
        return Err(error);
    }

    if let Some(supervision_context) = supervision_context {
        if let Err(error) = spawn_session_supervisor(supervision_context, managed_session.clone()) {
            let _ = pty_manager.remove_session(&session.id);
            managed_session.terminate()?;
            let _ = delete_agent_session(database, &session.id);
            return Err(error);
        }
    }

    tracing::info!(
        session_id = %session.id,
        project_id = %session.project_id,
        program = %session.program,
        "terminal session created"
    );

    if let Some(app_handle) = pty_manager.ui_app_handle()? {
        let _ = tray::refresh_running_session_tooltip(&app_handle, database);
    }

    Ok(session)
}

pub fn allocate_terminal_session_id() -> String {
    next_terminal_session_id()
}

pub fn get_agent_session(database: &Database, session_id: &str) -> AppResult<Option<AgentSession>> {
    database.with_connection(|connection| {
        let session = connection
            .query_row(
                "
                SELECT
                    id,
                    project_id,
                    task_id,
                    source,
                    session_kind,
                    status,
                    program,
                    args_json,
                    env_keys_json,
                    cwd,
                    transport,
                    exit_code,
                    started_at,
                    ended_at,
                    created_at,
                    updated_at
                FROM agent_sessions
                WHERE id = ?1
                ",
                [session_id],
                row_to_agent_session,
            )
            .optional()?;

        Ok(session)
    })
}

pub fn list_agent_sessions(database: &Database, project_id: &str) -> AppResult<Vec<AgentSession>> {
    if project_id.trim().is_empty() {
        return Err(AppError::new("project id cannot be blank"));
    }

    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "
            SELECT
                id,
                project_id,
                task_id,
                source,
                session_kind,
                status,
                program,
                args_json,
                env_keys_json,
                cwd,
                transport,
                exit_code,
                started_at,
                ended_at,
                created_at,
                updated_at
            FROM agent_sessions
            WHERE project_id = ?1
            ORDER BY created_at DESC, id DESC
            ",
        )?;
        let sessions = statement
            .query_map([project_id], row_to_agent_session)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(sessions)
    })
}

pub fn mark_agent_session_finished(
    database: &Database,
    session_id: &str,
    exit_status: &ExitStatus,
) -> AppResult<(Option<AgentSession>, Option<dispatch::TaskStatusTransition>)> {
    let status = if exit_status.success() {
        "succeeded"
    } else {
        "failed"
    };
    update_agent_session_status(
        database,
        session_id,
        status,
        Some(i32::try_from(exit_status.exit_code()).unwrap_or(i32::MAX)),
    )
}

pub fn mark_agent_session_canceled(
    database: &Database,
    session_id: &str,
) -> AppResult<(Option<AgentSession>, Option<dispatch::TaskStatusTransition>)> {
    update_agent_session_status(database, session_id, SESSION_STATUS_CANCELED, None)
}

pub fn record_terminal_session_exit(
    database: &Database,
    session: &ManagedTerminalSession,
    session_id: &str,
    exit_status: &ExitStatus,
) -> AppResult<(Option<AgentSession>, Option<dispatch::TaskStatusTransition>)> {
    if session.cancel_requested() {
        return mark_agent_session_canceled(database, session_id);
    }

    mark_agent_session_finished(database, session_id, exit_status)
}

fn validate_launch_request(request: &TerminalLaunchRequest) -> AppResult<()> {
    if request.project_id.trim().is_empty() {
        return Err(AppError::new("project id cannot be blank"));
    }

    if request.program.trim().is_empty() {
        return Err(AppError::new("terminal program cannot be blank"));
    }

    if !request.cwd.is_dir() {
        return Err(AppError::new(
            "resolved terminal cwd is invalid or inaccessible",
        ));
    }

    if request.source != SESSION_SOURCE_TERMINAL && request.source != "direct_dispatch" {
        return Err(AppError::new("terminal session source is invalid"));
    }

    if request.session_kind != SESSION_KIND_SHELL && request.session_kind != "direct_agent" {
        return Err(AppError::new("terminal session kind is invalid"));
    }

    Ok(())
}

fn resolve_project_cwd(project: &Project) -> AppResult<PathBuf> {
    let cwd = PathBuf::from(&project.root_path);

    if !cwd.is_dir() {
        return Err(AppError::new(
            "resolved terminal cwd is invalid or inaccessible",
        ));
    }

    Ok(cwd)
}

fn insert_agent_session(database: &Database, session: &AgentSession) -> AppResult<()> {
    database.with_connection(|connection| {
        connection.execute(
            "
            INSERT INTO agent_sessions (
                id,
                project_id,
                task_id,
                source,
                session_kind,
                status,
                program,
                args_json,
                env_keys_json,
                cwd,
                transport,
                exit_code,
                started_at,
                ended_at,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ",
            params![
                &session.id,
                &session.project_id,
                &session.task_id,
                &session.source,
                &session.session_kind,
                &session.status,
                &session.program,
                &session.args_json,
                &session.env_keys_json,
                &session.cwd,
                &session.transport,
                session.exit_code,
                session.started_at,
                session.ended_at,
                session.created_at,
                session.updated_at,
            ],
        )?;

        Ok(())
    })
}

fn delete_agent_session(database: &Database, session_id: &str) -> AppResult<bool> {
    database.with_connection(|connection| {
        let deleted =
            connection.execute("DELETE FROM agent_sessions WHERE id = ?1", [session_id])?;
        Ok(deleted > 0)
    })
}

fn update_agent_session_status(
    database: &Database,
    session_id: &str,
    status: &str,
    exit_code: Option<i32>,
) -> AppResult<(Option<AgentSession>, Option<dispatch::TaskStatusTransition>)> {
    let now = now_unix_seconds();

    let session = database.with_connection(|connection| {
        let updated_rows = connection.execute(
            "
            UPDATE agent_sessions
            SET
                status = ?2,
                exit_code = ?3,
                ended_at = ?4,
                updated_at = ?4
            WHERE id = ?1
              AND status = 'running'
            ",
            params![session_id, status, exit_code, now],
        )?;

        if updated_rows == 0 {
            return Ok::<Option<AgentSession>, AppError>(None);
        }

        let session = connection
            .query_row(
                "
                SELECT
                    id,
                    project_id,
                    task_id,
                    source,
                    session_kind,
                    status,
                    program,
                    args_json,
                    env_keys_json,
                    cwd,
                    transport,
                    exit_code,
                    started_at,
                    ended_at,
                    created_at,
                    updated_at
                FROM agent_sessions
                WHERE id = ?1
                ",
                [session_id],
                row_to_agent_session,
            )
            .optional()?;

        Ok::<Option<AgentSession>, AppError>(session)
    })?;

    let task_transition = match session.as_ref() {
        Some(session) => dispatch::sync_dispatch_session_status(database, session)?,
        None => None,
    };

    Ok((session, task_transition))
}

fn row_to_agent_session(row: &Row<'_>) -> rusqlite::Result<AgentSession> {
    Ok(AgentSession {
        id: row.get(0)?,
        project_id: row.get(1)?,
        task_id: row.get(2)?,
        source: row.get(3)?,
        session_kind: row.get(4)?,
        status: row.get(5)?,
        program: row.get(6)?,
        args_json: row.get(7)?,
        env_keys_json: row.get(8)?,
        cwd: row.get(9)?,
        transport: row.get(10)?,
        exit_code: row.get(11)?,
        started_at: row.get(12)?,
        ended_at: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn env_keys_from_pairs(env: &[(String, String)]) -> Vec<String> {
    let mut keys = env.iter().map(|(key, _)| key.clone()).collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    keys
}

fn serialize_string_list(values: &[String]) -> AppResult<String> {
    serde_json::to_string(values)
        .map_err(|error| AppError::new(format!("failed to serialize terminal metadata: {error}")))
}

fn spawn_output_forwarder(
    mut reader: Box<dyn Read + Send>,
    output_sender: broadcast::Sender<TerminalOutputEvent>,
    session_id: String,
    mut session_log_file: Option<File>,
) -> AppResult<()> {
    std::thread::Builder::new()
        .name(format!("dispatch-pty-output-{session_id}"))
        .spawn(move || {
            let mut buffer = [0u8; 8192];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(bytes_read) => {
                        if let Some(session_log_file) = session_log_file.as_mut() {
                            let _ = append_session_log(session_log_file, &buffer[..bytes_read]);
                        }

                        let _ = output_sender
                            .send(TerminalOutputEvent::Data(buffer[..bytes_read].to_vec()));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %error,
                            "terminal session output pump stopped after read error"
                        );
                        break;
                    }
                }
            }

            let _ = output_sender.send(TerminalOutputEvent::Closed);
        })
        .map_err(|error| {
            AppError::new(format!(
                "failed to spawn terminal session output pump thread: {error}"
            ))
        })?;

    Ok(())
}

fn spawn_session_supervisor(
    supervision_context: SessionSupervisionContext,
    session: Arc<ManagedTerminalSession>,
) -> AppResult<()> {
    let session_id = session.session_id().to_string();

    std::thread::Builder::new()
        .name(format!("dispatch-pty-supervisor-{session_id}"))
        .spawn(move || loop {
            match session.try_wait() {
                Ok(Some(exit_status)) => {
                    let (recorded_session, task_transition) = match record_terminal_session_exit(
                        supervision_context.database.as_ref(),
                        session.as_ref(),
                        &session_id,
                        &exit_status,
                    ) {
                        Ok(recorded_session) => recorded_session,
                        Err(error) => {
                            tracing::warn!(
                                session_id = %session_id,
                                error = %error,
                                "terminal session exit could not be recorded"
                            );
                            return;
                        }
                    };

                    if let Some(manager) = supervision_context.manager.upgrade() {
                        if let Some(app_handle) = manager.ui_app_handle().ok().flatten() {
                            let _ = tray::refresh_running_session_tooltip(
                                &app_handle,
                                supervision_context.database.as_ref(),
                            );

                            if let Some(task_transition) = task_transition.as_ref() {
                                if task_transition.session_status == "failed" {
                                    let _ = tray::notify_task_status(
                                        &app_handle,
                                        supervision_context.database.as_ref(),
                                        &task_transition.project_id,
                                        &task_transition.task_id,
                                        &task_transition.session_status,
                                    );
                                }
                            }
                        }
                    }

                    if let Some(recorded_session) = recorded_session {
                        if recorded_session.status == "succeeded" {
                            let review_routing = supervision_context
                                .manager
                                .upgrade()
                                .and_then(|manager| manager.review_routing_context().ok().flatten())
                                .or_else(|| supervision_context.review_routing.clone());

                            if let Some(review_routing) = review_routing {
                                if let Err(error) = review_routing.enqueue(
                                    supervision_context.database.clone(),
                                    recorded_session.id.clone(),
                                ) {
                                    tracing::warn!(
                                        session_id = %recorded_session.id,
                                        error = %error,
                                        "automated review routing failed after terminal session completion"
                                    );
                                }
                            }
                        }
                    }

                    if let Some(manager) = supervision_context.manager.upgrade() {
                        let _ = manager.remove_session(&session_id);
                    }
                    tracing::info!(
                        session_id = %session_id,
                        exit_status = %exit_status,
                        "terminal session finished"
                    );
                    return;
                }
                Ok(None) => std::thread::sleep(TERMINATION_POLL_INTERVAL),
                Err(error) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "terminal session supervisor stopped after polling error"
                    );
                    return;
                }
            }
        })
        .map_err(|error| {
            AppError::new(format!(
                "failed to spawn terminal session supervisor thread: {error}"
            ))
        })?;

    Ok(())
}

fn open_session_log(session_log_path: &PathBuf, session_id: &str) -> AppResult<File> {
    if let Some(parent) = session_log_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(format!(
                "failed to create terminal session log directory {}: {error}",
                parent.display()
            ))
        })?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(session_log_path)
        .map_err(|error| {
            AppError::new(format!(
                "failed to open terminal session log {}: {error}",
                session_log_path.display()
            ))
        })?;
    writeln!(file, "session_id={session_id}")?;
    file.flush()?;

    Ok(file)
}

fn append_session_log(session_log_file: &mut File, bytes: &[u8]) -> AppResult<()> {
    session_log_file.write_all(bytes)?;
    session_log_file.flush()?;

    Ok(())
}

fn terminate_child_process(child: &mut (dyn Child + Send + Sync)) -> AppResult<()> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        terminate_child_process_unix(child)
    }

    #[cfg(not(unix))]
    {
        terminate_child_process_portable(child)
    }
}

#[cfg(unix)]
fn terminate_child_process_unix(child: &mut (dyn Child + Send + Sync)) -> AppResult<()> {
    terminate_child_process_unix_with_signal_sender(child, send_unix_signal)
}

#[cfg(unix)]
fn terminate_child_process_unix_with_signal_sender<F>(
    child: &mut (dyn Child + Send + Sync),
    mut send_signal: F,
) -> AppResult<()>
where
    F: FnMut(u32, i32) -> AppResult<()>,
{
    let process_id = child
        .process_id()
        .ok_or_else(|| AppError::new("terminal child process id is unavailable"))?;

    send_signal(process_id, libc::SIGTERM)?;

    if wait_for_child_exit(child, TERMINATION_GRACE_PERIOD)? {
        return Ok(());
    }

    send_signal(process_id, libc::SIGKILL)?;

    if wait_for_child_exit(child, TERMINATION_GRACE_PERIOD)? {
        return Ok(());
    }

    let _ = child.wait();
    Ok(())
}

#[cfg(unix)]
#[doc(hidden)]
pub fn terminate_child_process_with_signal_sender_for_test<F>(
    child: &mut (dyn Child + Send + Sync),
    send_signal: F,
) -> AppResult<()>
where
    F: FnMut(u32, i32) -> AppResult<()>,
{
    terminate_child_process_unix_with_signal_sender(child, send_signal)
}

#[cfg(not(unix))]
fn terminate_child_process_portable(child: &mut (dyn Child + Send + Sync)) -> AppResult<()> {
    let _ = child.kill();

    if wait_for_child_exit(child, TERMINATION_GRACE_PERIOD)? {
        return Ok(());
    }

    let _ = child.kill();
    let _ = child.wait();
    Ok(())
}

#[cfg(unix)]
fn send_unix_signal(process_id: u32, signal: i32) -> AppResult<()> {
    let process_group_id = -(process_id as i32);

    if try_send_unix_signal(process_group_id, signal)?
        || try_send_unix_signal(process_id as i32, signal)?
    {
        return Ok(());
    }

    Ok(())
}

#[cfg(unix)]
fn try_send_unix_signal(target: i32, signal: i32) -> AppResult<bool> {
    let result = unsafe { libc::kill(target, signal) };
    if result == 0 {
        return Ok(true);
    }

    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::NotFound {
        return Ok(false);
    }

    Err(AppError::new(format!(
        "failed to send Unix signal {signal} to terminal target {target}: {error}"
    )))
}

fn wait_for_child_exit(
    child: &mut (dyn Child + Send + Sync),
    timeout: Duration,
) -> AppResult<bool> {
    let deadline = Instant::now() + timeout;

    loop {
        if child.try_wait()?.is_some() {
            return Ok(true);
        }

        if Instant::now() >= deadline {
            return Ok(false);
        }

        std::thread::sleep(TERMINATION_POLL_INTERVAL);
    }
}

fn next_terminal_session_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let process_id = std::process::id();
    let sequence = TERMINAL_SESSION_ID_COUNTER.fetch_add(1, Ordering::Relaxed);

    format!("session-{process_id}-{now}-{sequence}")
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
