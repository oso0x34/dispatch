mod migrate;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use rusqlite::Connection;
use tauri::{Manager, Runtime};

use crate::error::{AppError, AppResult};

const DATABASE_FILE_NAME: &str = "dispatch.sqlite3";
const JOURNAL_SIZE_LIMIT_BYTES: i64 = 67_108_864;

pub struct Database {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl Database {
    pub fn initialize_for_app<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> AppResult<Self> {
        let app_data_dir = app_handle.path().app_data_dir().map_err(|error| {
            AppError::new(format!("failed to resolve app data directory: {error}"))
        })?;

        Self::initialize_at(app_data_dir.join(DATABASE_FILE_NAME))
    }

    pub fn initialize_at(database_path: impl AsRef<Path>) -> AppResult<Self> {
        let path = database_path.as_ref().to_path_buf();

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                AppError::new(format!(
                    "failed to create database directory {}: {error}",
                    parent.display()
                ))
            })?;
        }

        let mut connection = Connection::open(&path).map_err(|error| {
            AppError::new(format!(
                "failed to open SQLite database {}: {error}",
                path.display()
            ))
        })?;

        configure_connection(&connection)?;
        let applied_migrations = migrate::run_pending_migrations(&mut connection)?;

        tracing::info!(
            database_path = %path.display(),
            applied_migrations = ?applied_migrations,
            "dispatch database initialized"
        );

        Ok(Self {
            path,
            connection: Mutex::new(connection),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn with_connection<T, E>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, E>,
    ) -> Result<T, E>
    where
        E: From<AppError>,
    {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| E::from(AppError::new("database connection mutex was poisoned")))?;

        f(&mut guard)
    }
}

fn configure_connection(connection: &Connection) -> AppResult<()> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "journal_size_limit", JOURNAL_SIZE_LIMIT_BYTES)?;

    Ok(())
}
