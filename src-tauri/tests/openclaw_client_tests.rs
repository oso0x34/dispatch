use std::{
    error::Error,
    fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    commands::{
        settings::set_setting_with_db,
        tasks::{create_task_with_db, CreateTaskInput},
    },
    configure_app,
    db::Database,
    error::AppError,
    services::openclaw::{
        OpenClawClient, OpenClawConnectInput, OpenClawKillSessionInput, OpenClawListSessionsInput,
        OpenClawSendMessageInput, OpenClawSpawnSessionInput,
    },
    services::project_registry,
};
use futures_util::{SinkExt, StreamExt};
use rusqlite::params;
use serde_json::{json, Value};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, INVOKE_KEY},
    webview::{InvokeRequest, WebviewWindowBuilder},
};
use tokio::{net::TcpListener, time::sleep};
use tokio_tungstenite::{accept_async, tungstenite::protocol::Message};

type OpenClawIpcHarness = (
    tauri::App<tauri::test::MockRuntime>,
    tauri::WebviewWindow<tauri::test::MockRuntime>,
    Arc<Database>,
    PathBuf,
);

#[test]
fn openclaw_status_command_is_registered_on_the_tauri_invoke_surface(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let (app, webview, database, database_path) = build_openclaw_ipc_harness("status-command")?;

    let status = invoke_command(&webview, "get_openclaw_status", json!({}))
        .expect("get_openclaw_status should resolve successfully");

    assert_eq!(status["state"], "disconnected");
    assert!(status["gatewayUrl"].is_null());
    assert!(status["lastError"].is_null());

    let snapshot = invoke_command(&webview, "get_openclaw_sidebar_snapshot", json!({}))
        .expect("get_openclaw_sidebar_snapshot should resolve successfully");

    assert_eq!(snapshot["status"]["state"], "disconnected");
    assert_eq!(
        snapshot["sessions"]
            .as_array()
            .expect("sidebar snapshot sessions should be an array")
            .len(),
        0
    );

    drop(webview);
    drop(app);
    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn openclaw_commands_proxy_connect_list_spawn_send_kill_and_disconnect_over_ipc(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let gateway_url = gateway_url(listener.local_addr()?);

    let server_task = tokio::spawn(async move {
        let mut websocket = accept_and_handshake(listener).await?;

        while let Some(message) = websocket.next().await {
            let Some(request) = parse_request_frame(message?)? else {
                break;
            };
            let method = request["method"]
                .as_str()
                .expect("mock gateway request should include a method");
            let request_id = request["id"]
                .as_str()
                .expect("mock gateway request should include an id")
                .to_string();

            let payload = match method {
                "status" => json!({ "runtime": "running" }),
                "health" => json!({ "ok": true }),
                "system-presence" => json!({ "entries": [] }),
                "sessions.list" => json!({ "sessions": [{ "key": "ipc-session" }] }),
                "agent" => json!({
                    "status": "accepted",
                    "runId": "ipc-run",
                    "sessionKey": "ipc-session"
                }),
                "chat.send" => json!({
                    "status": "accepted",
                    "runId": "ipc-send",
                    "sessionKey": "ipc-session"
                }),
                "chat.abort" => json!({
                    "status": "aborted",
                    "sessionKey": "ipc-session"
                }),
                other => panic!("unexpected IPC mock gateway method: {other}"),
            };

            websocket
                .send(Message::Text(
                    json!({
                        "type": "res",
                        "id": request_id,
                        "ok": true,
                        "payload": payload,
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let (app, webview, database, database_path) = build_openclaw_ipc_harness("ipc-proxy")?;

    let connected = invoke_command(
        &webview,
        "connect_openclaw",
        json!({
            "input": {
                "gatewayUrl": gateway_url,
            }
        }),
    )
    .expect("connect_openclaw should succeed over IPC");
    assert_eq!(connected["state"], "connected");

    let listed = invoke_command(
        &webview,
        "list_openclaw_sessions",
        json!({
            "input": {
                "limit": 10,
            }
        }),
    )
    .expect("list_openclaw_sessions should succeed over IPC");
    assert_eq!(listed["sessions"][0]["key"], "ipc-session");

    let snapshot = invoke_command(&webview, "get_openclaw_sidebar_snapshot", json!({}))
        .expect("get_openclaw_sidebar_snapshot should succeed over IPC");
    assert_eq!(snapshot["status"]["state"], "connected");
    assert_eq!(snapshot["sessions"][0]["sessionKey"], "ipc-session");
    assert_eq!(snapshot["sessions"][0]["source"], "openclaw");
    assert_eq!(snapshot["sessions"][0]["sessionKind"], "orchestrated_agent");

    let spawned = invoke_command(
        &webview,
        "spawn_openclaw_session",
        json!({
            "input": {
                "message": "ship it",
            }
        }),
    )
    .expect("spawn_openclaw_session should succeed over IPC");
    assert_eq!(spawned["runId"], "ipc-run");

    let sent = invoke_command(
        &webview,
        "send_openclaw_message",
        json!({
            "input": {
                "sessionKey": "ipc-session",
                "message": "keep going",
            }
        }),
    )
    .expect("send_openclaw_message should succeed over IPC");
    assert_eq!(sent["runId"], "ipc-send");

    let killed = invoke_command(
        &webview,
        "kill_openclaw_session",
        json!({
            "input": {
                "sessionKey": "ipc-session",
            }
        }),
    )
    .expect("kill_openclaw_session should succeed over IPC");
    assert_eq!(killed["status"], "aborted");

    let disconnected = invoke_command(&webview, "disconnect_openclaw", json!({}))
        .expect("disconnect_openclaw should succeed over IPC");
    assert_eq!(disconnected["state"], "disconnected");

    server_task.await??;
    drop(webview);
    drop(app);
    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dispatch_openclaw_session_marks_tasks_running_and_snapshot_reconciles_results(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let gateway_url = gateway_url(listener.local_addr()?);
    let listed_sessions = Arc::new(Mutex::new(Vec::<Value>::new()));
    let listed_sessions_for_server = listed_sessions.clone();

    let server_task = tokio::spawn(async move {
        let mut websocket = accept_and_handshake(listener).await?;

        while let Some(message) = websocket.next().await {
            let Some(request) = parse_request_frame(message?)? else {
                break;
            };
            let request_id = request["id"]
                .as_str()
                .expect("mock gateway request should include an id")
                .to_string();
            let method = request["method"]
                .as_str()
                .expect("mock gateway request should include a method");

            let payload = match method {
                "status" => json!({ "runtime": "running" }),
                "health" => json!({ "ok": true }),
                "system-presence" => json!({ "entries": [] }),
                "agent" => {
                    let message = request["params"]["message"]
                        .as_str()
                        .expect("dispatch_openclaw_session should send a prompt");
                    let session_key = if message.contains("failure") {
                        "task-failure-session"
                    } else {
                        "task-success-session"
                    };

                    json!({
                        "status": "accepted",
                        "runId": format!("run-{session_key}"),
                        "sessionKey": session_key
                    })
                }
                "sessions.list" => json!({
                    "sessions": listed_sessions_for_server
                        .lock()
                        .expect("listed_sessions mutex should not be poisoned")
                        .clone()
                }),
                other => panic!("unexpected task-linkage method: {other}"),
            };

            websocket
                .send(Message::Text(
                    json!({
                        "type": "res",
                        "id": request_id,
                        "ok": true,
                        "payload": payload,
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let (app, webview, database, database_path) = build_openclaw_ipc_harness("task-linkage")?;
    let workspace_root = database_path
        .parent()
        .expect("database path should have a parent")
        .join("workspace");
    fs::create_dir_all(&workspace_root)?;
    let project =
        project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
    let success_task = create_task_with_db(
        database.as_ref(),
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Success task".to_string(),
            description_markdown: Some("Task body".to_string()),
            priority: None,
            labels: None,
            subtasks: None,
            review_notes_markdown: None,
            assignee: None,
            workflow_state: None,
            last_run_state: None,
            last_session_id: None,
            assigned_agent_mode: Some("auto".to_string()),
            markdown_export_path: None,
            blocked_reason: None,
            completed_at: None,
        },
    )?;
    let failure_task = create_task_with_db(
        database.as_ref(),
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Failure task".to_string(),
            description_markdown: Some("Task body".to_string()),
            priority: None,
            labels: None,
            subtasks: None,
            review_notes_markdown: None,
            assignee: None,
            workflow_state: None,
            last_run_state: None,
            last_session_id: None,
            assigned_agent_mode: Some("auto".to_string()),
            markdown_export_path: None,
            blocked_reason: None,
            completed_at: None,
        },
    )?;

    let connected = invoke_command(
        &webview,
        "connect_openclaw",
        json!({
            "input": {
                "gatewayUrl": gateway_url,
            }
        }),
    )
    .expect("connect_openclaw should succeed");
    assert_eq!(connected["state"], "connected");

    let success_dispatch = invoke_command(
        &webview,
        "dispatch_openclaw_session",
        json!({
            "input": {
                "projectId": project.id,
                "taskId": success_task.id,
                "prompt": "success dispatch",
            }
        }),
    )
    .expect("dispatch_openclaw_session should start the success task");
    assert_eq!(
        success_dispatch["sessionId"],
        "openclaw:task-success-session"
    );

    let failure_dispatch = invoke_command(
        &webview,
        "dispatch_openclaw_session",
        json!({
            "input": {
                "projectId": project.id,
                "taskId": failure_task.id,
                "prompt": "failure dispatch",
            }
        }),
    )
    .expect("dispatch_openclaw_session should start the failure task");
    assert_eq!(
        failure_dispatch["sessionId"],
        "openclaw:task-failure-session"
    );

    assert_eq!(
        read_task_state(database.as_ref(), &success_task.id)?,
        TaskState {
            workflow_state: "in_progress".to_string(),
            last_run_state: "running".to_string(),
            last_session_id: Some("openclaw:task-success-session".to_string()),
        }
    );
    assert_eq!(
        read_task_state(database.as_ref(), &failure_task.id)?,
        TaskState {
            workflow_state: "in_progress".to_string(),
            last_run_state: "running".to_string(),
            last_session_id: Some("openclaw:task-failure-session".to_string()),
        }
    );

    {
        let mut sessions = listed_sessions
            .lock()
            .expect("listed_sessions mutex should not be poisoned");
        *sessions = vec![
            json!({
                "key": "task-success-session",
                "title": "Success session",
                "status": "completed"
            }),
            json!({
                "key": "task-failure-session",
                "title": "Failure session",
                "status": "errored"
            }),
        ];
    }

    let snapshot = invoke_command(&webview, "get_openclaw_sidebar_snapshot", json!({}))
        .expect("get_openclaw_sidebar_snapshot should reconcile task statuses");
    let sessions = snapshot["sessions"]
        .as_array()
        .expect("sidebar snapshot sessions should be an array");
    assert!(sessions.iter().any(|session| {
        session["sessionKey"] == "task-success-session" && session["taskId"] == success_task.id
    }));
    assert!(sessions.iter().any(|session| {
        session["sessionKey"] == "task-failure-session" && session["taskId"] == failure_task.id
    }));

    assert_eq!(
        read_task_state(database.as_ref(), &success_task.id)?,
        TaskState {
            workflow_state: "review".to_string(),
            last_run_state: "succeeded".to_string(),
            last_session_id: Some("openclaw:task-success-session".to_string()),
        }
    );
    assert_eq!(
        read_task_state(database.as_ref(), &failure_task.id)?,
        TaskState {
            workflow_state: "in_progress".to_string(),
            last_run_state: "failed".to_string(),
            last_session_id: Some("openclaw:task-failure-session".to_string()),
        }
    );

    set_task_workflow_state(database.as_ref(), &success_task.id, "done")?;
    let repeated_snapshot = invoke_command(&webview, "get_openclaw_sidebar_snapshot", json!({}))
        .expect("repeated sidebar refresh should not overwrite later manual task transitions");
    let repeated_sessions = repeated_snapshot["sessions"]
        .as_array()
        .expect("repeated sidebar snapshot sessions should be an array");
    assert!(repeated_sessions.iter().any(|session| {
        session["sessionKey"] == "task-success-session" && session["taskId"] == success_task.id
    }));

    assert_eq!(
        read_task_state(database.as_ref(), &success_task.id)?,
        TaskState {
            workflow_state: "done".to_string(),
            last_run_state: "succeeded".to_string(),
            last_session_id: Some("openclaw:task-success-session".to_string()),
        }
    );

    let disconnected = invoke_command(&webview, "disconnect_openclaw", json!({}))
        .expect("disconnect_openclaw should succeed");
    assert_eq!(disconnected["state"], "disconnected");

    server_task.await??;
    drop(webview);
    drop(app);
    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kill_openclaw_session_marks_the_linked_task_canceled(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let gateway_url = gateway_url(listener.local_addr()?);

    let server_task = tokio::spawn(async move {
        let mut websocket = accept_and_handshake(listener).await?;

        while let Some(message) = websocket.next().await {
            let Some(request) = parse_request_frame(message?)? else {
                break;
            };
            let request_id = request["id"]
                .as_str()
                .expect("mock gateway request should include an id")
                .to_string();
            let method = request["method"]
                .as_str()
                .expect("mock gateway request should include a method");

            let payload = match method {
                "status" => json!({ "runtime": "running" }),
                "health" => json!({ "ok": true }),
                "system-presence" => json!({ "entries": [] }),
                "agent" => json!({
                    "status": "accepted",
                    "runId": "run-cancel",
                    "sessionKey": "task-cancel-session"
                }),
                "chat.abort" => {
                    assert_eq!(request["params"]["sessionKey"], "task-cancel-session");
                    json!({
                        "status": "aborted",
                        "sessionKey": "task-cancel-session"
                    })
                }
                other => panic!("unexpected cancel method: {other}"),
            };

            websocket
                .send(Message::Text(
                    json!({
                        "type": "res",
                        "id": request_id,
                        "ok": true,
                        "payload": payload,
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let (app, webview, database, database_path) = build_openclaw_ipc_harness("cancel-linkage")?;
    let workspace_root = database_path
        .parent()
        .expect("database path should have a parent")
        .join("workspace");
    fs::create_dir_all(&workspace_root)?;
    let project =
        project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
    let task = create_task_with_db(
        database.as_ref(),
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Cancel task".to_string(),
            description_markdown: Some("Task body".to_string()),
            priority: None,
            labels: None,
            subtasks: None,
            review_notes_markdown: None,
            assignee: None,
            workflow_state: None,
            last_run_state: None,
            last_session_id: None,
            assigned_agent_mode: Some("auto".to_string()),
            markdown_export_path: None,
            blocked_reason: None,
            completed_at: None,
        },
    )?;

    let connected = invoke_command(
        &webview,
        "connect_openclaw",
        json!({
            "input": {
                "gatewayUrl": gateway_url,
            }
        }),
    )
    .expect("connect_openclaw should succeed");
    assert_eq!(connected["state"], "connected");

    let dispatched = invoke_command(
        &webview,
        "dispatch_openclaw_session",
        json!({
            "input": {
                "projectId": project.id,
                "taskId": task.id,
                "prompt": "cancel dispatch",
            }
        }),
    )
    .expect("dispatch_openclaw_session should start the cancel task");
    assert_eq!(dispatched["sessionId"], "openclaw:task-cancel-session");

    let killed = invoke_command(
        &webview,
        "kill_openclaw_session",
        json!({
            "input": {
                "sessionKey": "task-cancel-session",
            }
        }),
    )
    .expect("kill_openclaw_session should succeed");
    assert_eq!(killed["status"], "aborted");

    assert_eq!(
        read_task_state(database.as_ref(), &task.id)?,
        TaskState {
            workflow_state: "in_progress".to_string(),
            last_run_state: "canceled".to_string(),
            last_session_id: Some("openclaw:task-cancel-session".to_string()),
        }
    );

    let disconnected = invoke_command(&webview, "disconnect_openclaw", json!({}))
        .expect("disconnect_openclaw should succeed");
    assert_eq!(disconnected["state"], "disconnected");

    server_task.await??;
    drop(webview);
    drop(app);
    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sidebar_snapshot_routes_automated_review_for_succeeded_tasks(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    #[derive(Default)]
    struct GatewayState {
        listed_sessions: Vec<Value>,
        assistant_message: Option<Value>,
        chat_send_count: usize,
    }

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let gateway_url = gateway_url(listener.local_addr()?);
    let gateway_state = Arc::new(Mutex::new(GatewayState::default()));
    let gateway_state_for_server = gateway_state.clone();

    let server_task = tokio::spawn(async move {
        let mut websocket = accept_and_handshake(listener).await?;

        while let Some(message) = websocket.next().await {
            let Some(request) = parse_request_frame(message?)? else {
                break;
            };
            let request_id = request["id"]
                .as_str()
                .expect("mock gateway request should include an id")
                .to_string();
            let method = request["method"]
                .as_str()
                .expect("mock gateway request should include a method");

            let payload = match method {
                "status" => json!({ "runtime": "running" }),
                "health" => json!({ "ok": true }),
                "system-presence" => json!({ "entries": [] }),
                "agent" => json!({
                    "status": "accepted",
                    "runId": "run-sidebar-review",
                    "sessionKey": "task-review-session"
                }),
                "sessions.list" => json!({
                    "sessions": gateway_state_for_server
                        .lock()
                        .expect("gateway state mutex should not be poisoned")
                        .listed_sessions
                        .clone()
                }),
                "chat.subscribe" => json!({
                    "status": "subscribed",
                    "sessionKey": "agent:main:global"
                }),
                "chat.history" => json!({
                    "messages": gateway_state_for_server
                        .lock()
                        .expect("gateway state mutex should not be poisoned")
                        .assistant_message
                        .clone()
                        .into_iter()
                        .collect::<Vec<_>>()
                }),
                "chat.send" => {
                    let message = request["params"]["message"]
                        .as_str()
                        .expect("review router should send a text prompt");
                    assert!(message.contains("RESULT: PASS|FAIL"));
                    assert!(message.contains("FEEDBACK:"));

                    let assistant_message = json!({
                        "id": "assistant-sidebar-review-1",
                        "conversationId": "main",
                        "sessionKey": "agent:main:global",
                        "role": "assistant",
                        "authorKind": "openclaw",
                        "bodyMarkdown": "RESULT: PASS\nFEEDBACK: Snapshot review approved.\n",
                        "createdAt": unix_timestamp_millis(),
                        "runId": "run-sidebar-review-decision",
                    });

                    gateway_state_for_server
                        .lock()
                        .expect("gateway state mutex should not be poisoned")
                        .assistant_message = Some(assistant_message);
                    gateway_state_for_server
                        .lock()
                        .expect("gateway state mutex should not be poisoned")
                        .chat_send_count += 1;

                    json!({
                        "status": "accepted",
                        "runId": "run-sidebar-review-decision",
                        "sessionKey": "agent:main:global"
                    })
                }
                other => panic!("unexpected automated review method: {other}"),
            };

            websocket
                .send(Message::Text(
                    json!({
                        "type": "res",
                        "id": request_id,
                        "ok": true,
                        "payload": payload,
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let (app, webview, database, database_path) =
        build_openclaw_ipc_harness("sidebar-auto-review")?;
    let workspace_root = database_path
        .parent()
        .expect("database path should have a parent")
        .join("workspace");
    fs::create_dir_all(&workspace_root)?;
    let project =
        project_registry::create_project(database.as_ref(), "Workspace", &workspace_root)?;
    let task = create_task_with_db(
        database.as_ref(),
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Review task".to_string(),
            description_markdown: Some("Task body".to_string()),
            priority: None,
            labels: None,
            subtasks: None,
            review_notes_markdown: Some("Initial review notes".to_string()),
            assignee: None,
            workflow_state: None,
            last_run_state: None,
            last_session_id: None,
            assigned_agent_mode: Some("auto".to_string()),
            markdown_export_path: None,
            blocked_reason: None,
            completed_at: None,
        },
    )?;
    set_setting_with_db(
        database.as_ref(),
        "dispatch.review.auto_enabled".to_string(),
        json!(true),
    )?;

    let connected = invoke_command(
        &webview,
        "connect_openclaw",
        json!({
            "input": {
                "gatewayUrl": gateway_url,
            }
        }),
    )
    .expect("connect_openclaw should succeed");
    assert_eq!(connected["state"], "connected");

    let dispatched = invoke_command(
        &webview,
        "dispatch_openclaw_session",
        json!({
            "input": {
                "projectId": project.id,
                "taskId": task.id,
                "prompt": "review dispatch",
            }
        }),
    )
    .expect("dispatch_openclaw_session should start the review task");
    assert_eq!(dispatched["sessionId"], "openclaw:task-review-session");

    gateway_state
        .lock()
        .expect("gateway state mutex should not be poisoned")
        .listed_sessions = vec![json!({
        "key": "task-review-session",
        "title": "Review session",
        "status": "completed"
    })];

    let snapshot = invoke_command(&webview, "get_openclaw_sidebar_snapshot", json!({}))
        .expect("get_openclaw_sidebar_snapshot should succeed");
    assert!(snapshot["sessions"]
        .as_array()
        .expect("sidebar snapshot sessions should be an array")
        .iter()
        .any(|session| {
            session["sessionKey"] == "task-review-session" && session["taskId"] == task.id
        }));

    wait_for_reviewed_task_state(
        database.as_ref(),
        &task.id,
        "done",
        "succeeded",
        Some("openclaw:task-review-session"),
        "Snapshot review approved.",
    )
    .await?;
    assert_eq!(
        gateway_state
            .lock()
            .expect("gateway state mutex should not be poisoned")
            .chat_send_count,
        1
    );

    let repeated_snapshot = invoke_command(&webview, "get_openclaw_sidebar_snapshot", json!({}))
        .expect("repeated sidebar refresh should not send a duplicate review request");
    assert!(repeated_snapshot["sessions"]
        .as_array()
        .expect("sidebar snapshot sessions should be an array")
        .iter()
        .any(|session| {
            session["sessionKey"] == "task-review-session" && session["taskId"] == task.id
        }));
    sleep(Duration::from_millis(150)).await;
    assert_eq!(
        gateway_state
            .lock()
            .expect("gateway state mutex should not be poisoned")
            .chat_send_count,
        1
    );

    let disconnected = invoke_command(&webview, "disconnect_openclaw", json!({}))
        .expect("disconnect_openclaw should succeed");
    assert_eq!(disconnected["state"], "disconnected");

    server_task.await??;
    drop(webview);
    drop(app);
    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn openclaw_client_connects_and_maps_list_spawn_send_and_kill_commands(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let gateway_url = gateway_url(listener.local_addr()?);

    let server_task = tokio::spawn(async move {
        let mut websocket = accept_and_handshake(listener).await?;

        while let Some(message) = websocket.next().await {
            let Some(request) = parse_request_frame(message?)? else {
                break;
            };
            let method = request["method"]
                .as_str()
                .expect("mock gateway request should include a method");
            let request_id = request["id"]
                .as_str()
                .expect("mock gateway request should include an id")
                .to_string();

            let payload = match method {
                "status" => json!({ "runtime": "running" }),
                "health" => json!({ "ok": true, "gateway": "healthy" }),
                "system-presence" => json!({
                    "entries": [
                        { "deviceId": "dispatch-host", "roles": ["operator"], "scopes": ["operator.read", "operator.write"] }
                    ]
                }),
                "sessions.list" => json!({
                    "sessions": [
                        { "key": "session-1", "title": "Main session", "agentId": "codex" }
                    ]
                }),
                "agent" => {
                    assert_eq!(request["params"]["message"], "ship it");
                    assert_eq!(request["params"]["agentId"], "codex");
                    json!({
                        "status": "accepted",
                        "runId": "run-spawn",
                        "sessionKey": "session-1"
                    })
                }
                "chat.send" => {
                    assert_eq!(request["params"]["sessionKey"], "session-1");
                    assert_eq!(request["params"]["message"], "keep going");
                    json!({
                        "status": "accepted",
                        "runId": "run-send",
                        "sessionKey": "session-1"
                    })
                }
                "chat.abort" => {
                    assert_eq!(request["params"]["sessionKey"], "session-1");
                    json!({
                        "status": "aborted",
                        "sessionKey": "session-1"
                    })
                }
                other => panic!("unexpected mock gateway method: {other}"),
            };

            websocket
                .send(Message::Text(
                    json!({
                        "type": "res",
                        "id": request_id,
                        "ok": true,
                        "payload": payload,
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let client = OpenClawClient::default();
    let status = client
        .connect(OpenClawConnectInput {
            gateway_url: Some(gateway_url.clone()),
            auth_token: None,
        })
        .await?;

    assert_eq!(status.state, "connected");
    assert_eq!(status.gateway_url, Some(gateway_url.clone()));
    assert_eq!(status.protocol_version, Some(3));
    assert!(status
        .available_methods
        .iter()
        .any(|method| method == "sessions.list"));
    assert_eq!(
        status
            .status_details
            .as_ref()
            .and_then(|payload| payload.get("runtime"))
            .and_then(Value::as_str),
        Some("running")
    );

    let listed = client
        .list_sessions(OpenClawListSessionsInput::default())
        .await?;
    assert_eq!(listed["sessions"][0]["key"], "session-1");

    let spawned = client
        .spawn_session(OpenClawSpawnSessionInput {
            message: "ship it".to_string(),
            agent_id: Some("codex".to_string()),
            session_key: None,
            label: Some("Dispatch".to_string()),
        })
        .await?;
    assert_eq!(spawned["status"], "accepted");
    assert_eq!(spawned["runId"], "run-spawn");

    let sent = client
        .send_message(OpenClawSendMessageInput {
            session_key: "session-1".to_string(),
            message: "keep going".to_string(),
        })
        .await?;
    assert_eq!(sent["status"], "accepted");
    assert_eq!(sent["runId"], "run-send");

    let killed = client
        .kill_session(OpenClawKillSessionInput {
            session_key: "session-1".to_string(),
            run_id: None,
        })
        .await?;
    assert_eq!(killed["status"], "aborted");

    let disconnected = client.disconnect().await?;
    assert_eq!(disconnected.state, "disconnected");
    assert_eq!(disconnected.gateway_url, Some(gateway_url));

    server_task.await??;

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn openclaw_client_reconnects_after_the_gateway_socket_drops(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let first_listener = TcpListener::bind("127.0.0.1:0").await?;
    let socket_addr = first_listener.local_addr()?;
    let gateway_url = gateway_url(socket_addr);

    let first_server = tokio::spawn(async move {
        let mut websocket = accept_and_handshake(first_listener).await?;
        let mut refresh_requests = 0;

        while let Some(message) = websocket.next().await {
            let Some(request) = parse_request_frame(message?)? else {
                break;
            };
            let request_id = request["id"]
                .as_str()
                .expect("mock gateway request should include an id")
                .to_string();
            let method = request["method"]
                .as_str()
                .expect("mock gateway request should include a method");

            let payload = match method {
                "status" => json!({ "runtime": "running" }),
                "health" => json!({ "ok": true }),
                "system-presence" => json!({ "entries": [] }),
                other => panic!("unexpected reconnect bootstrap method: {other}"),
            };

            websocket
                .send(Message::Text(
                    json!({
                        "type": "res",
                        "id": request_id,
                        "ok": true,
                        "payload": payload,
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
            refresh_requests += 1;

            if refresh_requests == 3 {
                websocket.send(Message::Close(None)).await?;
                break;
            }
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let client = OpenClawClient::default();
    client
        .connect(OpenClawConnectInput {
            gateway_url: Some(gateway_url.clone()),
            auth_token: None,
        })
        .await?;

    tokio::time::timeout(Duration::from_secs(1), first_server)
        .await
        .map_err(|_| "timed out waiting for the first mock gateway to stop")???;
    let reconnecting = wait_for_state(&client, "reconnecting", Duration::from_secs(3)).await?;
    assert_eq!(reconnecting.gateway_url, Some(gateway_url.clone()));
    assert!(reconnecting.last_error.is_some());

    let second_listener = TcpListener::bind(socket_addr).await?;
    let second_server = tokio::spawn(async move {
        let mut websocket = accept_and_handshake(second_listener).await?;

        while let Some(message) = websocket.next().await {
            let Some(request) = parse_request_frame(message?)? else {
                break;
            };
            let request_id = request["id"]
                .as_str()
                .expect("mock gateway request should include an id")
                .to_string();
            let method = request["method"]
                .as_str()
                .expect("mock gateway request should include a method");

            let payload = match method {
                "status" => json!({ "runtime": "running" }),
                "health" => json!({ "ok": true }),
                "system-presence" => json!({ "entries": [{ "deviceId": "dispatch-host" }] }),
                "sessions.list" => json!({ "sessions": [] }),
                other => panic!("unexpected method after reconnect: {other}"),
            };

            websocket
                .send(Message::Text(
                    json!({
                        "type": "res",
                        "id": request_id,
                        "ok": true,
                        "payload": payload,
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let reconnected = wait_for_state(&client, "connected", Duration::from_secs(5)).await?;
    assert_eq!(reconnected.gateway_url, Some(gateway_url.clone()));
    assert!(reconnected.last_error.is_none());

    let listed = client
        .list_sessions(OpenClawListSessionsInput::default())
        .await?;
    assert_eq!(
        listed["sessions"]
            .as_array()
            .expect("sessions.list should return an array")
            .len(),
        0
    );

    let disconnected = client.disconnect().await?;
    assert_eq!(disconnected.state, "disconnected");

    tokio::time::timeout(Duration::from_secs(1), second_server)
        .await
        .map_err(|_| "timed out waiting for the second mock gateway to stop")???;

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn openclaw_client_reports_gateway_down_and_keeps_standalone_mode_non_blocking(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let gateway_url = gateway_url(listener.local_addr()?);
    drop(listener);

    let client = OpenClawClient::default();
    let status = client
        .connect(OpenClawConnectInput {
            gateway_url: Some(gateway_url.clone()),
            auth_token: None,
        })
        .await?;

    assert_eq!(status.state, "reconnecting");
    assert_eq!(status.gateway_url, Some(gateway_url.clone()));
    assert!(status.last_error.is_some());

    let reconnecting = wait_for_state(&client, "reconnecting", Duration::from_secs(2)).await?;
    assert_eq!(reconnecting.gateway_url, Some(gateway_url.clone()));
    assert!(reconnecting.last_error.is_some());

    let error = client
        .list_sessions(OpenClawListSessionsInput::default())
        .await
        .expect_err("list_sessions should fail while the gateway is down");
    assert_eq!(error.message(), "openclaw client is not connected");

    let disconnected = client.disconnect().await?;
    assert_eq!(disconnected.state, "disconnected");

    Ok(())
}

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

async fn accept_and_handshake(
    listener: TcpListener,
) -> Result<tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>, Box<dyn Error + Send + Sync>>
{
    let (stream, _) = listener.accept().await?;
    let mut websocket = accept_async(stream).await?;

    websocket
        .send(Message::Text(
            json!({
                "type": "event",
                "event": "connect.challenge",
                "payload": { "nonce": "nonce-123", "ts": 1737264000000u64 },
            })
            .to_string()
            .into(),
        ))
        .await?;

    let connect_frame = parse_request_frame(
        websocket
            .next()
            .await
            .ok_or("expected a connect request from the OpenClaw client")??,
    )?
    .ok_or("mock gateway expected a text connect frame")?;
    assert_eq!(connect_frame["type"], "req");
    assert_eq!(connect_frame["method"], "connect");

    let connect_id = connect_frame["id"]
        .as_str()
        .expect("connect request should include an id")
        .to_string();

    websocket
        .send(Message::Text(
            json!({
                "type": "res",
                "id": connect_id,
                "ok": true,
                "payload": {
                    "type": "hello-ok",
                    "protocol": 3,
                    "server": { "version": "mock-gateway", "connId": "conn-1" },
                    "features": {
                        "methods": [
                            "status",
                            "health",
                            "system-presence",
                            "sessions.list",
                            "agent",
                            "chat.send",
                            "chat.abort"
                        ],
                        "events": ["connect.challenge", "health", "presence", "tick", "chat", "agent"]
                    },
                    "snapshot": { "status": "ready" },
                    "policy": {
                        "maxPayload": 1048576,
                        "maxBufferedBytes": 1048576,
                        "tickIntervalMs": 250
                    }
                },
            })
            .to_string()
            .into(),
        ))
        .await?;

    Ok(websocket)
}

fn parse_request_frame(message: Message) -> Result<Option<Value>, Box<dyn Error + Send + Sync>> {
    let Message::Text(text) = message else {
        return Ok(None);
    };

    Ok(Some(serde_json::from_str(text.as_ref())?))
}

async fn wait_for_state(
    client: &OpenClawClient,
    expected_state: &str,
    timeout_duration: Duration,
) -> Result<dispatch_lib::services::openclaw::OpenClawConnectionStatus, Box<dyn Error + Send + Sync>>
{
    let deadline = tokio::time::Instant::now() + timeout_duration;

    loop {
        let status = client.status().await;
        if status.state == expected_state {
            return Ok(status);
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "timed out waiting for OpenClaw state {expected_state}; last state was {}",
                status.state
            )
            .into());
        }

        sleep(Duration::from_millis(25)).await;
    }
}

fn gateway_url(address: SocketAddr) -> String {
    format!("ws://{address}")
}

fn build_openclaw_ipc_harness(
    label: &str,
) -> Result<OpenClawIpcHarness, Box<dyn Error + Send + Sync>> {
    let temp_root = unique_temp_directory(label);
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Arc::new(Database::initialize_at(&database_path)?);
    let app = configure_app(mock_builder())
        .manage(database.clone())
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch OpenClaw IPC app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build Dispatch OpenClaw IPC webview");

    Ok((app, webview, database, database_path))
}

fn unique_temp_directory(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after the unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("dispatch-openclaw-{label}-{timestamp}"));
    fs::create_dir_all(&path).expect("failed to create temporary test directory");
    path
}

fn cleanup_database_artifacts(database_path: &Path) {
    let _ = fs::remove_file(database_path);
    let _ = fs::remove_file(database_path.with_extension("sqlite3-shm"));
    let _ = fs::remove_file(database_path.with_extension("sqlite3-wal"));
    if let Some(parent) = database_path.parent() {
        let _ = fs::remove_dir_all(parent);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TaskState {
    workflow_state: String,
    last_run_state: String,
    last_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TaskReviewSnapshot {
    workflow_state: String,
    last_run_state: String,
    last_session_id: Option<String>,
    review_notes_markdown: String,
}

fn read_task_state(
    database: &Database,
    task_id: &str,
) -> Result<TaskState, Box<dyn Error + Send + Sync>> {
    Ok(database.with_connection(|connection| {
        connection
            .query_row(
                "
            SELECT workflow_state, last_run_state, last_session_id
            FROM tasks
            WHERE id = ?1
            ",
                params![task_id],
                |row| {
                    Ok(TaskState {
                        workflow_state: row.get(0)?,
                        last_run_state: row.get(1)?,
                        last_session_id: row.get(2)?,
                    })
                },
            )
            .map_err(AppError::from)
    })?)
}

fn read_task_review_snapshot(
    database: &Database,
    task_id: &str,
) -> Result<TaskReviewSnapshot, Box<dyn Error + Send + Sync>> {
    Ok(database.with_connection(|connection| {
        connection
            .query_row(
                "
            SELECT workflow_state, last_run_state, last_session_id, review_notes_markdown
            FROM tasks
            WHERE id = ?1
            ",
                params![task_id],
                |row| {
                    Ok(TaskReviewSnapshot {
                        workflow_state: row.get(0)?,
                        last_run_state: row.get(1)?,
                        last_session_id: row.get(2)?,
                        review_notes_markdown: row.get(3)?,
                    })
                },
            )
            .map_err(AppError::from)
    })?)
}

async fn wait_for_reviewed_task_state(
    database: &Database,
    task_id: &str,
    workflow_state: &str,
    last_run_state: &str,
    last_session_id: Option<&str>,
    review_note_fragment: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

    loop {
        let state = read_task_review_snapshot(database, task_id)?;
        if state.workflow_state == workflow_state
            && state.last_run_state == last_run_state
            && state.last_session_id.as_deref() == last_session_id
            && state.review_notes_markdown.contains(review_note_fragment)
        {
            return Ok(());
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "timed out waiting for reviewed task {task_id} to reach workflow_state={workflow_state}, last_run_state={last_run_state}, last_session_id={last_session_id:?} and contain {review_note_fragment:?} (got {:?})",
                state
            )
            .into());
        }

        sleep(Duration::from_millis(50)).await;
    }
}

fn unix_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after the unix epoch")
        .as_millis() as i64
}

fn set_task_workflow_state(
    database: &Database,
    task_id: &str,
    workflow_state: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    database.with_connection(|connection| {
        connection.execute(
            "
            UPDATE tasks
            SET workflow_state = ?2,
                updated_at = updated_at + 1
            WHERE id = ?1
            ",
            params![task_id, workflow_state],
        )?;

        Ok::<(), AppError>(())
    })?;

    Ok(())
}
