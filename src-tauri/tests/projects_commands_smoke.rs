use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{configure_app, db::Database};
use serde_json::json;
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, INVOKE_KEY},
    webview::{InvokeRequest, WebviewWindowBuilder},
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
fn project_commands_only_expose_project_scoped_paths_over_ipc() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("projects-commands");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let nested_directory = project_root.join("nested");

    fs::create_dir_all(&nested_directory)?;

    let database = Database::initialize_at(&database_path)?;
    let app = configure_app(mock_builder())
        .manage(Arc::new(database))
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch projects command test app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build Dispatch projects command test webview");

    let created = invoke_command(
        &webview,
        "create_project",
        json!({
            "name": " Dispatch Workspace ",
            "rootPath": nested_directory.join("..").to_string_lossy(),
        }),
    )
    .expect("create_project should resolve successfully");

    assert_eq!(created["name"], "Dispatch Workspace");
    assert_eq!(created["rootRelativePath"], ".");
    assert!(
        created.get("rootPath").is_none(),
        "create_project should not expose an absolute rootPath field over IPC"
    );

    let project_id = created["id"]
        .as_str()
        .expect("created project should include an id")
        .to_string();

    let listed = invoke_command(&webview, "list_projects", json!({}))
        .expect("list_projects should resolve successfully");
    let listed_projects = listed
        .as_array()
        .expect("list_projects should return an array");
    assert_eq!(listed_projects, &[created.clone()]);

    let fetched = invoke_command(
        &webview,
        "get_project",
        json!({ "projectId": project_id.clone() }),
    )
    .expect("get_project should resolve successfully");
    assert_eq!(fetched, created);

    let duplicate_error = invoke_command(
        &webview,
        "create_project",
        json!({
            "name": "Duplicate Workspace",
            "rootPath": project_root.to_string_lossy(),
        }),
    )
    .expect_err("duplicate project root should be rejected");

    let duplicate_message = duplicate_error
        .as_str()
        .expect("duplicate create_project error should be a string");
    assert_eq!(duplicate_message, "project root is already registered");
    assert!(
        !duplicate_message.contains(&project_root.to_string_lossy().into_owned()),
        "duplicate errors should not leak the host filesystem path"
    );

    let invalid_error = invoke_command(
        &webview,
        "create_project",
        json!({
            "name": "Missing Workspace",
            "rootPath": temp_root.join("missing-workspace").to_string_lossy(),
        }),
    )
    .expect_err("invalid project roots should be rejected");
    let invalid_message = invalid_error
        .as_str()
        .expect("invalid create_project error should be a string");
    assert_eq!(invalid_message, "project root is invalid or inaccessible");

    let deleted = invoke_command(
        &webview,
        "delete_project",
        json!({ "projectId": project_id.clone() }),
    )
    .expect("delete_project should resolve successfully");
    assert_eq!(deleted, json!(true));

    let missing = invoke_command(&webview, "get_project", json!({ "projectId": project_id }))
        .expect("get_project should resolve successfully after deletion");
    assert_eq!(missing, serde_json::Value::Null);

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
