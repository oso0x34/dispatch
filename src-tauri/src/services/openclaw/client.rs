use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use futures_util::{
    stream::{SplitSink, SplitStream},
    Sink, SinkExt, StreamExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::async_runtime::JoinHandle;
use tokio::{
    net::TcpStream,
    sync::{mpsc, oneshot, Mutex, RwLock},
    time::{sleep, timeout, Instant},
};
use tokio_tungstenite::{
    connect_async, tungstenite::protocol::Message, MaybeTlsStream, WebSocketStream,
};

use crate::error::{AppError, AppResult};

use super::protocol::{
    build_connect_request, ConnectChallengePayload, GatewayErrorPayload, GatewayRequestFrame,
    HelloOkPayload, IncomingFrame, DEFAULT_OPENCLAW_GATEWAY_URL, METHOD_AGENT, METHOD_CHAT_ABORT,
    METHOD_CHAT_HISTORY, METHOD_CHAT_SEND, METHOD_CHAT_SUBSCRIBE, METHOD_HEALTH,
    METHOD_SESSIONS_LIST, METHOD_STATUS, METHOD_SYSTEM_PRESENCE, OPENCLAW_CONNECT_TIMEOUT_MS,
};

const STATE_DISCONNECTED: &str = "disconnected";
const STATE_CONNECTING: &str = "connecting";
const STATE_CONNECTED: &str = "connected";
const STATE_RECONNECTING: &str = "reconnecting";
const INITIAL_CONNECT_WAIT: Duration = Duration::from_millis(750);
const CONNECT_STATUS_POLL_INTERVAL: Duration = Duration::from_millis(25);
const RECONNECT_BACKOFF_MIN: Duration = Duration::from_millis(250);
const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(5);

type GatewaySocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type GatewayWriteHalf = SplitSink<GatewaySocket, Message>;
type GatewayReadHalf = SplitStream<GatewaySocket>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawConnectionStatus {
    pub state: String,
    pub gateway_url: Option<String>,
    pub connected_at: Option<i64>,
    pub last_error: Option<String>,
    pub protocol_version: Option<u32>,
    pub server_version: Option<String>,
    pub tick_interval_ms: Option<u64>,
    pub available_methods: Vec<String>,
    pub available_events: Vec<String>,
    pub hello_snapshot: Option<Value>,
    pub status_details: Option<Value>,
    pub health_details: Option<Value>,
    pub presence_details: Option<Value>,
    pub last_event_at: Option<i64>,
    pub last_event_seq: Option<u64>,
}

impl Default for OpenClawConnectionStatus {
    fn default() -> Self {
        Self {
            state: STATE_DISCONNECTED.to_string(),
            gateway_url: None,
            connected_at: None,
            last_error: None,
            protocol_version: None,
            server_version: None,
            tick_interval_ms: None,
            available_methods: Vec::new(),
            available_events: Vec::new(),
            hello_snapshot: None,
            status_details: None,
            health_details: None,
            presence_details: None,
            last_event_at: None,
            last_event_seq: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawConnectInput {
    pub gateway_url: Option<String>,
    pub auth_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawListSessionsInput {
    pub limit: Option<u32>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSpawnSessionInput {
    pub message: String,
    pub agent_id: Option<String>,
    pub session_key: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSendMessageInput {
    pub session_key: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawChatHistoryInput {
    pub session_key: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawChatSubscribeInput {
    pub session_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawKillSessionInput {
    pub session_key: String,
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OpenClawConnectConfig {
    gateway_url: String,
    auth_token: Option<String>,
}

struct PendingRequest {
    respond_to: oneshot::Sender<AppResult<Value>>,
    expect_final: bool,
}

enum DriverCommand {
    Request {
        method: String,
        params: Value,
        expect_final: bool,
        respond_to: oneshot::Sender<AppResult<Value>>,
    },
    Disconnect,
}

struct ClientLifecycle {
    desired_config: Option<OpenClawConnectConfig>,
    control_tx: Option<mpsc::UnboundedSender<DriverCommand>>,
    driver_task: Option<JoinHandle<()>>,
    generation: u64,
}

impl Default for ClientLifecycle {
    fn default() -> Self {
        Self {
            desired_config: None,
            control_tx: None,
            driver_task: None,
            generation: 0,
        }
    }
}

struct OpenClawClientInner {
    status: RwLock<OpenClawConnectionStatus>,
    lifecycle: Mutex<ClientLifecycle>,
    request_counter: AtomicU64,
    event_subscriber_counter: AtomicU64,
    event_subscribers:
        Mutex<HashMap<u64, mpsc::UnboundedSender<super::protocol::GatewayEventFrame>>>,
}

#[derive(Clone)]
pub struct OpenClawClient {
    inner: Arc<OpenClawClientInner>,
}

impl Default for OpenClawClient {
    fn default() -> Self {
        Self {
            inner: Arc::new(OpenClawClientInner {
                status: RwLock::new(OpenClawConnectionStatus::default()),
                lifecycle: Mutex::new(ClientLifecycle::default()),
                request_counter: AtomicU64::new(1),
                event_subscriber_counter: AtomicU64::new(1),
                event_subscribers: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl OpenClawClient {
    pub async fn connect(
        &self,
        input: OpenClawConnectInput,
    ) -> AppResult<OpenClawConnectionStatus> {
        let config = normalize_connect_input(input)?;

        let should_spawn_driver = {
            let mut lifecycle = self.inner.lifecycle.lock().await;
            let driver_missing = lifecycle.driver_task.is_none();
            let config_changed = lifecycle.desired_config.as_ref() != Some(&config);

            if config_changed || driver_missing {
                lifecycle.generation = lifecycle.generation.saturating_add(1);
                let generation = lifecycle.generation;
                if let Some(control_tx) = lifecycle.control_tx.take() {
                    let _ = control_tx.send(DriverCommand::Disconnect);
                }
                let _ = lifecycle.driver_task.take();

                let (control_tx, control_rx) = mpsc::unbounded_channel();
                lifecycle.desired_config = Some(config.clone());
                lifecycle.control_tx = Some(control_tx);
                lifecycle.driver_task = Some(tauri::async_runtime::spawn(run_driver_loop(
                    self.inner.clone(),
                    config.clone(),
                    control_rx,
                    generation,
                )));
                true
            } else {
                false
            }
        };

        if should_spawn_driver {
            set_connection_state(
                &self.inner,
                STATE_CONNECTING,
                Some(config.gateway_url.clone()),
                None,
            )
            .await;
        }

        Ok(self.wait_for_connection_progress().await)
    }

    pub async fn disconnect(&self) -> AppResult<OpenClawConnectionStatus> {
        let control_tx = {
            let mut lifecycle = self.inner.lifecycle.lock().await;
            lifecycle.generation = lifecycle.generation.saturating_add(1);
            lifecycle.desired_config = None;
            lifecycle.driver_task = None;
            lifecycle.control_tx.take()
        };

        if let Some(control_tx) = control_tx {
            let _ = control_tx.send(DriverCommand::Disconnect);
        }

        clear_connection_state(&self.inner, None).await;

        Ok(self.status().await)
    }

    pub async fn status(&self) -> OpenClawConnectionStatus {
        self.inner.status.read().await.clone()
    }

    pub async fn list_sessions(&self, input: OpenClawListSessionsInput) -> AppResult<Value> {
        let mut params = serde_json::Map::new();
        params.insert("limit".to_string(), Value::from(input.limit.unwrap_or(50)));
        params.insert("includeGlobal".to_string(), Value::Bool(true));
        params.insert("includeUnknown".to_string(), Value::Bool(true));

        if let Some(search) = normalize_optional_string(input.search.as_deref()) {
            params.insert("search".to_string(), Value::String(search));
        }

        self.request_json(METHOD_SESSIONS_LIST, Value::Object(params), false)
            .await
    }

    pub async fn spawn_session(&self, input: OpenClawSpawnSessionInput) -> AppResult<Value> {
        let message = validate_required_field("openclaw spawn message", &input.message)?;
        let mut params = serde_json::Map::new();
        params.insert("message".to_string(), Value::String(message));
        params.insert("deliver".to_string(), Value::Bool(false));
        params.insert(
            "idempotencyKey".to_string(),
            Value::String(self.next_operation_id("spawn")),
        );

        if let Some(agent_id) = normalize_optional_string(input.agent_id.as_deref()) {
            params.insert("agentId".to_string(), Value::String(agent_id));
        }

        if let Some(session_key) = normalize_optional_string(input.session_key.as_deref()) {
            params.insert("sessionKey".to_string(), Value::String(session_key));
        }

        if let Some(label) = normalize_optional_string(input.label.as_deref()) {
            params.insert("label".to_string(), Value::String(label));
        }

        self.request_json(METHOD_AGENT, Value::Object(params), false)
            .await
    }

    pub async fn send_message(&self, input: OpenClawSendMessageInput) -> AppResult<Value> {
        let session_key = validate_required_field("openclaw session key", &input.session_key)?;
        let message = validate_required_field("openclaw message", &input.message)?;

        self.request_json(
            METHOD_CHAT_SEND,
            json!({
                "sessionKey": session_key,
                "message": message,
                "deliver": false,
                "idempotencyKey": self.next_operation_id("send"),
            }),
            false,
        )
        .await
    }

    pub async fn chat_history(&self, input: OpenClawChatHistoryInput) -> AppResult<Value> {
        let mut params = serde_json::Map::new();

        if let Some(session_key) = normalize_optional_string(input.session_key.as_deref()) {
            params.insert("sessionKey".to_string(), Value::String(session_key));
        }

        if let Some(limit) = input.limit.filter(|value| *value > 0) {
            params.insert("limit".to_string(), Value::from(limit));
        }

        self.request_json(METHOD_CHAT_HISTORY, Value::Object(params), false)
            .await
    }

    pub async fn subscribe_chat(&self, input: OpenClawChatSubscribeInput) -> AppResult<Value> {
        let mut params = serde_json::Map::new();

        if let Some(session_key) = normalize_optional_string(input.session_key.as_deref()) {
            params.insert("sessionKey".to_string(), Value::String(session_key));
        }

        self.request_json(METHOD_CHAT_SUBSCRIBE, Value::Object(params), false)
            .await
    }

    pub async fn kill_session(&self, input: OpenClawKillSessionInput) -> AppResult<Value> {
        let session_key = validate_required_field("openclaw session key", &input.session_key)?;
        let mut params = serde_json::Map::new();
        params.insert("sessionKey".to_string(), Value::String(session_key));

        if let Some(run_id) = normalize_optional_string(input.run_id.as_deref()) {
            params.insert("runId".to_string(), Value::String(run_id));
        }

        self.request_json(METHOD_CHAT_ABORT, Value::Object(params), false)
            .await
    }

    pub async fn subscribe_events(
        &self,
    ) -> mpsc::UnboundedReceiver<super::protocol::GatewayEventFrame> {
        let subscriber_id = self
            .inner
            .event_subscriber_counter
            .fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::unbounded_channel();
        let mut subscribers = self.inner.event_subscribers.lock().await;
        subscribers.insert(subscriber_id, sender);
        receiver
    }

    async fn request_json(
        &self,
        method: &str,
        params: Value,
        expect_final: bool,
    ) -> AppResult<Value> {
        let control_tx = {
            let lifecycle = self.inner.lifecycle.lock().await;
            lifecycle.control_tx.clone()
        }
        .ok_or_else(|| AppError::new("openclaw client is not connected"))?;

        if self.status().await.state != STATE_CONNECTED {
            return Err(AppError::new("openclaw client is not connected"));
        }

        let (respond_to, response_rx) = oneshot::channel();
        control_tx
            .send(DriverCommand::Request {
                method: method.to_string(),
                params,
                expect_final,
                respond_to,
            })
            .map_err(|_| AppError::new("openclaw client request loop is unavailable"))?;

        response_rx
            .await
            .map_err(|_| AppError::new("openclaw client request loop terminated"))?
    }

    async fn wait_for_connection_progress(&self) -> OpenClawConnectionStatus {
        let deadline = Instant::now() + INITIAL_CONNECT_WAIT;

        loop {
            let status = self.status().await;
            if matches!(
                status.state.as_str(),
                STATE_CONNECTED | STATE_RECONNECTING | STATE_DISCONNECTED
            ) {
                return status;
            }

            if Instant::now() >= deadline {
                return status;
            }

            sleep(CONNECT_STATUS_POLL_INTERVAL).await;
        }
    }

    fn next_operation_id(&self, prefix: &str) -> String {
        format!(
            "dispatch-openclaw-{prefix}-{}",
            self.inner.request_counter.fetch_add(1, Ordering::SeqCst)
        )
    }
}

async fn run_driver_loop(
    inner: Arc<OpenClawClientInner>,
    config: OpenClawConnectConfig,
    mut control_rx: mpsc::UnboundedReceiver<DriverCommand>,
    generation: u64,
) {
    let mut backoff = RECONNECT_BACKOFF_MIN;
    let mut has_connected_once = false;

    loop {
        if !driver_is_current(&inner, &config, generation).await {
            return;
        }

        let next_state = if has_connected_once {
            STATE_RECONNECTING
        } else {
            STATE_CONNECTING
        };
        set_connection_state_if_current(
            &inner,
            &config,
            generation,
            next_state,
            Some(config.gateway_url.clone()),
            None,
        )
        .await;

        match connect_socket(&config, &inner.request_counter).await {
            Ok((socket, hello_ok)) => {
                if !driver_is_current(&inner, &config, generation).await {
                    return;
                }

                has_connected_once = true;
                backoff = RECONNECT_BACKOFF_MIN;

                apply_hello_snapshot(&inner, &config.gateway_url, &hello_ok).await;

                let (mut write, read) = socket.split();
                let pending_requests =
                    Arc::new(Mutex::new(HashMap::<String, PendingRequest>::new()));
                let (close_tx, close_rx) = oneshot::channel();
                let mut close_rx = close_rx;
                let read_task = tauri::async_runtime::spawn(read_gateway_loop(
                    inner.clone(),
                    read,
                    pending_requests.clone(),
                    close_tx,
                ));

                if let Err(error) = refresh_connection_snapshots(
                    &inner,
                    &mut write,
                    &pending_requests,
                    &config.gateway_url,
                    &inner.request_counter,
                )
                .await
                {
                    let message = error.message().to_string();
                    read_task.abort();
                    set_connection_state_if_current(
                        &inner,
                        &config,
                        generation,
                        STATE_RECONNECTING,
                        Some(config.gateway_url.clone()),
                        Some(message),
                    )
                    .await;
                    sleep(backoff).await;
                    backoff = std::cmp::min(backoff.saturating_mul(2), RECONNECT_BACKOFF_MAX);
                    continue;
                }

                loop {
                    tokio::select! {
                        maybe_command = control_rx.recv() => {
                            match maybe_command {
                                Some(DriverCommand::Request {
                                    method,
                                    params,
                                    expect_final,
                                    respond_to,
                                }) => {
                                    let result = send_gateway_request(
                                        &mut write,
                                        &pending_requests,
                                        &inner.request_counter,
                                        &method,
                                        params,
                                        expect_final,
                                    ).await;
                                    let _ = respond_to.send(result);
                                }
                                Some(DriverCommand::Disconnect) => {
                                    let _ = write.send(Message::Close(None)).await;
                                    read_task.abort();
                                    clear_connection_state_if_current(
                                        &inner,
                                        &config,
                                        generation,
                                        Some(config.gateway_url.clone()),
                                    ).await;
                                    return;
                                }
                                None => {
                                    let _ = write.send(Message::Close(None)).await;
                                    read_task.abort();
                                    clear_connection_state_if_current(
                                        &inner,
                                        &config,
                                        generation,
                                        Some(config.gateway_url.clone()),
                                    ).await;
                                    return;
                                }
                            }
                        }
                        close_reason = &mut close_rx => {
                            read_task.abort();
                            let reason = close_reason.unwrap_or_else(|_| "openclaw gateway connection closed".to_string());
                            set_connection_state_if_current(
                                &inner,
                                &config,
                                generation,
                                STATE_RECONNECTING,
                                Some(config.gateway_url.clone()),
                                Some(reason),
                            ).await;
                            break;
                        }
                    }
                }
            }
            Err(error) => {
                set_connection_state_if_current(
                    &inner,
                    &config,
                    generation,
                    STATE_RECONNECTING,
                    Some(config.gateway_url.clone()),
                    Some(error.message().to_string()),
                )
                .await;
            }
        }

        if !driver_is_current(&inner, &config, generation).await {
            return;
        }

        sleep(backoff).await;
        backoff = std::cmp::min(backoff.saturating_mul(2), RECONNECT_BACKOFF_MAX);
    }
}

async fn connect_socket(
    config: &OpenClawConnectConfig,
    request_counter: &AtomicU64,
) -> AppResult<(GatewaySocket, HelloOkPayload)> {
    let (mut socket, _) = connect_async(config.gateway_url.as_str())
        .await
        .map_err(|error| {
            AppError::new(format!("failed to connect to OpenClaw gateway: {error}"))
        })?;
    let connect_timeout = Duration::from_millis(OPENCLAW_CONNECT_TIMEOUT_MS);

    let nonce = timeout(connect_timeout, wait_for_connect_challenge(&mut socket))
        .await
        .map_err(|_| AppError::new("timed out waiting for OpenClaw connect challenge"))??;
    let request_id = next_atomic_request_id(request_counter);
    let connect_request = build_connect_request(request_id.clone(), config.auth_token.as_deref());

    send_frame(&mut socket, &connect_request).await?;
    let hello_ok = timeout(
        connect_timeout,
        wait_for_connect_response(&mut socket, &request_id),
    )
    .await
    .map_err(|_| AppError::new("timed out waiting for OpenClaw hello response"))??;

    if hello_ok.payload_type != "hello-ok" {
        return Err(AppError::new("OpenClaw connect did not return hello-ok"));
    }

    let _ = nonce;
    Ok((socket, hello_ok))
}

async fn wait_for_connect_challenge(socket: &mut GatewaySocket) -> AppResult<String> {
    loop {
        let message = socket
            .next()
            .await
            .ok_or_else(|| AppError::new("OpenClaw gateway closed before connect challenge"))?
            .map_err(|error| {
                AppError::new(format!(
                    "failed reading OpenClaw connect challenge: {error}"
                ))
            })?;

        let Some(text) = message_to_text(message) else {
            continue;
        };

        let frame: IncomingFrame = serde_json::from_str(&text)
            .map_err(|error| AppError::new(format!("failed to parse OpenClaw frame: {error}")))?;

        if let IncomingFrame::Event(event) = frame {
            if event.event != "connect.challenge" {
                continue;
            }

            let payload = event
                .payload
                .ok_or_else(|| AppError::new("OpenClaw connect challenge payload was missing"))?;
            let challenge: ConnectChallengePayload =
                serde_json::from_value(payload).map_err(|error| {
                    AppError::new(format!("failed to decode OpenClaw challenge: {error}"))
                })?;

            return validate_required_field("OpenClaw challenge nonce", &challenge.nonce);
        }
    }
}

async fn wait_for_connect_response(
    socket: &mut GatewaySocket,
    request_id: &str,
) -> AppResult<HelloOkPayload> {
    loop {
        let message = socket
            .next()
            .await
            .ok_or_else(|| AppError::new("OpenClaw gateway closed before hello response"))?
            .map_err(|error| {
                AppError::new(format!("failed reading OpenClaw hello response: {error}"))
            })?;

        let Some(text) = message_to_text(message) else {
            continue;
        };

        let frame: IncomingFrame = serde_json::from_str(&text)
            .map_err(|error| AppError::new(format!("failed to parse OpenClaw frame: {error}")))?;

        if let IncomingFrame::Response(response) = frame {
            if response.id != request_id {
                continue;
            }

            if !response.ok {
                return Err(gateway_response_error(response.error));
            }

            let payload = response
                .payload
                .ok_or_else(|| AppError::new("OpenClaw hello response payload was missing"))?;

            return serde_json::from_value(payload).map_err(|error| {
                AppError::new(format!("failed to decode OpenClaw hello payload: {error}"))
            });
        }
    }
}

async fn refresh_connection_snapshots(
    inner: &Arc<OpenClawClientInner>,
    write: &mut GatewayWriteHalf,
    pending_requests: &Arc<Mutex<HashMap<String, PendingRequest>>>,
    gateway_url: &str,
    request_counter: &AtomicU64,
) -> AppResult<()> {
    let status_details = send_gateway_request(
        write,
        pending_requests,
        request_counter,
        METHOD_STATUS,
        json!({}),
        false,
    )
    .await?;
    let health_details = send_gateway_request(
        write,
        pending_requests,
        request_counter,
        METHOD_HEALTH,
        json!({}),
        false,
    )
    .await?;
    let presence_details = send_gateway_request(
        write,
        pending_requests,
        request_counter,
        METHOD_SYSTEM_PRESENCE,
        json!({}),
        false,
    )
    .await?;

    let mut status = inner.status.write().await;
    status.state = STATE_CONNECTED.to_string();
    status.gateway_url = Some(gateway_url.to_string());
    status.connected_at = Some(now_unix_seconds());
    status.last_error = None;
    status.status_details = Some(status_details);
    status.health_details = Some(health_details);
    status.presence_details = Some(presence_details);

    Ok(())
}

async fn send_gateway_request(
    write: &mut GatewayWriteHalf,
    pending_requests: &Arc<Mutex<HashMap<String, PendingRequest>>>,
    request_counter: &AtomicU64,
    method: &str,
    params: Value,
    expect_final: bool,
) -> AppResult<Value> {
    let request_id = next_atomic_request_id(request_counter);
    let (respond_to, response_rx) = oneshot::channel();

    {
        let mut pending = pending_requests.lock().await;
        pending.insert(
            request_id.clone(),
            PendingRequest {
                respond_to,
                expect_final,
            },
        );
    }

    let frame = GatewayRequestFrame {
        frame_type: "req",
        id: request_id.clone(),
        method: method.to_string(),
        params,
    };

    if let Err(error) = send_frame(write, &frame).await {
        let mut pending = pending_requests.lock().await;
        pending.remove(&request_id);
        return Err(error);
    }

    response_rx
        .await
        .map_err(|_| AppError::new("OpenClaw gateway request loop terminated"))?
}

async fn read_gateway_loop(
    inner: Arc<OpenClawClientInner>,
    mut read: GatewayReadHalf,
    pending_requests: Arc<Mutex<HashMap<String, PendingRequest>>>,
    close_tx: oneshot::Sender<String>,
) {
    let reason = loop {
        match read.next().await {
            Some(Ok(message)) => {
                let Some(text) = message_to_text(message) else {
                    continue;
                };

                match serde_json::from_str::<IncomingFrame>(&text) {
                    Ok(IncomingFrame::Event(event)) => {
                        apply_gateway_event(&inner, &event).await;
                    }
                    Ok(IncomingFrame::Response(response)) => {
                        if let Err(error) =
                            resolve_pending_request(&pending_requests, response).await
                        {
                            break error.message().to_string();
                        }
                    }
                    Err(error) => {
                        break format!("failed to parse OpenClaw frame: {error}");
                    }
                }
            }
            Some(Err(error)) => {
                break format!("OpenClaw gateway read failed: {error}");
            }
            None => {
                break "OpenClaw gateway connection closed".to_string();
            }
        }
    };

    drain_pending_requests(&pending_requests, &reason).await;
    let _ = close_tx.send(reason);
}

async fn resolve_pending_request(
    pending_requests: &Arc<Mutex<HashMap<String, PendingRequest>>>,
    response: super::protocol::GatewayResponseFrame,
) -> AppResult<()> {
    let should_keep_pending = response.ok
        && response
            .payload
            .as_ref()
            .and_then(|payload| payload.get("status"))
            .and_then(Value::as_str)
            == Some("accepted")
        && pending_requests
            .lock()
            .await
            .get(&response.id)
            .map(|pending| pending.expect_final)
            .unwrap_or(false);

    if should_keep_pending {
        return Ok(());
    }

    let pending_request = {
        let mut pending = pending_requests.lock().await;
        pending.remove(&response.id)
    };

    let Some(pending_request) = pending_request else {
        return Ok(());
    };

    let result = if response.ok {
        Ok(response.payload.unwrap_or(Value::Null))
    } else {
        Err(gateway_response_error(response.error))
    };

    let _ = pending_request.respond_to.send(result);

    Ok(())
}

async fn apply_gateway_event(
    inner: &Arc<OpenClawClientInner>,
    event: &super::protocol::GatewayEventFrame,
) {
    {
        let mut status = inner.status.write().await;
        status.last_event_at = Some(now_unix_seconds());

        if let Some(seq) = event.seq {
            status.last_event_seq = Some(seq);
        }

        match event.event.as_str() {
            "health" => {
                status.health_details = event.payload.clone();
            }
            "presence" | "system-presence" => {
                status.presence_details = event.payload.clone();
            }
            _ => {}
        }
    }

    broadcast_gateway_event(inner, event).await;
}

async fn broadcast_gateway_event(
    inner: &Arc<OpenClawClientInner>,
    event: &super::protocol::GatewayEventFrame,
) {
    let stale_subscriber_ids = {
        let subscribers = inner.event_subscribers.lock().await;
        subscribers
            .iter()
            .filter_map(|(subscriber_id, subscriber)| {
                subscriber.send(event.clone()).err().map(|_| *subscriber_id)
            })
            .collect::<Vec<_>>()
    };

    if stale_subscriber_ids.is_empty() {
        return;
    }

    let mut subscribers = inner.event_subscribers.lock().await;
    for subscriber_id in stale_subscriber_ids {
        subscribers.remove(&subscriber_id);
    }
}

async fn send_frame<S, TParams>(
    socket: &mut S,
    frame: &GatewayRequestFrame<TParams>,
) -> AppResult<()>
where
    S: Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    TParams: Serialize,
{
    let payload = serde_json::to_string(frame)
        .map_err(|error| AppError::new(format!("failed to serialize OpenClaw request: {error}")))?;
    socket
        .send(Message::Text(payload.into()))
        .await
        .map_err(|error| AppError::new(format!("failed to write OpenClaw request: {error}")))
}

async fn apply_hello_snapshot(
    inner: &Arc<OpenClawClientInner>,
    gateway_url: &str,
    hello_ok: &HelloOkPayload,
) {
    let mut status = inner.status.write().await;
    status.state = STATE_CONNECTED.to_string();
    status.gateway_url = Some(gateway_url.to_string());
    status.connected_at = Some(now_unix_seconds());
    status.last_error = None;
    status.protocol_version = Some(hello_ok.protocol);
    status.server_version = hello_ok
        .server
        .as_ref()
        .map(|server| server.version.clone());
    status.tick_interval_ms = hello_ok
        .policy
        .as_ref()
        .map(|policy| policy.tick_interval_ms);
    status.available_methods = hello_ok
        .features
        .as_ref()
        .map(|features| features.methods.clone())
        .unwrap_or_default();
    status.available_events = hello_ok
        .features
        .as_ref()
        .map(|features| features.events.clone())
        .unwrap_or_default();
    status.hello_snapshot = hello_ok.snapshot.clone();
}

async fn set_connection_state(
    inner: &Arc<OpenClawClientInner>,
    state: &str,
    gateway_url: Option<String>,
    last_error: Option<String>,
) {
    let mut status = inner.status.write().await;
    status.state = state.to_string();
    status.gateway_url = gateway_url.or_else(|| status.gateway_url.clone());
    status.connected_at = if state == STATE_CONNECTED {
        Some(now_unix_seconds())
    } else {
        None
    };
    status.last_error = last_error;
    if state != STATE_CONNECTED {
        status.status_details = None;
        status.health_details = None;
        status.presence_details = None;
    }
}

async fn clear_connection_state(inner: &Arc<OpenClawClientInner>, gateway_url: Option<String>) {
    let mut status = inner.status.write().await;
    let previous_url = status.gateway_url.clone();
    *status = OpenClawConnectionStatus::default();
    status.gateway_url = gateway_url.or(previous_url);
}

async fn driver_is_current(
    inner: &Arc<OpenClawClientInner>,
    expected_config: &OpenClawConnectConfig,
    expected_generation: u64,
) -> bool {
    let lifecycle = inner.lifecycle.lock().await;
    lifecycle.generation == expected_generation
        && lifecycle.desired_config.as_ref() == Some(expected_config)
}

async fn set_connection_state_if_current(
    inner: &Arc<OpenClawClientInner>,
    expected_config: &OpenClawConnectConfig,
    expected_generation: u64,
    state: &str,
    gateway_url: Option<String>,
    last_error: Option<String>,
) {
    if !driver_is_current(inner, expected_config, expected_generation).await {
        return;
    }

    set_connection_state(inner, state, gateway_url, last_error).await;
}

async fn clear_connection_state_if_current(
    inner: &Arc<OpenClawClientInner>,
    expected_config: &OpenClawConnectConfig,
    expected_generation: u64,
    gateway_url: Option<String>,
) {
    if !driver_is_current(inner, expected_config, expected_generation).await {
        return;
    }

    clear_connection_state(inner, gateway_url).await;
}

async fn drain_pending_requests(
    pending_requests: &Arc<Mutex<HashMap<String, PendingRequest>>>,
    reason: &str,
) {
    let pending = {
        let mut pending = pending_requests.lock().await;
        pending.drain().collect::<Vec<_>>()
    };

    for (_, pending_request) in pending {
        let _ = pending_request
            .respond_to
            .send(Err(AppError::new(reason.to_string())));
    }
}

fn normalize_connect_input(input: OpenClawConnectInput) -> AppResult<OpenClawConnectConfig> {
    let env_gateway_url = std::env::var("OPENCLAW_GATEWAY_URL").ok();
    let env_auth_token = std::env::var("OPENCLAW_GATEWAY_TOKEN").ok();
    let gateway_url =
        normalize_gateway_url(input.gateway_url.as_deref().or(env_gateway_url.as_deref()))?;
    let auth_token =
        normalize_optional_string(input.auth_token.as_deref().or(env_auth_token.as_deref()));

    Ok(OpenClawConnectConfig {
        gateway_url,
        auth_token,
    })
}

fn normalize_gateway_url(raw_value: Option<&str>) -> AppResult<String> {
    let trimmed = raw_value.unwrap_or(DEFAULT_OPENCLAW_GATEWAY_URL).trim();
    if trimmed.is_empty() {
        return Err(AppError::new("OpenClaw gateway URL cannot be blank"));
    }

    let normalized = if trimmed.starts_with("ws://") || trimmed.starts_with("wss://") {
        trimmed.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}")
    } else {
        format!("ws://{trimmed}")
    };

    Ok(normalized)
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn validate_required_field(field_name: &str, value: &str) -> AppResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(AppError::new(format!("{field_name} cannot be blank")));
    }

    Ok(normalized.to_string())
}

fn next_atomic_request_id(request_counter: &AtomicU64) -> String {
    format!(
        "dispatch-openclaw-{}",
        request_counter.fetch_add(1, Ordering::SeqCst)
    )
}

fn gateway_response_error(error: Option<GatewayErrorPayload>) -> AppError {
    match error {
        Some(error) => match error.code {
            Some(code) => AppError::new(format!("OpenClaw {code}: {}", error.message)),
            None => AppError::new(format!("OpenClaw {}", error.message)),
        },
        None => AppError::new("OpenClaw request failed"),
    }
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn message_to_text(message: Message) -> Option<String> {
    match message {
        Message::Text(text) => Some(text.to_string()),
        Message::Binary(bytes) => String::from_utf8(bytes.to_vec()).ok(),
        Message::Close(_) => None,
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => None,
    }
}
