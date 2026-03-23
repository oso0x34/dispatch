use std::{
    net::{SocketAddr, TcpListener},
    sync::{Arc, Mutex},
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::PtySize;
use serde::Deserialize;
use tauri::async_runtime::JoinHandle;
use tokio::{
    net::TcpListener as TokioTcpListener,
    sync::oneshot,
    time::{sleep, Duration, Instant},
};

use crate::{
    db::Database,
    error::{AppError, AppResult},
};

use super::pty_manager::{
    self, ManagedTerminalSession, PtyManager, TerminalOutputEvent, TerminalSessionAttachment,
};

const ATTACHMENT_RETRY_WINDOW: Duration = Duration::from_millis(250);
const ATTACHMENT_RETRY_INTERVAL: Duration = Duration::from_millis(10);
const ATTACHMENT_ACTIVE_MESSAGE: &str = "terminal session is already attached";

pub struct TerminalWebsocketService {
    local_addr: SocketAddr,
    shutdown_sender: Mutex<Option<oneshot::Sender<()>>>,
    join_handle: Mutex<Option<JoinHandle<()>>>,
}

impl TerminalWebsocketService {
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub fn session_websocket_url(&self, session_id: &str) -> String {
        format!("ws://{}/ws/terminal/{}", self.local_addr, session_id)
    }
}

impl Drop for TerminalWebsocketService {
    fn drop(&mut self) {
        if let Ok(mut shutdown_sender) = self.shutdown_sender.lock() {
            if let Some(sender) = shutdown_sender.take() {
                let _ = sender.send(());
            }
        }

        if let Ok(mut join_handle) = self.join_handle.lock() {
            if let Some(join_handle) = join_handle.take() {
                join_handle.abort();
            }
        }
    }
}

#[derive(Clone)]
struct TerminalWsRouterState {
    database: Arc<Database>,
    pty_manager: Arc<PtyManager>,
}

#[derive(Debug)]
struct TerminalAttachRejection {
    status: StatusCode,
    message: String,
}

impl TerminalAttachRejection {
    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for TerminalAttachRejection {
    fn into_response(self) -> Response {
        (self.status, self.message).into_response()
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Resize {
        rows: u16,
        cols: u16,
        #[serde(default)]
        pixel_width: u16,
        #[serde(default)]
        pixel_height: u16,
    },
}

pub fn spawn_terminal_ws_server(
    database: Arc<Database>,
    pty_manager: Arc<PtyManager>,
) -> AppResult<TerminalWebsocketService> {
    let std_listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        AppError::new(format!(
            "failed to bind terminal websocket listener: {error}"
        ))
    })?;
    std_listener.set_nonblocking(true).map_err(|error| {
        AppError::new(format!("failed to configure websocket listener: {error}"))
    })?;
    let local_addr = std_listener.local_addr().map_err(|error| {
        AppError::new(format!(
            "failed to inspect websocket listener address: {error}"
        ))
    })?;
    let router = Router::new()
        .route("/ws/terminal/{session_id}", get(attach_terminal))
        .with_state(TerminalWsRouterState {
            database,
            pty_manager,
        });
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();
    let join_handle = tauri::async_runtime::spawn(async move {
        let listener = match TokioTcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(error) => {
                tracing::error!(error = %error, "failed to adopt terminal websocket listener");
                return;
            }
        };
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        });

        if let Err(error) = server.await {
            tracing::error!(error = %error, "terminal websocket server exited with an error");
        }
    });

    Ok(TerminalWebsocketService {
        local_addr,
        shutdown_sender: Mutex::new(Some(shutdown_sender)),
        join_handle: Mutex::new(Some(join_handle)),
    })
}

async fn attach_terminal(
    Path(session_id): Path<String>,
    State(state): State<TerminalWsRouterState>,
    websocket_upgrade: WebSocketUpgrade,
) -> Response {
    match resolve_attachable_session(&state, &session_id).await {
        Ok(attachment) => websocket_upgrade.on_upgrade(move |socket| {
            handle_terminal_socket(state, session_id, attachment, socket)
        }),
        Err(error) => error.into_response(),
    }
}

