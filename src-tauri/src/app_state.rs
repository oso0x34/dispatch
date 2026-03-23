use std::{
    path::PathBuf,
    sync::RwLock,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Default)]
pub struct RuntimeDebugSnapshot {
    pub log_directory: Option<PathBuf>,
    pub active_log_path: Option<PathBuf>,
    pub session_logs_directory: Option<PathBuf>,
    pub stale_sessions_abandoned_at_boot: usize,
}

#[derive(Debug)]
pub struct AppState {
    booted_at_unix: u64,
    runtime_debug: RwLock<RuntimeDebugSnapshot>,
}

impl Default for AppState {
    fn default() -> Self {
        let booted_at_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();

        Self {
            booted_at_unix,
            runtime_debug: RwLock::new(RuntimeDebugSnapshot::default()),
        }
    }
}

impl AppState {
    pub fn booted_at_unix(&self) -> u64 {
        self.booted_at_unix
    }

    pub fn configure_runtime_debug(&self, snapshot: RuntimeDebugSnapshot) {
        let mut runtime_debug = self
            .runtime_debug
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        *runtime_debug = snapshot;
    }

    pub fn runtime_debug_snapshot(&self) -> RuntimeDebugSnapshot {
        self.runtime_debug
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}
