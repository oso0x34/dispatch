use std::{
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, OptionalExtension, Row};

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::Project,
};

use super::path_guard;

static PROJECT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn create_project(
    database: &Database,
    name: &str,
    root_path: impl AsRef<Path>,
) -> AppResult<Project> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::new("project name cannot be blank"));
    }

    let canonical_root_path = path_guard::canonicalize_project_root(root_path.as_ref())?;
    let canonical_root_path_string = canonical_root_path.to_string_lossy().into_owned();

    database.with_connection(|connection| {
        if project_exists_for_root(connection, &canonical_root_path_string)? {
            return Err(AppError::new(format!(
                "project root is already registered: {}",
                canonical_root_path.display()
            )));
        }

        let now = now_unix_seconds();
        let project = Project {
            id: next_project_id(),
            name: trimmed_name.to_string(),
            root_path: canonical_root_path_string.clone(),
            created_at: now,
            updated_at: now,
            last_opened_at: None,
        };

        connection.execute(
            "
            INSERT INTO projects (id, name, root_path, created_at, updated_at, last_opened_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                &project.id,
                &project.name,
                &project.root_path,
                project.created_at,
                project.updated_at,
                project.last_opened_at,
            ],
        )?;

        Ok(project)
    })
}

pub fn list_projects(database: &Database) -> AppResult<Vec<Project>> {
    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "
            SELECT id, name, root_path, created_at, updated_at, last_opened_at
            FROM projects
            ORDER BY
                COALESCE(last_opened_at, 0) DESC,
                updated_at DESC,
                name COLLATE NOCASE ASC,
                id ASC
            ",
        )?;
        let projects = statement
            .query_map([], row_to_project)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(projects)
    })
}

pub fn get_project(database: &Database, project_id: &str) -> AppResult<Option<Project>> {
    database.with_connection(|connection| {
        let project = connection
            .query_row(
                "
                SELECT id, name, root_path, created_at, updated_at, last_opened_at
                FROM projects
                WHERE id = ?1
                ",
                [project_id],
                row_to_project,
            )
            .optional()?;

        Ok(project)
    })
}

pub fn delete_project(database: &Database, project_id: &str) -> AppResult<bool> {
    database.with_connection(|connection| {
        let deleted_rows =
            connection.execute("DELETE FROM projects WHERE id = ?1", [project_id])?;
        Ok(deleted_rows > 0)
    })
}

fn row_to_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        last_opened_at: row.get(5)?,
    })
}

fn project_exists_for_root(
    connection: &rusqlite::Connection,
    root_path: &str,
) -> rusqlite::Result<bool> {
    let existing_project_id = connection
        .query_row(
            "SELECT id FROM projects WHERE root_path = ?1 LIMIT 1",
            [root_path],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    Ok(existing_project_id.is_some())
}

fn next_project_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let process_id = std::process::id();
    let sequence = PROJECT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);

    format!("project-{process_id}-{now}-{sequence}")
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
