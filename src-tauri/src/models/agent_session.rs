use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub project_id: String,
    pub task_id: Option<String>,
    pub source: String,
    pub session_kind: String,
    pub status: String,
    pub program: String,
    pub args_json: String,
    pub env_keys_json: String,
    pub cwd: String,
    pub transport: String,
    pub exit_code: Option<i32>,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}
