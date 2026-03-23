use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::AgentSession,
    services::{
        pty_manager::{self, CreateShellSessionRequest, PtyManager},
        terminal_ws::TerminalWebsocketService,
    },
};

type CommandResult<T> = Result<T, String>;
const PROJECT_ROOT_RELATIVE_PATH: &str = ".";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionPayload {
    pub id: String,
    pub project_id: String,
    pub task_id: Option<String>,
    pub source: String,
    pub session_kind: String,
    pub status: String,
    pub program: String,
    pub transport: String,
    pub cwd_relative_path: String,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWorkspacePayload {
    pub websocket_base_url: String,
    pub sessions: Vec<TerminalSessionPayload>,
}

impl From<AgentSession> for TerminalSessionPayload {
    fn from(session: AgentSession) -> Self {
        Self {
            id: session.id,
            project_id: session.project_id,
            task_id: session.task_id,
            source: session.source,
            session_kind: session.session_kind,
            status: session.status,
            program: session.program,
            transport: session.transport,
            cwd_relative_path: PROJECT_ROOT_RELATIVE_PATH.to_string(),
            started_at: session.started_at,
            ended_at: session.ended_at,
            created_at: session.created_at,
            updated_at: session.updated_at,
        }
    }
}

pub fn create_terminal_session_with_services(
    database: &Database,
    pty_manager: &PtyManager,
    project_id: String,
    task_id: Option<String>,
    shell: Option<String>,
) -> AppResult<TerminalSessionPayload> {
    let session = pty_manager::create_shell_session(
        database,
        pty_manager,
        CreateShellSessionRequest {
            project_id,
            task_id,
            shell,
        },
    )?;

    Ok(session.into())
}

pub fn terminate_terminal_session_with_services(
    pty_manager: &PtyManager,
    session_id: String,
) -> AppResult<bool> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return Err(AppError::new("terminal session id cannot be blank"));
    }

    pty_manager.terminate_session(session_id)
}

pub fn get_terminal_workspace_with_services(
    database: &Database,
    websocket_service: &TerminalWebsocketService,
    project_id: String,
) -> AppResult<TerminalWorkspacePayload> {
    let sessions = pty_manager::list_agent_sessions(database, &project_id)?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(TerminalWorkspacePayload {
        websocket_base_url: format!("ws://{}", websocket_service.local_addr()),
        sessions,
    })
}

fn terminal_command_error_message(error: AppError) -> String {
    let message = error.message();

    if matches!(
        message,
        "project not found"
            | "project id cannot be blank"
            | "terminal session id cannot be blank"
            | "resolved terminal cwd is invalid or inaccessible"
            | "shell override cannot be blank"
    ) {
        return message.to_string();
    }

    "terminal session command failed".to_string()
}

#[tauri::command]
pub fn get_terminal_workspace(
    database: State<'_, Arc<Database>>,
    websocket_service: State<'_, TerminalWebsocketService>,
    project_id: String,
) -> CommandResult<TerminalWorkspacePayload> {
    get_terminal_workspace_with_services(database.inner(), websocket_service.inner(), project_id)
        .map_err(terminal_command_error_message)
}

#[tauri::command]
pub fn create_terminal_session(
    database: State<'_, Arc<Database>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    project_id: String,
    task_id: Option<String>,
    shell: Option<String>,
) -> CommandResult<TerminalSessionPayload> {
    create_terminal_session_with_services(
        database.inner(),
        pty_manager.inner(),
        project_id,
        task_id,
        shell,
    )
    .map_err(terminal_command_error_message)
}

#[tauri::command]
pub fn terminate_terminal_session(
    pty_manager: State<'_, Arc<PtyManager>>,
    session_id: String,
) -> CommandResult<bool> {
    terminate_terminal_session_with_services(pty_manager.inner(), session_id)
        .map_err(terminal_command_error_message)
}
