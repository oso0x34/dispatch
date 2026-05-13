use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<AgentArg>,
    pub env: BTreeMap<String, AgentEnvValue>,
    pub cwd: AgentCwd,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct AgentProfileStorage {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args_json: String,
    pub env_json: String,
    pub cwd_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentArg {
    Literal { value: String },
    Prompt,
    OptionalPrompt,
    ProjectPath,
    TaskTitle,
    TaskBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEnvValue {
    Inherit { key: String },
    Literal { value: String },
    Secret { key: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentCwd {
    ProjectRoot,
}

impl AgentProfile {
    pub fn from_storage(storage: AgentProfileStorage) -> AppResult<Self> {
        let AgentProfileStorage {
            id,
            name,
            program,
            args_json,
            env_json,
            cwd_json,
            created_at,
            updated_at,
        } = storage;

        let args = serde_json::from_str(&args_json).map_err(|error| {
            AppError::new(format!(
                "failed to deserialize agent profile args for {id}: {error}"
            ))
        })?;
        let env = serde_json::from_str(&env_json).map_err(|error| {
            AppError::new(format!(
                "failed to deserialize agent profile env for {id}: {error}"
            ))
        })?;
        let cwd = serde_json::from_str(&cwd_json).map_err(|error| {
            AppError::new(format!(
                "failed to deserialize agent profile cwd for {id}: {error}"
            ))
        })?;

        Ok(Self {
            id,
            name,
            program,
            args,
            env,
            cwd,
            created_at,
            updated_at,
        })
    }

    pub fn args_json(&self) -> AppResult<String> {
        serde_json::to_string(&self.args).map_err(|error| {
            AppError::new(format!(
                "failed to serialize agent profile args for {}: {error}",
                self.id
            ))
        })
    }

    pub fn env_json(&self) -> AppResult<String> {
        serde_json::to_string(&self.env).map_err(|error| {
            AppError::new(format!(
                "failed to serialize agent profile env for {}: {error}",
                self.id
            ))
        })
    }

    pub fn cwd_json(&self) -> AppResult<String> {
        serde_json::to_string(&self.cwd).map_err(|error| {
            AppError::new(format!(
                "failed to serialize agent profile cwd for {}: {error}",
                self.id
            ))
        })
    }
}
