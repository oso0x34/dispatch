use std::{
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::{AgentArg, AgentEnvValue, AgentProfile, AgentSession},
};

use super::{
    agent_registry::{self, AUTO_AGENT_PROFILE_ID},
    history, project_registry,
    pty_manager::{self, PtyManager, TerminalLaunchRequest},
    secrets, task_export,
};

const DISPATCH_SESSION_SOURCE: &str = "direct_dispatch";
const DISPATCH_SESSION_KIND: &str = "direct_agent";
const TASK_WORKFLOW_IN_PROGRESS: &str = "in_progress";
const TASK_WORKFLOW_REVIEW: &str = "review";
const TASK_RUN_STATE_RUNNING: &str = "running";
const TASK_RUN_STATE_SUCCEEDED: &str = "succeeded";
const TASK_RUN_STATE_FAILED: &str = "failed";
const TASK_RUN_STATE_CANCELED: &str = "canceled";
const TASK_RUN_STATE_ABANDONED: &str = "abandoned";
const LAST_USED_LOCAL_PROFILE_SETTING_KEY: &str = "dispatch.last_used_local_profile_id";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DispatchAgentRequest {
    pub project_id: String,
    pub profile_id: String,
    pub task_id: Option<String>,
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedDispatchLaunch {
    pub profile_id: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskStatusTransition {
    pub project_id: String,
    pub task_id: String,
    pub session_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DispatchTaskContext {
    id: String,
    project_id: String,
    title: String,
    description_markdown: String,
}

pub fn resolve_dispatch_launch(
    database: &Database,
    request: &DispatchAgentRequest,
) -> AppResult<ResolvedDispatchLaunch> {
    let normalized_request = normalize_dispatch_request(request)?;
    let resolved_profile_id = if normalized_request.profile_id == AUTO_AGENT_PROFILE_ID {
        resolve_auto_local_profile_id(database)?
    } else {
        normalized_request.profile_id.clone()
    };

    let project = project_registry::get_project(database, &normalized_request.project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;
    let profile = agent_registry::get_agent_profile(database, &resolved_profile_id)?
        .ok_or_else(|| AppError::new("agent profile not found"))?;
    let task = match normalized_request.task_id.as_deref() {
        Some(task_id) => Some(load_dispatch_task(
            database,
            &normalized_request.project_id,
            task_id,
        )?),
        None => None,
    };

    let args = resolve_agent_args(
        &profile,
        normalized_request.prompt.as_deref(),
        &project.root_path,
        task.as_ref(),
    )?;
    let env = resolve_agent_env(&profile)?;
    let cwd = resolve_agent_cwd(&project.root_path, &profile)?;

    Ok(ResolvedDispatchLaunch {
        profile_id: profile.id,
        program: profile.program,
        args,
        env,
        cwd,
    })
}

pub fn dispatch_agent(
    database: &Database,
    pty_manager: &Arc<PtyManager>,
    request: DispatchAgentRequest,
) -> AppResult<AgentSession> {
    let normalized_request = normalize_dispatch_request(&request)?;
    let launch = resolve_dispatch_launch(database, &normalized_request)?;
    let session_id = pty_manager::allocate_terminal_session_id();
    let _ = history::create_pre_agent_save_point(
        database,
        &normalized_request.project_id,
        &session_id,
    )?;

    let session = pty_manager::create_terminal_session(
        database,
        pty_manager.as_ref(),
        TerminalLaunchRequest {
            session_id: Some(session_id),
            project_id: normalized_request.project_id,
            task_id: normalized_request.task_id,
            source: DISPATCH_SESSION_SOURCE.to_string(),
            session_kind: DISPATCH_SESSION_KIND.to_string(),
            program: launch.program,
            args: launch.args,
            env: launch.env,
            cwd: launch.cwd,
        },
    )?;

    remember_last_used_local_profile(database, &launch.profile_id)?;
    mark_task_dispatch_started(database, &session)?;

    Ok(session)
}

pub fn mark_task_session_started(
    database: &Database,
    project_id: &str,
    task_id: &str,
    session_id: &str,
) -> AppResult<()> {
    let now = now_unix_seconds();
    database.with_connection(|connection| {
        let updated_rows = connection.execute(
            "
            UPDATE tasks
            SET
                workflow_state = ?3,
                last_run_state = ?4,
                last_session_id = ?5,
                updated_at = ?6
            WHERE id = ?1
              AND project_id = ?2
            ",
            params![
                task_id,
                project_id,
                TASK_WORKFLOW_IN_PROGRESS,
                TASK_RUN_STATE_RUNNING,
                session_id,
                now,
            ],
        )?;

        if updated_rows == 0 {
            return Err(AppError::new("task not found"));
        }

        Ok::<(), AppError>(())
    })?;

    let _ = task_export::sync_task_markdown_export(database, project_id, task_id)?;

    Ok(())
}

pub fn mark_task_dispatch_started(database: &Database, session: &AgentSession) -> AppResult<()> {
    let Some(task_id) = session.task_id.as_deref() else {
        return Ok(());
    };

    if !session_is_direct_dispatch(session) {
        return Ok(());
    }

    mark_task_session_started(database, &session.project_id, task_id, &session.id)
}

pub fn sync_task_session_status(
    database: &Database,
    project_id: &str,
    task_id: &str,
    session_id: &str,
    status: &str,
) -> AppResult<Option<TaskStatusTransition>> {
    let (workflow_state, run_state) = match status {
        "succeeded" => (TASK_WORKFLOW_REVIEW, TASK_RUN_STATE_SUCCEEDED),
        "failed" => (TASK_WORKFLOW_IN_PROGRESS, TASK_RUN_STATE_FAILED),
        "canceled" => (TASK_WORKFLOW_IN_PROGRESS, TASK_RUN_STATE_CANCELED),
        "abandoned" => (TASK_WORKFLOW_IN_PROGRESS, TASK_RUN_STATE_ABANDONED),
        _ => return Ok(None),
    };

    let now = now_unix_seconds();
    let updated_rows = database.with_connection(|connection| {
        let updated_rows = connection.execute(
            "
            UPDATE tasks
            SET
                workflow_state = ?4,
                last_run_state = ?5,
                last_session_id = ?3,
                updated_at = ?6
            WHERE id = ?1
              AND project_id = ?2
              AND last_session_id = ?3
              AND last_run_state = ?7
            ",
            params![
                task_id,
                project_id,
                session_id,
                workflow_state,
                run_state,
                now,
                TASK_RUN_STATE_RUNNING,
            ],
        )?;

        Ok::<usize, AppError>(updated_rows)
    })?;

    if updated_rows == 0 {
        return Ok(None);
    }

    let _ = task_export::sync_task_markdown_export(database, project_id, task_id)?;

    Ok(Some(TaskStatusTransition {
        project_id: project_id.to_string(),
        task_id: task_id.to_string(),
        session_status: status.to_string(),
    }))
}

pub fn sync_task_status_by_session_id(
    database: &Database,
    session_id: &str,
    status: &str,
) -> AppResult<Vec<TaskStatusTransition>> {
    let task_rows = database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "
            SELECT id, project_id
            FROM tasks
            WHERE last_session_id = ?1
            ",
        )?;
        let rows = statement
            .query_map([session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok::<Vec<(String, String)>, AppError>(rows)
    })?;

    let mut transitions = Vec::new();
    for (task_id, project_id) in task_rows {
        if let Some(transition) =
            sync_task_session_status(database, &project_id, &task_id, session_id, status)?
        {
            transitions.push(transition);
        }
    }

    Ok(transitions)
}

pub fn sync_dispatch_session_status(
    database: &Database,
    session: &AgentSession,
) -> AppResult<Option<TaskStatusTransition>> {
    if !session_is_direct_dispatch(session) {
        return Ok(None);
    }

    let _ = history::create_post_agent_save_point(database, &session.project_id, &session.id)?;

    let Some(task_id) = session.task_id.as_deref() else {
        return Ok(None);
    };

    sync_task_session_status(
        database,
        &session.project_id,
        task_id,
        &session.id,
        &session.status,
    )
}

pub fn sync_task_with_session_status(
    database: &Database,
    session: &AgentSession,
) -> AppResult<Option<TaskStatusTransition>> {
    sync_dispatch_session_status(database, session)
}

pub fn validate_linked_task(database: &Database, project_id: &str, task_id: &str) -> AppResult<()> {
    load_dispatch_task(database, project_id, task_id).map(|_| ())
}

fn normalize_dispatch_request(request: &DispatchAgentRequest) -> AppResult<DispatchAgentRequest> {
    let project_id = request.project_id.trim();
    if project_id.is_empty() {
        return Err(AppError::new("project id cannot be blank"));
    }

    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err(AppError::new("agent profile id cannot be blank"));
    }

    let task_id = request
        .task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let prompt = request
        .prompt
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned();

    Ok(DispatchAgentRequest {
        project_id: project_id.to_string(),
        profile_id: profile_id.to_string(),
        task_id,
        prompt,
    })
}

fn resolve_agent_args(
    profile: &AgentProfile,
    prompt: Option<&str>,
    project_root: &str,
    task: Option<&DispatchTaskContext>,
) -> AppResult<Vec<String>> {
    let mut args = Vec::with_capacity(profile.args.len());

    for arg in &profile.args {
        match arg {
            AgentArg::Literal { value } => args.push(value.clone()),
            AgentArg::Prompt => {
                let prompt = prompt.ok_or_else(|| AppError::new("dispatch prompt is required"))?;
                args.push(prompt.to_string());
            }
            AgentArg::OptionalPrompt => {
                if let Some(prompt) = prompt {
                    args.push(prompt.to_string());
                }
            }
            AgentArg::ProjectPath => args.push(project_root.to_string()),
            AgentArg::TaskTitle => {
                let task =
                    task.ok_or_else(|| AppError::new("dispatch task context is required"))?;
                args.push(task.title.clone());
            }
            AgentArg::TaskBody => {
                let task =
                    task.ok_or_else(|| AppError::new("dispatch task context is required"))?;
                args.push(task.description_markdown.clone());
            }
        }
    }

    Ok(args)
}

fn resolve_agent_env(profile: &AgentProfile) -> AppResult<Vec<(String, String)>> {
    let mut env = Vec::with_capacity(profile.env.len());

    for (key, value) in &profile.env {
        let resolved_value = match value {
            AgentEnvValue::Literal { value } => value.clone(),
            AgentEnvValue::Inherit { key } => std::env::var(key)
                .map_err(|_| AppError::new(format!("inherited env var is missing: {key}")))?,
            AgentEnvValue::Secret { key } => secrets::resolve_secret_value(key)?
                .ok_or_else(|| AppError::new(format!("secret env var is missing: {key}")))?,
        };

        env.push((key.clone(), resolved_value));
    }

    Ok(env)
}

fn resolve_agent_cwd(project_root: &str, _profile: &AgentProfile) -> AppResult<PathBuf> {
    let cwd = PathBuf::from(project_root);

    if !cwd.is_dir() {
        return Err(AppError::new(
            "resolved terminal cwd is invalid or inaccessible",
        ));
    }

    Ok(cwd)
}

fn load_dispatch_task(
    database: &Database,
    project_id: &str,
    task_id: &str,
) -> AppResult<DispatchTaskContext> {
    database.with_connection(|connection| {
        let row = connection
            .query_row(
                "
                SELECT id, project_id, title, description_markdown
                FROM tasks
                WHERE id = ?1
                ",
                [task_id],
                |row| {
                    Ok(DispatchTaskContext {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        title: row.get(2)?,
                        description_markdown: row.get(3)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::new("task not found"))?;

        if row.project_id != project_id {
            return Err(AppError::new("task does not belong to project"));
        }

        Ok(row)
    })
}

fn session_is_direct_dispatch(session: &AgentSession) -> bool {
    session.source == DISPATCH_SESSION_SOURCE && session.session_kind == DISPATCH_SESSION_KIND
}

fn resolve_auto_local_profile_id(database: &Database) -> AppResult<String> {
    if let Some(saved_profile_id) = load_last_used_local_profile_id(database)? {
        if agent_registry::get_agent_profile(database, &saved_profile_id)?.is_some() {
            return Ok(saved_profile_id);
        }
    }

    agent_registry::list_agent_profiles(database)?
        .into_iter()
        .next()
        .map(|profile| profile.id)
        .ok_or_else(|| AppError::new("auto dispatch fallback has no local agent profile"))
}

fn load_last_used_local_profile_id(database: &Database) -> AppResult<Option<String>> {
    database.with_connection(|connection| {
        let value_json = connection
            .query_row(
                "
                SELECT value_json
                FROM settings
                WHERE key = ?1
                ",
                [LAST_USED_LOCAL_PROFILE_SETTING_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        let Some(value_json) = value_json else {
            return Ok(None);
        };

        let value: Value = serde_json::from_str(&value_json).map_err(|error| {
            AppError::new(format!(
                "failed to deserialize setting {LAST_USED_LOCAL_PROFILE_SETTING_KEY}: {error}"
            ))
        })?;

        Ok(value.as_str().map(ToString::to_string))
    })
}

fn remember_last_used_local_profile(database: &Database, profile_id: &str) -> AppResult<()> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty() || profile_id == AUTO_AGENT_PROFILE_ID {
        return Ok(());
    }

    let updated_at = now_unix_seconds();
    let value_json = serde_json::to_string(profile_id).map_err(|error| {
        AppError::new(format!(
            "failed to serialize setting {LAST_USED_LOCAL_PROFILE_SETTING_KEY}: {error}"
        ))
    })?;

    database.with_connection(|connection| {
        connection.execute(
            "
            INSERT INTO settings (key, value_json, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
            ",
            params![LAST_USED_LOCAL_PROFILE_SETTING_KEY, value_json, updated_at,],
        )?;

        Ok::<(), AppError>(())
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn build_profile(args: Vec<AgentArg>) -> AgentProfile {
        AgentProfile {
            id: "codex".to_string(),
            name: "Codex".to_string(),
            program: "codex".to_string(),
            args,
            env: BTreeMap::new(),
            cwd: crate::models::AgentCwd::ProjectRoot,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn optional_prompt_is_omitted_when_dispatch_prompt_is_missing() {
        let args = resolve_agent_args(
            &build_profile(vec![AgentArg::OptionalPrompt]),
            None,
            "/tmp/project",
            None,
        )
        .expect("optional prompt should not fail without a prompt");

        assert!(args.is_empty());
    }

    #[test]
    fn optional_prompt_is_forwarded_when_dispatch_prompt_is_present() {
        let args = resolve_agent_args(
            &build_profile(vec![AgentArg::OptionalPrompt]),
            Some("Continue the session"),
            "/tmp/project",
            None,
        )
        .expect("optional prompt should be forwarded");

        assert_eq!(args, vec!["Continue the session".to_string()]);
    }
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_secs() as i64
}
