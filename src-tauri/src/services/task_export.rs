use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, OptionalExtension};

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::{Project, Task},
};

const TASK_EXPORT_DIRECTORY: &str = "dispatch/tasks";

pub fn sync_task_markdown_export(
    database: &Database,
    project_id: &str,
    task_id: &str,
) -> AppResult<Option<String>> {
    let Some((project, task)) = load_project_and_task(database, project_id, task_id)? else {
        return Ok(None);
    };

    let relative_path = build_relative_export_path(&task);
    let absolute_path = absolute_export_path(&project.root_path, &relative_path);
    let previous_relative_path = task.markdown_export_path.clone();

    if let Some(previous_relative_path) = previous_relative_path.as_deref() {
        if previous_relative_path != relative_path {
            remove_stale_export(&project.root_path, previous_relative_path)?;
        }
    }

    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::new(format!(
                "failed to create task export directory {}: {error}",
                parent.display()
            ))
        })?;
    }

    fs::write(&absolute_path, render_task_markdown(&task)).map_err(|error| {
        AppError::new(format!(
            "failed to write task export {}: {error}",
            absolute_path.display()
        ))
    })?;

    if task.markdown_export_path.as_deref() != Some(relative_path.as_str()) {
        database.with_connection(|connection| {
            connection.execute(
                "
                UPDATE tasks
                SET markdown_export_path = ?3
                WHERE id = ?1
                  AND project_id = ?2
                ",
                params![task_id, project_id, &relative_path],
            )?;

            Ok::<(), AppError>(())
        })?;
    }

    Ok(Some(relative_path))
}

pub fn remove_task_markdown_export(
    database: &Database,
    project_id: &str,
    task_id: &str,
) -> AppResult<()> {
    let Some((project, existing_relative_path)) =
        load_existing_export_path(database, project_id, task_id)?
    else {
        return Ok(());
    };

    remove_stale_export(&project.root_path, &existing_relative_path)
}

fn load_project_and_task(
    database: &Database,
    project_id: &str,
    task_id: &str,
) -> AppResult<Option<(Project, Task)>> {
    database.with_connection(|connection| {
        let project = connection
            .query_row(
                "
                SELECT id, name, root_path, created_at, updated_at, last_opened_at
                FROM projects
                WHERE id = ?1
                ",
                [project_id],
                |row| {
                    Ok(Project {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        root_path: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                        last_opened_at: row.get(5)?,
                    })
                },
            )
            .optional()?;

        let Some(project) = project else {
            return Ok(None);
        };

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
                WHERE id = ?1
                  AND project_id = ?2
                ",
                params![task_id, project_id],
                |row| {
                    let labels_json = row.get::<_, String>(5)?;
                    let subtasks_json = row.get::<_, String>(6)?;

                    Ok(Task {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        title: row.get(2)?,
                        description_markdown: row.get(3)?,
                        priority: row.get(4)?,
                        labels: serde_json::from_str(&labels_json).map_err(invalid_export_json)?,
                        subtasks: serde_json::from_str(&subtasks_json)
                            .map_err(invalid_export_json)?,
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
                },
            )
            .optional()?;

        Ok(task.map(|task| (project, task)))
    })
}

fn load_existing_export_path(
    database: &Database,
    project_id: &str,
    task_id: &str,
) -> AppResult<Option<(Project, String)>> {
    database.with_connection(|connection| {
        let project = connection
            .query_row(
                "
                SELECT id, name, root_path, created_at, updated_at, last_opened_at
                FROM projects
                WHERE id = ?1
                ",
                [project_id],
                |row| {
                    Ok(Project {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        root_path: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                        last_opened_at: row.get(5)?,
                    })
                },
            )
            .optional()?;

        let Some(project) = project else {
            return Ok(None);
        };

        let export_path = connection
            .query_row(
                "
                SELECT markdown_export_path
                FROM tasks
                WHERE id = ?1
                  AND project_id = ?2
                ",
                params![task_id, project_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        Ok(export_path.map(|path| (project, path)))
    })
}

fn build_relative_export_path(task: &Task) -> String {
    format!(
        "{TASK_EXPORT_DIRECTORY}/{}-{}.md",
        task.id,
        slugify(&task.title)
    )
}

fn absolute_export_path(project_root: &str, relative_path: &str) -> PathBuf {
    Path::new(project_root).join(relative_path)
}

fn remove_stale_export(project_root: &str, previous_relative_path: &str) -> AppResult<()> {
    let previous_absolute_path = absolute_export_path(project_root, previous_relative_path);

    if !previous_absolute_path.exists() {
        return Ok(());
    }

    fs::remove_file(&previous_absolute_path).map_err(|error| {
        AppError::new(format!(
            "failed to remove stale task export {}: {error}",
            previous_absolute_path.display()
        ))
    })?;

    Ok(())
}

fn render_task_markdown(task: &Task) -> String {
    let labels = if task.labels.is_empty() {
        "[]".to_string()
    } else {
        format!(
            "[{}]",
            task.labels
                .iter()
                .map(|label| serde_json::to_string(label).unwrap_or_else(|_| "\"\"".to_string()))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let assignee = yaml_optional_string(task.assignee.as_deref());
    let assigned_agent_mode = yaml_optional_string(task.assigned_agent_mode.as_deref());
    let last_session_id = yaml_optional_string(task.last_session_id.as_deref());
    let blocked_reason = yaml_optional_string(task.blocked_reason.as_deref());

    let subtasks_markdown = if task.subtasks.is_empty() {
        "- None".to_string()
    } else {
        task.subtasks
            .iter()
            .map(|subtask| {
                format!(
                    "- [{}] {}",
                    if subtask.completed { "x" } else { " " },
                    subtask.text
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "---\nid: {}\nproject_id: {}\nworkflow_state: {}\npriority: {}\nlast_run_state: {}\nlast_session_id: {}\nassignee: {}\nassigned_agent_mode: {}\nblocked_reason: {}\nlabels: {}\n---\n\n# {}\n\n## Description\n\n{}\n\n## Subtasks\n\n{}\n\n## Review Notes\n\n{}\n",
        yaml_string(&task.id),
        yaml_string(&task.project_id),
        yaml_string(&task.workflow_state),
        yaml_string(&task.priority),
        yaml_string(&task.last_run_state),
        last_session_id,
        assignee,
        assigned_agent_mode,
        blocked_reason,
        labels,
        task.title,
        markdown_or_placeholder(&task.description_markdown, "No description yet."),
        subtasks_markdown,
        markdown_or_placeholder(&task.review_notes_markdown, "No review notes yet."),
    )
}

fn markdown_or_placeholder(markdown: &str, placeholder: &str) -> String {
    if markdown.trim().is_empty() {
        placeholder.to_string()
    } else {
        markdown.trim().to_string()
    }
}

fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_separator = false;

    for character in title.chars().flat_map(|character| character.to_lowercase()) {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            previous_was_separator = false;
            continue;
        }

        if !previous_was_separator {
            slug.push('-');
            previous_was_separator = true;
        }
    }

    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "task".to_string()
    } else {
        slug
    }
}

fn yaml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn yaml_optional_string(value: Option<&str>) -> String {
    value.map(yaml_string).unwrap_or_else(|| "null".to_string())
}

fn invalid_export_json(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
