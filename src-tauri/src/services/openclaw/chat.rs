use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::sync::{Mutex, RwLock};

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::{ChatMessage, ChatMessageAuthorKind, ChatMessageRole},
};

use super::{
    client::{
        OpenClawChatHistoryInput, OpenClawChatSubscribeInput, OpenClawClient,
        OpenClawConnectionStatus, OpenClawSendMessageInput,
    },
    session_bridge::openclaw_session_id,
};

pub const DEFAULT_OPENCLAW_CHAT_CONVERSATION_ID: &str = "main";
pub const DEFAULT_OPENCLAW_CHAT_SESSION_KEY: &str = "agent:main:global";
const DEFAULT_OPENCLAW_CHAT_HISTORY_LIMIT: u32 = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawChatSnapshotInput {
    pub conversation_id: Option<String>,
    pub session_key: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawChatSendInput {
    pub body_markdown: String,
    pub conversation_id: Option<String>,
    pub session_key: Option<String>,
    pub project_id: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawChatSnapshot {
    pub status: OpenClawConnectionStatus,
    pub stream_state: String,
    pub conversation_id: String,
    pub session_key: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawChatSendResult {
    pub message: ChatMessage,
    pub session_key: String,
    pub conversation_id: String,
    pub run_id: Option<String>,
    pub status: String,
}

#[derive(Debug, Default)]
struct OpenClawChatRuntime {
    listener_started: bool,
    subscribed_connected_at: Option<i64>,
    subscribed_session_key: Option<String>,
    buffered_messages: HashMap<String, ChatMessage>,
    project_hints_by_run_id: HashMap<String, Option<String>>,
    project_hints_by_session_key: HashMap<String, Option<String>>,
}

#[derive(Default)]
pub struct OpenClawChatService {
    state: Mutex<OpenClawChatRuntime>,
    bound_database: RwLock<Option<Arc<Database>>>,
}

impl OpenClawChatService {
    pub async fn bind_database(&self, database: Arc<Database>) {
        let mut bound_database = self.bound_database.write().await;
        if bound_database.is_none() {
            *bound_database = Some(database);
        }
    }

    pub async fn get_snapshot(
        self: &Arc<Self>,
        database: &Database,
        client: &OpenClawClient,
        input: OpenClawChatSnapshotInput,
    ) -> AppResult<OpenClawChatSnapshot> {
        self.ensure_listener_started(client).await;

        let conversation_id = normalize_conversation_id(input.conversation_id.as_deref());
        let session_key = normalize_session_key(input.session_key.as_deref());
        let limit = input
            .limit
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_OPENCLAW_CHAT_HISTORY_LIMIT);

        let replay_error = self
            .ensure_subscription_and_replay(database, client, &conversation_id, &session_key, limit)
            .await
            .err();
        self.flush_buffered_messages(database).await?;

        let status = client.status().await;
        let messages = list_cached_chat_messages(
            database,
            &conversation_id,
            input.limit.map(|value| value.max(1)),
        )?;

        Ok(OpenClawChatSnapshot {
            stream_state: self
                .stream_state(&status, &session_key, replay_error.is_some())
                .await,
            status,
            conversation_id,
            session_key,
            messages,
        })
    }

    pub async fn send_message(
        self: &Arc<Self>,
        database: &Database,
        client: &OpenClawClient,
        input: OpenClawChatSendInput,
    ) -> AppResult<OpenClawChatSendResult> {
        self.ensure_listener_started(client).await;

        let conversation_id = normalize_conversation_id(input.conversation_id.as_deref());
        let session_key = normalize_session_key(input.session_key.as_deref());
        let project_id = normalize_optional_string(input.project_id.as_deref());
        let model_id = normalize_optional_string(input.model_id.as_deref());
        let body_markdown = validate_required_field("openclaw chat message", &input.body_markdown)?;

        if let Some(project_id) = project_id.as_deref() {
            ensure_project_exists(database, project_id)?;
        }

        let _ = self
            .ensure_subscription_and_replay(
                database,
                client,
                &conversation_id,
                &session_key,
                DEFAULT_OPENCLAW_CHAT_HISTORY_LIMIT,
            )
            .await;

        let response = client
            .send_message(OpenClawSendMessageInput {
                session_key: session_key.clone(),
                message: body_markdown.clone(),
            })
            .await?;

        let resolved_session_key =
            normalize_optional_value(response.get("sessionKey").and_then(Value::as_str))
                .unwrap_or_else(|| session_key.clone());
        let run_id = normalize_optional_value(response.get("runId").and_then(Value::as_str));
        let status = normalize_optional_value(response.get("status").and_then(Value::as_str))
            .unwrap_or_else(|| "accepted".to_string());

        {
            let mut runtime = self.state.lock().await;
            runtime
                .project_hints_by_session_key
                .insert(resolved_session_key.clone(), project_id.clone());
            if let Some(run_id) = run_id.as_ref() {
                runtime
                    .project_hints_by_run_id
                    .insert(run_id.clone(), project_id.clone());
            }
        }

        let message = ChatMessage {
            id: next_chat_message_id("user"),
            conversation_id: conversation_id.clone(),
            project_id: project_id.clone(),
            agent_session_id: resolve_agent_session_id(database, &resolved_session_key)?,
            role: ChatMessageRole::User,
            author_kind: ChatMessageAuthorKind::User,
            body_markdown,
            metadata_json: Value::Object({
                let mut object = Map::new();
                object.insert(
                    "sessionKey".to_string(),
                    Value::String(resolved_session_key.clone()),
                );
                object.insert(
                    "conversationId".to_string(),
                    Value::String(conversation_id.clone()),
                );
                object.insert("status".to_string(), Value::String(status.clone()));
                object.insert("source".to_string(), Value::String("dispatch".to_string()));
                if let Some(project_id) = project_id.as_ref() {
                    object.insert("projectId".to_string(), Value::String(project_id.clone()));
                }
                if let Some(model_id) = model_id.as_ref() {
                    object.insert("modelId".to_string(), Value::String(model_id.clone()));
                }
                if let Some(run_id) = run_id.as_ref() {
                    object.insert("runId".to_string(), Value::String(run_id.clone()));
                }
                object
            }),
            created_at: now_unix_seconds(),
        };

        persist_chat_messages(database, std::slice::from_ref(&message))?;
        self.flush_buffered_messages(database).await?;

        Ok(OpenClawChatSendResult {
            message,
            session_key: resolved_session_key,
            conversation_id,
            run_id,
            status,
        })
    }

    async fn ensure_listener_started(self: &Arc<Self>, client: &OpenClawClient) {
        let should_start = {
            let mut runtime = self.state.lock().await;
            if runtime.listener_started {
                false
            } else {
                runtime.listener_started = true;
                true
            }
        };

        if !should_start {
            return;
        }

        let mut events = client.subscribe_events().await;
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                service.record_gateway_event(event).await;
            }
        });
    }

    async fn ensure_subscription_and_replay(
        &self,
        database: &Database,
        client: &OpenClawClient,
        conversation_id: &str,
        session_key: &str,
        limit: u32,
    ) -> AppResult<()> {
        let status = client.status().await;
        if status.state != "connected" {
            let mut runtime = self.state.lock().await;
            runtime.subscribed_connected_at = None;
            runtime.subscribed_session_key = None;
            return Ok(());
        }

        let subscribe_result = client
            .subscribe_chat(OpenClawChatSubscribeInput {
                session_key: Some(session_key.to_string()),
            })
            .await;
        let history_result = client
            .chat_history(OpenClawChatHistoryInput {
                session_key: Some(session_key.to_string()),
                limit: Some(limit),
            })
            .await;

        let (project_hints_by_run_id, project_hints_by_session_key) = {
            let runtime = self.state.lock().await;
            (
                runtime.project_hints_by_run_id.clone(),
                runtime.project_hints_by_session_key.clone(),
            )
        };

        if let Ok(history) = history_result.as_ref() {
            let messages = normalize_gateway_messages(
                Some(database),
                history,
                conversation_id,
                session_key,
                "history",
                &project_hints_by_run_id,
                &project_hints_by_session_key,
            )?;
            persist_chat_messages(database, &messages)?;
        }

        if subscribe_result.is_ok() {
            let mut runtime = self.state.lock().await;
            runtime.subscribed_connected_at = status.connected_at;
            runtime.subscribed_session_key = Some(session_key.to_string());
        }

        match (subscribe_result, history_result) {
            (Ok(_), Ok(_)) => Ok(()),
            (Err(error), Ok(_)) => Err(error),
            (Ok(_), Err(error)) => Err(error),
            (Err(error), Err(_)) => Err(error),
        }
    }

    async fn record_gateway_event(&self, event: super::protocol::GatewayEventFrame) {
        if event.event != "chat" {
            return;
        }

        let (project_hints_by_run_id, project_hints_by_session_key) = {
            let runtime = self.state.lock().await;
            (
                runtime.project_hints_by_run_id.clone(),
                runtime.project_hints_by_session_key.clone(),
            )
        };

        let payload = event.payload.unwrap_or(Value::Null);
        let messages = match normalize_gateway_messages(
            None,
            &payload,
            DEFAULT_OPENCLAW_CHAT_CONVERSATION_ID,
            DEFAULT_OPENCLAW_CHAT_SESSION_KEY,
            "stream",
            &project_hints_by_run_id,
            &project_hints_by_session_key,
        ) {
            Ok(messages) => messages,
            Err(_) => return,
        };

        if messages.is_empty() {
            return;
        }

        self.persist_or_buffer_messages(messages).await;
    }

    async fn flush_buffered_messages(&self, database: &Database) -> AppResult<()> {
        let messages = {
            let runtime = self.state.lock().await;
            runtime
                .buffered_messages
                .values()
                .cloned()
                .collect::<Vec<_>>()
        };

        persist_chat_messages(database, &messages)?;

        let mut runtime = self.state.lock().await;
        for message in messages {
            runtime.buffered_messages.remove(&message.id);
        }

        Ok(())
    }

    async fn persist_or_buffer_messages(&self, messages: Vec<ChatMessage>) {
        if messages.is_empty() {
            return;
        }

        if let Some(database) = self.bound_database.read().await.clone() {
            if persist_chat_messages(database.as_ref(), &messages).is_ok() {
                let mut runtime = self.state.lock().await;
                for message in messages {
                    runtime.buffered_messages.remove(&message.id);
                }
                return;
            }
        }

        let mut runtime = self.state.lock().await;
        for message in messages {
            runtime
                .buffered_messages
                .insert(message.id.clone(), message);
        }
    }

    async fn stream_state(
        &self,
        status: &OpenClawConnectionStatus,
        session_key: &str,
        replay_failed: bool,
    ) -> String {
        if replay_failed && status.state == "connected" {
            return "degraded".to_string();
        }

        match status.state.as_str() {
            "connected" => {
                let runtime = self.state.lock().await;
                if runtime.subscribed_connected_at == status.connected_at
                    && runtime.subscribed_session_key.as_deref() == Some(session_key)
                {
                    "live".to_string()
                } else {
                    "connecting".to_string()
                }
            }
            "reconnecting" => "reconnecting".to_string(),
            "disconnected" => "cache_only".to_string(),
            other => other.to_string(),
        }
    }
}

