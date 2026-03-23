use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    db::Database,
    error::AppError,
    services::history::{
        self, SavePoint, SavePointCreateResult, SavePointDiffResult, SavePointRestoreResult,
    },
};

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHistoryInput {
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateManualSavePointInput {
    pub project_id: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSavePointInput {
    pub project_id: String,
    pub ref_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProjectSavePointFileInput {
    pub project_id: String,
    pub ref_name: String,
    pub relative_path: String,
}

fn history_command_error_message(error: AppError) -> String {
    let message = error.message();

    if matches!(
        message,
        "project not found" | "project is not a git repository" | "project path is not a file"
    ) {
        return message.to_string();
    }

    if message.starts_with("absolute paths are not allowed")
        || message.starts_with("path traversal is not allowed")
        || message.starts_with("path escapes project root")
    {
        return "project path is invalid".to_string();
    }

    if message.starts_with("save point") || message.starts_with("failed to ") {
        return message.to_string();
    }

    "history command failed".to_string()
}

#[tauri::command]
pub fn list_project_save_points(
    database: State<'_, Arc<Database>>,
    input: ProjectHistoryInput,
) -> CommandResult<Vec<SavePoint>> {
    history::list_project_save_points(database.inner(), &input.project_id)
        .map_err(history_command_error_message)
}

#[tauri::command]
pub fn latest_project_save_point(
    database: State<'_, Arc<Database>>,
    input: ProjectHistoryInput,
) -> CommandResult<Option<SavePoint>> {
    history::latest_project_save_point(database.inner(), &input.project_id)
        .map_err(history_command_error_message)
}

#[tauri::command]
pub fn create_manual_save_point(
    database: State<'_, Arc<Database>>,
    input: CreateManualSavePointInput,
) -> CommandResult<SavePointCreateResult> {
    history::create_manual_save_point(database.inner(), &input.project_id, input.label.as_deref())
        .map_err(history_command_error_message)
}

#[tauri::command]
pub fn get_project_save_point_diff(
    database: State<'_, Arc<Database>>,
    input: ProjectSavePointInput,
) -> CommandResult<SavePointDiffResult> {
    history::get_save_point_diff(database.inner(), &input.project_id, &input.ref_name)
        .map_err(history_command_error_message)
}

#[tauri::command]
pub fn restore_project_save_point(
    database: State<'_, Arc<Database>>,
    input: ProjectSavePointInput,
) -> CommandResult<SavePointRestoreResult> {
    history::restore_project_save_point(database.inner(), &input.project_id, &input.ref_name)
        .map_err(history_command_error_message)
}

#[tauri::command]
pub fn restore_project_save_point_file(
    database: State<'_, Arc<Database>>,
    input: RestoreProjectSavePointFileInput,
) -> CommandResult<SavePointRestoreResult> {
    history::restore_project_save_point_file(
        database.inner(),
        &input.project_id,
        &input.ref_name,
        &input.relative_path,
    )
    .map_err(history_command_error_message)
}
