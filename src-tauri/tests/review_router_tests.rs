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
    db::Database,
    error::AppError,
    models::TaskSubtask,
    services::{
        openclaw::{OpenClawChatService, OpenClawClient, OpenClawConnectInput},
        project_registry,
    },
};
use futures_util::{SinkExt, StreamExt};
use rusqlite::params;
use serde_json::{json, Value};
use tokio::{net::TcpListener, time::timeout};
use tokio_tungstenite::{accept_async, tungstenite::protocol::Message};

pub mod db {
    pub use dispatch_lib::db::*;
}

pub mod error {
    pub use dispatch_lib::error::*;
}

pub mod models {
    pub use dispatch_lib::models::*;
}

pub mod commands {
    pub mod settings {
        pub use dispatch_lib::commands::settings::*;
    }

    pub mod tasks {
        pub use dispatch_lib::commands::tasks::*;
    }
}

pub mod services {
    pub mod project_registry {
        pub use dispatch_lib::services::project_registry::*;
    }

    pub mod task_export {
        pub use dispatch_lib::services::task_export::*;
    }

    pub mod openclaw {
        pub use dispatch_lib::services::openclaw::{
            OpenClawChatSendInput, OpenClawChatService, OpenClawChatSnapshotInput, OpenClawClient,
        };

        pub mod chat {
            pub use dispatch_lib::services::openclaw::chat::*;
        }

        pub mod client {
            pub use dispatch_lib::services::openclaw::client::*;
        }
    }
}

#[path = "../src/services/review_router.rs"]
mod review_router;

