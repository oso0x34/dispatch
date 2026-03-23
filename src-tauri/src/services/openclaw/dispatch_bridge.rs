use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    db::Database,
    error::{AppError, AppResult},
    services::{dispatch, project_registry},
};

use super::{
    client::{OpenClawClient, OpenClawSpawnSessionInput},
    session_bridge::{openclaw_session_id, OpenClawSidebarSession},
};

const OPENCLAW_SESSION_SOURCE: &str = "openclaw";
const OPENCLAW_SESSION_KIND: &str = "orchestrated_agent";
const OPENCLAW_TRANSPORT: &str = "openclaw";
const OPENCLAW_PROGRAM: &str = "openclaw";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawDispatchSessionInput {
    pub project_id: String,
    pub task_id: Option<String>,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawDispatchSessionResult {
    pub session_id: String,
    pub session_key: String,
    pub run_id: Option<String>,
    pub status: String,
    pub task_id: Option<String>,
}

pub async fn dispatch_openclaw_session(
    database: &Database,
    client: &OpenClawClient,
    input: OpenClawDispatchSessionInput,
) -> AppResult<OpenClawDispatchSessionResult> {
    let project_id = normalize_required_field("project id", &input.project_id)?;
    let prompt = normalize_required_field("openclaw dispatch prompt", &input.prompt)?;

    let project = project_registry::get_project(database, &project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;

    let task_id = normalize_optional_field(input.task_id.as_deref());
    if let Some(task_id) = task_id.as_deref() {
        dispatch::validate_linked_task(database, &project_id, task_id)?;
    }

    let response = client
        .spawn_session(OpenClawSpawnSessionInput {
            message: prompt,
            agent_id: None,
            session_key: None,
            label: None,
        })
        .await?;

    let session_key = required_response_string(
        &response,
        &["sessionKey", "session_key", "key", "id"],
        "openclaw dispatch response did not include a session key",
    )?;
    let session_id = openclaw_session_id(&session_key);
    let run_id = optional_response_string(&response, &["runId", "run_id"]);
    let status = optional_response_string(&response, &["status", "state"])
        .unwrap_or_else(|| "accepted".to_string());

    create_openclaw_session_mirror(
        database,
        &session_id,
        &project_id,
        task_id.as_deref(),
        &project.root_path,
    )?;

    if let Some(task_id) = task_id.as_deref() {
        dispatch::mark_task_session_started(database, &project_id, task_id, &session_id)?;
    }

    Ok(OpenClawDispatchSessionResult {
        session_id,
        session_key,
        run_id,
        status,
        task_id,
    })
}

pub fn sync_tasks_for_sidebar_sessions(
    database: &Database,
    sessions: &[OpenClawSidebarSession],
) -> AppResult<Vec<dispatch::TaskStatusTransition>> {
    let mut transitions = Vec::new();

    for session in sessions {
        let Some(status) =
            sync_openclaw_session_mirror_status(database, &session.id, &session.status)?
        else {
            continue;
        };
        transitions.extend(dispatch::sync_task_status_by_session_id(
            database,
            &session.id,
            status,
        )?);
    }

    Ok(transitions)
}

pub fn hydrate_sidebar_session_task_links(
    database: &Database,
    sessions: &mut [OpenClawSidebarSession],
) -> AppResult<()> {
    for session in sessions {
        if session.task_id.is_some() {
            continue;
        }

        let task_id = database.with_connection(|connection| {
            connection
                .query_row(
                    "
                    SELECT task_id
                    FROM agent_sessions
                    WHERE id = ?1
                    LIMIT 1
                    ",
                    [session.id.as_str()],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()
                .map_err(AppError::from)
        })?;

        let task_id = match task_id.flatten() {
            Some(task_id) => Some(task_id),
            None => database.with_connection(|connection| {
                connection
                    .query_row(
                        "
                    SELECT id
                    FROM tasks
                    WHERE last_session_id = ?1
                    ORDER BY updated_at DESC, id DESC
                    LIMIT 1
                    ",
                        [session.id.as_str()],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(AppError::from)
            })?,
        };

        if let Some(task_id) = task_id {
            session.task_id = Some(task_id);
        }
    }

    Ok(())
}

pub fn mark_openclaw_session_canceled(
    database: &Database,
    session_key: &str,
) -> AppResult<Vec<dispatch::TaskStatusTransition>> {
    let session_key = normalize_required_field("openclaw session key", session_key)?;
    let session_id = openclaw_session_id(&session_key);
    let _ = sync_openclaw_session_mirror_status(database, &session_id, "canceled")?;
    dispatch::sync_task_status_by_session_id(database, &session_id, "canceled")
}

fn normalize_required_field(label: &str, value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(format!("{label} cannot be blank")));
    }

    Ok(trimmed.to_string())
}

fn normalize_optional_field(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn required_response_string(
    payload: &Value,
    keys: &[&str],
    error_message: &str,
) -> AppResult<String> {
    optional_response_string(payload, keys).ok_or_else(|| AppError::new(error_message))
}

fn optional_response_string(payload: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        payload.get(*key).and_then(|value| match value {
            Value::String(inner) => {
                let trimmed = inner.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            }
            Value::Number(inner) => Some(inner.to_string()),
            _ => None,
        })
    })
}

fn create_openclaw_session_mirror(
    database: &Database,
    session_id: &str,
    project_id: &str,
    task_id: Option<&str>,
    cwd: &str,
) -> AppResult<()> {
    let now = unix_timestamp_seconds();

    database.with_connection(|connection| {
        connection.execute(
            "
            INSERT INTO agent_sessions (
                id,
                project_id,
                task_id,
                source,
                session_kind,
                status,
                program,
                args_json,
                env_keys_json,
                cwd,
                transport,
                exit_code,
                started_at,
                ended_at,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[]', '[]', ?8, ?9, NULL, ?10, NULL, ?10, ?10)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                task_id = excluded.task_id,
                source = excluded.source,
                session_kind = excluded.session_kind,
                status = excluded.status,
                program = excluded.program,
                args_json = excluded.args_json,
                env_keys_json = excluded.env_keys_json,
                cwd = excluded.cwd,
                transport = excluded.transport,
                exit_code = NULL,
                ended_at = NULL,
                started_at = excluded.started_at,
                updated_at = excluded.updated_at
            ",
            params![
                session_id,
                project_id,
                task_id,
                OPENCLAW_SESSION_SOURCE,
                OPENCLAW_SESSION_KIND,
                "running",
                OPENCLAW_PROGRAM,
                cwd,
                OPENCLAW_TRANSPORT,
                now,
            ],
        )?;

        Ok::<(), AppError>(())
    })
}

fn sync_openclaw_session_mirror_status(
    database: &Database,
    session_id: &str,
    raw_status: &str,
) -> AppResult<Option<&'static str>> {
    let Some(status) = normalize_openclaw_status(raw_status) else {
        return Ok(None);
    };
    let now = unix_timestamp_seconds();
    let ended_at =
        matches!(status, "succeeded" | "failed" | "canceled" | "abandoned").then_some(now);

    database.with_connection(|connection| {
        connection.execute(
            "
            UPDATE agent_sessions
            SET
                status = ?2,
                ended_at = ?3,
                updated_at = ?4
            WHERE id = ?1
              AND source = ?5
            ",
            params![session_id, status, ended_at, now, OPENCLAW_SESSION_SOURCE,],
        )?;

        Ok::<(), AppError>(())
    })?;

    Ok(Some(status))
}

fn normalize_openclaw_status(raw_status: &str) -> Option<&'static str> {
    let normalized = raw_status.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }

    match normalized.as_str() {
        "pending" | "queued" | "accepted" | "created" => Some("pending"),
        "running" | "active" | "live" | "ready" | "streaming" => Some("running"),
        "succeeded" | "success" | "completed" | "done" | "finished" | "ok" => Some("succeeded"),
        "failed" | "error" | "errored" | "crashed" => Some("failed"),
        "canceled" | "cancelled" | "aborted" | "terminated" => Some("canceled"),
        "abandoned" => Some("abandoned"),
        _ => None,
    }
}

fn unix_timestamp_seconds() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
