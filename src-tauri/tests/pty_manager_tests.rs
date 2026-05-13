use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    configure_app,
    db::Database,
    error::AppError,
    services::{
        openclaw::{OpenClawChatService, OpenClawClient},
        project_registry,
        pty_manager::{self, CreateDispatchSessionRequest, CreateShellSessionRequest, PtyManager},
        review_router::ReviewRouterService,
        session_supervisor,
    },
};
#[cfg(unix)]
use portable_pty::{Child, ChildKiller, ExitStatus};
use rusqlite::params;
use tauri::test::mock_builder;
use tauri::Manager;

#[test]
fn shell_launch_plan_uses_registered_project_root_as_cwd() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("pty-manager-cwd");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;

    let launch_plan = pty_manager::resolve_shell_launch(
        &project,
        Some(default_test_shell().as_str()),
        None,
        None,
    )?;

    assert_eq!(launch_plan.cwd, PathBuf::from(&project.root_path));
    assert_shell_args_match_launch_strategy(&launch_plan.program, &launch_plan.args)?;

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn shell_resolution_prefers_override_then_environment_then_platform_default(
) -> Result<(), Box<dyn Error>> {
    let override_program = pty_manager::resolve_shell_program(
        Some("  /bin/custom-shell  "),
        Some("/bin/from-env"),
        Some("C:\\Windows\\System32\\cmd.exe"),
    )?;
    assert_eq!(override_program, "/bin/custom-shell");

    #[cfg(unix)]
    {
        let env_program = pty_manager::resolve_shell_program(None, Some("/bin/from-env"), None)?;
        let default_program = pty_manager::resolve_shell_program(None, None, None)?;

        assert_eq!(env_program, "/bin/from-env");
        assert_eq!(default_program, "/bin/sh");
    }

    #[cfg(windows)]
    {
        let env_program = pty_manager::resolve_shell_program(
            None,
            Some("/bin/ignored-on-windows"),
            Some("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
        )?;
        let default_program = pty_manager::resolve_shell_program(None, None, None)?;

        assert_eq!(
            env_program,
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        );
        assert_eq!(default_program, "cmd.exe");
    }

    Ok(())
}

#[test]
fn create_shell_session_persists_running_agent_session_metadata() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("pty-manager-create");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;
    let pty_manager = PtyManager::default();

    let session = pty_manager::create_shell_session(
        &database,
        &pty_manager,
        CreateShellSessionRequest {
            project_id: project.id.clone(),
            task_id: None,
            shell: Some(default_test_shell()),
        },
    )?;

    assert_eq!(session.project_id, project.id);
    assert_eq!(session.task_id, None);
    assert_eq!(session.source, "terminal");
    assert_eq!(session.session_kind, "shell");
    assert_eq!(session.status, "running");
    assert_eq!(session.transport, "pty");
    assert_eq!(session.cwd, project.root_path);
    assert!(session.started_at.is_some());
    assert!(pty_manager.get(&session.id).is_some());
    assert_eq!(pty_manager.session_count(), 1);

    let stored = pty_manager::get_agent_session(&database, &session.id)?
        .expect("created terminal session should be persisted");
    assert_eq!(stored, session);
    assert_shell_args_match_json(&stored.program, &stored.args_json)?;
    assert_eq!(stored.env_keys_json, "[]");

    let running_process_id = pty_manager
        .get(&stored.id)
        .and_then(|managed_session| managed_session.process_id());
    assert!(
        running_process_id.is_some(),
        "PTY manager should keep a live child handle for the running session"
    );

    assert!(
        pty_manager.terminate_session(&stored.id)?,
        "test session cleanup should terminate the created PTY"
    );
    assert_eq!(pty_manager.session_count(), 0);

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn create_dispatch_session_reuses_the_same_pty_creation_path() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("pty-manager-dispatch");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;
    let pty_manager = PtyManager::default();

    let session = pty_manager::create_dispatch_session(
        &database,
        &pty_manager,
        CreateDispatchSessionRequest {
            project_id: project.id.clone(),
            task_id: None,
            program: default_test_shell(),
            args: Vec::new(),
            env: vec![("DISPATCH_AGENT_MODE".to_string(), "direct".to_string())],
        },
    )?;

    assert_eq!(session.project_id, project.id);
    assert_eq!(session.source, "direct_dispatch");
    assert_eq!(session.session_kind, "direct_agent");
    assert_eq!(session.status, "running");
    assert_eq!(session.transport, "pty");
    assert_eq!(session.cwd, project.root_path);

    let stored = pty_manager::get_agent_session(&database, &session.id)?
        .expect("dispatch-created terminal session should be persisted");
    assert_eq!(stored, session);
    assert_eq!(stored.args_json, "[]");
    assert_eq!(stored.env_keys_json, "[\"DISPATCH_AGENT_MODE\"]");

    assert!(
        pty_manager.terminate_session(&stored.id)?,
        "dispatch test session cleanup should terminate the created PTY"
    );

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[cfg(unix)]
#[test]
fn bash_shell_launch_uses_a_dispatch_init_file_that_unaliases_embedded_ai_clis(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("pty-manager-bash-init");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;

    let launch_plan = pty_manager::resolve_shell_launch(&project, Some("/bin/bash"), None, None)?;

    assert_eq!(launch_plan.program, "/bin/bash");
    assert_eq!(launch_plan.args.len(), 2);
    assert_eq!(launch_plan.args[0], "--init-file");
    let init_contents = fs::read_to_string(&launch_plan.args[1])?;
    assert!(init_contents.contains("unalias codex"));
    assert!(init_contents.contains("unalias claude"));

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn configure_review_routing_spawns_without_a_caller_tokio_runtime() -> Result<(), Box<dyn Error>> {
    let app = configure_app(mock_builder())
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch review routing test app");
    let pty_manager = app.state::<Arc<PtyManager>>().inner().clone();
    let openclaw_client = app.state::<Arc<OpenClawClient>>().inner().clone();
    let openclaw_chat = app.state::<Arc<OpenClawChatService>>().inner().clone();
    let review_router = app.state::<Arc<ReviewRouterService>>().inner().clone();

    pty_manager.configure_review_routing(openclaw_client, openclaw_chat, review_router)?;

    drop(app);

    Ok(())
}

#[test]
fn abandon_stale_running_sessions_marks_running_pty_rows_as_abandoned() -> Result<(), Box<dyn Error>>
{
    let temp_root = unique_temp_directory("pty-manager-abandon");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;
    let session_id = "session-stale-running";
    let now = unix_timestamp();
    let shell_program = default_test_shell();

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
            VALUES (?1, ?2, NULL, 'terminal', 'shell', 'running', ?3, '[]', '[]', ?4, 'pty', NULL, ?5, NULL, ?5, ?5)
            ",
            params![
                session_id,
                project.id.as_str(),
                shell_program.as_str(),
                project.root_path.as_str(),
                now,
            ],
        )?;

        Ok::<(), AppError>(())
    })?;

    let abandoned = session_supervisor::abandon_stale_running_sessions(&database)?;
    assert_eq!(abandoned, 1);

    let stored = pty_manager::get_agent_session(&database, session_id)?
        .expect("stale session should remain persisted");
    assert_eq!(stored.status, "abandoned");
    assert!(stored.ended_at.is_some());

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[cfg(unix)]
#[test]
fn terminate_session_escalates_when_child_ignores_sigterm() -> Result<(), Box<dyn Error>> {
    let signal_log = Arc::new(Mutex::new(Vec::new()));
    let mut child = FakeChild::new(4242, signal_log.clone());
    let recorder = signal_log.clone();

    pty_manager::terminate_child_process_with_signal_sender_for_test(
        &mut child,
        move |process_id, signal| {
            assert_eq!(process_id, 4242);
            recorder
                .lock()
                .expect("signal log mutex should not be poisoned")
                .push(signal);
            Ok(())
        },
    )?;

    assert_eq!(
        *signal_log
            .lock()
            .expect("signal log mutex should not be poisoned"),
        vec![libc::SIGTERM, libc::SIGKILL]
    );
    assert!(
        child.try_wait()?.is_some(),
        "fake child should report completion after SIGKILL escalation"
    );

    Ok(())
}

