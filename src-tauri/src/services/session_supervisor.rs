use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::params;

use crate::{
    db::Database,
    error::{AppError, AppResult},
};

const SESSION_LOGS_DIRECTORY_NAME: &str = "sessions";

#[derive(Debug, Clone)]
pub struct SessionSupervisor {
    session_logs_dir: PathBuf,
}

impl SessionSupervisor {
    pub fn initialize(app_log_dir: impl AsRef<Path>) -> AppResult<Self> {
        let session_logs_dir = app_log_dir.as_ref().join(SESSION_LOGS_DIRECTORY_NAME);
        fs::create_dir_all(&session_logs_dir).map_err(|error| {
            AppError::new(format!(
                "failed to create terminal session log directory {}: {error}",
                session_logs_dir.display()
            ))
        })?;

        Ok(Self { session_logs_dir })
    }

    pub fn session_logs_dir(&self) -> &Path {
        &self.session_logs_dir
    }

    pub fn session_log_path(&self, session_id: &str) -> PathBuf {
        self.session_logs_dir.join(format!("{session_id}.log"))
    }
}

pub fn abandon_stale_running_sessions(database: &Database) -> AppResult<usize> {
    let now = now_unix_seconds();

    database.with_connection(|connection| {
        let updated = connection.execute(
            "
            UPDATE agent_sessions
            SET
                status = 'abandoned',
                ended_at = COALESCE(ended_at, ?1),
                updated_at = ?1
            WHERE status = 'running'
            ",
            params![now],
        )?;

        Ok(updated)
    })
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
