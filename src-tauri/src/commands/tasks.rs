use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, types::Type, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::{Task, TaskSubtask},
    services::{project_registry, task_export},
};

type CommandResult<T> = Result<T, String>;

const TASK_WORKFLOW_STATE_DRAFT: &str = "draft";
const TASK_WORKFLOW_STATE_PLANNING: &str = "planning";
const TASK_WORKFLOW_STATE_IN_PROGRESS: &str = "in_progress";
const TASK_WORKFLOW_STATE_REVIEW: &str = "review";
const TASK_WORKFLOW_STATE_DONE: &str = "done";
const TASK_WORKFLOW_STATE_BLOCKED: &str = "blocked";

const TASK_LAST_RUN_STATE_IDLE: &str = "idle";
const TASK_LAST_RUN_STATE_RUNNING: &str = "running";
const TASK_LAST_RUN_STATE_SUCCEEDED: &str = "succeeded";
const TASK_LAST_RUN_STATE_FAILED: &str = "failed";
const TASK_LAST_RUN_STATE_CANCELED: &str = "canceled";
const TASK_LAST_RUN_STATE_ABANDONED: &str = "abandoned";

const TASK_PRIORITY_NONE: &str = "none";
const TASK_PRIORITY_LOW: &str = "low";
const TASK_PRIORITY_MEDIUM: &str = "medium";
const TASK_PRIORITY_HIGH: &str = "high";
const TASK_PRIORITY_URGENT: &str = "urgent";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksInput {
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskInput {
    pub project_id: String,
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub project_id: String,
    pub title: String,
    pub description_markdown: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
    pub subtasks: Option<Vec<TaskSubtask>>,
    pub review_notes_markdown: Option<String>,
    pub assignee: Option<String>,
    pub workflow_state: Option<String>,
    pub last_run_state: Option<String>,
    pub last_session_id: Option<String>,
    pub assigned_agent_mode: Option<String>,
    pub markdown_export_path: Option<String>,
    pub blocked_reason: Option<String>,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub project_id: String,
    pub task_id: String,
    pub title: Option<String>,
    pub description_markdown: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
    pub subtasks: Option<Vec<TaskSubtask>>,
    pub review_notes_markdown: Option<String>,
    pub assignee: Option<Option<String>>,
    pub workflow_state: Option<String>,
    pub last_run_state: Option<String>,
    pub last_session_id: Option<Option<String>>,
    pub assigned_agent_mode: Option<Option<String>>,
    pub markdown_export_path: Option<Option<String>>,
    pub blocked_reason: Option<Option<String>>,
    pub completed_at: Option<Option<i64>>,
}

static TASK_ID_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn list_tasks_with_db(database: &Database, project_id: String) -> AppResult<Vec<Task>> {
    let project_id = normalize_project_id(&project_id)?;
    require_project_exists(database, &project_id)?;

    database.with_connection(|connection| {
        let mut statement = connection.prepare(
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
            WHERE project_id = ?1
            ORDER BY created_at ASC, id ASC
            ",
        )?;
        let tasks = statement
            .query_map([&project_id], row_to_task)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(tasks)
    })
}

pub fn create_task_with_db(database: &Database, input: CreateTaskInput) -> AppResult<Task> {
    let project_id = normalize_project_id(&input.project_id)?;
    require_project_exists(database, &project_id)?;

    let title = normalize_task_title(&input.title)?;
    let description_markdown = input.description_markdown.unwrap_or_default();
    let priority = normalize_priority(input.priority.as_deref().unwrap_or(TASK_PRIORITY_NONE))?;
    let labels = normalize_labels(input.labels.unwrap_or_default())?;
    let subtasks = normalize_subtasks(input.subtasks.unwrap_or_default())?;
    let review_notes_markdown = input.review_notes_markdown.unwrap_or_default();
    let assignee = normalize_optional_text(input.assignee);
    let workflow_state = normalize_workflow_state(
        input
            .workflow_state
            .as_deref()
            .unwrap_or(TASK_WORKFLOW_STATE_DRAFT),
    )?;
    let last_run_state = normalize_last_run_state(
        input
            .last_run_state
            .as_deref()
            .unwrap_or(TASK_LAST_RUN_STATE_IDLE),
    )?;
    let last_session_id = normalize_optional_text(input.last_session_id);
    let assigned_agent_mode = normalize_assigned_agent_mode(input.assigned_agent_mode)?;
    let markdown_export_path = normalize_optional_text(input.markdown_export_path);
    let blocked_reason = normalize_optional_text(input.blocked_reason);
    let created_at = now_unix_seconds();
    let task = Task {
        id: next_task_id(),
        project_id,
        title,
        description_markdown,
        priority,
        labels,
        subtasks,
        review_notes_markdown,
        assignee,
        workflow_state,
        last_run_state,
        last_session_id,
        assigned_agent_mode,
        markdown_export_path,
        blocked_reason,
        created_at,
        updated_at: created_at,
        completed_at: input.completed_at,
    };

    let task = database.with_connection(|connection| {
        connection.execute(
            "
            INSERT INTO tasks (
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
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
            ",
            params![
                &task.id,
                &task.project_id,
                &task.title,
                &task.description_markdown,
                &task.priority,
                serialize_string_list(&task.labels)?,
                serialize_subtasks(&task.subtasks)?,
                &task.review_notes_markdown,
                &task.assignee,
                &task.workflow_state,
                &task.last_run_state,
                &task.last_session_id,
                &task.assigned_agent_mode,
                &task.markdown_export_path,
                &task.blocked_reason,
                task.created_at,
                task.updated_at,
                task.completed_at,
            ],
        )?;

        Ok::<Task, AppError>(task)
    })?;

    let markdown_export_path =
        task_export::sync_task_markdown_export(database, &task.project_id, &task.id)?;

    Ok(Task {
        markdown_export_path,
        ..task
    })
}

pub fn update_task_with_db(database: &Database, input: UpdateTaskInput) -> AppResult<Task> {
    let project_id = normalize_project_id(&input.project_id)?;
    let task_id = normalize_task_id(&input.task_id)?;
    require_project_exists(database, &project_id)?;
    let updated_at = now_unix_seconds();

    let task = database.with_connection(|connection| {
        let existing = connection
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
                WHERE project_id = ?1 AND id = ?2
                ",
                params![&project_id, &task_id],
                row_to_task,
            )
            .optional()?;

        let existing = existing.ok_or_else(|| AppError::new("task not found"))?;

        let title = match input.title {
            Some(title) => normalize_task_title(&title)?,
            None => existing.title,
        };
        let description_markdown = input
            .description_markdown
            .unwrap_or(existing.description_markdown);
        let priority = match input.priority {
            Some(priority) => normalize_priority(&priority)?,
            None => existing.priority,
        };
        let labels = match input.labels {
            Some(labels) => normalize_labels(labels)?,
            None => existing.labels,
        };
        let subtasks = match input.subtasks {
            Some(subtasks) => normalize_subtasks(subtasks)?,
            None => existing.subtasks,
        };
        let review_notes_markdown = input
            .review_notes_markdown
            .unwrap_or(existing.review_notes_markdown);
        let assignee = match input.assignee {
            Some(assignee) => normalize_optional_text(assignee),
            None => existing.assignee,
        };
        let workflow_state = match input.workflow_state {
            Some(workflow_state) => normalize_workflow_state(&workflow_state)?,
            None => existing.workflow_state,
        };
        let last_run_state = match input.last_run_state {
            Some(last_run_state) => normalize_last_run_state(&last_run_state)?,
            None => existing.last_run_state,
        };
        let last_session_id = match input.last_session_id {
            Some(last_session_id) => normalize_optional_text(last_session_id),
            None => existing.last_session_id,
        };
        let assigned_agent_mode = match input.assigned_agent_mode {
            Some(assigned_agent_mode) => normalize_assigned_agent_mode(assigned_agent_mode)?,
            None => existing.assigned_agent_mode,
        };
        let markdown_export_path = match input.markdown_export_path {
            Some(markdown_export_path) => normalize_optional_text(markdown_export_path),
            None => existing.markdown_export_path,
        };
        let blocked_reason = match input.blocked_reason {
            Some(blocked_reason) => normalize_optional_text(blocked_reason),
            None => existing.blocked_reason,
        };
        let completed_at = input.completed_at.unwrap_or(existing.completed_at);

        let task = Task {
            id: existing.id,
            project_id: existing.project_id,
            title,
            description_markdown,
            priority,
            labels,
            subtasks,
            review_notes_markdown,
            assignee,
            workflow_state,
            last_run_state,
            last_session_id,
            assigned_agent_mode,
            markdown_export_path,
            blocked_reason,
            created_at: existing.created_at,
            updated_at,
            completed_at,
        };

        connection.execute(
            "
            UPDATE tasks
            SET
                title = ?3,
                description_markdown = ?4,
                priority = ?5,
                labels_json = ?6,
                subtasks_json = ?7,
                review_notes_markdown = ?8,
                assignee = ?9,
                workflow_state = ?10,
                last_run_state = ?11,
                last_session_id = ?12,
                assigned_agent_mode = ?13,
                markdown_export_path = ?14,
                blocked_reason = ?15,
                updated_at = ?16,
                completed_at = ?17
            WHERE project_id = ?1
              AND id = ?2
            ",
            params![
                &project_id,
                &task_id,
                &task.title,
                &task.description_markdown,
                &task.priority,
                serialize_string_list(&task.labels)?,
                serialize_subtasks(&task.subtasks)?,
                &task.review_notes_markdown,
                &task.assignee,
                &task.workflow_state,
                &task.last_run_state,
                &task.last_session_id,
                &task.assigned_agent_mode,
                &task.markdown_export_path,
                &task.blocked_reason,
                task.updated_at,
                task.completed_at,
            ],
        )?;

        Ok::<Task, AppError>(task)
    })?;

    let markdown_export_path =
        task_export::sync_task_markdown_export(database, &task.project_id, &task.id)?;

    Ok(Task {
        markdown_export_path,
        ..task
    })
}

pub fn delete_task_with_db(database: &Database, input: DeleteTaskInput) -> AppResult<bool> {
    let project_id = normalize_project_id(&input.project_id)?;
    let task_id = normalize_task_id(&input.task_id)?;
    require_project_exists(database, &project_id)?;
    task_export::remove_task_markdown_export(database, &project_id, &task_id)?;

    database.with_connection(|connection| {
        let deleted = connection.execute(
            "
            DELETE FROM tasks
            WHERE project_id = ?1
              AND id = ?2
            ",
            params![&project_id, &task_id],
        )?;

        Ok(deleted > 0)
    })
}

fn require_project_exists(database: &Database, project_id: &str) -> AppResult<()> {
    project_registry::get_project(database, project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;

    Ok(())
}

fn normalize_project_id(project_id: &str) -> AppResult<String> {
    let normalized = project_id.trim();

    if normalized.is_empty() {
        return Err(AppError::new("task project id cannot be blank"));
    }

    Ok(normalized.to_string())
}

fn normalize_task_id(task_id: &str) -> AppResult<String> {
    let normalized = task_id.trim();

    if normalized.is_empty() {
        return Err(AppError::new("task id cannot be blank"));
    }

    Ok(normalized.to_string())
}

fn normalize_task_title(title: &str) -> AppResult<String> {
    let normalized = title.trim();

    if normalized.is_empty() {
        return Err(AppError::new("task title cannot be blank"));
    }

    Ok(normalized.to_string())
}

fn normalize_priority(priority: &str) -> AppResult<String> {
    let normalized = priority.trim();

    if normalized.is_empty() {
        return Err(AppError::new("task priority is invalid"));
    }

    if matches!(
        normalized,
        TASK_PRIORITY_NONE
            | TASK_PRIORITY_LOW
            | TASK_PRIORITY_MEDIUM
            | TASK_PRIORITY_HIGH
            | TASK_PRIORITY_URGENT
    ) {
        return Ok(normalized.to_string());
    }

    Err(AppError::new("task priority is invalid"))
}

fn normalize_workflow_state(workflow_state: &str) -> AppResult<String> {
    let normalized = workflow_state.trim();

    if normalized.is_empty() {
        return Err(AppError::new("task workflow state is invalid"));
    }

    if matches!(
        normalized,
        TASK_WORKFLOW_STATE_DRAFT
            | TASK_WORKFLOW_STATE_PLANNING
            | TASK_WORKFLOW_STATE_IN_PROGRESS
            | TASK_WORKFLOW_STATE_REVIEW
            | TASK_WORKFLOW_STATE_DONE
            | TASK_WORKFLOW_STATE_BLOCKED
    ) {
        return Ok(normalized.to_string());
    }

    Err(AppError::new("task workflow state is invalid"))
}

fn normalize_last_run_state(last_run_state: &str) -> AppResult<String> {
    let normalized = last_run_state.trim();

    if normalized.is_empty() {
        return Err(AppError::new("task last run state is invalid"));
    }

    if matches!(
        normalized,
        TASK_LAST_RUN_STATE_IDLE
            | TASK_LAST_RUN_STATE_RUNNING
            | TASK_LAST_RUN_STATE_SUCCEEDED
            | TASK_LAST_RUN_STATE_FAILED
            | TASK_LAST_RUN_STATE_CANCELED
            | TASK_LAST_RUN_STATE_ABANDONED
    ) {
        return Ok(normalized.to_string());
    }

    Err(AppError::new("task last run state is invalid"))
}

fn normalize_assigned_agent_mode(value: Option<String>) -> AppResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };

    let normalized = value.trim();
    if normalized.is_empty() {
        return Ok(None);
    }

    if normalized == "auto" {
        return Ok(Some(normalized.to_string()));
    }

    if normalized.starts_with("profile:") && normalized.len() > "profile:".len() {
        return Ok(Some(normalized.to_string()));
    }

    Err(AppError::new("task assigned agent mode is invalid"))
}

