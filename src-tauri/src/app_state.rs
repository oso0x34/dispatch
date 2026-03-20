use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub struct AppState {
    booted_at_unix: u64,
}

impl Default for AppState {
    fn default() -> Self {
        let booted_at_unix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();

        Self { booted_at_unix }
    }
}

impl AppState {
    pub fn booted_at_unix(&self) -> u64 {
        self.booted_at_unix
    }
}
