use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatMessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatMessageAuthorKind {
    User,
    Dispatch,
    OpenClaw,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub conversation_id: String,
    pub project_id: Option<String>,
    pub agent_session_id: Option<String>,
    pub role: ChatMessageRole,
    pub author_kind: ChatMessageAuthorKind,
    pub body_markdown: String,
    pub metadata_json: Value,
    pub created_at: i64,
}
