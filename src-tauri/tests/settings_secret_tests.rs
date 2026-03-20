use std::{
    collections::HashMap,
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    commands::settings::{get_setting_with_db, list_settings_with_db, set_setting_with_db},
    db::Database,
    error::AppResult,
    services::secrets::{self, SecretStatus, SecretStore},
};
use rusqlite::params;
use serde_json::json;

#[test]
fn settings_commands_persist_non_secret_json_values_in_sqlite() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("settings-db");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Database::initialize_at(&database_path)?;

    let stored = set_setting_with_db(
        &database,
        "ui.theme".to_string(),
        json!({
            "mode": "dark",
            "density": "compact"
        }),
    )?;

    assert_eq!(stored.key, "ui.theme");
    assert_eq!(
        stored.value,
        json!({
            "mode": "dark",
            "density": "compact"
        })
    );

    let fetched = get_setting_with_db(&database, "ui.theme".to_string())?;
    assert_eq!(fetched, Some(stored.clone()));

    let listed = list_settings_with_db(&database)?;
    assert_eq!(listed, vec![stored.clone()]);

    drop(database);

    let reopened = Database::initialize_at(&database_path)?;
    let reopened_setting = get_setting_with_db(&reopened, "ui.theme".to_string())?;
    assert_eq!(reopened_setting, Some(stored.clone()));
    assert_eq!(list_settings_with_db(&reopened)?, vec![stored]);

    drop(reopened);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn settings_commands_reject_secret_key_names_and_keep_them_out_of_sqlite(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("settings-secret-key");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Database::initialize_at(&database_path)?;

    let error = set_setting_with_db(
        &database,
        "OPENAI_API_KEY".to_string(),
        json!("super-secret-value"),
    )
    .expect_err("secret-key names must stay out of public settings APIs");
    assert_eq!(
        error.message(),
        "setting key is reserved for secret storage"
    );

    let row_count = database.with_connection(|connection| -> Result<_, Box<dyn Error>> {
        Ok(
            connection.query_row("SELECT COUNT(*) FROM settings", [], |row| {
                row.get::<_, i64>(0)
            })?,
        )
    })?;
    assert_eq!(
        row_count, 0,
        "SQLite must not persist secret-looking settings"
    );
    assert!(list_settings_with_db(&database)?.is_empty());

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn list_settings_keeps_non_secret_keys_that_only_case_match_secret_prefix(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("settings-prefix-case");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Database::initialize_at(&database_path)?;

    let stored = set_setting_with_db(
        &database,
        "Dispatch.Secret.theme".to_string(),
        json!("light"),
    )?;

    assert_eq!(
        get_setting_with_db(&database, "Dispatch.Secret.theme".to_string())?,
        Some(stored.clone())
    );
    assert_eq!(
        list_settings_with_db(&database)?,
        vec![stored],
        "only exact secret marker keys should be hidden from public settings APIs"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn list_settings_hides_legacy_secret_rows_already_in_sqlite() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("settings-legacy-secret-row");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Database::initialize_at(&database_path)?;

    let visible_setting = set_setting_with_db(&database, "ui.theme".to_string(), json!("dark"))?;

    database.with_connection(|connection| -> Result<(), Box<dyn Error>> {
        connection.execute(
            "
            INSERT INTO settings (key, value_json, updated_at)
            VALUES (?1, ?2, ?3)
            ",
            params![
                "OPENAI_API_KEY",
                json!("legacy-secret-value").to_string(),
                1_i64
            ],
        )?;
        connection.execute(
            "
            INSERT INTO settings (key, value_json, updated_at)
            VALUES (?1, ?2, ?3)
            ",
            params![
                "dispatch.secret.OPENAI_API_KEY",
                r#"{"kind":"keychain_presence"}"#,
                2_i64
            ],
        )?;

        Ok(())
    })?;

    assert_eq!(list_settings_with_db(&database)?, vec![visible_setting]);

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn secret_commands_reject_invalid_secret_key_names() {
    let store = MemorySecretStore::default();

    let error = secrets::get_secret_status_with_store(&store, "OPENAI_API_KEY=bad")
        .expect_err("invalid env-style keys must be rejected before env lookup");
    assert_eq!(
        error.message(),
        "secret key must be an env-style identifier"
    );
}

#[test]
fn secret_storage_never_writes_secret_rows_to_sqlite_or_public_settings(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("secret-marker");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Database::initialize_at(&database_path)?;
    let store = MemorySecretStore::default();
    let secret_key = unique_secret_key("OPENAI_API_KEY");
    let secret_value = "super-secret-value";

    let setting = set_setting_with_db(&database, "ui.layout".to_string(), json!("split"))?;
    let secret_status = secrets::set_secret_with_store(&store, &secret_key, secret_value)?;

    assert_eq!(secret_status, SecretStatus::Keychain);
    assert_eq!(
        list_settings_with_db(&database)?,
        vec![setting],
        "secret storage must not leak into public settings APIs"
    );

    let total_settings_rows =
        database.with_connection(|connection| -> Result<_, Box<dyn Error>> {
            Ok(
                connection.query_row("SELECT COUNT(*) FROM settings", [], |row| {
                    row.get::<_, i64>(0)
                })?,
            )
        })?;
    assert_eq!(
        total_settings_rows, 1,
        "secret operations must not add rows to the settings table"
    );

    // Verify the raw secret value is never stored in SQLite
    let raw_row_count = database.with_connection(|connection| -> Result<_, Box<dyn Error>> {
        Ok(connection.query_row(
            "SELECT COUNT(*) FROM settings WHERE value_json = ?1",
            [secret_value],
            |row| row.get::<_, i64>(0),
        )?)
    })?;
    assert_eq!(
        raw_row_count, 0,
        "SQLite must never store the raw secret value"
    );

    let raw_key_row_count =
        database.with_connection(|connection| -> Result<_, Box<dyn Error>> {
            Ok(connection.query_row(
                "SELECT COUNT(*) FROM settings WHERE key = ?1",
                [secret_key.as_str()],
                |row| row.get::<_, i64>(0),
            )?)
        })?;
    assert_eq!(
        raw_key_row_count, 0,
        "secret keys must not be written to SQLite"
    );

    let cleared_status = secrets::clear_secret_with_store(&store, &secret_key)?;
    assert_eq!(cleared_status, SecretStatus::Missing);

    let post_clear_row_count =
        database.with_connection(|connection| -> Result<_, Box<dyn Error>> {
            Ok(
                connection.query_row("SELECT COUNT(*) FROM settings", [], |row| {
                    row.get::<_, i64>(0)
                })?,
            )
        })?;
    assert_eq!(post_clear_row_count, 1);

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn secret_status_prefers_keychain_then_env_then_missing() -> Result<(), Box<dyn Error>> {
    let store = MemorySecretStore::default();
    let secret_key = unique_secret_key("ANTHROPIC_API_KEY");
    let _env_guard = EnvVarGuard::set(&secret_key, "env-secret");

    assert_eq!(
        secrets::get_secret_status_with_store(&store, &secret_key)?,
        SecretStatus::Env
    );
    assert_eq!(
        secrets::resolve_secret_value_with_store(&store, &secret_key)?,
        Some("env-secret".to_string())
    );

    secrets::set_secret_with_store(&store, &secret_key, "keychain-secret")?;

    assert_eq!(
        secrets::get_secret_status_with_store(&store, &secret_key)?,
        SecretStatus::Keychain
    );
    assert_eq!(
        secrets::resolve_secret_value_with_store(&store, &secret_key)?,
        Some("keychain-secret".to_string())
    );

    let cleared_status = secrets::clear_secret_with_store(&store, &secret_key)?;
    assert_eq!(cleared_status, SecretStatus::Env);
    assert_eq!(
        secrets::resolve_secret_value_with_store(&store, &secret_key)?,
        Some("env-secret".to_string())
    );

    drop(_env_guard);

    assert_eq!(
        secrets::get_secret_status_with_store(&store, &secret_key)?,
        SecretStatus::Missing
    );
    assert_eq!(
        secrets::resolve_secret_value_with_store(&store, &secret_key)?,
        None
    );

    Ok(())
}

#[derive(Default)]
struct MemorySecretStore {
    values: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemorySecretStore {
    fn set_secret(&self, key: &str, value: &str) -> AppResult<()> {
        self.values
            .lock()
            .expect("memory secret store mutex was poisoned")
            .insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn get_secret(&self, key: &str) -> AppResult<Option<String>> {
        Ok(self
            .values
            .lock()
            .expect("memory secret store mutex was poisoned")
            .get(key)
            .cloned())
    }

    fn clear_secret(&self, key: &str) -> AppResult<()> {
        self.values
            .lock()
            .expect("memory secret store mutex was poisoned")
            .remove(key);
        Ok(())
    }
}

struct EnvVarGuard {
    key: String,
}

impl EnvVarGuard {
    fn set(key: &str, value: &str) -> Self {
        #[allow(unused_unsafe)]
        unsafe {
            std::env::set_var(key, value);
        }

        Self {
            key: key.to_string(),
        }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        #[allow(unused_unsafe)]
        unsafe {
            std::env::remove_var(&self.key);
        }
    }
}

fn unique_secret_key(prefix: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_nanos();

    format!("{prefix}_{}_{}", std::process::id(), timestamp)
}

fn unique_temp_directory(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "dispatch-{label}-{}-{timestamp}",
        std::process::id()
    ));

    fs::create_dir_all(&path).expect("failed to create temp test directory");

    path
}

fn cleanup_database_artifacts(database_path: &Path) {
    for path in [
        database_path.to_path_buf(),
        database_path.with_extension("sqlite3-shm"),
        database_path.with_extension("sqlite3-wal"),
    ] {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    if let Some(parent) = database_path.parent() {
        let _ = fs::remove_dir_all(parent);
    }
}
