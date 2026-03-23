use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    db::Database,
    error::AppError,
    services::openclaw::{
        build_openclaw_sidebar_snapshot,
        client::{
            OpenClawClient, OpenClawConnectInput, OpenClawConnectionStatus,
            OpenClawKillSessionInput, OpenClawListSessionsInput, OpenClawSendMessageInput,
            OpenClawSpawnSessionInput,
        },
        dispatch_openclaw_session as dispatch_openclaw_session_with_services,
        hydrate_sidebar_session_task_links, mark_openclaw_session_canceled,
        sync_tasks_for_sidebar_sessions, OpenClawChatSendInput, OpenClawChatSendResult,
        OpenClawChatService, OpenClawChatSnapshot, OpenClawChatSnapshotInput,
        OpenClawDispatchSessionInput, OpenClawDispatchSessionResult, OpenClawSidebarSnapshot,
    },
    services::{review_router::ReviewRouterService, tray},
};

type CommandResult<T> = Result<T, String>;

fn openclaw_command_error_message(error: AppError) -> String {
    error.message().to_string()
}

#[tauri::command]
pub async fn connect_openclaw(
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    input: OpenClawConnectInput,
) -> CommandResult<OpenClawConnectionStatus> {
    openclaw_client
        .connect(input)
        .await
        .map_err(openclaw_command_error_message)
}

#[tauri::command]
pub async fn disconnect_openclaw(
    openclaw_client: State<'_, Arc<OpenClawClient>>,
) -> CommandResult<OpenClawConnectionStatus> {
    openclaw_client
        .disconnect()
        .await
        .map_err(openclaw_command_error_message)
}

#[tauri::command]
pub async fn get_openclaw_status(
    openclaw_client: State<'_, Arc<OpenClawClient>>,
) -> CommandResult<OpenClawConnectionStatus> {
    Ok(openclaw_client.status().await)
}

#[tauri::command]
pub async fn get_openclaw_sidebar_snapshot<R: tauri::Runtime>(
    app: AppHandle<R>,
    database: State<'_, Arc<Database>>,
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    openclaw_chat: State<'_, Arc<OpenClawChatService>>,
    review_router: State<'_, Arc<ReviewRouterService>>,
) -> CommandResult<OpenClawSidebarSnapshot> {
    let mut snapshot = build_openclaw_sidebar_snapshot(openclaw_client.inner()).await;
    hydrate_sidebar_session_task_links(database.inner(), &mut snapshot.sessions)
        .map_err(openclaw_command_error_message)?;
    let task_transitions = sync_tasks_for_sidebar_sessions(database.inner(), &snapshot.sessions)
        .map_err(openclaw_command_error_message)?;
    let _ = tray::refresh_running_session_tooltip(&app, database.inner());

    for transition in task_transitions {
        if transition.session_status == "failed" {
            let _ = tray::notify_task_status(
                &app,
                database.inner(),
                &transition.project_id,
                &transition.task_id,
                &transition.session_status,
            );
        }
    }

    let reviewable_session_ids = snapshot
        .sessions
        .iter()
        .filter_map(|session| session.task_id.as_ref().map(|_| session.id.clone()))
        .collect::<Vec<_>>();

    if !reviewable_session_ids.is_empty() {
        let database = database.inner().clone();
        let openclaw_client = openclaw_client.inner().clone();
        let openclaw_chat = openclaw_chat.inner().clone();
        let review_router = review_router.inner().clone();
        let app = app.clone();
        openclaw_chat.bind_database(database.clone()).await;

        for session_id in reviewable_session_ids {
            let database = database.clone();
            let openclaw_client = openclaw_client.clone();
            let openclaw_chat = openclaw_chat.clone();
            let review_router = review_router.clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                match review_router
                    .route_session_review(
                        database.as_ref(),
                        openclaw_client.as_ref(),
                        &openclaw_chat,
                        &session_id,
                    )
                    .await
                {
                    Ok(outcome) => {
                        let _ = tray::notify_review_outcome(
                            &app,
                            database.as_ref(),
                            &session_id,
                            &outcome,
                        );
                    }
                    Err(error) => {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %error,
                            "automated review routing failed during sidebar snapshot refresh"
                        );
                    }
                }
            });
        }
    }

    Ok(snapshot)
}

#[tauri::command]
pub async fn get_openclaw_chat_snapshot(
    database: State<'_, Arc<Database>>,
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    openclaw_chat: State<'_, Arc<OpenClawChatService>>,
    input: OpenClawChatSnapshotInput,
) -> CommandResult<OpenClawChatSnapshot> {
    openclaw_chat.bind_database(database.inner().clone()).await;
    openclaw_chat
        .get_snapshot(database.inner(), openclaw_client.inner(), input)
        .await
        .map_err(openclaw_command_error_message)
}

#[tauri::command]
pub async fn list_openclaw_sessions(
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    input: OpenClawListSessionsInput,
) -> CommandResult<Value> {
    openclaw_client
        .list_sessions(input)
        .await
        .map_err(openclaw_command_error_message)
}

#[tauri::command]
pub async fn spawn_openclaw_session(
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    input: OpenClawSpawnSessionInput,
) -> CommandResult<Value> {
    openclaw_client
        .spawn_session(input)
        .await
        .map_err(openclaw_command_error_message)
}

#[tauri::command]
pub async fn dispatch_openclaw_session<R: tauri::Runtime>(
    app: AppHandle<R>,
    database: State<'_, Arc<Database>>,
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    input: OpenClawDispatchSessionInput,
) -> CommandResult<OpenClawDispatchSessionResult> {
    let result =
        dispatch_openclaw_session_with_services(database.inner(), openclaw_client.inner(), input)
            .await
            .map_err(openclaw_command_error_message)?;
    let _ = tray::refresh_running_session_tooltip(&app, database.inner());

    Ok(result)
}

#[tauri::command]
pub async fn send_openclaw_chat_message(
    database: State<'_, Arc<Database>>,
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    openclaw_chat: State<'_, Arc<OpenClawChatService>>,
    input: OpenClawChatSendInput,
) -> CommandResult<OpenClawChatSendResult> {
    openclaw_chat.bind_database(database.inner().clone()).await;
    openclaw_chat
        .send_message(database.inner(), openclaw_client.inner(), input)
        .await
        .map_err(openclaw_command_error_message)
}

#[tauri::command]
pub async fn send_openclaw_message(
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    input: OpenClawSendMessageInput,
) -> CommandResult<Value> {
    openclaw_client
        .send_message(input)
        .await
        .map_err(openclaw_command_error_message)
}

#[tauri::command]
pub async fn kill_openclaw_session<R: tauri::Runtime>(
    app: AppHandle<R>,
    database: State<'_, Arc<Database>>,
    openclaw_client: State<'_, Arc<OpenClawClient>>,
    input: OpenClawKillSessionInput,
) -> CommandResult<Value> {
    let response = openclaw_client
        .kill_session(input)
        .await
        .map_err(openclaw_command_error_message)?;

    if let Some(session_key) = response
        .get("sessionKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let _ = mark_openclaw_session_canceled(database.inner(), session_key)
            .map_err(openclaw_command_error_message)?;
    }

    let _ = tray::refresh_running_session_tooltip(&app, database.inner());

    Ok(response)
}