fn normalize_labels(labels: Vec<String>) -> AppResult<Vec<String>> {
    let mut normalized_labels = Vec::new();

    for label in labels {
        let normalized = label.trim();

        if normalized.is_empty() {
            return Err(AppError::new("task labels are invalid"));
        }

        if normalized_labels
            .iter()
            .any(|candidate| candidate == normalized)
        {
            continue;
        }

        normalized_labels.push(normalized.to_string());
    }

    Ok(normalized_labels)
}

fn normalize_subtasks(subtasks: Vec<TaskSubtask>) -> AppResult<Vec<TaskSubtask>> {
    let mut normalized_subtasks = Vec::new();

    for subtask in subtasks {
        let id = subtask.id.trim();
        let text = subtask.text.trim();

        if id.is_empty() || text.is_empty() {
            return Err(AppError::new("task subtasks are invalid"));
        }

        if normalized_subtasks
            .iter()
            .any(|candidate: &TaskSubtask| candidate.id == id)
        {
            return Err(AppError::new("task subtasks are invalid"));
        }

        normalized_subtasks.push(TaskSubtask {
            id: id.to_string(),
            text: text.to_string(),
            completed: subtask.completed,
        });
    }

    Ok(normalized_subtasks)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .and_then(|value| if value.is_empty() { None } else { Some(value) })
}

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let priority = row.get::<_, String>(4)?;
    let labels_json = row.get::<_, String>(5)?;
    let subtasks_json = row.get::<_, String>(6)?;

    Ok(Task {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        description_markdown: row.get(3)?,
        priority: normalize_priority(&priority).map_err(|error| invalid_task_column(4, error))?,
        labels: deserialize_string_list(5, &labels_json)?,
        subtasks: deserialize_subtasks(6, &subtasks_json)?,
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

fn serialize_string_list(values: &[String]) -> AppResult<String> {
    serde_json::to_string(values)
        .map_err(|error| AppError::new(format!("failed to serialize task labels: {error}")))
}

fn serialize_subtasks(subtasks: &[TaskSubtask]) -> AppResult<String> {
    serde_json::to_string(subtasks)
        .map_err(|error| AppError::new(format!("failed to serialize task subtasks: {error}")))
}

fn deserialize_string_list(index: usize, raw: &str) -> rusqlite::Result<Vec<String>> {
    let labels = serde_json::from_str::<Vec<String>>(raw)
        .map_err(|error| invalid_task_column(index, error))?;

    normalize_labels(labels).map_err(|error| invalid_task_column(index, error))
}

fn deserialize_subtasks(index: usize, raw: &str) -> rusqlite::Result<Vec<TaskSubtask>> {
    let subtasks = serde_json::from_str::<Vec<TaskSubtask>>(raw)
        .map_err(|error| invalid_task_column(index, error))?;

    normalize_subtasks(subtasks).map_err(|error| invalid_task_column(index, error))
}

fn invalid_task_column(
    index: usize,
    error: impl Into<Box<dyn std::error::Error + Send + Sync>>,
) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, Type::Text, error.into())
}

