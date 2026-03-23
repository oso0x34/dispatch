use std::{
    collections::HashSet,
    error::Error,
    fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{configure_app, db::Database, services::openclaw::OpenClawClient};
use futures_util::{SinkExt, StreamExt};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, INVOKE_KEY},
    webview::{InvokeRequest, WebviewWindowBuilder},
    Manager,
};
use tokio::{net::TcpListener, time::sleep};
use tokio_tungstenite::{accept_async, tungstenite::protocol::Message};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn openclaw_chat_snapshot_replays_history_after_reconnect_without_duplicate_rows(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let first_listener = TcpListener::bind("127.0.0.1:0").await?;
    let socket_addr = first_listener.local_addr()?;
    let gateway_url = gateway_url(socket_addr);

    let first_server = tokio::spawn(async move {
        let mut websocket = accept_and_handshake(first_listener).await?;
        let mut history_requests = 0;

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
                "chat.subscribe" => {
                    json!({ "status": "subscribed", "sessionKey": "agent:main:global" })
                }
                "chat.history" => {
                    history_requests += 1;
                    json!({
                        "messages": [
                            {
                                "id": "history-user-1",
                                "sessionKey": "agent:main:global",
                                "role": "user",
                                "authorKind": "user",
                                "bodyMarkdown": "First prompt",
                                "createdAt": 1_767_290_000_000i64,
                            },
                            {
                                "id": "history-assistant-1",
                                "sessionKey": "agent:main:global",
                                "role": "assistant",
                                "authorKind": "openclaw",
                                "bodyMarkdown": "First answer",
                                "createdAt": 1_767_290_030_000i64,
                                "runId": "run-history-1",
                            }
                        ]
                    })
                }
                other => panic!("unexpected first-server method: {other}"),
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

            if method == "chat.history" && history_requests == 1 {
                websocket.send(Message::Close(None)).await?;
                break;
            }
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let (app, webview, database, database_path) = build_chat_ipc_harness("chat-reconnect")?;
    let client = app.state::<Arc<OpenClawClient>>().inner().clone();

    let connected = invoke_command(
        &webview,
        "connect_openclaw",
        json!({ "input": { "gatewayUrl": gateway_url } }),
    )
    .expect("connect_openclaw should succeed");
    assert_eq!(connected["state"], "connected");

    let initial_snapshot = invoke_command(
        &webview,
        "get_openclaw_chat_snapshot",
        json!({ "input": {} }),
    )
    .expect("initial chat snapshot should succeed");
    assert_eq!(
        initial_snapshot["messages"]
            .as_array()
            .expect("messages should deserialize into an array")
            .len(),
        2
    );

    tokio::time::timeout(Duration::from_secs(1), first_server)
        .await
        .map_err(|_| "timed out waiting for the first mock gateway to close")???;
    wait_for_state(&client, "reconnecting", Duration::from_secs(3)).await?;

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
                "system-presence" => json!({ "entries": [] }),
                "chat.subscribe" => {
                    json!({ "status": "subscribed", "sessionKey": "agent:main:global" })
                }
                "chat.history" => json!({
                    "messages": [
                        {
                            "id": "history-user-1",
                            "sessionKey": "agent:main:global",
                            "role": "user",
                            "authorKind": "user",
                            "bodyMarkdown": "First prompt",
                            "createdAt": 1_767_290_000_000i64,
                        },
                        {
                            "id": "history-assistant-1",
                            "sessionKey": "agent:main:global",
                            "role": "assistant",
                            "authorKind": "openclaw",
                            "bodyMarkdown": "First answer",
                            "createdAt": 1_767_290_030_000i64,
                            "runId": "run-history-1",
                        },
                        {
                            "id": "history-assistant-2",
                            "sessionKey": "agent:main:global",
                            "role": "assistant",
                            "authorKind": "openclaw",
                            "bodyMarkdown": "Replayed after reconnect",
                            "createdAt": 1_767_290_060_000i64,
                            "runId": "run-history-2",
                        }
                    ]
                }),
                other => panic!("unexpected second-server method: {other}"),
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

    wait_for_state(&client, "connected", Duration::from_secs(5)).await?;

    let replayed_snapshot = invoke_command(
        &webview,
        "get_openclaw_chat_snapshot",
        json!({ "input": {} }),
    )
    .expect("replayed chat snapshot should succeed");
    let replayed_messages = replayed_snapshot["messages"]
        .as_array()
        .expect("messages should deserialize into an array");
    assert_eq!(replayed_messages.len(), 3);

    let cached_message_ids = load_cached_message_ids(&database)?;
    assert_eq!(cached_message_ids.len(), 3);
    assert!(cached_message_ids.contains("history-user-1"));
    assert!(cached_message_ids.contains("history-assistant-1"));
    assert!(cached_message_ids.contains("history-assistant-2"));

    invoke_command(&webview, "disconnect_openclaw", json!({}))
        .expect("disconnect_openclaw should succeed");
    tokio::time::timeout(Duration::from_secs(1), second_server)
        .await
        .map_err(|_| "timed out waiting for the second mock gateway to stop")???;

    drop(webview);
    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn openclaw_chat_stream_events_incrementally_upsert_assistant_messages(
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
                "chat.subscribe" => {
                    json!({ "status": "subscribed", "sessionKey": "agent:main:global" })
                }
                "chat.history" => json!({ "messages": [] }),
                "chat.send" => {
                    assert_eq!(request["params"]["sessionKey"], "agent:main:global");
                    assert_eq!(request["params"]["message"], "Summarize this");

                    websocket
                        .send(Message::Text(
                            json!({
                                "type": "event",
                                "event": "chat",
                                "payload": {
                                    "message": {
                                        "id": "assistant-stream-1",
                                        "sessionKey": "agent:main:global",
                                        "role": "assistant",
                                        "authorKind": "openclaw",
                                        "bodyMarkdown": "Hel",
                                        "createdAt": 1_767_291_000_000i64,
                                        "runId": "run-stream-1",
                                        "partial": true,
                                        "status": "streaming"
                                    }
                                }
                            })
                            .to_string()
                            .into(),
                        ))
                        .await?;
                    sleep(Duration::from_millis(25)).await;
                    websocket
                        .send(Message::Text(
                            json!({
                                "type": "event",
                                "event": "chat",
                                "payload": {
                                    "message": {
                                        "id": "assistant-stream-1",
                                        "sessionKey": "agent:main:global",
                                        "role": "assistant",
                                        "authorKind": "openclaw",
                                        "bodyMarkdown": "Hello there",
                                        "createdAt": 1_767_291_000_000i64,
                                        "runId": "run-stream-1",
                                        "partial": false,
                                        "status": "completed"
                                    }
                                }
                            })
                            .to_string()
                            .into(),
                        ))
                        .await?;

                    json!({
                        "status": "accepted",
                        "runId": "run-stream-1",
                        "sessionKey": "agent:main:global"
                    })
                }
                other => panic!("unexpected chat-stream method: {other}"),
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

    let (app, webview, database, database_path) = build_chat_ipc_harness("chat-stream")?;

    invoke_command(
        &webview,
        "connect_openclaw",
        json!({ "input": { "gatewayUrl": gateway_url } }),
    )
    .expect("connect_openclaw should succeed");
    invoke_command(
        &webview,
        "get_openclaw_chat_snapshot",
        json!({ "input": {} }),
    )
    .expect("chat snapshot should initialize subscription");

    let sent = invoke_command(
        &webview,
        "send_openclaw_chat_message",
        json!({
            "input": {
                "bodyMarkdown": "Summarize this"
            }
        }),
    )
    .expect("send_openclaw_chat_message should succeed");
    assert_eq!(sent["status"], "accepted");
    assert_eq!(sent["runId"], "run-stream-1");

    sleep(Duration::from_millis(100)).await;

    let cached_message_ids_before_snapshot = load_cached_message_ids(&database)?;
    assert!(cached_message_ids_before_snapshot.contains("assistant-stream-1"));

    let streamed_snapshot = invoke_command(
        &webview,
        "get_openclaw_chat_snapshot",
        json!({ "input": {} }),
    )
    .expect("streamed chat snapshot should succeed");
    let streamed_messages = streamed_snapshot["messages"]
        .as_array()
        .expect("messages should deserialize into an array");
    assert_eq!(streamed_messages.len(), 2);
    let assistant_message = streamed_messages
        .iter()
        .find(|message| message["id"] == "assistant-stream-1")
        .expect("assistant stream message should be present");
    assert_eq!(
        assistant_message["bodyMarkdown"],
        Value::String("Hello there".to_string())
    );

    let cached_message_ids = load_cached_message_ids(&database)?;
    assert_eq!(cached_message_ids.len(), 2);
    assert!(cached_message_ids.contains("assistant-stream-1"));

    invoke_command(&webview, "disconnect_openclaw", json!({}))
        .expect("disconnect_openclaw should succeed");

    let cached_snapshot = invoke_command(
        &webview,
        "get_openclaw_chat_snapshot",
        json!({ "input": {} }),
    )
    .expect("cached chat snapshot should still load after disconnect");
    assert_eq!(cached_snapshot["streamState"], "cache_only");
    assert_eq!(
        cached_snapshot["messages"]
            .as_array()
            .expect("messages should deserialize into an array")
            .len(),
        2
    );

    tokio::time::timeout(Duration::from_secs(1), server_task)
        .await
        .map_err(|_| "timed out waiting for the chat stream mock gateway to stop")???;
    drop(webview);
    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn openclaw_chat_cache_stays_readable_and_send_still_works_when_replay_methods_fail(
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

            let (ok, payload, error) = match method {
                "status" => (true, Some(json!({ "runtime": "running" })), None),
                "health" => (true, Some(json!({ "ok": true })), None),
                "system-presence" => (true, Some(json!({ "entries": [] })), None),
                "chat.subscribe" => (
                    false,
                    None,
                    Some(
                        json!({ "code": "not_supported", "message": "chat.subscribe unavailable" }),
                    ),
                ),
                "chat.history" => (
                    false,
                    None,
                    Some(json!({ "code": "not_supported", "message": "chat.history unavailable" })),
                ),
                "chat.send" => (
                    true,
                    Some(json!({
                        "status": "accepted",
                        "runId": "run-degraded-1",
                        "sessionKey": "agent:main:global"
                    })),
                    None,
                ),
                other => panic!("unexpected degraded-chat method: {other}"),
            };

            websocket
                .send(Message::Text(
                    json!({
                        "type": "res",
                        "id": request_id,
                        "ok": ok,
                        "payload": payload,
                        "error": error,
                    })
                    .to_string()
                    .into(),
                ))
                .await?;
        }

        Ok::<(), Box<dyn Error + Send + Sync>>(())
    });

    let (app, webview, database, database_path) = build_chat_ipc_harness("chat-degraded")?;
    seed_cached_chat_message(&database, "cached-assistant-1", "Cached answer")?;

    invoke_command(
        &webview,
        "connect_openclaw",
        json!({ "input": { "gatewayUrl": gateway_url } }),
    )
    .expect("connect_openclaw should succeed");

    let degraded_snapshot = invoke_command(
        &webview,
        "get_openclaw_chat_snapshot",
        json!({ "input": {} }),
    )
    .expect("cached chat snapshot should still succeed");
    assert_eq!(degraded_snapshot["streamState"], "degraded");
    assert_eq!(
        degraded_snapshot["messages"]
            .as_array()
            .expect("messages should deserialize into an array")
            .len(),
        1
    );

    let sent = invoke_command(
        &webview,
        "send_openclaw_chat_message",
        json!({ "input": { "bodyMarkdown": "Keep working" } }),
    )
    .expect("send_openclaw_chat_message should still succeed without replay methods");
    assert_eq!(sent["status"], "accepted");

    let cached_message_ids = load_cached_message_ids(&database)?;
    assert!(cached_message_ids.contains("cached-assistant-1"));
    assert_eq!(cached_message_ids.len(), 2);

    invoke_command(&webview, "disconnect_openclaw", json!({}))
        .expect("disconnect_openclaw should succeed");
    tokio::time::timeout(Duration::from_secs(1), server_task)
        .await
        .map_err(|_| "timed out waiting for the degraded chat mock gateway to stop")???;
    drop(webview);
    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn openclaw_chat_send_records_model_and_project_metadata_on_user_messages(
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
                "chat.subscribe" => {
                    json!({ "status": "subscribed", "sessionKey": "agent:main:global" })
                }
                "chat.history" => json!({ "messages": [] }),
                "chat.send" => {
                    assert_eq!(request["params"]["sessionKey"], "agent:main:global");
                    assert_eq!(request["params"]["message"], "Review the release notes");

                    json!({
                        "status": "accepted",
                        "runId": "run-metadata-1",
                        "sessionKey": "agent:main:global"
                    })
                }
                other => panic!("unexpected metadata-chat method: {other}"),
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

    let (app, webview, database, database_path) = build_chat_ipc_harness("chat-send-metadata")?;
    seed_project(&database, "project-alpha", "Alpha")?;

    invoke_command(
        &webview,
        "connect_openclaw",
        json!({ "input": { "gatewayUrl": gateway_url } }),
    )
    .expect("connect_openclaw should succeed");

    let sent = invoke_command(
        &webview,
        "send_openclaw_chat_message",
        json!({
            "input": {
                "bodyMarkdown": "Review the release notes",
                "projectId": "project-alpha",
                "modelId": "codex"
            }
        }),
    )
    .expect("send_openclaw_chat_message should succeed");

    assert_eq!(sent["message"]["projectId"], "project-alpha");
    assert_eq!(
        sent["message"]["metadataJson"]["projectId"],
        "project-alpha"
    );
    assert_eq!(sent["message"]["metadataJson"]["modelId"], "codex");
    assert_eq!(sent["message"]["metadataJson"]["conversationId"], "main");

    let message_id = sent["message"]["id"]
        .as_str()
        .expect("sent chat message should include an id");
    let cached_metadata = load_cached_message_metadata(&database, message_id)?
        .expect("cached chat message metadata should exist");
    assert_eq!(cached_metadata["projectId"], "project-alpha");
    assert_eq!(cached_metadata["modelId"], "codex");
    assert_eq!(cached_metadata["conversationId"], "main");

    invoke_command(&webview, "disconnect_openclaw", json!({}))
        .expect("disconnect_openclaw should succeed");
    tokio::time::timeout(Duration::from_secs(1), server_task)
        .await
        .map_err(|_| "timed out waiting for the metadata chat mock gateway to stop")???;
    drop(webview);
    drop(app);
    cleanup_database_artifacts(&database_path);

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
                            "chat.history",
                            "chat.subscribe",
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

fn load_cached_message_ids(
    database: &Database,
) -> Result<HashSet<String>, Box<dyn Error + Send + Sync>> {
    database.with_connection(
        |connection| -> Result<HashSet<String>, Box<dyn Error + Send + Sync>> {
            let mut statement = connection.prepare("SELECT id FROM chat_messages")?;
            let ids = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<HashSet<_>, _>>()?;
            Ok(ids)
        },
    )
}

fn seed_cached_chat_message(
    database: &Database,
    id: &str,
    body_markdown: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    database.with_connection(|connection| -> Result<(), Box<dyn Error + Send + Sync>> {
        connection.execute(
            "
            INSERT INTO chat_messages (
                id,
                conversation_id,
                project_id,
                agent_session_id,
                role,
                author_kind,
                body_markdown,
                metadata_json,
                created_at
            ) VALUES (?1, 'main', NULL, NULL, 'assistant', 'openclaw', ?2, '{}', ?3)
            ",
            params![id, body_markdown, 1_767_292_000i64],
        )?;
        Ok(())
    })
}

fn load_cached_message_metadata(
    database: &Database,
    id: &str,
) -> Result<Option<Value>, Box<dyn Error + Send + Sync>> {
    database.with_connection(
        |connection| -> Result<Option<Value>, Box<dyn Error + Send + Sync>> {
            let metadata_json = connection
                .query_row(
                    "SELECT metadata_json FROM chat_messages WHERE id = ?1",
                    [id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;

            metadata_json
                .map(|value| serde_json::from_str::<Value>(&value))
                .transpose()
                .map_err(Into::into)
        },
    )
}

fn seed_project(
    database: &Database,
    id: &str,
    name: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    database.with_connection(|connection| -> Result<(), Box<dyn Error + Send + Sync>> {
        connection.execute(
            "
            INSERT INTO projects (
                id,
                name,
                root_path,
                created_at,
                updated_at,
                last_opened_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, NULL)
            ",
            params![id, name, "/tmp", 1_767_293_000i64, 1_767_293_000i64],
        )?;
        Ok(())
    })
}

fn gateway_url(address: SocketAddr) -> String {
    format!("ws://{address}")
}

fn build_chat_ipc_harness(
    label: &str,
) -> Result<
    (
        tauri::App<tauri::test::MockRuntime>,
        tauri::WebviewWindow<tauri::test::MockRuntime>,
        Arc<Database>,
        PathBuf,
    ),
    Box<dyn Error + Send + Sync>,
> {
    let temp_root = unique_temp_directory(label);
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Arc::new(Database::initialize_at(&database_path)?);
    let app = configure_app(mock_builder())
        .manage(database.clone())
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch chat IPC app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build Dispatch chat IPC webview");

    Ok((app, webview, database, database_path))
}

fn unique_temp_directory(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after the unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("dispatch-chat-{label}-{timestamp}"));
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