fn list_cached_chat_messages(
    database: &Database,
    conversation_id: &str,
    limit: Option<u32>,
) -> AppResult<Vec<ChatMessage>> {
    database.with_connection(|connection| -> AppResult<Vec<ChatMessage>> {
        let sql = if limit.is_some() {
            "
            SELECT
                id,
                conversation_id,
                project_id,
                agent_session_id,
                role,
                author_kind,
                body_markdown,
                metadata_json,
                created_at
            FROM (
                SELECT
                    id,
                    conversation_id,
                    project_id,
                    agent_session_id,
                    role,
                    author_kind,
                    body_markdown,
                    metadata_json,
                    created_at
                FROM chat_messages
                WHERE conversation_id = ?1
                ORDER BY created_at DESC, id DESC
                LIMIT ?2
            )
            ORDER BY created_at ASC, id ASC
            "
        } else {
            "
            SELECT
                id,
                conversation_id,
                project_id,
                agent_session_id,
                role,
                author_kind,
                body_markdown,
                metadata_json,
                created_at
            FROM chat_messages
            WHERE conversation_id = ?1
            ORDER BY created_at ASC, id ASC
            "
        };

        let mut statement = connection.prepare(sql)?;
        let messages = if let Some(limit) = limit {
            statement
                .query_map(
                    params![conversation_id, i64::from(limit)],
                    deserialize_chat_message,
                )?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            statement
                .query_map(params![conversation_id], deserialize_chat_message)?
                .collect::<Result<Vec<_>, _>>()?
        };

        Ok(messages)
    })
}

