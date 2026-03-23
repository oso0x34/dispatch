UPDATE agent_profiles
SET
    args_json = '[{"kind":"optional_prompt"}]',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE id = 'codex'
  AND program = 'codex'
  AND args_json = '[{"kind":"literal","value":"exec"},{"kind":"literal","value":"--dangerously-bypass-approvals-and-sandbox"},{"kind":"literal","value":"-C"},{"kind":"project_path"},{"kind":"prompt"}]';

UPDATE agent_profiles
SET
    args_json = '[{"kind":"optional_prompt"}]',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE id = 'claude-code'
  AND program = 'claude'
  AND args_json = '[{"kind":"literal","value":"--permission-mode"},{"kind":"literal","value":"bypassPermissions"},{"kind":"literal","value":"--print"},{"kind":"prompt"}]';
