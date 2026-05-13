use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::client::{OpenClawClient, OpenClawConnectionStatus, OpenClawListSessionsInput};

const OPENCLAW_CONNECTED_STATE: &str = "connected";
const OPENCLAW_SESSION_SOURCE: &str = "openclaw";
const OPENCLAW_SESSION_KIND: &str = "orchestrated_agent";
const OPENCLAW_SESSION_ID_PREFIX: &str = "openclaw:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSidebarSnapshot {
    pub status: OpenClawConnectionStatus,
    pub sessions: Vec<OpenClawSidebarSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawSidebarSession {
    pub id: String,
    pub session_key: String,
    pub title: String,
    pub subtitle: String,
    pub source: String,
    pub session_kind: String,
    pub status: String,
    pub task_id: Option<String>,
    pub agent_id: Option<String>,
    pub label: Option<String>,
    pub run_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_activity_at: Option<i64>,
}

pub async fn build_openclaw_sidebar_snapshot(client: &OpenClawClient) -> OpenClawSidebarSnapshot {
    let mut status = client.status().await;
    if status.state != OPENCLAW_CONNECTED_STATE {
        return OpenClawSidebarSnapshot {
            status,
            sessions: Vec::new(),
        };
    }

    let sessions = match client
        .list_sessions(OpenClawListSessionsInput::default())
        .await
    {
        Ok(payload) => normalize_sidebar_sessions(payload),
        Err(error) => {
            if status.last_error.is_none() {
                status.last_error = Some(error.message().to_string());
            }
            Vec::new()
        }
    };

    OpenClawSidebarSnapshot { status, sessions }
}

pub fn openclaw_session_id(session_key: &str) -> String {
    format!("{OPENCLAW_SESSION_ID_PREFIX}{session_key}")
}

fn normalize_sidebar_sessions(payload: Value) -> Vec<OpenClawSidebarSession> {
    let Some(raw_sessions) = payload.get("sessions").and_then(Value::as_array) else {
        return Vec::new();
    };

    let fallback_now = unix_timestamp_seconds();
    let mut sessions = raw_sessions
        .iter()
        .enumerate()
        .filter_map(|(index, raw_session)| {
            normalize_sidebar_session(raw_session, index, fallback_now)
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| right.id.cmp(&left.id))
    });

    sessions
}

fn normalize_sidebar_session(
    raw_session: &Value,
    index: usize,
    fallback_now: i64,
) -> Option<OpenClawSidebarSession> {
    let session_key = first_string(raw_session, &["sessionKey", "key", "id", "session_key"])
        .or_else(|| first_string(raw_session, &["targetSessionKey", "target_session_key"]))?;
    let title = first_string(raw_session, &["title", "label", "name"])
        .or_else(|| first_string(raw_session, &["agentId", "agent_id"]))
        .unwrap_or_else(|| session_key.clone());
    let label = first_string(raw_session, &["label"]);
    let agent_id = first_string(raw_session, &["agentId", "agent_id"]);
    let run_id = first_string(raw_session, &["runId", "run_id"]);
    let task_id = first_string(raw_session, &["taskId", "task_id"]);
    let last_activity_at = first_time(
        raw_session,
        &[
            "lastActivityAt",
            "last_activity_at",
            "updatedAt",
            "updated_at",
        ],
    );
    let created_at = first_time(
        raw_session,
        &[
            "createdAt",
            "created_at",
            "startedAt",
            "started_at",
            "boundAt",
            "bound_at",
        ],
    )
    .or(last_activity_at)
    .unwrap_or(fallback_now.saturating_sub(index as i64));
    let updated_at = first_time(
        raw_session,
        &[
            "updatedAt",
            "updated_at",
            "lastActivityAt",
            "last_activity_at",
        ],
    )
    .or(last_activity_at)
    .unwrap_or(created_at);

    Some(OpenClawSidebarSession {
        id: openclaw_session_id(&session_key),
        session_key: session_key.clone(),
        title,
        subtitle: build_subtitle(&session_key, label.as_deref(), agent_id.as_deref()),
        source: OPENCLAW_SESSION_SOURCE.to_string(),
        session_kind: OPENCLAW_SESSION_KIND.to_string(),
        status: normalize_session_status(raw_session),
        task_id,
        agent_id,
        label,
        run_id,
        created_at,
        updated_at,
        last_activity_at,
    })
}

