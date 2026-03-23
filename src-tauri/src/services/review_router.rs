use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::{
    commands::settings::get_setting_with_db,
    db::Database,
    error::{AppError, AppResult},
    models::Task,
    services::{
        openclaw::{
            chat::DEFAULT_OPENCLAW_CHAT_SESSION_KEY, OpenClawChatSendInput, OpenClawChatService,
            OpenClawChatSnapshotInput, OpenClawClient,
        },
        project_registry, task_export,
    },
};

const REVIEW_AUTOMATION_SETTING_KEY: &str = "dispatch.review.auto_enabled";
const TASK_WORKFLOW_REVIEW: &str = "review";
const TASK_WORKFLOW_IN_PROGRESS: &str = "in_progress";
const TASK_WORKFLOW_DONE: &str = "done";
const TASK_RUN_STATE_SUCCEEDED: &str = "succeeded";
const REVIEW_MODEL_ID: &str = "auto-review";
const REVIEW_WAIT_TIMEOUT: Duration = Duration::from_secs(10);
const REVIEW_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewRouteOutcome {
    Disabled,
    Ignored,
    AlreadyRouting,
    Passed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ReviewDecisionKind {
    Pass,
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReviewDecision {
    kind: ReviewDecisionKind,
    feedback: String,
}

#[derive(Default)]
pub struct ReviewRouterService {
    in_flight_session_ids: Mutex<HashSet<String>>,
}

impl ReviewRouterService {
    pub async fn route_session_review(
        &self,
        database: &Database,
        client: &OpenClawClient,
        chat: &Arc<OpenClawChatService>,
        session_id: &str,
    ) -> AppResult<ReviewRouteOutcome> {
        let session_id = normalize_required_field("session id", session_id)?;

        if !review_automation_enabled(database)? {
            return Ok(ReviewRouteOutcome::Disabled);
        }

        let Some(_in_flight_guard) =
            try_mark_session_in_flight(&self.in_flight_session_ids, &session_id)?
        else {
            return Ok(ReviewRouteOutcome::AlreadyRouting);
        };

        if client.status().await.state != "connected" {
            return Ok(ReviewRouteOutcome::Ignored);
        }

        let Some(task) = load_reviewable_task(database, &session_id)? else {
            return Ok(ReviewRouteOutcome::Ignored);
        };

        let result = self
            .route_task_review(database, client, chat, &task, &session_id)
            .await;

        result
    }

    async fn route_task_review(
        &self,
        database: &Database,
        client: &OpenClawClient,
        chat: &Arc<OpenClawChatService>,
        task: &Task,
        session_id: &str,
    ) -> AppResult<ReviewRouteOutcome> {
        let review_prompt = build_review_prompt(load_task_export_markdown(database, task)?);
        let send_result = chat
            .send_message(
                database,
                client,
                OpenClawChatSendInput {
                    body_markdown: review_prompt,
                    conversation_id: None,
                    session_key: Some(DEFAULT_OPENCLAW_CHAT_SESSION_KEY.to_string()),
                    project_id: Some(task.project_id.clone()),
                    model_id: Some(REVIEW_MODEL_ID.to_string()),
                },
            )
            .await?;

        let run_id = send_result
            .run_id
            .ok_or_else(|| AppError::new("review routing requires an OpenClaw run id"))?;
        let decision = wait_for_review_decision(database, client, chat, &run_id).await?;
        apply_review_decision(database, task, session_id, &decision)?;

        Ok(match decision.kind {
            ReviewDecisionKind::Pass => ReviewRouteOutcome::Passed,
            ReviewDecisionKind::Fail => ReviewRouteOutcome::Failed,
        })
    }
}

fn review_automation_enabled(database: &Database) -> AppResult<bool> {
    Ok(
        get_setting_with_db(database, REVIEW_AUTOMATION_SETTING_KEY.to_string())?
            .and_then(|setting| setting.value.as_bool())
            .unwrap_or(false),
    )
}

fn load_reviewable_task(database: &Database, session_id: &str) -> AppResult<Option<Task>> {
    database.with_connection(|connection| {
        let task = connection
            .query_row(
                "
                SELECT
                    id,
                    project_id,
                    title,
                    description_markdown,
                    priority,
                    labels_json,
                    subtasks_json,
                    review_notes_markdown,
                    assignee,
                    workflow_state,
                    last_run_state,
                    last_session_id,
                    assigned_agent_mode,
                    markdown_export_path,
                    blocked_reason,
                    created_at,
                    updated_at,
                    completed_at
                FROM tasks
                WHERE last_session_id = ?1
                  AND workflow_state = ?2
                  AND last_run_state = ?3
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                ",
                params![session_id, TASK_WORKFLOW_REVIEW, TASK_RUN_STATE_SUCCEEDED],
                row_to_task,
            )
            .optional()?;

        Ok(task)
    })
}

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let labels_json = row.get::<_, String>(5)?;
    let subtasks_json = row.get::<_, String>(6)?;

    Ok(Task {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        description_markdown: row.get(3)?,
        priority: row.get(4)?,
        labels: serde_json::from_str(&labels_json).map_err(invalid_task_json)?,
        subtasks: serde_json::from_str(&subtasks_json).map_err(invalid_task_json)?,
        review_notes_markdown: row.get(7)?,
        assignee: row.get(8)?,
        workflow_state: row.get(9)?,
        last_run_state: row.get(10)?,
        last_session_id: row.get(11)?,
        assigned_agent_mode: row.get(12)?,
        markdown_export_path: row.get(13)?,
        blocked_reason: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        completed_at: row.get(17)?,
    })
}

fn invalid_task_json(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn load_task_export_markdown(database: &Database, task: &Task) -> AppResult<String> {
    let export_path = task_export::sync_task_markdown_export(database, &task.project_id, &task.id)?
        .or_else(|| task.markdown_export_path.clone())
        .ok_or_else(|| AppError::new("task export path is missing"))?;
    let project = project_registry::get_project(database, &task.project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;
    let absolute_path = PathBuf::from(project.root_path).join(export_path);

    fs::read_to_string(&absolute_path).map_err(|error| {
        AppError::new(format!(
            "failed to read task export {}: {error}",
            absolute_path.display()
        ))
    })
}

fn build_review_prompt(task_markdown: String) -> String {
    format!(
        "Review the completed task below.\n\nReply with exactly this format and no extra prose:\nRESULT: PASS|FAIL\nFEEDBACK: <markdown feedback>\n\nTask export:\n\n{task_markdown}"
    )
}

async fn wait_for_review_decision(
    database: &Database,
    client: &OpenClawClient,
    chat: &Arc<OpenClawChatService>,
    run_id: &str,
) -> AppResult<ReviewDecision> {
    let deadline = tokio::time::Instant::now() + REVIEW_WAIT_TIMEOUT;

    loop {
        let snapshot = chat
            .get_snapshot(
                database,
                client,
                OpenClawChatSnapshotInput {
                    conversation_id: None,
                    session_key: Some(DEFAULT_OPENCLAW_CHAT_SESSION_KEY.to_string()),
                    limit: Some(200),
                },
            )
            .await?;

        if let Some(message) = snapshot
            .messages
            .iter()
            .rev()
            .find(|message| review_message_matches_run_id(message, run_id))
        {
            return parse_review_decision(&message.body_markdown).ok_or_else(|| {
                AppError::new("review response did not match the expected PASS/FAIL format")
            });
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::new(
                "timed out waiting for automated review response",
            ));
        }

        tokio::time::sleep(REVIEW_POLL_INTERVAL).await;
    }
}

fn review_message_matches_run_id(message: &crate::models::ChatMessage, run_id: &str) -> bool {
    if message.author_kind == crate::models::ChatMessageAuthorKind::User {
        return false;
    }

    let Some(metadata) = message.metadata_json.as_object() else {
        return false;
    };

    if metadata.get("partial").and_then(Value::as_bool) == Some(true) {
        return false;
    }

    if matches!(
        metadata.get("status").and_then(Value::as_str),
        Some("streaming" | "partial")
    ) {
        return false;
    }

    metadata.get("runId").and_then(Value::as_str) == Some(run_id)
}

fn parse_review_decision(markdown: &str) -> Option<ReviewDecision> {
    let mut result = None;
    let mut feedback_lines = Vec::new();
    let mut collecting_feedback = false;

    for raw_line in markdown.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();

        if trimmed.is_empty() {
            if collecting_feedback {
                feedback_lines.push(String::new());
            }

            continue;
        }

        if !collecting_feedback {
            if let Some(value) = trimmed.strip_prefix("RESULT:") {
                let normalized = value.trim().to_ascii_uppercase();
                result = Some(match normalized.as_str() {
                    "PASS" => ReviewDecisionKind::Pass,
                    "FAIL" => ReviewDecisionKind::Fail,
                    _ => return None,
                });
                continue;
            }

            if let Some(value) = trimmed.strip_prefix("FEEDBACK:") {
                collecting_feedback = true;
                feedback_lines.push(value.trim_start().to_string());
                continue;
            }

            return None;
        }

        feedback_lines.push(line.to_string());
    }

    let kind = result?;
    let feedback = feedback_lines.join("\n").trim().to_string();
    let feedback = if feedback.is_empty() {
        "No feedback provided.".to_string()
    } else {
        feedback
    };

    Some(ReviewDecision { kind, feedback })
}

fn apply_review_decision(
    database: &Database,
    task: &Task,
    session_id: &str,
    decision: &ReviewDecision,
) -> AppResult<()> {
    let workflow_state = match decision.kind {
        ReviewDecisionKind::Pass => TASK_WORKFLOW_DONE,
        ReviewDecisionKind::Fail => TASK_WORKFLOW_IN_PROGRESS,
    };
    let completed_at = match decision.kind {
        ReviewDecisionKind::Pass => Some(now_unix_seconds()),
        ReviewDecisionKind::Fail => None,
    };
    let review_notes_markdown = render_review_notes(
        &task.review_notes_markdown,
        match decision.kind {
            ReviewDecisionKind::Pass => "PASS",
            ReviewDecisionKind::Fail => "FAIL",
        },
        &decision.feedback,
    );
    let updated_at = now_unix_seconds();

    let updated_rows = database.with_connection(|connection| {
        let updated_rows = connection.execute(
            "
            UPDATE tasks
            SET
                workflow_state = ?4,
                review_notes_markdown = ?5,
                completed_at = ?6,
                updated_at = ?7
            WHERE id = ?1
              AND project_id = ?2
              AND last_session_id = ?3
              AND workflow_state = ?8
              AND last_run_state = ?9
            ",
            params![
                &task.id,
                &task.project_id,
                session_id,
                workflow_state,
                &review_notes_markdown,
                completed_at,
                updated_at,
                TASK_WORKFLOW_REVIEW,
                TASK_RUN_STATE_SUCCEEDED,
            ],
        )?;

        Ok::<usize, AppError>(updated_rows)
    })?;

    if updated_rows == 0 {
        return Err(AppError::new(
            "automated review decision could not be applied because the task state changed",
        ));
    }

    let _ = task_export::sync_task_markdown_export(database, &task.project_id, &task.id)?;

    Ok(())
}

fn render_review_notes(existing: &str, result: &str, feedback: &str) -> String {
    let entry = format!("### Automated Review\n\nRESULT: {result}\n\nFEEDBACK: {feedback}",);

    if existing.trim().is_empty() {
        entry
    } else {
        format!("{}\n\n---\n\n{}", existing.trim(), entry)
    }
}

fn normalize_required_field(label: &str, value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(format!("{label} cannot be blank")));
    }

    Ok(trimmed.to_string())
}

