CREATE TABLE agent_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) > 0),
    program TEXT NOT NULL CHECK(length(trim(program)) > 0),
    args_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(args_json) AND json_type(args_json) = 'array'),
    env_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(env_json) AND json_type(env_json) = 'object'),
    cwd_json TEXT NOT NULL CHECK(json_valid(cwd_json) AND json_type(cwd_json) = 'object'),
    created_at INTEGER NOT NULL CHECK(created_at >= 0),
    updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
);

CREATE INDEX idx_agent_profiles_name
ON agent_profiles(name COLLATE NOCASE ASC, id ASC);

INSERT INTO agent_profiles (
    id,
    name,
    program,
    args_json,
    env_json,
    cwd_json,
    created_at,
    updated_at
)
VALUES
    (
        'codex',
        'Codex',
        'codex',
        '[{"kind":"literal","value":"exec"},{"kind":"literal","value":"--dangerously-bypass-approvals-and-sandbox"},{"kind":"literal","value":"-C"},{"kind":"project_path"},{"kind":"prompt"}]',
        '{}',
        '{"kind":"project_root"}',
        CAST(strftime('%s', 'now') AS INTEGER),
        CAST(strftime('%s', 'now') AS INTEGER)
    ),
    (
        'claude-code',
        'Claude Code',
        'claude',
        '[{"kind":"literal","value":"--permission-mode"},{"kind":"literal","value":"bypassPermissions"},{"kind":"literal","value":"--print"},{"kind":"prompt"}]',
        '{}',
        '{"kind":"project_root"}',
        CAST(strftime('%s', 'now') AS INTEGER),
        CAST(strftime('%s', 'now') AS INTEGER)
    ),
    (
        'gemini',
        'Gemini',
        'gemini',
        '[{"kind":"prompt"}]',
        '{}',
        '{"kind":"project_root"}',
        CAST(strftime('%s', 'now') AS INTEGER),
        CAST(strftime('%s', 'now') AS INTEGER)
    );
