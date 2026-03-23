use std::sync::Arc;

use tauri::State;

use crate::{
    db::Database,
    error::AppError,
    services::{
        dispatch::{self, DispatchAgentRequest},
        pty_manager::PtyManager,
    },
};

use super::terminal::TerminalSessionPayload;

type CommandResult<T> = Result<T, String>;

pub fn dispatch_agent_with_services(
    database: &Database,
    pty_manager: &Arc<PtyManager>,
    request: DispatchAgentRequest,
) -> crate::error::AppResult<TerminalSessionPayload> {
    let session = dispatch::dispatch_agent(database, pty_manager, request)?;
    Ok(session.into())
}

fn dispatch_command_error_message(error: AppError) -> String {
    let message = error.message();

    if matches!(
        message,
        "project id cannot be blank"
            | "agent profile id cannot be blank"
            | "project not found"
            | "agent profile not found"
            | "auto dispatch fallback has no local agent profile"
            | "dispatch prompt is required"
            | "dispatch task context is required"
            | "task not found"
            | "task does not belong to project"
            | "resolved terminal cwd is invalid or inaccessible"
    ) || message.starts_with("inherited env var is missing:")
        || message.starts_with("secret env var is missing:")
    {
        return message.to_string();
    }

    "dispatch command failed".to_string()
}

#[tauri::command]
pub fn dispatch_agent(
    database: State<'_, Arc<Database>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    request: DispatchAgentRequest,
) -> CommandResult<TerminalSessionPayload> {
    dispatch_agent_with_services(database.inner(), pty_manager.inner(), request)
        .map_err(dispatch_command_error_message)
}
