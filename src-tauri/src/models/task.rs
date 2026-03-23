use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSubtask {
    pub id: String,
    pub text: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description_markdown: String,
    pub priority: String,
    pub labels: Vec<String>,
    pub subtasks: Vec<TaskSubtask>,
    pub review_notes_markdown: String,
    pub assignee: Option<String>,
    pub workflow_state: String,
    pub last_run_state: String,
    pub last_session_id: Option<String>,
    pub assigned_agent_mode: Option<String>,
    pub markdown_export_path: Option<String>,
    pub blocked_reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
}