fn persist_chat_messages(database: &Database, messages: &[ChatMessage]) -> AppResult<()> {
    if messages.is_empty() {
        return Ok(());
    }

    database.with_connection(|connection| -> AppResult<()> {
        let transaction = connection.transaction()?;
        for message in messages {
            let metadata_json = serialize_metadata_json(&message.metadata_json)?;
            transaction.execute(
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
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ON CONFLICT(id) DO UPDATE SET
                    conversation_id = excluded.conversation_id,
                    project_id = excluded.project_id,
                    agent_session_id = excluded.agent_session_id,
                    role = excluded.role,
                    author_kind = excluded.author_kind,
                    body_markdown = excluded.body_markdown,
                    metadata_json = excluded.metadata_json,
                    created_at = excluded.created_at
                ",
                params![
                    message.id,
                    message.conversation_id,
                    message.project_id,
                    message.agent_session_id,
                    chat_role_value(&message.role),
                    chat_author_kind_value(&message.author_kind),
                    message.body_markdown,
                    metadata_json,
                    message.created_at,
                ],
            )?;
        }
        transaction.commit()?;

        Ok(())
    })
}

fn normalize_gateway_messages(
    database: Option<&Database>,
    payload: &Value,
    conversation_id: &str,
    default_session_key: &str,
    source: &str,
    project_hints_by_run_id: &HashMap<String, Option<String>>,
    project_hints_by_session_key: &HashMap<String, Option<String>>,
) -> AppResult<Vec<ChatMessage>> {
    extract_gateway_message_entries(payload)
        .into_iter()
        .map(|entry| {
            normalize_gateway_message(
                database,
                entry,
                conversation_id,
                default_session_key,
                source,
                project_hints_by_run_id,
                project_hints_by_session_key,
            )
        })
        .collect()
}