#[test]
fn supervised_sessions_write_logs_and_mark_finished_rows() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("pty-manager-supervision");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let app_log_dir = temp_root.join("AppLog");

    fs::create_dir_all(&project_root)?;

    let database = Arc::new(Database::initialize_at(&database_path)?);
    let project = project_registry::create_project(database.as_ref(), "Workspace", &project_root)?;
    let pty_manager = Arc::new(PtyManager::default());
    let session_supervisor = session_supervisor::SessionSupervisor::initialize(&app_log_dir)?;
    pty_manager.configure_supervision(
        database.clone(),
        Arc::downgrade(&pty_manager),
        session_supervisor.session_logs_dir().to_path_buf(),
    )?;

    let session = pty_manager::create_dispatch_session(
        database.as_ref(),
        pty_manager.as_ref(),
        CreateDispatchSessionRequest {
            project_id: project.id.clone(),
            task_id: None,
            program: default_test_shell(),
            args: exit_with_output_args("dispatch-session-log"),
            env: Vec::new(),
        },
    )?;

    wait_for_session_status(database.as_ref(), &session.id, "succeeded")?;
    wait_for_file_contains(
        &session_supervisor.session_log_path(&session.id),
        "dispatch-session-log",
    )?;
    wait_for_session_removed(pty_manager.as_ref(), &session.id)?;

    cleanup_database_artifacts(&database_path);

    Ok(())
}