use review_router::{ReviewRouteOutcome, ReviewRouterService};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automation_disabled_skips_review_without_sending_a_chat_request(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let harness = ReviewHarness::spawn("disabled", None).await?;

    let outcome = timeout(
        Duration::from_secs(5),
        harness.router.route_session_review(
            harness.database.as_ref(),
            harness.client.as_ref(),
            &harness.chat,
            &harness.session_id,
        ),
    )
    .await??;

    assert_eq!(outcome, ReviewRouteOutcome::Disabled);
    assert_eq!(harness.gateway_state.lock().unwrap().chat_send_count, 0);

    let task = read_task_snapshot(
        harness.database.as_ref(),
        &harness.project.id,
        &harness.task.id,
    )?;
    assert_eq!(task.workflow_state, "review");
    assert_eq!(task.last_run_state, "succeeded");
    assert_eq!(task.completed_at, None);

    harness.client.disconnect().await?;
    harness.server.await??;
    cleanup_database_artifacts(&harness.database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enabled_review_pass_moves_task_to_done_and_updates_notes(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let harness = ReviewHarness::spawn(
        "pass",
        Some("RESULT: PASS\nFEEDBACK: Reviewed and approved.\n".to_string()),
    )
    .await?;

    harness.connect_client().await?;

    let outcome = timeout(
        Duration::from_secs(5),
        harness.router.route_session_review(
            harness.database.as_ref(),
            harness.client.as_ref(),
            &harness.chat,
            &harness.session_id,
        ),
    )
    .await??;

    assert_eq!(outcome, ReviewRouteOutcome::Passed);
    assert_eq!(harness.gateway_state.lock().unwrap().chat_send_count, 1);

    let task = read_task_snapshot(
        harness.database.as_ref(),
        &harness.project.id,
        &harness.task.id,
    )?;
    assert_eq!(task.workflow_state, "done");
    assert!(task.completed_at.is_some());
    assert!(task.review_notes_markdown.contains("Initial review notes"));
    assert!(task.review_notes_markdown.contains("Automated Review"));
    assert!(task.review_notes_markdown.contains("RESULT: PASS"));
    assert!(task
        .review_notes_markdown
        .contains("Reviewed and approved."));

    let export_markdown = fs::read_to_string(
        harness.project_root.join(
            task.markdown_export_path
                .as_deref()
                .expect("task export path should be present"),
        ),
    )?;
    assert!(export_markdown.contains("workflow_state: \"done\""));
    assert!(export_markdown.contains("Reviewed and approved."));

    harness.client.disconnect().await?;
    harness.server.await??;
    cleanup_database_artifacts(&harness.database_path);

    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enabled_review_fail_moves_task_back_to_in_progress_and_updates_notes(
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let harness = ReviewHarness::spawn(
        "fail",
        Some("RESULT: FAIL\nFEEDBACK: Please fix the failing export.\n".to_string()),
    )
    .await?;

    harness.connect_client().await?;

    let outcome = timeout(
        Duration::from_secs(5),
        harness.router.route_session_review(
            harness.database.as_ref(),
            harness.client.as_ref(),
            &harness.chat,
            &harness.session_id,
        ),
    )
    .await??;

    assert_eq!(outcome, ReviewRouteOutcome::Failed);
    assert_eq!(harness.gateway_state.lock().unwrap().chat_send_count, 1);

    let task = read_task_snapshot(
        harness.database.as_ref(),
        &harness.project.id,
        &harness.task.id,
    )?;
    assert_eq!(task.workflow_state, "in_progress");
    assert_eq!(task.completed_at, None);
    assert!(task.review_notes_markdown.contains("Initial review notes"));
    assert!(task.review_notes_markdown.contains("Automated Review"));
    assert!(task.review_notes_markdown.contains("RESULT: FAIL"));
    assert!(task
        .review_notes_markdown
        .contains("Please fix the failing export."));

    let export_markdown = fs::read_to_string(
        harness.project_root.join(
            task.markdown_export_path
                .as_deref()
                .expect("task export path should be present"),
        ),
    )?;
    assert!(export_markdown.contains("workflow_state: \"in_progress\""));
    assert!(export_markdown.contains("Please fix the failing export."));

    harness.client.disconnect().await?;
    harness.server.await??;
    cleanup_database_artifacts(&harness.database_path);

    Ok(())
}

struct ReviewHarness {
    database: Arc<Database>,
    database_path: PathBuf,
    project_root: PathBuf,
    project: dispatch_lib::models::Project,
    task: dispatch_lib::models::Task,
    session_id: String,
    client: Arc<OpenClawClient>,
    chat: Arc<OpenClawChatService>,
    router: ReviewRouterService,
    gateway_state: Arc<Mutex<ReviewGatewayState>>,
    server: tokio::task::JoinHandle<Result<(), Box<dyn Error + Send + Sync>>>,
}

#[derive(Default)]
struct ReviewGatewayState {
    assistant_message: Option<Value>,
    chat_send_count: usize,
}

impl ReviewHarness {
    async fn spawn(
        label: &str,
        assistant_reply: Option<String>,
    ) -> Result<Self, Box<dyn Error + Send + Sync>> {
        let temp_root = unique_temp_directory(label);
        let database_path = temp_root.join("dispatch-test.sqlite3");
        let project_root = temp_root.join("workspace");
        fs::create_dir_all(&project_root)?;

        let database = Arc::new(Database::initialize_at(&database_path)?);
        let project =
            project_registry::create_project(database.as_ref(), "Workspace", &project_root)?;
        let session_id = format!("openclaw:review-session-{label}");
        insert_agent_session(
            database.as_ref(),
            &project.id,
            None,
            &session_id,
            &project_root,
        )?;
        let task = create_review_task(database.as_ref(), &project, &session_id)?;

        set_setting_with_db(
            database.as_ref(),
            "dispatch.review.auto_enabled".to_string(),
            json!(assistant_reply.is_some()),
        )?;

        let (gateway_url, gateway_state, server) =
            spawn_gateway(assistant_reply.unwrap_or_default()).await?;

        let client = Arc::new(OpenClawClient::default());
        let chat = Arc::new(OpenClawChatService::default());
        let router = ReviewRouterService::default();

        if gateway_state.lock().unwrap().assistant_message.is_some() {
            // no-op; the message is injected by the gateway after chat.send
        }

        let _ = client
            .connect(OpenClawConnectInput {
                gateway_url: Some(gateway_url),
                auth_token: None,
            })
            .await?;

        Ok(Self {
            database,
            database_path,
            project_root,
            project,
            task,
            session_id,
            client,
            chat,
            router,
            gateway_state,
            server,
        })
    }

    async fn connect_client(&self) -> Result<(), Box<dyn Error + Send + Sync>> {
        let status = self.client.status().await;

        if status.state == "connected" {
            return Ok(());
        }

        Err("client failed to connect".into())
    }
}

async fn spawn_gateway(
    assistant_reply: String,
) -> Result<
    (
        String,
        Arc<Mutex<ReviewGatewayState>>,
        tokio::task::JoinHandle<Result<(), Box<dyn Error + Send + Sync>>>,
    ),
    Box<dyn Error + Send + Sync>,
> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let gateway_url = gateway_url(listener.local_addr()?);
    let gateway_state = Arc::new(Mutex::new(ReviewGatewayState::default()));
    let state_for_server = gateway_state.clone();

    let server = tokio::spawn(async move {
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
                "sessions.list" => json!({ "sessions": [] }),
                "chat.subscribe" => json!({
                    "status": "subscribed",
                    "sessionKey": "agent:main:global"
                }),
                "chat.history" => {
                    let assistant_message = {
                        state_for_server
                            .lock()
                            .expect("gateway state should not be poisoned")
                            .assistant_message
                            .clone()
                    };

                    json!({
                        "messages": assistant_message.into_iter().collect::<Vec<_>>()
                    })
                }
                "chat.send" => {
                    let message = request["params"]["message"]
                        .as_str()
                        .expect("review router should send a text prompt");
                    assert!(message.contains("RESULT: PASS|FAIL"));
                    assert!(message.contains("FEEDBACK:"));

                    let run_id = "review-run-1";
                    let assistant_message = json!({
                        "id": "assistant-review-1",
                        "conversationId": "main",
                        "sessionKey": "agent:main:global",
                        "role": "assistant",
                        "authorKind": "openclaw",
                        "bodyMarkdown": assistant_reply,
                        "createdAt": unix_timestamp_millis(),
                        "runId": run_id,
                    });

                    let mut state = state_for_server
                        .lock()
                        .expect("gateway state should not be poisoned");
                    state.chat_send_count += 1;
                    state.assistant_message = Some(assistant_message);

                    json!({
                        "status": "accepted",
                        "runId": run_id,
                        "sessionKey": "agent:main:global"
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

    Ok((gateway_url, gateway_state, server))
}

fn create_review_task(
    database: &Database,
    project: &dispatch_lib::models::Project,
    session_id: &str,
) -> Result<dispatch_lib::models::Task, Box<dyn Error + Send + Sync>> {
    Ok(create_task_with_db(
        database,
        CreateTaskInput {
            project_id: project.id.clone(),
            title: "Reviewable task".to_string(),
            description_markdown: Some("Task body for the automated review.".to_string()),
            priority: Some("high".to_string()),
            labels: Some(vec!["backend".to_string()]),
            subtasks: Some(vec![TaskSubtask {
                id: "subtask-1".to_string(),
                text: "Verify the review router".to_string(),
                completed: false,
            }]),
            review_notes_markdown: Some("Initial review notes".to_string()),
            assignee: None,
            workflow_state: Some("review".to_string()),
            last_run_state: Some("succeeded".to_string()),
            last_session_id: Some(session_id.to_string()),
            assigned_agent_mode: Some("auto".to_string()),
            markdown_export_path: None,
            blocked_reason: None,
            completed_at: None,
        },
    )?)
}

fn insert_agent_session(
    database: &Database,
    project_id: &str,
    task_id: Option<&str>,
    session_id: &str,
    cwd: &Path,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let now = unix_timestamp();

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
            params![
                session_id,
                project_id,
                task_id,
                "openclaw",
                "orchestrated_agent",
                "succeeded",
                "openclaw",
                "[]",
                "[]",
                cwd.to_string_lossy(),
                "openclaw",
                Option::<i64>::None,
                Some(now),
                Some(now),
                now,
                now,
            ],
        )?;

        Ok::<(), AppError>(())
    })?;

    Ok(())
}

fn read_task_snapshot(
    database: &Database,
    project_id: &str,
    task_id: &str,
) -> Result<TaskSnapshot, Box<dyn Error + Send + Sync>> {
    Ok(database.with_connection(|connection| {
        connection
            .query_row(
                "
                SELECT
                    workflow_state,
                    last_run_state,
                    review_notes_markdown,
                    markdown_export_path,
                    completed_at
                FROM tasks
                WHERE project_id = ?1 AND id = ?2
                ",
                params![project_id, task_id],
                |row| {
                    Ok(TaskSnapshot {
                        workflow_state: row.get(0)?,
                        last_run_state: row.get(1)?,
                        review_notes_markdown: row.get(2)?,
                        markdown_export_path: row.get(3)?,
                        completed_at: row.get(4)?,
                    })
                },
            )
            .map_err(AppError::from)
    })?)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TaskSnapshot {
    workflow_state: String,
    last_run_state: String,
    review_notes_markdown: String,
    markdown_export_path: Option<String>,
    completed_at: Option<i64>,
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
                            "chat.subscribe",
                            "chat.history",
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

fn gateway_url(address: SocketAddr) -> String {
    format!("ws://{address}")
}

fn unique_temp_directory(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after the unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("dispatch-review-router-{label}-{timestamp}"));
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

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn unix_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
