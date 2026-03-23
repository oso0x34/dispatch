use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    commands::window::{hide_main_window, is_main_window_visible, show_main_window},
    configure_app,
    db::Database,
};
use tauri::{test::mock_builder, webview::WebviewWindowBuilder};

#[test]
fn window_commands_resolve_against_the_main_window() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("system-window");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Arc::new(Database::initialize_at(&database_path)?);
    let app = configure_app(mock_builder())
        .manage(database)
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch system window smoke app");
    let _webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build Dispatch main webview");

    // MockRuntime reports window visibility as always true, so this smoke only
    // proves that the Tauri commands resolve against the main window wiring.
    assert!(
        is_main_window_visible(app.handle().clone()).expect("visibility command should resolve")
    );
    assert!(hide_main_window(app.handle().clone()).is_ok());
    assert!(show_main_window(app.handle().clone()).expect("show command should resolve"));

    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn window_commands_fail_when_the_main_window_is_missing() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("system-window-missing");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Arc::new(Database::initialize_at(&database_path)?);
    let app = configure_app(mock_builder())
        .manage(database)
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch system window smoke app");

    let error =
        show_main_window(app.handle().clone()).expect_err("show should fail without a main window");
    assert_eq!(error, "main window is unavailable");

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
