use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_OPENCLAW_GATEWAY_URL: &str = "ws://127.0.0.1:18789";
pub const OPENCLAW_PROTOCOL_VERSION: u32 = 3;
pub const OPENCLAW_CONNECT_TIMEOUT_MS: u64 = 2_000;
pub const OPENCLAW_CLIENT_ID: &str = "dispatch";
pub const OPENCLAW_CLIENT_MODE: &str = "operator";
pub const OPENCLAW_ROLE: &str = "operator";
pub const OPENCLAW_DEFAULT_SCOPES: [&str; 2] = ["operator.read", "operator.write"];
pub const METHOD_STATUS: &str = "status";
pub const METHOD_HEALTH: &str = "health";
pub const METHOD_SYSTEM_PRESENCE: &str = "system-presence";
pub const METHOD_SESSIONS_LIST: &str = "sessions.list";
pub const METHOD_AGENT: &str = "agent";
pub const METHOD_CHAT_HISTORY: &str = "chat.history";
pub const METHOD_CHAT_SUBSCRIBE: &str = "chat.subscribe";
pub const METHOD_CHAT_SEND: &str = "chat.send";
pub const METHOD_CHAT_ABORT: &str = "chat.abort";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectClient {
    pub id: String,
    pub version: String,
    pub platform: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectAuth {
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectParams {
    pub min_protocol: u32,
    pub max_protocol: u32,
    pub client: ConnectClient,
    pub role: String,
    pub scopes: Vec<String>,
    pub caps: Vec<String>,
    pub commands: Vec<String>,
    pub permissions: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<ConnectAuth>,
    pub locale: String,
    pub user_agent: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GatewayRequestFrame<TParams>
where
    TParams: Serialize,
{
    #[serde(rename = "type")]
    pub frame_type: &'static str,
    pub id: String,
    pub method: String,
    pub params: TParams,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayErrorPayload {
    pub code: Option<String>,
    pub message: String,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayResponseFrame {
    pub id: String,
    pub ok: bool,
    pub payload: Option<Value>,
    pub error: Option<GatewayErrorPayload>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayEventFrame {
    pub event: String,
    pub payload: Option<Value>,
    pub seq: Option<u64>,
    pub state_version: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum IncomingFrame {
    #[serde(rename = "event")]
    Event(GatewayEventFrame),
    #[serde(rename = "res")]
    Response(GatewayResponseFrame),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectChallengePayload {
    pub nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelloServerInfo {
    pub version: String,
    pub conn_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelloFeatures {
    pub methods: Vec<String>,
    pub events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelloPolicy {
    pub max_payload: u64,
    pub max_buffered_bytes: u64,
    pub tick_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HelloOkPayload {
    #[serde(rename = "type")]
    pub payload_type: String,
    pub protocol: u32,
    pub server: Option<HelloServerInfo>,
    pub features: Option<HelloFeatures>,
    pub snapshot: Option<Value>,
    pub policy: Option<HelloPolicy>,
}

pub fn build_connect_request(
    id: String,
    auth_token: Option<&str>,
) -> GatewayRequestFrame<ConnectParams> {
    GatewayRequestFrame {
        frame_type: "req",
        id,
        method: "connect".to_string(),
        params: ConnectParams {
            min_protocol: OPENCLAW_PROTOCOL_VERSION,
            max_protocol: OPENCLAW_PROTOCOL_VERSION,
            client: ConnectClient {
                id: OPENCLAW_CLIENT_ID.to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                platform: std::env::consts::OS.to_string(),
                mode: OPENCLAW_CLIENT_MODE.to_string(),
            },
            role: OPENCLAW_ROLE.to_string(),
            scopes: OPENCLAW_DEFAULT_SCOPES
                .iter()
                .map(|scope| (*scope).to_string())
                .collect(),
            caps: Vec::new(),
            commands: Vec::new(),
            permissions: Value::Object(Default::default()),
            auth: auth_token.map(|token| ConnectAuth {
                token: token.to_string(),
            }),
            locale: "en-US".to_string(),
            user_agent: format!("dispatch/{}", env!("CARGO_PKG_VERSION")),
        },
    }
}
