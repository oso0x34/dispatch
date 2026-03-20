use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE_NAME: &str = "dispatch";
pub const SECRET_KEY_BLANK_ERROR: &str = "secret key cannot be blank";
pub const SECRET_KEY_INVALID_ERROR: &str = "secret key must be an env-style identifier";
pub const SECRET_VALUE_BLANK_ERROR: &str = "secret value cannot be blank";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SecretStatus {
    Keychain,
    Env,
    Missing,
}

pub trait SecretStore {
    fn set_secret(&self, key: &str, value: &str) -> AppResult<()>;
    fn get_secret(&self, key: &str) -> AppResult<Option<String>>;
    fn clear_secret(&self, key: &str) -> AppResult<()>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn set_secret(&self, key: &str, value: &str) -> AppResult<()> {
        keyring_entry(key)?
            .set_password(value)
            .map_err(|error| keyring_error("write", key, error))
    }

    fn get_secret(&self, key: &str) -> AppResult<Option<String>> {
        match keyring_entry(key)?.get_password() {
            Ok(value) if secret_value_is_blank(&value) => Ok(None),
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error("read", key, error)),
        }
    }

    fn clear_secret(&self, key: &str) -> AppResult<()> {
        match keyring_entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error("clear", key, error)),
        }
    }
}

pub fn set_secret(key: &str, value: &str) -> AppResult<SecretStatus> {
    set_secret_with_store(&KeyringSecretStore, key, value)
}

pub fn set_secret_with_store(
    store: &impl SecretStore,
    key: &str,
    value: &str,
) -> AppResult<SecretStatus> {
    let key = normalize_secret_key(key)?;
    if secret_value_is_blank(value) {
        return Err(AppError::new(SECRET_VALUE_BLANK_ERROR));
    }

    store.set_secret(&key, value)?;

    Ok(SecretStatus::Keychain)
}

pub fn get_secret_status(key: &str) -> AppResult<SecretStatus> {
    get_secret_status_with_store(&KeyringSecretStore, key)
}

pub fn get_secret_status_with_store(
    store: &impl SecretStore,
    key: &str,
) -> AppResult<SecretStatus> {
    let key = normalize_secret_key(key)?;

    match store.get_secret(&key) {
        Ok(Some(_)) => Ok(SecretStatus::Keychain),
        Ok(None) => Ok(env_secret_value(&key)
            .map(|_| SecretStatus::Env)
            .unwrap_or(SecretStatus::Missing)),
        Err(error) => {
            tracing::warn!(
                secret_key = %key,
                error = %error,
                "failed to read keychain secret; falling back to inherited environment"
            );

            Ok(env_secret_value(&key)
                .map(|_| SecretStatus::Env)
                .unwrap_or(SecretStatus::Missing))
        }
    }
}

pub fn clear_secret(key: &str) -> AppResult<SecretStatus> {
    clear_secret_with_store(&KeyringSecretStore, key)
}

pub fn clear_secret_with_store(store: &impl SecretStore, key: &str) -> AppResult<SecretStatus> {
    let key = normalize_secret_key(key)?;

    store.clear_secret(&key)?;

    get_secret_status_with_store(store, &key)
}

pub fn resolve_secret_value(key: &str) -> AppResult<Option<String>> {
    resolve_secret_value_with_store(&KeyringSecretStore, key)
}

pub fn resolve_secret_value_with_store(
    store: &impl SecretStore,
    key: &str,
) -> AppResult<Option<String>> {
    let key = normalize_secret_key(key)?;

    match store.get_secret(&key) {
        Ok(Some(value)) => Ok(Some(value)),
        Ok(None) => Ok(env_secret_value(&key)),
        Err(error) => {
            tracing::warn!(
                secret_key = %key,
                error = %error,
                "failed to read keychain secret value; falling back to inherited environment"
            );

            Ok(env_secret_value(&key))
        }
    }
}

pub fn is_secret_key_name(key: &str) -> bool {
    let mut characters = key.chars();

    match characters.next() {
        Some(character) if character.is_ascii_alphabetic() || character == '_' => {}
        _ => return false,
    }

    characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn normalize_secret_key(key: &str) -> AppResult<String> {
    let normalized = key.trim();
    if normalized.is_empty() {
        return Err(AppError::new(SECRET_KEY_BLANK_ERROR));
    }

    if !is_secret_key_name(normalized) {
        return Err(AppError::new(SECRET_KEY_INVALID_ERROR));
    }

    Ok(normalized.to_string())
}

pub fn validate_secret_key(key: &str) -> AppResult<()> {
    normalize_secret_key(key).map(|_| ())
}

pub fn validate_secret_value(value: &str) -> AppResult<()> {
    if secret_value_is_blank(value) {
        return Err(AppError::new(SECRET_VALUE_BLANK_ERROR));
    }

    Ok(())
}

fn keyring_entry(key: &str) -> AppResult<Entry> {
    Entry::new(KEYRING_SERVICE_NAME, key).map_err(|error| {
        AppError::new(format!(
            "failed to access secure credential store for {key}: {error}"
        ))
    })
}

fn keyring_error(operation: &str, key: &str, error: keyring::Error) -> AppError {
    AppError::new(format!(
        "failed to {operation} secure credential store for {key}: {error}"
    ))
}

fn env_secret_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .filter(|value| !secret_value_is_blank(value))
}

fn secret_value_is_blank(value: &str) -> bool {
    value.trim().is_empty()
}
