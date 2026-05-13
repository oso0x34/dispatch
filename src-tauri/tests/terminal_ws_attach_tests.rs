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
    services::{
        project_registry,
        pty_manager::{self, CreateDispatchSessionRequest, CreateShellSessionRequest},
        terminal_ws,
    },
};
use futures_util::{SinkExt, StreamExt};
use tauri::Manager;
use tokio_tungstenite::{connect_async, tungstenite};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn websocket_attach_rejects_missing_and_finished_sessions() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("terminal-ws-reject");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let app = configure_app(tauri::test::mock_builder())
        .manage(Arc::new(database))
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch websocket test app");
    let project = project_registry::create_project(
        app.state::<Arc<Database>>().inner(),
        "Workspace",
        &project_root,
    )?;
    let websocket_service = terminal_ws::spawn_terminal_ws_server(
        app.state::<Arc<Database>>().inner().clone(),
        app.state::<Arc<pty_manager::PtyManager>>().inner().clone(),
    )?;

    assert_missing_session_rejected(
        websocket_service
            .session_websocket_url("missing-session")
            .as_str(),
    )
    .await?;

    let finished_session = pty_manager::create_dispatch_session(
        app.state::<Arc<Database>>().inner(),
        app.state::<Arc<pty_manager::PtyManager>>().inner(),
        CreateDispatchSessionRequest {
            project_id: project.id,
            task_id: None,
            program: default_test_shell(),
            args: exit_immediately_args(),
            env: Vec::new(),
        },
    )?;
    wait_for_process_exit(
        app.state::<Arc<pty_manager::PtyManager>>().inner(),
        &finished_session.id,
    )
    .await?;

    let connect_error =
        connect_async(websocket_service.session_websocket_url(&finished_session.id))
            .await
            .expect_err("finished sessions should reject websocket attach");
    let response = connect_error_response(connect_error)?;
    assert_eq!(response.status(), tungstenite::http::StatusCode::CONFLICT);

    let stored_session =
        pty_manager::get_agent_session(app.state::<Arc<Database>>().inner(), &finished_session.id)?
            .expect("finished session should still have a persisted row");
    assert_eq!(stored_session.status, "succeeded");

    drop(websocket_service);
    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn websocket_attach_streams_output_and_reconnects_without_new_pty(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("terminal-ws-reconnect");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let app = configure_app(tauri::test::mock_builder())
        .manage(Arc::new(database))
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch websocket test app");
    let project = project_registry::create_project(
        app.state::<Arc<Database>>().inner(),
        "Workspace",
        &project_root,
    )?;
    let websocket_service = terminal_ws::spawn_terminal_ws_server(
        app.state::<Arc<Database>>().inner().clone(),
        app.state::<Arc<pty_manager::PtyManager>>().inner().clone(),
    )?;

    let session = pty_manager::create_shell_session(
        app.state::<Arc<Database>>().inner(),
        app.state::<Arc<pty_manager::PtyManager>>().inner(),
        CreateShellSessionRequest {
            project_id: project.id,
            task_id: None,
            shell: Some(default_test_shell()),
        },
    )?;

    let websocket_url = websocket_service.session_websocket_url(&session.id);
    let (mut first_socket, _) = connect_async(websocket_url.as_str()).await?;

    first_socket
        .send(tungstenite::Message::Binary(
            shell_echo_command("dispatch-ws-first").into(),
        ))
        .await?;
    wait_for_output(&mut first_socket, "dispatch-ws-first").await?;
    first_socket.close(None).await?;
    assert_eq!(
        app.state::<Arc<pty_manager::PtyManager>>().session_count(),
        1
    );

    let (mut second_socket, _) = connect_async(websocket_url.as_str()).await?;
    second_socket
        .send(tungstenite::Message::Binary(
            shell_echo_command("dispatch-ws-second").into(),
        ))
        .await?;
    wait_for_output(&mut second_socket, "dispatch-ws-second").await?;
    second_socket.close(None).await?;

    let stored_session =
        pty_manager::get_agent_session(app.state::<Arc<Database>>().inner(), &session.id)?
            .expect("reconnected websocket session should keep its persisted row");
    assert_eq!(stored_session.id, session.id);
    assert_eq!(
        app.state::<Arc<pty_manager::PtyManager>>().session_count(),
        1
    );

    let terminated = app
        .state::<Arc<pty_manager::PtyManager>>()
        .terminate_session(&session.id)?;
    assert!(
        terminated,
        "test cleanup should terminate the live PTY session"
    );

    drop(websocket_service);
    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn websocket_attach_closes_and_marks_session_finished_when_process_exits(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("terminal-ws-exit");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let app = configure_app(tauri::test::mock_builder())
        .manage(Arc::new(database))
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch websocket test app");
    let project = project_registry::create_project(
        app.state::<Arc<Database>>().inner(),
        "Workspace",
        &project_root,
    )?;
    let websocket_service = terminal_ws::spawn_terminal_ws_server(
        app.state::<Arc<Database>>().inner().clone(),
        app.state::<Arc<pty_manager::PtyManager>>().inner().clone(),
    )?;

    let session = pty_manager::create_shell_session(
        app.state::<Arc<Database>>().inner(),
        app.state::<Arc<pty_manager::PtyManager>>().inner(),
        CreateShellSessionRequest {
            project_id: project.id,
            task_id: None,
            shell: Some(default_test_shell()),
        },
    )?;

    let (mut socket, _) =
        connect_async(websocket_service.session_websocket_url(&session.id)).await?;
    socket
        .send(tungstenite::Message::Binary(b"exit\r".to_vec().into()))
        .await?;
    wait_for_socket_close(&mut socket).await?;
    wait_for_session_status(
        app.state::<Arc<Database>>().inner(),
        &session.id,
        "succeeded",
    )
    .await?;
    assert!(
        app.state::<Arc<pty_manager::PtyManager>>()
            .get(&session.id)
            .is_none(),
        "finished sessions should be removed from the in-memory PTY registry"
    );

    drop(websocket_service);
    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn websocket_resize_messages_update_the_existing_pty() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("terminal-ws-resize");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let app = configure_app(tauri::test::mock_builder())
        .manage(Arc::new(database))
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch websocket test app");
    let project = project_registry::create_project(
        app.state::<Arc<Database>>().inner(),
        "Workspace",
        &project_root,
    )?;
    let websocket_service = terminal_ws::spawn_terminal_ws_server(
        app.state::<Arc<Database>>().inner().clone(),
        app.state::<Arc<pty_manager::PtyManager>>().inner().clone(),
    )?;

    let session = pty_manager::create_shell_session(
        app.state::<Arc<Database>>().inner(),
        app.state::<Arc<pty_manager::PtyManager>>().inner(),
        CreateShellSessionRequest {
            project_id: project.id,
            task_id: None,
            shell: Some(default_test_shell()),
        },
    )?;

    let (mut socket, _) =
        connect_async(websocket_service.session_websocket_url(&session.id)).await?;
    socket
        .send(tungstenite::Message::Text(
            r#"{"type":"resize","rows":41,"cols":119,"pixel_width":0,"pixel_height":0}"#
                .to_string()
                .into(),
        ))
        .await?;
    tokio::time::sleep(Duration::from_millis(50)).await;

    let size = app
        .state::<Arc<pty_manager::PtyManager>>()
        .get(&session.id)
        .expect("session should remain registered while attached")
        .get_size()?;
    assert_eq!(size.rows, 41);
    assert_eq!(size.cols, 119);

    socket.close(None).await?;
    let terminated = app
        .state::<Arc<pty_manager::PtyManager>>()
        .terminate_session(&session.id)?;
    assert!(
        terminated,
        "test cleanup should terminate the resized PTY session"
    );

    drop(websocket_service);
    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

async fn assert_missing_session_rejected(websocket_url: &str) -> Result<(), Box<dyn Error>> {
    let connect_error = connect_async(websocket_url)
        .await
        .expect_err("missing sessions should reject websocket attach");
    let response = connect_error_response(connect_error)?;
    assert_eq!(response.status(), tungstenite::http::StatusCode::NOT_FOUND);
    Ok(())
}

fn connect_error_response(
    error: tungstenite::Error,
) -> Result<tungstenite::http::Response<Option<Vec<u8>>>, Box<dyn Error>> {
    match error {
        tungstenite::Error::Http(response) => Ok(*response),
        other => Err(format!("expected HTTP websocket rejection, got {other}").into()),
    }
}

async fn wait_for_process_exit(
    pty_manager: &pty_manager::PtyManager,
    session_id: &str,
) -> Result<(), Box<dyn Error>> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

    loop {
        let Some(session) = pty_manager.get(session_id) else {
            return Ok(());
        };

        if session.try_wait()?.is_some() {
            return Ok(());
        }

        if tokio::time::Instant::now() >= deadline {
            return Err("timed out waiting for the PTY process to exit".into());
        }

        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn wait_for_output(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    expected: &str,
) -> Result<(), Box<dyn Error>> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let mut captured = String::new();

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let message = tokio::time::timeout(remaining, socket.next())
            .await
            .map_err(|_| "timed out waiting for terminal output")?
            .ok_or("terminal websocket closed before output was received")??;

        match message {
            tungstenite::Message::Binary(bytes) => {
                captured.push_str(&String::from_utf8_lossy(&bytes));
            }
            tungstenite::Message::Text(text) => {
                captured.push_str(text.as_str());
            }
            tungstenite::Message::Close(_) => {
                return Err("terminal websocket closed before expected output arrived".into());
            }
            _ => {}
        }

        if captured.contains(expected) {
            return Ok(());
        }
    }
}

async fn wait_for_socket_close(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<(), Box<dyn Error>> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        let Some(message) = tokio::time::timeout(remaining, socket.next())
            .await
            .map_err(|_| "timed out waiting for terminal websocket close")?
        else {
            return Ok(());
        };

        if let tungstenite::Message::Close(_) = message? {
            return Ok(());
        }
    }
}

async fn wait_for_session_status(
    database: &Database,
    session_id: &str,
    expected_status: &str,
) -> Result<(), Box<dyn Error>> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

    loop {
        let session = pty_manager::get_agent_session(database, session_id)?
            .ok_or("terminal session row disappeared before status could be asserted")?;
        if session.status == expected_status {
            return Ok(());
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "timed out waiting for terminal session {session_id} to reach status {expected_status}"
            )
            .into());
        }

        tokio::time::sleep(Duration::from_millis(25)).await;
    }
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
fn shell_echo_command(marker: &str) -> Vec<u8> {
    format!("printf '{marker}\\n'\r").into_bytes()
}

#[cfg(windows)]
fn shell_echo_command(marker: &str) -> Vec<u8> {
    format!("echo {marker}\r\n").into_bytes()
}

#[cfg(unix)]
fn exit_immediately_args() -> Vec<String> {
    vec!["-lc".to_string(), "exit 0".to_string()]
}

#[cfg(windows)]
fn exit_immediately_args() -> Vec<String> {
    vec!["/C".to_string(), "exit 0".to_string()]
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
