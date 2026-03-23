use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    commands::tasks::{create_task_with_db, update_task_with_db, CreateTaskInput, UpdateTaskInput},
    db::Database,
    models::{AgentSession, TaskSubtask},
    services::{dispatch, project_registry},
};

#[test]
fn task_exports_write_slugged_markdown_on_create_and_update() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("task-export");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    let created = create_task_with_db(
        &database,
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Ship task export".to_string(),
            description_markdown: Some("Describe the export".to_string()),
            priority: Some("high".to_string()),
            labels: Some(vec!["backend".to_string(), "release".to_string()]),
            subtasks: Some(vec![TaskSubtask {
                id: "subtask-1".to_string(),
                text: "Write the export".to_string(),
                completed: false,
            }]),
            review_notes_markdown: Some("Check the generated markdown".to_string()),
            assignee: Some("Avery".to_string()),
            workflow_state: None,
            last_run_state: None,
            last_session_id: None,
            assigned_agent_mode: Some("auto".to_string()),
            markdown_export_path: None,
            blocked_reason: None,
            completed_at: None,
        },
    )?;

    let created_relative_path = created
        .markdown_export_path
        .clone()
        .expect("created task should have an export path");
    assert!(created_relative_path.starts_with("dispatch/tasks/"));
    assert!(created_relative_path.ends_with("-ship-task-export.md"));

    let created_absolute_path = workspace.join(&created_relative_path);
    let created_markdown = fs::read_to_string(&created_absolute_path)?;
    assert!(created_markdown.contains("workflow_state: \"draft\""));
    assert!(created_markdown.contains("priority: \"high\""));
    assert!(created_markdown.contains("last_run_state: \"idle\""));
    assert!(created_markdown.contains("labels: [\"backend\", \"release\"]"));
    assert!(created_markdown.contains("# Ship task export"));
    assert!(created_markdown.contains("## Subtasks"));
    assert!(created_markdown.contains("- [ ] Write the export"));
    assert!(created_markdown.contains("## Review Notes"));

    let updated = update_task_with_db(
        &database,
        UpdateTaskInput {
            project_id: project.id.clone(),
            task_id: created.id.clone(),
            title: Some("Ship task export now".to_string()),
            description_markdown: Some("Export is now updated".to_string()),
            priority: Some("urgent".to_string()),
            labels: Some(vec!["backend".to_string(), "docs".to_string()]),
            subtasks: Some(vec![TaskSubtask {
                id: "subtask-1".to_string(),
                text: "Verify the renamed export".to_string(),
                completed: true,
            }]),
            review_notes_markdown: Some("Reviewed and updated".to_string()),
            assignee: Some(Some("Jordan".to_string())),
            workflow_state: Some("review".to_string()),
            last_run_state: None,
            last_session_id: None,
            assigned_agent_mode: Some(Some("profile:codex".to_string())),
            markdown_export_path: None,
            blocked_reason: None,
            completed_at: None,
        },
    )?;

    let updated_relative_path = updated
        .markdown_export_path
        .clone()
        .expect("updated task should keep an export path");
    assert!(updated_relative_path.ends_with("-ship-task-export-now.md"));
    assert_ne!(updated_relative_path, created_relative_path);
    assert!(
        !created_absolute_path.exists(),
        "renaming the export should remove the previous file"
    );

    let updated_absolute_path = workspace.join(&updated_relative_path);
    let updated_markdown = fs::read_to_string(&updated_absolute_path)?;
    assert!(updated_markdown.contains("workflow_state: \"review\""));
    assert!(updated_markdown.contains("priority: \"urgent\""));
    assert!(updated_markdown.contains("assigned_agent_mode: \"profile:codex\""));
    assert!(updated_markdown.contains("assignee: \"Jordan\""));
    assert!(updated_markdown.contains("labels: [\"backend\", \"docs\"]"));
    assert!(updated_markdown.contains("- [x] Verify the renamed export"));
    assert!(updated_markdown.contains("Reviewed and updated"));

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn task_exports_follow_direct_dispatch_state_transitions() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("task-export-dispatch");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;
    let task = create_task_with_db(
        &database,
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Dispatchable task".to_string(),
            description_markdown: Some("Task body".to_string()),
            priority: None,
            labels: None,
            subtasks: None,
            review_notes_markdown: None,
            assignee: None,
            workflow_state: None,
            last_run_state: None,
            last_session_id: None,
            assigned_agent_mode: None,
            markdown_export_path: None,
            blocked_reason: None,
            completed_at: None,
        },
    )?;

    let started_session = build_direct_session(&project.id, &task.id, "session-1", "running");
    insert_agent_session(&database, &started_session)?;
    dispatch::mark_task_dispatch_started(&database, &started_session)?;

    let started_markdown = fs::read_to_string(
        workspace.join(
            task.markdown_export_path
                .clone()
                .expect("task export path should exist after creation"),
        ),
    )?;
    assert!(started_markdown.contains("workflow_state: \"in_progress\""));
    assert!(started_markdown.contains("last_run_state: \"running\""));
    assert!(started_markdown.contains("last_session_id: \"session-1\""));

    let finished_session = build_direct_session(&project.id, &task.id, "session-1", "succeeded");
    dispatch::sync_task_with_session_status(&database, &finished_session)?;

    let finished_markdown = fs::read_to_string(
        workspace.join(
            task.markdown_export_path
                .clone()
                .expect("task export path should still exist"),
        ),
    )?;
    assert!(finished_markdown.contains("workflow_state: \"review\""));
    assert!(finished_markdown.contains("last_run_state: \"succeeded\""));
    assert!(finished_markdown.contains("last_session_id: \"session-1\""));

    cleanup_database_artifacts(&database_path);

    Ok(())
}

fn build_direct_session(
    project_id: &str,
    task_id: &str,
    session_id: &str,
    status: &str,
) -> AgentSession {
    AgentSession {
        id: session_id.to_string(),
        project_id: project_id.to_string(),
        task_id: Some(task_id.to_string()),
        source: "direct_dispatch".to_string(),
        session_kind: "direct_agent".to_string(),
        status: status.to_string(),
        program: "codex".to_string(),
        args_json: "[]".to_string(),
        env_keys_json: "[]".to_string(),
        cwd: "/tmp".to_string(),
        transport: "pty".to_string(),
        exit_code: None,
        started_at: Some(unix_timestamp()),
        ended_at: None,
        created_at: unix_timestamp(),
        updated_at: unix_timestamp(),
    }
}

fn insert_agent_session(database: &Database, session: &AgentSession) -> Result<(), Box<dyn Error>> {
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
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ",
            (
                &session.id,
                &session.project_id,
                &session.task_id,
                &session.source,
                &session.session_kind,
                &session.status,
                &session.program,
                &session.args_json,
                &session.env_keys_json,
                &session.cwd,
                &session.transport,
                session.exit_code,
                session.started_at,
                session.ended_at,
                session.created_at,
                session.updated_at,
            ),
        )?;

        Ok::<(), dispatch_lib::error::AppError>(())
    })?;

    Ok(())
}

fn unique_temp_directory(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "dispatch-{label}-{}-{timestamp}",
        std::process::id()
    ));

    fs::create_dir_all(&path).expect("failed to create temp test directory");

    path
}

fn cleanup_database_artifacts(database_path: &Path) {
    for path in [
        database_path.to_path_buf(),
        database_path.with_extension("sqlite3-shm"),
        database_path.with_extension("sqlite3-wal"),
    ] {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    if let Some(parent) = database_path.parent() {
        let _ = fs::remove_dir_all(parent);
    }
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_secs() as i64
}
