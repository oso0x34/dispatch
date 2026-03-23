use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    commands::tasks::{
        create_task_with_db, delete_task_with_db, list_tasks_with_db, update_task_with_db,
        CreateTaskInput, DeleteTaskInput, UpdateTaskInput,
    },
    db::Database,
    models::TaskSubtask,
    services::project_registry,
};

#[test]
fn task_commands_are_project_scoped_for_empty_populated_update_and_delete_flows(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("task-commands-scoped");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_a = temp_root.join("workspace-a");
    let workspace_b = temp_root.join("workspace-b");

    fs::create_dir_all(&workspace_a)?;
    fs::create_dir_all(&workspace_b)?;

    let database = Database::initialize_at(&database_path)?;
    let project_a = project_registry::create_project(&database, "Workspace A", &workspace_a)?;
    let project_b = project_registry::create_project(&database, "Workspace B", &workspace_b)?;
    let project_a_id = project_a.id.clone();
    let project_b_id = project_b.id.clone();

    assert!(list_tasks_with_db(&database, project_a_id.clone())?.is_empty());

    let created_a = create_task_with_db(
        &database,
        CreateTaskInput {
            project_id: project_a_id.clone(),
            title: " Task A ".to_string(),
            description_markdown: Some("Task A body".to_string()),
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
    assert_eq!(created_a.project_id, project_a_id);
    assert_eq!(created_a.title, "Task A");
    assert_eq!(created_a.description_markdown, "Task A body");
    assert_eq!(created_a.priority, "none");
    assert!(created_a.labels.is_empty());
    assert!(created_a.subtasks.is_empty());
    assert_eq!(created_a.review_notes_markdown, "");
    assert_eq!(created_a.assignee, None);
    assert_eq!(created_a.workflow_state, "draft");
    assert_eq!(created_a.last_run_state, "idle");
    assert!(created_a
        .markdown_export_path
        .as_deref()
        .is_some_and(|path| path.ends_with("-task-a.md")));

    let created_b = create_task_with_db(
        &database,
        CreateTaskInput {
            project_id: project_b_id.clone(),
            title: "Task B".to_string(),
            description_markdown: Some("Task B body".to_string()),
            priority: Some("high".to_string()),
            labels: Some(vec!["backend".to_string(), "release".to_string()]),
            subtasks: Some(vec![
                TaskSubtask {
                    id: "subtask-b1".to_string(),
                    text: "Cut release branch".to_string(),
                    completed: false,
                },
                TaskSubtask {
                    id: "subtask-b2".to_string(),
                    text: "Write changelog".to_string(),
                    completed: true,
                },
            ]),
            review_notes_markdown: Some("Review notes go here".to_string()),
            assignee: Some("Avery".to_string()),
            workflow_state: Some("planning".to_string()),
            last_run_state: Some("running".to_string()),
            last_session_id: None,
            assigned_agent_mode: Some("auto".to_string()),
            markdown_export_path: Some("dispatch/tasks/task-b.md".to_string()),
            blocked_reason: Some("Waiting on review".to_string()),
            completed_at: Some(now_unix_seconds() + 1),
        },
    )?;
    assert_eq!(created_b.project_id, project_b_id);
    assert_eq!(created_b.priority, "high");
    assert_eq!(
        created_b.labels,
        vec!["backend".to_string(), "release".to_string()]
    );
    assert_eq!(created_b.subtasks.len(), 2);
    assert_eq!(created_b.review_notes_markdown, "Review notes go here");
    assert_eq!(created_b.assignee.as_deref(), Some("Avery"));
    assert_eq!(created_b.workflow_state, "planning");
    assert_eq!(created_b.last_run_state, "running");
    assert!(created_b
        .markdown_export_path
        .as_deref()
        .is_some_and(|path| path.ends_with("-task-b.md")));

    assert_eq!(
        list_tasks_with_db(&database, project_a_id.clone())?,
        vec![created_a.clone()]
    );
    assert_eq!(
        list_tasks_with_db(&database, project_b_id.clone())?,
        vec![created_b.clone()]
    );

    let updated_a = update_task_with_db(
        &database,
        UpdateTaskInput {
            project_id: project_a_id.clone(),
            task_id: created_a.id.clone(),
            title: Some("Task A updated".to_string()),
            description_markdown: Some("Task A body updated".to_string()),
            priority: Some("urgent".to_string()),
            labels: Some(vec!["frontend".to_string(), "ux".to_string()]),
            subtasks: Some(vec![TaskSubtask {
                id: "subtask-a1".to_string(),
                text: "Update task drawer".to_string(),
                completed: false,
            }]),
            review_notes_markdown: Some("Needs another pass".to_string()),
            assignee: Some(Some("Jordan".to_string())),
            workflow_state: Some("in_progress".to_string()),
            last_run_state: Some("running".to_string()),
            last_session_id: Some(None),
            assigned_agent_mode: Some(Some("profile:codex".to_string())),
            markdown_export_path: Some(Some("dispatch/tasks/task-a.md".to_string())),
            blocked_reason: Some(Some("Blocked on input".to_string())),
            completed_at: Some(None),
        },
    )?;
    assert_eq!(updated_a.id, created_a.id);
    assert_eq!(updated_a.project_id, project_a_id);
    assert_eq!(updated_a.title, "Task A updated");
    assert_eq!(updated_a.description_markdown, "Task A body updated");
    assert_eq!(updated_a.priority, "urgent");
    assert_eq!(
        updated_a.labels,
        vec!["frontend".to_string(), "ux".to_string()]
    );
    assert_eq!(updated_a.subtasks.len(), 1);
    assert_eq!(updated_a.review_notes_markdown, "Needs another pass");
    assert_eq!(updated_a.assignee.as_deref(), Some("Jordan"));
    assert_eq!(updated_a.workflow_state, "in_progress");
    assert_eq!(updated_a.last_run_state, "running");
    assert_eq!(updated_a.last_session_id, None);
    assert_eq!(
        updated_a.assigned_agent_mode.as_deref(),
        Some("profile:codex")
    );
    assert!(updated_a
        .markdown_export_path
        .as_deref()
        .is_some_and(|path| path.ends_with("-task-a-updated.md")));
    assert_eq!(
        updated_a.blocked_reason.as_deref(),
        Some("Blocked on input")
    );
    assert_eq!(
        list_tasks_with_db(&database, project_a_id.clone())?,
        vec![updated_a.clone()]
    );

    let partially_updated_a = update_task_with_db(
        &database,
        UpdateTaskInput {
            project_id: project_a_id.clone(),
            task_id: created_a.id.clone(),
            title: None,
            description_markdown: None,
            priority: None,
            labels: None,
            subtasks: None,
            review_notes_markdown: Some(String::new()),
            assignee: Some(None),
            workflow_state: Some("review".to_string()),
            last_run_state: None,
            last_session_id: None,
            assigned_agent_mode: None,
            markdown_export_path: None,
            blocked_reason: Some(None),
            completed_at: Some(Some(now_unix_seconds() + 2)),
        },
    )?;
    assert_eq!(partially_updated_a.title, "Task A updated");
    assert_eq!(
        partially_updated_a.description_markdown,
        "Task A body updated"
    );
    assert_eq!(partially_updated_a.priority, "urgent");
    assert_eq!(
        partially_updated_a.labels,
        vec!["frontend".to_string(), "ux".to_string()]
    );
    assert_eq!(partially_updated_a.subtasks.len(), 1);
    assert_eq!(partially_updated_a.review_notes_markdown, "");
    assert_eq!(partially_updated_a.assignee, None);
    assert_eq!(partially_updated_a.workflow_state, "review");
    assert_eq!(partially_updated_a.last_run_state, "running");
    assert_eq!(partially_updated_a.blocked_reason, None);
    assert!(partially_updated_a.completed_at.is_some());
    assert_eq!(
        list_tasks_with_db(&database, project_a_id.clone())?,
        vec![partially_updated_a.clone()]
    );

    let cross_project_update = update_task_with_db(
        &database,
        UpdateTaskInput {
            project_id: project_a_id.clone(),
            task_id: created_b.id.clone(),
            title: Some(created_b.title.clone()),
            description_markdown: Some(created_b.description_markdown.clone()),
            priority: Some(created_b.priority.clone()),
            labels: Some(created_b.labels.clone()),
            subtasks: Some(created_b.subtasks.clone()),
            review_notes_markdown: Some(created_b.review_notes_markdown.clone()),
            assignee: Some(created_b.assignee.clone()),
            workflow_state: Some(created_b.workflow_state.clone()),
            last_run_state: Some(created_b.last_run_state.clone()),
            last_session_id: Some(created_b.last_session_id.clone()),
            assigned_agent_mode: Some(created_b.assigned_agent_mode.clone()),
            markdown_export_path: Some(created_b.markdown_export_path.clone()),
            blocked_reason: Some(created_b.blocked_reason.clone()),
            completed_at: Some(created_b.completed_at),
        },
    )
    .expect_err("project-scoped updates should not touch tasks from another project");
    assert_eq!(cross_project_update.message(), "task not found");
    assert_eq!(
        list_tasks_with_db(&database, project_b_id.clone())?,
        vec![created_b.clone()]
    );

    assert!(
        delete_task_with_db(
            &database,
            DeleteTaskInput {
                project_id: project_a_id.clone(),
                task_id: created_a.id.clone(),
            },
        )?,
        "deleting task A within its project should succeed"
    );
    assert!(list_tasks_with_db(&database, project_a_id.clone())?.is_empty());

    assert!(
        !delete_task_with_db(
            &database,
            DeleteTaskInput {
                project_id: project_a_id.clone(),
                task_id: created_b.id.clone(),
            },
        )?,
        "deleting a task from the wrong project should report no match"
    );
    assert_eq!(
        list_tasks_with_db(&database, project_b_id.clone())?,
        vec![created_b.clone()]
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn task_commands_reject_blank_titles_and_missing_projects() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("task-commands-validation");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    let blank_title_error = create_task_with_db(
        &database,
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "   ".to_string(),
            description_markdown: None,
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
    )
    .expect_err("blank task titles should be rejected");
    assert_eq!(blank_title_error.message(), "task title cannot be blank");

    let missing_project_error = list_tasks_with_db(&database, "missing-project".to_string())
        .expect_err("missing projects should be rejected");
    assert_eq!(missing_project_error.message(), "project not found");

    let invalid_priority_error = create_task_with_db(
        &database,
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Priority task".to_string(),
            description_markdown: None,
            priority: Some("critical".to_string()),
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
    )
    .expect_err("invalid task priority should be rejected");
    assert_eq!(invalid_priority_error.message(), "task priority is invalid");

    let invalid_subtasks_error = create_task_with_db(
        &database,
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Subtask task".to_string(),
            description_markdown: None,
            priority: None,
            labels: None,
            subtasks: Some(vec![TaskSubtask {
                id: "subtask-1".to_string(),
                text: "   ".to_string(),
                completed: false,
            }]),
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
    )
    .expect_err("invalid subtasks should be rejected");
    assert_eq!(
        invalid_subtasks_error.message(),
        "task subtasks are invalid"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

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

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_secs() as i64
}
