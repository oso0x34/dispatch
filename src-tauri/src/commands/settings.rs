use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::{
    db::Database,
    error::{AppError, AppResult},
    models::Setting,
    services::secrets::{self, SecretStatus},
};

type CommandResult<T> = Result<T, String>;
const LEGACY_SECRET_MARKER_PREFIX: &str = "dispatch.secret.";
const SETTING_KEY_BLANK_ERROR: &str = "setting key cannot be blank";
const SETTING_KEY_RESERVED_ERROR: &str = "setting key is reserved for secret storage";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatusPayload {
    pub status: SecretStatus,
}

pub fn get_setting_with_db(database: &Database, key: String) -> AppResult<Option<Setting>> {
    let key = normalize_public_setting_key(&key)?;

    database.with_connection(|connection| {
        let row = connection
            .query_row(
                "
                SELECT key, value_json, updated_at
                FROM settings
                WHERE key = ?1
                ",
                [key],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?;

        row.map(|(key, value_json, updated_at)| {
            Setting::from_value_json(key, value_json, updated_at)
        })
        .transpose()
    })
}

pub fn set_setting_with_db(database: &Database, key: String, value: Value) -> AppResult<Setting> {
    let key = normalize_public_setting_key(&key)?;
    let updated_at = now_unix_seconds();
    let setting = Setting {
        key,
        value,
        updated_at,
    };
    let value_json = setting.value_json()?;

    database.with_connection(|connection| {
        connection.execute(
            "
            INSERT INTO settings (key, value_json, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
            ",
            params![&setting.key, &value_json, setting.updated_at],
        )?;

        Ok(setting)
    })
}

pub fn list_settings_with_db(database: &Database) -> AppResult<Vec<Setting>> {
    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "
            SELECT key, value_json, updated_at
            FROM settings
            ORDER BY key ASC
            ",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        rows.into_iter()
            .filter(|(key, _, _)| !is_hidden_setting_key(key))
            .map(|(key, value_json, updated_at)| {
                Setting::from_value_json(key, value_json, updated_at)
            })
            .collect()
    })
}

fn is_hidden_setting_key(key: &str) -> bool {
    key.starts_with(LEGACY_SECRET_MARKER_PREFIX) || secrets::is_secret_key_name(key)
}

fn normalize_public_setting_key(key: &str) -> AppResult<String> {
    let normalized = key.trim();

    if normalized.is_empty() {
        return Err(AppError::new(SETTING_KEY_BLANK_ERROR));
    }

    if is_hidden_setting_key(normalized) {
        return Err(AppError::new(SETTING_KEY_RESERVED_ERROR));
    }

    Ok(normalized.to_string())
}

fn validate_public_setting_key_command(key: &str) -> CommandResult<()> {
    normalize_public_setting_key(key)
        .map(|_| ())
        .map_err(|error| error.message().to_string())
}

fn validate_secret_command_key(key: &str) -> CommandResult<()> {
    secrets::validate_secret_key(key).map_err(|error| error.message().to_string())
}

fn validate_secret_command_value(value: &str) -> CommandResult<()> {
    secrets::validate_secret_value(value).map_err(|error| error.message().to_string())
}

fn settings_command_error_message(_: AppError) -> String {
    "settings command failed".to_string()
}

fn secret_command_error_message(error: AppError) -> String {
    if error.message().contains("secure credential store") {
        return "secure credential store is unavailable".to_string();
    }

    "secret command failed".to_string()
}

#[tauri::command]
pub fn get_setting(
    database: State<'_, Arc<Database>>,
    key: String,
) -> CommandResult<Option<Setting>> {
    validate_public_setting_key_command(&key)?;
    get_setting_with_db(database.inner(), key).map_err(settings_command_error_message)
}

#[tauri::command]
pub fn set_setting(
    database: State<'_, Arc<Database>>,
    key: String,
    value: Value,
) -> CommandResult<Setting> {
    validate_public_setting_key_command(&key)?;
    set_setting_with_db(database.inner(), key, value).map_err(settings_command_error_message)
}

#[tauri::command]
pub fn list_settings(database: State<'_, Arc<Database>>) -> CommandResult<Vec<Setting>> {
    list_settings_with_db(database.inner()).map_err(settings_command_error_message)
}

#[tauri::command]
pub fn set_secret(key: String, value: String) -> CommandResult<SecretStatusPayload> {
    validate_secret_command_key(&key)?;
    validate_secret_command_value(&value)?;
    secrets::set_secret(&key, &value)
        .map(|status| SecretStatusPayload { status })
        .map_err(secret_command_error_message)
}

#[tauri::command]
pub fn get_secret_status(key: String) -> CommandResult<SecretStatusPayload> {
    validate_secret_command_key(&key)?;
    secrets::get_secret_status(&key)
        .map(|status| SecretStatusPayload { status })
        .map_err(secret_command_error_message)
}

#[tauri::command]
pub fn clear_secret(key: String) -> CommandResult<SecretStatusPayload> {
    validate_secret_command_key(&key)?;
    secrets::clear_secret(&key)
        .map(|status| SecretStatusPayload { status })
        .map_err(secret_command_error_message)
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
