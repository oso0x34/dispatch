CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) > 0),
    root_path TEXT NOT NULL UNIQUE CHECK(length(root_path) > 0),
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
    last_opened_at INTEGER CHECK(last_opened_at IS NULL OR last_opened_at >= 0)
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    description_markdown TEXT NOT NULL DEFAULT '',
    workflow_state TEXT NOT NULL CHECK(
        workflow_state IN ('draft', 'planning', 'in_progress', 'review', 'done', 'blocked')
    ),
    last_run_state TEXT NOT NULL DEFAULT 'idle' CHECK(
        last_run_state IN ('idle', 'running', 'succeeded', 'failed', 'canceled', 'abandoned')
    ),
    last_session_id TEXT,
    assigned_agent_mode TEXT CHECK(
        assigned_agent_mode IS NULL
        OR assigned_agent_mode = 'auto'
        OR (assigned_agent_mode LIKE 'profile:%' AND length(assigned_agent_mode) > 8)
    ),
    markdown_export_path TEXT,
    blocked_reason TEXT,
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
    completed_at INTEGER CHECK(completed_at IS NULL OR completed_at >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(last_session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL
);

CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    source TEXT NOT NULL CHECK(source IN ('terminal', 'direct_dispatch', 'openclaw')),
    session_kind TEXT NOT NULL CHECK(session_kind IN ('shell', 'direct_agent', 'orchestrated_agent')),
    status TEXT NOT NULL CHECK(
        status IN ('pending', 'running', 'succeeded', 'failed', 'canceled', 'abandoned')
    ),
    program TEXT NOT NULL CHECK(length(program) > 0),
    args_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(args_json) AND json_type(args_json) = 'array'),
    env_keys_json TEXT NOT NULL DEFAULT '[]' CHECK(
        json_valid(env_keys_json) AND json_type(env_keys_json) = 'array'
    ),
    cwd TEXT NOT NULL CHECK(length(cwd) > 0),
    transport TEXT NOT NULL CHECK(transport IN ('pty', 'openclaw')),
    exit_code INTEGER,
    started_at INTEGER CHECK(started_at IS NULL OR started_at >= 0),
    ended_at INTEGER CHECK(ended_at IS NULL OR ended_at >= 0),
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
);

CREATE INDEX idx_tasks_project_workflow_updated_at
ON tasks(project_id, workflow_state, updated_at DESC, id);

CREATE INDEX idx_tasks_project_last_run_updated_at
ON tasks(project_id, last_run_state, updated_at DESC, id);

CREATE INDEX idx_agent_sessions_project_status_created_at
ON agent_sessions(project_id, status, created_at DESC, id);

CREATE INDEX idx_agent_sessions_task_created_at
ON agent_sessions(task_id, created_at DESC, id);