fn unique_temp_directory(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "dispatch-{label}-{}-{timestamp}",
        std::process::id()
    ));

    fs::create_dir_all(&path).expect("failed to create temp test directory");

    path
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_secs() as i64
}

#[cfg(unix)]
fn default_test_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

#[cfg(windows)]
fn default_test_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
}

#[cfg(unix)]
fn exit_with_output_args(marker: &str) -> Vec<String> {
    vec!["-lc".to_string(), format!("printf '{marker}\\n'")]
}

#[cfg(windows)]
fn exit_with_output_args(marker: &str) -> Vec<String> {
    vec!["/C".to_string(), format!("echo {marker}")]
}

fn wait_for_session_status(
    database: &Database,
    session_id: &str,
    expected_status: &str,
) -> Result<(), Box<dyn Error>> {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);

    loop {
        let session = pty_manager::get_agent_session(database, session_id)?
            .ok_or("terminal session row disappeared before status assertion")?;
        if session.status == expected_status {
            return Ok(());
        }

        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "timed out waiting for terminal session {session_id} to reach status {expected_status}"
            )
            .into());
        }

        std::thread::sleep(Duration::from_millis(25));
    }
}

fn wait_for_file_contains(path: &Path, expected: &str) -> Result<(), Box<dyn Error>> {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);

    loop {
        if path.exists() {
            let contents = fs::read_to_string(path)?;
            if contents.contains(expected) {
                return Ok(());
            }
        }

        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "timed out waiting for {} to contain {expected}",
                path.display()
            )
            .into());
        }

        std::thread::sleep(Duration::from_millis(25));
    }
}

fn assert_shell_args_match_json(program: &str, args_json: &str) -> Result<(), Box<dyn Error>> {
    let args = serde_json::from_str::<Vec<String>>(args_json)?;
    assert_shell_args_match_launch_strategy(program, &args)
}

fn assert_shell_args_match_launch_strategy(
    program: &str,
    args: &[String],
) -> Result<(), Box<dyn Error>> {
    #[cfg(unix)]
    if Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        == Some("bash")
    {
        assert_eq!(args.len(), 2);
        assert_eq!(args[0], "--init-file");
        let init_contents = fs::read_to_string(&args[1])?;
        assert!(init_contents.contains("unalias codex"));
        assert!(init_contents.contains("unalias claude"));
        return Ok(());
    }

    assert!(args.is_empty());
    Ok(())
}

fn wait_for_session_removed(
    pty_manager: &PtyManager,
    session_id: &str,
) -> Result<(), Box<dyn Error>> {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);

    loop {
        if pty_manager.get(session_id).is_none() {
            return Ok(());
        }

        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "timed out waiting for finished session {session_id} to leave the PTY registry"
            )
            .into());
        }

        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(unix)]
#[derive(Debug)]
struct FakeChild {
    process_id: u32,
    signal_log: Arc<Mutex<Vec<i32>>>,
    exited: bool,
}

#[cfg(unix)]
impl FakeChild {
    fn new(process_id: u32, signal_log: Arc<Mutex<Vec<i32>>>) -> Self {
        Self {
            process_id,
            signal_log,
            exited: false,
        }
    }
}

#[cfg(unix)]
impl Child for FakeChild {
    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        if self.exited {
            return Ok(Some(ExitStatus::with_signal("SIGKILL")));
        }

        let signals = self
            .signal_log
            .lock()
            .expect("signal log mutex should not be poisoned");
        if signals.contains(&libc::SIGKILL) {
            self.exited = true;
            return Ok(Some(ExitStatus::with_signal("SIGKILL")));
        }

        Ok(None)
    }

    fn wait(&mut self) -> std::io::Result<ExitStatus> {
        self.exited = true;
        Ok(ExitStatus::with_signal("SIGKILL"))
    }

    fn process_id(&self) -> Option<u32> {
        Some(self.process_id)
    }
}

#[cfg(unix)]
impl ChildKiller for FakeChild {
    fn kill(&mut self) -> std::io::Result<()> {
        self.exited = true;
        Ok(())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(FakeChildKiller)
    }
}

#[cfg(unix)]
#[derive(Debug)]
struct FakeChildKiller;

#[cfg(unix)]
impl ChildKiller for FakeChildKiller {
    fn kill(&mut self) -> std::io::Result<()> {
        Ok(())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(FakeChildKiller)
    }
}

fn cleanup_database_artifacts(database_path: &Path) {
    for path in [
        database_path.to_path_buf(),
        database_path.with_extension("sqlite3-shm"),
        database_path.with_extension("sqlite3-wal"),
    ] {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    if let Some(parent) = database_path.parent() {
        let _ = fs::remove_dir_all(parent);
    }
}
