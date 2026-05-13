use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::{AgentArg, AgentCwd, AgentEnvValue, AgentProfile, AgentProfileStorage},
};

use super::secrets;

pub const AUTO_AGENT_PROFILE_ID: &str = "auto";
pub const AUTO_AGENT_PROFILE_NAME: &str = "Auto";
const REGISTRY_SELECTION_MODE_AUTO: &str = "auto";
const REGISTRY_SELECTION_MODE_PROFILE: &str = "profile";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentProfileInput {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<AgentArg>,
    pub env: BTreeMap<String, AgentEnvValue>,
    pub cwd: AgentCwd,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryEntry {
    pub id: String,
    pub name: String,
    pub selection_mode: String,
}

pub fn list_agent_profiles(database: &Database) -> AppResult<Vec<AgentProfile>> {
    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "
            SELECT id, name, program, args_json, env_json, cwd_json, created_at, updated_at
            FROM agent_profiles
            ORDER BY name COLLATE NOCASE ASC, id ASC
            ",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        rows.into_iter()
            .map(
                |(id, name, program, args_json, env_json, cwd_json, created_at, updated_at)| {
                    AgentProfile::from_storage(AgentProfileStorage {
                        id,
                        name,
                        program,
                        args_json,
                        env_json,
                        cwd_json,
                        created_at,
                        updated_at,
                    })
                },
            )
            .collect()
    })
}

pub fn list_agent_registry_entries(database: &Database) -> AppResult<Vec<AgentRegistryEntry>> {
    let mut entries = vec![AgentRegistryEntry {
        id: AUTO_AGENT_PROFILE_ID.to_string(),
        name: AUTO_AGENT_PROFILE_NAME.to_string(),
        selection_mode: REGISTRY_SELECTION_MODE_AUTO.to_string(),
    }];

    entries.extend(
        list_agent_profiles(database)?
            .into_iter()
            .map(|profile| AgentRegistryEntry {
                id: profile.id,
                name: profile.name,
                selection_mode: REGISTRY_SELECTION_MODE_PROFILE.to_string(),
            }),
    );

    Ok(entries)
}

pub fn get_agent_profile(database: &Database, profile_id: &str) -> AppResult<Option<AgentProfile>> {
    let normalized_profile_id = normalize_profile_id(profile_id)?;

    database.with_connection(|connection| {
        let row = connection
            .query_row(
                "
                SELECT id, name, program, args_json, env_json, cwd_json, created_at, updated_at
                FROM agent_profiles
                WHERE id = ?1
                ",
                [&normalized_profile_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
            .optional()?;

        row.map(
            |(id, name, program, args_json, env_json, cwd_json, created_at, updated_at)| {
                AgentProfile::from_storage(AgentProfileStorage {
                    id,
                    name,
                    program,
                    args_json,
                    env_json,
                    cwd_json,
                    created_at,
                    updated_at,
                })
            },
        )
        .transpose()
    })
}

pub fn save_agent_profile(
    database: &Database,
    input: SaveAgentProfileInput,
) -> AppResult<AgentProfile> {
    let profile = validate_agent_profile(input)?;
    let now = now_unix_seconds();
    let args_json = profile.args_json()?;
    let env_json = profile.env_json()?;
    let cwd_json = profile.cwd_json()?;

    database.with_connection(|connection| {
        let created_at = connection
            .query_row(
                "SELECT created_at FROM agent_profiles WHERE id = ?1",
                [&profile.id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(now);

        connection.execute(
            "
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
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                program = excluded.program,
                args_json = excluded.args_json,
                env_json = excluded.env_json,
                cwd_json = excluded.cwd_json,
                updated_at = excluded.updated_at
            ",
            params![
                &profile.id,
                &profile.name,
                &profile.program,
                &args_json,
                &env_json,
                &cwd_json,
                created_at,
                now,
            ],
        )?;

        Ok(AgentProfile {
            created_at,
            updated_at: now,
            ..profile
        })
    })
}

pub fn delete_agent_profile(database: &Database, profile_id: &str) -> AppResult<bool> {
    let normalized_profile_id = normalize_profile_id(profile_id)?;

    database.with_connection(|connection| {
        let deleted = connection.execute(
            "DELETE FROM agent_profiles WHERE id = ?1",
            [&normalized_profile_id],
        )?;

        Ok(deleted > 0)
    })
}

fn validate_agent_profile(input: SaveAgentProfileInput) -> AppResult<AgentProfile> {
    let id = normalize_profile_id(&input.id)?;
    let name = normalize_profile_name(&input.name)?;
    let program = normalize_program(&input.program)?;
    validate_agent_args(&input.args)?;
    validate_agent_env(&input.env)?;

    Ok(AgentProfile {
        id,
        name,
        program,
        args: input.args,
        env: input.env,
        cwd: input.cwd,
        created_at: 0,
        updated_at: 0,
    })
}

fn normalize_profile_id(profile_id: &str) -> AppResult<String> {
    let normalized = profile_id.trim();

    if normalized.is_empty() {
        return Err(AppError::new("agent profile id cannot be blank"));
    }

    if normalized == AUTO_AGENT_PROFILE_ID {
        return Err(AppError::new("agent profile id is reserved"));
    }

    Ok(normalized.to_string())
}

fn normalize_profile_name(name: &str) -> AppResult<String> {
    let normalized = name.trim();

    if normalized.is_empty() {
        return Err(AppError::new("agent profile name cannot be blank"));
    }

    Ok(normalized.to_string())
}

fn normalize_program(program: &str) -> AppResult<String> {
    let normalized = program.trim();

    if normalized.is_empty() {
        return Err(AppError::new("agent profile program cannot be blank"));
    }

    Ok(normalized.to_string())
}
fn validate_agent_args(args: &[AgentArg]) -> AppResult<()> {
    for argument in args {
        if let AgentArg::Literal { value } = argument {
            if value.trim().is_empty() {
                return Err(AppError::new("agent profile literal args cannot be blank"));
            }
        }
    }

    Ok(())
}

fn validate_agent_env(env: &BTreeMap<String, AgentEnvValue>) -> AppResult<()> {
    for (key, value) in env {
        if !secrets::is_secret_key_name(key) {
            return Err(AppError::new(
                "agent env key must be an env-style identifier",
            ));
        }

        match value {
            AgentEnvValue::Inherit { key } | AgentEnvValue::Secret { key } => {
                if !secrets::is_secret_key_name(key) {
                    return Err(AppError::new(
                        "agent env source keys must be env-style identifiers",
                    ));
                }
            }
            AgentEnvValue::Literal { value } => {
                if value.trim().is_empty() {
                    return Err(AppError::new("agent env literal values cannot be blank"));
                }
            }
        }
    }

    Ok(())
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