fn next_task_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let process_id = std::process::id();
    let sequence = TASK_ID_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    format!("task-{process_id}-{now}-{sequence}")
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn task_command_error_message(error: AppError) -> String {
    let message = error.message();

    if matches!(
        message,
        "project not found"
            | "task project id cannot be blank"
            | "task id cannot be blank"
            | "task not found"
            | "task title cannot be blank"
            | "task priority is invalid"
            | "task workflow state is invalid"
            | "task last run state is invalid"
            | "task labels are invalid"
            | "task subtasks are invalid"
            | "task assigned agent mode is invalid"
    ) {
        return message.to_string();
    }

    "task command failed".to_string()
}

#[tauri::command]
pub fn list_tasks(
    database: State<'_, Arc<Database>>,
    input: ListTasksInput,
) -> CommandResult<Vec<Task>> {
    list_tasks_with_db(database.inner(), input.project_id).map_err(task_command_error_message)
}

#[tauri::command]
pub fn create_task(
    database: State<'_, Arc<Database>>,
    input: CreateTaskInput,
) -> CommandResult<Task> {
    create_task_with_db(database.inner(), input).map_err(task_command_error_message)
}

#[tauri::command]
pub fn update_task(
    database: State<'_, Arc<Database>>,
    input: UpdateTaskInput,
) -> CommandResult<Task> {
    update_task_with_db(database.inner(), input).map_err(task_command_error_message)
}

#[tauri::command]
pub fn delete_task(
    database: State<'_, Arc<Database>>,
    input: DeleteTaskInput,
) -> CommandResult<bool> {
    delete_task_with_db(database.inner(), input).map_err(task_command_error_message)
}
