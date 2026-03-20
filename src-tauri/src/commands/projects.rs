use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::Project,
    services::project_registry,
};

type CommandResult<T> = Result<T, String>;
const PROJECT_ROOT_RELATIVE_PATH: &str = ".";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPayload {
    pub id: String,
    pub name: String,
    pub root_relative_path: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: Option<i64>,
}

impl From<Project> for ProjectPayload {
    fn from(project: Project) -> Self {
        Self {
            id: project.id,
            name: project.name,
            root_relative_path: PROJECT_ROOT_RELATIVE_PATH.to_string(),
            created_at: project.created_at,
            updated_at: project.updated_at,
            last_opened_at: project.last_opened_at,
        }
    }
}

pub fn create_project_with_db(
    database: &Database,
    name: String,
    root_path: String,
) -> AppResult<ProjectPayload> {
    let project = project_registry::create_project(database, &name, root_path.as_str())?;
    Ok(project.into())
}

pub fn list_projects_with_db(database: &Database) -> AppResult<Vec<ProjectPayload>> {
    let projects = project_registry::list_projects(database)?;
    Ok(projects.into_iter().map(Into::into).collect())
}

pub fn get_project_with_db(
    database: &Database,
    project_id: String,
) -> AppResult<Option<ProjectPayload>> {
    let project = project_registry::get_project(database, &project_id)?;
    Ok(project.map(Into::into))
}

pub fn delete_project_with_db(database: &Database, project_id: String) -> AppResult<bool> {
    project_registry::delete_project(database, &project_id)
}

fn project_command_error_message(error: AppError) -> String {
    let message = error.message();

    if message == "project name cannot be blank" {
        return message.to_string();
    }

    if message.starts_with("project root is already registered") {
        return "project root is already registered".to_string();
    }

    if message.starts_with("failed to canonicalize project root")
        || message.starts_with("project root must be a directory")
    {
        return "project root is invalid or inaccessible".to_string();
    }

    "project command failed".to_string()
}

#[tauri::command]
pub fn create_project(
    database: State<'_, Database>,
    name: String,
    root_path: String,
) -> CommandResult<ProjectPayload> {
    create_project_with_db(database.inner(), name, root_path).map_err(project_command_error_message)
}

#[tauri::command]
pub fn list_projects(database: State<'_, Database>) -> CommandResult<Vec<ProjectPayload>> {
    list_projects_with_db(database.inner()).map_err(project_command_error_message)
}

#[tauri::command]
pub fn get_project(
    database: State<'_, Database>,
    project_id: String,
) -> CommandResult<Option<ProjectPayload>> {
    get_project_with_db(database.inner(), project_id).map_err(project_command_error_message)
}

#[tauri::command]
pub fn delete_project(database: State<'_, Database>, project_id: String) -> CommandResult<bool> {
    delete_project_with_db(database.inner(), project_id).map_err(project_command_error_message)
}
