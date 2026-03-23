use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{configure_app, db::Database, services::project_registry};
use serde_json::json;
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, INVOKE_KEY},
    webview::{InvokeRequest, WebviewWindowBuilder},
    Manager,
};

fn invoke_command(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost"
                .parse()
                .expect("failed to parse test invoke URL"),
            body: InvokeBody::from(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|response| {
        response
            .deserialize::<serde_json::Value>()
            .expect("IPC payload should deserialize into JSON")
    })
}

#[test]
fn task_commands_expose_project_scoped_crud_over_ipc() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("task-commands-smoke");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_a = temp_root.join("workspace-a");
    let workspace_b = temp_root.join("workspace-b");

    fs::create_dir_all(&workspace_a)?;
    fs::create_dir_all(&workspace_b)?;

    let database = Database::initialize_at(&database_path)?;
    let app = configure_app(mock_builder())
        .manage(Arc::new(database))
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch task command smoke app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build Dispatch task command smoke webview");

    let project_a = project_registry::create_project(
        app.state::<Arc<Database>>().inner(),
        "Workspace A",
        &workspace_a,
    )?;
    let project_b = project_registry::create_project(
        app.state::<Arc<Database>>().inner(),
        "Workspace B",
        &workspace_b,
    )?;

    let empty_list = invoke_command(
        &webview,
        "list_tasks",
        json!({ "input": { "projectId": project_a.id } }),
    )
    .expect("list_tasks should resolve successfully");
    assert_eq!(empty_list, json!([]));

    let created = invoke_command(
        &webview,
        "create_task",
        json!({
            "input": {
                "projectId": project_a.id,
                "title": " Draft task ",
                "descriptionMarkdown": "Task body"
            }
        }),
    )
    .expect("create_task should resolve successfully");
    assert_eq!(created["projectId"], project_a.id);
    assert_eq!(created["title"], "Draft task");
    assert_eq!(created["workflowState"], "draft");
    assert_eq!(created["lastRunState"], "idle");
    assert_eq!(created["priority"], "none");
    assert_eq!(created["labels"], json!([]));
    assert_eq!(created["subtasks"], json!([]));
    assert_eq!(created["reviewNotesMarkdown"], "");
    assert_eq!(created["assignee"], serde_json::Value::Null);

    let task_id = created["id"]
        .as_str()
        .expect("created task should include an id")
        .to_string();

    let project_a_tasks = invoke_command(
        &webview,
        "list_tasks",
        json!({ "input": { "projectId": project_a.id } }),
    )
    .expect("project A tasks should resolve successfully");
    assert_eq!(project_a_tasks, json!([created.clone()]));

    let project_b_tasks = invoke_command(
        &webview,
        "list_tasks",
        json!({ "input": { "projectId": project_b.id } }),
    )
    .expect("project B tasks should resolve successfully");
    assert_eq!(project_b_tasks, json!([]));

    let updated = invoke_command(
        &webview,
        "update_task",
        json!({
            "input": {
                "projectId": project_a.id,
                "taskId": task_id,
                "priority": "high",
                "labels": ["backend", "release"],
                "subtasks": [
                    {
                        "id": "subtask-1",
                        "text": "Ship task metadata migration",
                        "completed": false
                    }
                ],
                "reviewNotesMarkdown": "Looks good after migration.",
                "assignee": "Avery",
                "workflowState": "review",
                "completedAt": 777
            }
        }),
    )
    .expect("update_task should resolve successfully");
    assert_eq!(updated["title"], "Draft task");
    assert_eq!(updated["priority"], "high");
    assert_eq!(updated["labels"], json!(["backend", "release"]));
    assert_eq!(
        updated["subtasks"],
        json!([{ "id": "subtask-1", "text": "Ship task metadata migration", "completed": false }])
    );
    assert_eq!(
        updated["reviewNotesMarkdown"],
        "Looks good after migration."
    );
    assert_eq!(updated["assignee"], "Avery");
    assert_eq!(updated["workflowState"], "review");
    assert_eq!(updated["completedAt"], 777);

    let cross_project_delete = invoke_command(
        &webview,
        "delete_task",
        json!({
            "input": {
                "projectId": project_b.id,
                "taskId": updated["id"]
            }
        }),
    )
    .expect("delete_task should resolve successfully");
    assert_eq!(cross_project_delete, json!(false));

    let deleted = invoke_command(
        &webview,
        "delete_task",
        json!({
            "input": {
                "projectId": project_a.id,
                "taskId": updated["id"]
            }
        }),
    )
    .expect("delete_task should resolve successfully");
    assert_eq!(deleted, json!(true));

    let deleted_list = invoke_command(
        &webview,
        "list_tasks",
        json!({ "input": { "projectId": project_a.id } }),
    )
    .expect("project A task list should resolve after deletion");
    assert_eq!(deleted_list, json!([]));

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
