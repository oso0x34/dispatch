use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value: Value,
    pub updated_at: i64,
}

impl Setting {
    pub fn from_value_json(key: String, value_json: String, updated_at: i64) -> AppResult<Self> {
        let value = serde_json::from_str(&value_json).map_err(|error| {
            AppError::new(format!("failed to deserialize setting {key}: {error}"))
        })?;

        Ok(Self {
            key,
            value,
            updated_at,
        })
    }

    pub fn value_json(&self) -> AppResult<String> {
        serde_json::to_string(&self.value).map_err(|error| {
            AppError::new(format!("failed to serialize setting {}: {error}", self.key))
        })
    }
}