struct ReviewInflightGuard<'a> {
    in_flight_session_ids: &'a Mutex<HashSet<String>>,
    session_id: String,
}

impl Drop for ReviewInflightGuard<'_> {
    fn drop(&mut self) {
        let _ = clear_session_in_flight(self.in_flight_session_ids, &self.session_id);
    }
}

fn try_mark_session_in_flight<'a>(
    in_flight_session_ids: &'a Mutex<HashSet<String>>,
    session_id: &str,
) -> AppResult<Option<ReviewInflightGuard<'a>>> {
    let mut in_flight = in_flight_session_ids
        .lock()
        .map_err(|_| AppError::new("review router in-flight mutex was poisoned"))?;

    if in_flight.contains(session_id) {
        return Ok(None);
    }

    in_flight.insert(session_id.to_string());

    Ok(Some(ReviewInflightGuard {
        in_flight_session_ids,
        session_id: session_id.to_string(),
    }))
}

fn clear_session_in_flight(
    in_flight_session_ids: &Mutex<HashSet<String>>,
    session_id: &str,
) -> AppResult<()> {
    let mut in_flight = in_flight_session_ids
        .lock()
        .map_err(|_| AppError::new("review router in-flight mutex was poisoned"))?;
    in_flight.remove(session_id);
    Ok(())
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
