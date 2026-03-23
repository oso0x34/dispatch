CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL DEFAULT 'main' CHECK(length(trim(conversation_id)) > 0),
    project_id TEXT,
    agent_session_id TEXT,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    author_kind TEXT NOT NULL CHECK(author_kind IN ('user', 'dispatch', 'openclaw', 'agent')),
    body_markdown TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(
        json_valid(metadata_json) AND json_type(metadata_json) = 'object'
    ),
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY(agent_session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL
);

CREATE INDEX idx_chat_messages_project_conversation_created_at
ON chat_messages(project_id, conversation_id, created_at ASC, id);