fn build_subtitle(session_key: &str, label: Option<&str>, agent_id: Option<&str>) -> String {
    let mut parts = Vec::new();

    if let Some(label) = label {
        if !label.eq_ignore_ascii_case(session_key) {
            parts.push(label.to_string());
        }
    }

    if let Some(agent_id) = agent_id {
        parts.push(format!("Agent {agent_id}"));
    }

    parts.push(session_key.to_string());
    parts.join(" · ")
}

fn normalize_session_status(raw_session: &Value) -> String {
    let normalized = first_string(
        raw_session,
        &[
            "status",
            "runStatus",
            "run_state",
            "runtimeState",
            "runtime_state",
            "state",
        ],
    )
    .map(|value| value.trim().to_ascii_lowercase())
    .filter(|value| !value.is_empty());

    match normalized.as_deref() {
        Some("pending" | "queued" | "accepted" | "created") => "pending".to_string(),
        Some("running" | "active" | "live" | "ready" | "streaming") => "running".to_string(),
        Some("succeeded" | "success" | "completed" | "done" | "finished" | "ok") => {
            "succeeded".to_string()
        }
        Some("failed" | "error" | "errored" | "crashed") => "failed".to_string(),
        Some("canceled" | "cancelled" | "aborted" | "terminated") => "canceled".to_string(),
        Some("abandoned") => "abandoned".to_string(),
        Some(other) => other.to_string(),
        None => "running".to_string(),
    }
}

fn first_string(raw_session: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        raw_session.get(*key).and_then(|value| match value {
            Value::String(inner) => {
                let trimmed = inner.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            }
            Value::Number(inner) => Some(inner.to_string()),
            _ => None,
        })
    })
}

fn first_time(raw_session: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| raw_session.get(*key).and_then(normalize_timestamp_value))
}

fn normalize_timestamp_value(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64().map(normalize_timestamp_number),
        Value::String(raw) => raw
            .trim()
            .parse::<i64>()
            .ok()
            .map(normalize_timestamp_number),
        _ => None,
    }
}

fn normalize_timestamp_number(raw: i64) -> i64 {
    if raw >= 1_000_000_000_000 || raw <= -1_000_000_000_000 {
        raw / 1_000
    } else {
        raw
    }
}

fn unix_timestamp_seconds() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::normalize_sidebar_sessions;

    #[test]
    fn normalizes_gateway_sessions_into_sidebar_records() {
        let sessions = normalize_sidebar_sessions(json!({
            "sessions": [
                {
                    "key": "agent:main:global",
                    "title": "Main review loop",
                    "label": "Review",
                    "agentId": "codex",
                    "status": "accepted",
                    "createdAt": 1_767_284_800_000i64,
                    "lastActivityAt": 1_767_285_160i64,
                    "runId": "run-123"
                },
                {
                    "sessionKey": "thread:alpha",
                    "state": "done",
                    "updatedAt": 1_767_285_260i64
                }
            ]
        }));

        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_key, "thread:alpha");
        assert_eq!(sessions[0].status, "succeeded");
        assert_eq!(sessions[0].source, "openclaw");
        assert_eq!(sessions[0].session_kind, "orchestrated_agent");
        assert_eq!(sessions[1].session_key, "agent:main:global");
        assert_eq!(sessions[1].status, "pending");
        assert_eq!(sessions[1].title, "Main review loop");
        assert_eq!(
            sessions[1].subtitle,
            "Review · Agent codex · agent:main:global"
        );
        assert_eq!(sessions[1].created_at, 1_767_284_800i64);
        assert_eq!(sessions[1].run_id.as_deref(), Some("run-123"));
    }
}