fn normalize_gateway_message(
    database: Option<&Database>,
    entry: &Value,
    conversation_id: &str,
    default_session_key: &str,
    source: &str,
    project_hints_by_run_id: &HashMap<String, Option<String>>,
    project_hints_by_session_key: &HashMap<String, Option<String>>,
) -> AppResult<ChatMessage> {
    let session_key = normalize_optional_value(
        entry
            .get("sessionKey")
            .or_else(|| entry.get("key"))
            .and_then(Value::as_str),
    )
    .unwrap_or_else(|| default_session_key.to_string());
    let run_id = normalize_optional_value(entry.get("runId").and_then(Value::as_str));
    let created_at = entry
        .get("createdAt")
        .or_else(|| entry.get("ts"))
        .or_else(|| entry.get("updatedAt"))
        .and_then(normalize_timestamp_value)
        .unwrap_or_else(now_unix_seconds);
    let role = parse_chat_role(
        normalize_optional_value(entry.get("role").and_then(Value::as_str))
            .unwrap_or_else(|| "assistant".to_string())
            .as_str(),
    )?;
    let author_kind = parse_chat_author_kind(
        normalize_optional_value(entry.get("authorKind").and_then(Value::as_str))
            .or_else(|| {
                entry
                    .get("author")
                    .and_then(|author| author.get("kind"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| chat_author_kind_value(&infer_author_kind(&role)).to_string())
            .as_str(),
    )?;
    let body_markdown = extract_body_markdown(entry).unwrap_or_default();
    let project_id = normalize_optional_value(entry.get("projectId").and_then(Value::as_str))
        .or_else(|| {
            run_id
                .as_ref()
                .and_then(|candidate| project_hints_by_run_id.get(candidate))
                .cloned()
                .flatten()
        })
        .or_else(|| {
            project_hints_by_session_key
                .get(&session_key)
                .cloned()
                .flatten()
        });
    let conversation_id =
        normalize_optional_value(entry.get("conversationId").and_then(Value::as_str))
            .unwrap_or_else(|| conversation_id.to_string());
    let metadata = build_gateway_metadata(entry, source, &session_key, run_id.as_deref());
    let message_id = normalize_optional_value(
        entry
            .get("id")
            .or_else(|| entry.get("messageId"))
            .and_then(Value::as_str),
    )
    .unwrap_or_else(|| {
        fallback_gateway_message_id(&session_key, run_id.as_deref(), &role, created_at, source)
    });

    Ok(ChatMessage {
        id: message_id,
        conversation_id,
        project_id,
        agent_session_id: database
            .map(|database| resolve_agent_session_id(database, &session_key))
            .transpose()?
            .flatten(),
        role,
        author_kind,
        body_markdown,
        metadata_json: metadata,
        created_at,
    })
}

fn extract_gateway_message_entries(payload: &Value) -> Vec<&Value> {
    for key in ["messages", "history", "items", "entries"] {
        if let Some(messages) = payload.get(key).and_then(Value::as_array) {
            return messages.iter().collect();
        }
    }

    if let Some(message) = payload.get("message") {
        return vec![message];
    }

    if payload.is_object() {
        return vec![payload];
    }

    Vec::new()
}

fn build_gateway_metadata(
    entry: &Value,
    source: &str,
    session_key: &str,
    run_id: Option<&str>,
) -> Value {
    let mut metadata = entry
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    metadata.insert("source".to_string(), Value::String(source.to_string()));
    metadata.insert(
        "sessionKey".to_string(),
        Value::String(session_key.to_string()),
    );

    if let Some(run_id) = run_id {
        metadata.insert("runId".to_string(), Value::String(run_id.to_string()));
    }

    if let Some(status) = normalize_optional_value(entry.get("status").and_then(Value::as_str)) {
        metadata.insert("status".to_string(), Value::String(status));
    }

    if let Some(partial) = entry.get("partial").and_then(Value::as_bool) {
        metadata.insert("partial".to_string(), Value::Bool(partial));
    }

    Value::Object(metadata)
}

fn extract_body_markdown(entry: &Value) -> Option<String> {
    for key in ["bodyMarkdown", "body", "text", "content"] {
        if let Some(value) = entry.get(key) {
            if let Some(body) = value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(body.to_string());
            }

            if let Some(text) = value
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(text.to_string());
            }
        }
    }

    None
}

fn resolve_agent_session_id(database: &Database, session_key: &str) -> AppResult<Option<String>> {
    let session_id = openclaw_session_id(session_key);

    database.with_connection(|connection| -> AppResult<Option<String>> {
        let found = connection
            .query_row(
                "SELECT id FROM agent_sessions WHERE id = ?1 LIMIT 1",
                params![session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(found)
    })
}

fn ensure_project_exists(database: &Database, project_id: &str) -> AppResult<()> {
    database.with_connection(|connection| -> AppResult<()> {
        let exists = connection
            .query_row(
                "SELECT 1 FROM projects WHERE id = ?1 LIMIT 1",
                params![project_id],
                |_row| Ok(true),
            )
            .optional()?
            .unwrap_or(false);

        if exists {
            Ok(())
        } else {
            Err(AppError::new("project not found"))
        }
    })
}

fn deserialize_chat_message(row: &Row<'_>) -> rusqlite::Result<ChatMessage> {
    let metadata_json = row.get::<_, String>(7)?;
    let metadata = serde_json::from_str::<Value>(&metadata_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
    })?;

    Ok(ChatMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        project_id: row.get(2)?,
        agent_session_id: row.get(3)?,
        role: parse_chat_role(row.get::<_, String>(4)?.as_str()).map_err(invalid_chat_column(4))?,
        author_kind: parse_chat_author_kind(row.get::<_, String>(5)?.as_str())
            .map_err(invalid_chat_column(5))?,
        body_markdown: row.get(6)?,
        metadata_json: metadata,
        created_at: row.get(8)?,
    })
}

fn serialize_metadata_json(metadata: &Value) -> AppResult<String> {
    if !metadata.is_object() {
        return Err(AppError::new("chat message metadata must be a JSON object"));
    }

    serde_json::to_string(metadata)
        .map_err(|error| AppError::new(format!("failed to serialize chat metadata: {error}")))
}

fn infer_author_kind(role: &ChatMessageRole) -> ChatMessageAuthorKind {
    match role {
        ChatMessageRole::User => ChatMessageAuthorKind::User,
        ChatMessageRole::Assistant => ChatMessageAuthorKind::OpenClaw,
        ChatMessageRole::Tool => ChatMessageAuthorKind::Agent,
        ChatMessageRole::System => ChatMessageAuthorKind::Dispatch,
    }
}

fn fallback_gateway_message_id(
    session_key: &str,
    run_id: Option<&str>,
    role: &ChatMessageRole,
    created_at: i64,
    source: &str,
) -> String {
    format!(
        "chat-{source}-{session_key}-{}-{role}-{created_at}",
        run_id.unwrap_or("no-run"),
        role = chat_role_value(role),
    )
}

fn normalize_conversation_id(value: Option<&str>) -> String {
    normalize_optional_string(value)
        .unwrap_or_else(|| DEFAULT_OPENCLAW_CHAT_CONVERSATION_ID.to_string())
}

fn normalize_session_key(value: Option<&str>) -> String {
    normalize_optional_string(value)
        .unwrap_or_else(|| DEFAULT_OPENCLAW_CHAT_SESSION_KEY.to_string())
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_optional_value(value: Option<&str>) -> Option<String> {
    normalize_optional_string(value)
}

fn validate_required_field(field_name: &str, value: &str) -> AppResult<String> {
    normalize_optional_string(Some(value))
        .ok_or_else(|| AppError::new(format!("{field_name} cannot be blank")))
}

fn next_chat_message_id(prefix: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let process_id = std::process::id();

    format!("chat-{prefix}-{process_id}-{now}")
}

fn normalize_timestamp_value(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64().map(normalize_timestamp_number),
        Value::String(raw) => raw
            .trim()
            .parse::<i64>()
            .ok()
            .map(normalize_timestamp_number),
        _ => None,
    }
}

fn normalize_timestamp_number(raw: i64) -> i64 {
    if raw >= 1_000_000_000_000 || raw <= -1_000_000_000_000 {
        raw / 1_000
    } else {
        raw
    }
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn parse_chat_role(value: &str) -> AppResult<ChatMessageRole> {
    match value {
        "system" => Ok(ChatMessageRole::System),
        "user" => Ok(ChatMessageRole::User),
        "assistant" => Ok(ChatMessageRole::Assistant),
        "tool" => Ok(ChatMessageRole::Tool),
        _ => Err(AppError::new("chat role is invalid")),
    }
}

fn parse_chat_author_kind(value: &str) -> AppResult<ChatMessageAuthorKind> {
    match value {
        "user" => Ok(ChatMessageAuthorKind::User),
        "dispatch" => Ok(ChatMessageAuthorKind::Dispatch),
        "openclaw" => Ok(ChatMessageAuthorKind::OpenClaw),
        "agent" => Ok(ChatMessageAuthorKind::Agent),
        _ => Err(AppError::new("chat author kind is invalid")),
    }
}

fn chat_role_value(value: &ChatMessageRole) -> &'static str {
    match value {
        ChatMessageRole::System => "system",
        ChatMessageRole::User => "user",
        ChatMessageRole::Assistant => "assistant",
        ChatMessageRole::Tool => "tool",
    }
}

fn chat_author_kind_value(value: &ChatMessageAuthorKind) -> &'static str {
    match value {
        ChatMessageAuthorKind::User => "user",
        ChatMessageAuthorKind::Dispatch => "dispatch",
        ChatMessageAuthorKind::OpenClaw => "openclaw",
        ChatMessageAuthorKind::Agent => "agent",
    }
}

fn invalid_chat_column(index: usize) -> impl FnOnce(AppError) -> rusqlite::Error {
    move |error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    }
}
