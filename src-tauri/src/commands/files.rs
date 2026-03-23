use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    db::Database,
    error::AppError,
    services::{
        file_watch::{FileWatchService, ProjectFileWatchRegistration},
        project_fs::{self, ProjectContentSearchHit, ProjectFilePreview, ProjectTreeEntry},
    },
};

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectTreeInput {
    pub project_id: String,
    pub root_relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadProjectFileInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchProjectInput {
    pub project_id: String,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartProjectFileWatchInput {
    pub project_id: String,
}

fn files_command_error_message(error: AppError) -> String {
    let message = error.message();

    if matches!(
        message,
        "project not found"
            | "project path was not found"
            | "project path is not a directory"
            | "project path is not a file"
            | "project file is not previewable"
            | "search query cannot be blank"
    ) {
        return message.to_string();
    }

    if message.starts_with("absolute paths are not allowed")
        || message.starts_with("path traversal is not allowed")
        || message.starts_with("path escapes project root")
    {
        return "project path is invalid".to_string();
    }

    "files command failed".to_string()
}

#[tauri::command]
pub fn start_project_file_watch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    database: State<'_, Arc<Database>>,
    file_watch_service: State<'_, Arc<FileWatchService>>,
    input: StartProjectFileWatchInput,
) -> CommandResult<ProjectFileWatchRegistration> {
    file_watch_service
        .start_project_watch(&app, database.inner(), &input.project_id)
        .map_err(files_command_error_message)
}

#[tauri::command]
pub fn stop_project_file_watch(
    file_watch_service: State<'_, Arc<FileWatchService>>,
) -> CommandResult<bool> {
    Ok(file_watch_service.stop_project_watch())
}

#[tauri::command]
pub fn list_project_tree(
    database: State<'_, Arc<Database>>,
    input: ListProjectTreeInput,
) -> CommandResult<Vec<ProjectTreeEntry>> {
    project_fs::list_project_tree(
        database.inner(),
        &input.project_id,
        input.root_relative_path.as_deref(),
    )
    .map_err(files_command_error_message)
}

#[tauri::command]
pub fn read_project_file(
    database: State<'_, Arc<Database>>,
    input: ReadProjectFileInput,
) -> CommandResult<ProjectFilePreview> {
    project_fs::read_project_file(database.inner(), &input.project_id, &input.relative_path)
        .map_err(files_command_error_message)
}

#[tauri::command]
pub fn search_project_paths(
    database: State<'_, Arc<Database>>,
    input: SearchProjectInput,
) -> CommandResult<Vec<ProjectTreeEntry>> {
    project_fs::search_project_paths(database.inner(), &input.project_id, &input.query)
        .map_err(files_command_error_message)
}

#[tauri::command]
pub fn search_project_content(
    database: State<'_, Arc<Database>>,
    input: SearchProjectInput,
) -> CommandResult<Vec<ProjectContentSearchHit>> {
    project_fs::search_project_content(database.inner(), &input.project_id, &input.query)
        .map_err(files_command_error_message)
}