async fn resolve_attachable_session(
    state: &TerminalWsRouterState,
    session_id: &str,
) -> Result<TerminalSessionAttachment, TerminalAttachRejection> {
    let session = pty_manager::get_agent_session(state.database.as_ref(), session_id)
        .map_err(|error| TerminalAttachRejection::internal(error.message().to_string()))?
        .ok_or_else(|| TerminalAttachRejection::not_found("terminal session was not found"))?;

    if session.transport != "pty" {
        return Err(TerminalAttachRejection::conflict(
            "terminal session does not support websocket attach",
        ));
    }

    if session.status != "running" {
        return Err(TerminalAttachRejection::conflict(
            "terminal session is no longer running",
        ));
    }

    let managed_session = state.pty_manager.get(session_id).ok_or_else(|| {
        TerminalAttachRejection::conflict("terminal session is not owned by this backend process")
    })?;

    if let Some(exit_status) = managed_session
        .try_wait()
        .map_err(|error| TerminalAttachRejection::internal(error.message().to_string()))?
    {
        let _ = state.pty_manager.remove_session(session_id);
        let _ = pty_manager::record_terminal_session_exit(
            state.database.as_ref(),
            managed_session.as_ref(),
            session_id,
            &exit_status,
        );
        return Err(TerminalAttachRejection::conflict(
            "terminal session is no longer running",
        ));
    }

    let deadline = Instant::now() + ATTACHMENT_RETRY_WINDOW;

    loop {
        match managed_session.try_acquire_attachment() {
            Ok(attachment) => return Ok(attachment),
            Err(error)
                if error.message() == ATTACHMENT_ACTIVE_MESSAGE && Instant::now() < deadline =>
            {
                sleep(ATTACHMENT_RETRY_INTERVAL).await;
            }
            Err(error) => {
                return Err(TerminalAttachRejection::conflict(
                    error.message().to_string(),
                ));
            }
        }
    }
}

async fn handle_terminal_socket(
    state: TerminalWsRouterState,
    session_id: String,
    attachment: TerminalSessionAttachment,
    socket: WebSocket,
) {
    let mut output_receiver = attachment.session().subscribe_output();
    let (mut sender, mut receiver) = socket.split();
    let (output_closed_sender, mut output_closed_receiver) = oneshot::channel::<()>();

    let output_task = tokio::spawn(async move {
        loop {
            match output_receiver.recv().await {
                Ok(TerminalOutputEvent::Data(chunk)) => {
                    if sender.send(Message::Binary(chunk.into())).await.is_err() {
                        break;
                    }
                }
                Ok(TerminalOutputEvent::Closed) => {
                    let _ = sender.send(Message::Close(None)).await;
                    let _ = output_closed_sender.send(());
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    let _ = output_closed_sender.send(());
                    break;
                }
            }
        }
    });

    let mut output_ended = false;

    loop {
        tokio::select! {
            closed = &mut output_closed_receiver => {
                output_ended = closed.is_ok();
                break;
            }
            message = receiver.next() => {
                let Some(message) = message else {
                    break;
                };

                match message {
                    Ok(Message::Binary(bytes)) => {
                        if attachment.session().write_all(&bytes).is_err() {
                            break;
                        }
                    }
                    Ok(Message::Text(text)) => {
                        if handle_client_message(attachment.session(), text.as_str()).is_err() {
                            break;
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                    Err(_) => break,
                }
            }
        }
    }

    output_task.abort();

    if output_ended {
        sync_terminal_session_state_after_output_close(&state, &session_id).await;
    } else {
        sync_terminal_session_state(&state, &session_id);
    }
}

fn handle_client_message(session: &ManagedTerminalSession, payload: &str) -> AppResult<()> {
    let message = serde_json::from_str::<ClientMessage>(payload)
        .map_err(|error| AppError::new(format!("invalid terminal websocket message: {error}")))?;

    match message {
        ClientMessage::Resize {
            rows,
            cols,
            pixel_width,
            pixel_height,
        } => session.resize(PtySize {
            rows,
            cols,
            pixel_width,
            pixel_height,
        }),
    }
}

fn sync_terminal_session_state(state: &TerminalWsRouterState, session_id: &str) {
    let Some(session) = state.pty_manager.get(session_id) else {
        return;
    };

    let Ok(Some(exit_status)) = session.try_wait() else {
        return;
    };

    let _ = state.pty_manager.remove_session(session_id);
    let _ = pty_manager::record_terminal_session_exit(
        state.database.as_ref(),
        session.as_ref(),
        session_id,
        &exit_status,
    );
}

async fn sync_terminal_session_state_after_output_close(
    state: &TerminalWsRouterState,
    session_id: &str,
) {
    let Some(session) = state.pty_manager.get(session_id) else {
        return;
    };
    let deadline = Instant::now() + Duration::from_secs(1);

    loop {
        match session.try_wait() {
            Ok(Some(exit_status)) => {
                let _ = state.pty_manager.remove_session(session_id);
                let _ = pty_manager::record_terminal_session_exit(
                    state.database.as_ref(),
                    session.as_ref(),
                    session_id,
                    &exit_status,
                );
                return;
            }
            Ok(None) if Instant::now() < deadline => sleep(Duration::from_millis(10)).await,
            Ok(None) | Err(_) => return,
        }
    }
}
