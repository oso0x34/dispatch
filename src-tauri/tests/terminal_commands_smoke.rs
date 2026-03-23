use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    configure_app,
    db::Database,
    services::{project_registry, pty_manager},
};
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
fn create_terminal_session_command_uses_managed_pty_state_and_sanitized_payload(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("terminal-commands");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;
    let app = configure_app(mock_builder())
        .manage(Arc::new(database))
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch terminal command test app");
    let managed_database = app.state::<Arc<Database>>().inner().clone();
    let managed_pty_manager = app.state::<Arc<pty_manager::PtyManager>>().inner().clone();
    managed_pty_manager.configure_supervision(
        managed_database,
        Arc::downgrade(&managed_pty_manager),
        app.handle().path().app_log_dir()?.join("sessions"),
    )?;
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build Dispatch terminal command test webview");

    let created = invoke_command(
        &webview,
        "create_terminal_session",
        json!({
            "projectId": project.id,
            "shell": default_test_shell(),
        }),
    )
    .expect("create_terminal_session should resolve successfully");

    assert_eq!(created["source"], "terminal");
    assert_eq!(created["sessionKind"], "shell");
    assert_eq!(created["status"], "running");
    assert_eq!(created["transport"], "pty");
    assert_eq!(created["cwdRelativePath"], ".");
    assert!(
        created.get("cwd").is_none(),
        "create_terminal_session should not expose an absolute cwd over IPC"
    );

    let session_id = created["id"]
        .as_str()
        .expect("created terminal session should include an id")
        .to_string();
    let stored = pty_manager::get_agent_session(app.state::<Arc<Database>>().inner(), &session_id)?
        .expect("terminal session command should persist the created session row");
    assert_eq!(stored.source, "terminal");
    assert_eq!(stored.session_kind, "shell");

    let session_log_path = app
        .handle()
        .path()
        .app_log_dir()?
        .join("sessions")
        .join(format!("{session_id}.log"));

    let session = app
        .state::<Arc<pty_manager::PtyManager>>()
        .get(&session_id)
        .expect("managed PTY registry should contain the created session");
    session.write_all(&default_session_output_command("dispatch-session-log"))?;
    wait_for_file_contains(&session_log_path, "dispatch-session-log")?;

    let terminated = app
        .state::<Arc<pty_manager::PtyManager>>()
        .terminate_session(&session_id)?;
    assert!(
        terminated,
        "managed PTY registry should contain the session created over IPC"
    );

    drop(webview);
    drop(app);
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

#[cfg(unix)]
fn default_test_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

#[cfg(windows)]
fn default_test_shell() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
}

#[cfg(unix)]
fn default_session_output_command(marker: &str) -> Vec<u8> {
    format!("printf '{marker}\\n'\r").into_bytes()
}

#[cfg(windows)]
fn default_session_output_command(marker: &str) -> Vec<u8> {
    format!("echo {marker}\r\n").into_bytes()
}

fn wait_for_file_contains(path: &Path, expected: &str) -> Result<(), Box<dyn Error>> {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);

    loop {
        if path.exists() {
            let contents = fs::read_to_string(path)?;
            if contents.contains(expected) {
                return Ok(());
            }
        }

        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "timed out waiting for {} to contain {expected}",
                path.display()
            )
            .into());
        }

        std::thread::sleep(Duration::from_millis(25));
    }
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
