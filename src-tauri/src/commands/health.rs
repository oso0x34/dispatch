use serde::Serialize;

use crate::app_state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthPayload {
    pub status: &'static str,
    pub app_name: String,
    pub app_version: String,
    pub booted_at_unix: u64,
    pub log_directory: Option<String>,
    pub active_log_path: Option<String>,
    pub session_logs_directory: Option<String>,
    pub stale_sessions_abandoned_at_boot: usize,
}

#[tauri::command]
pub fn health<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> HealthPayload {
    let runtime_debug = state.runtime_debug_snapshot();

    HealthPayload {
        status: "ok",
        app_name: app.package_info().name.to_string(),
        app_version: app.package_info().version.to_string(),
        booted_at_unix: state.booted_at_unix(),
        log_directory: runtime_debug
            .log_directory
            .map(|path| path.display().to_string()),
        active_log_path: runtime_debug
            .active_log_path
            .map(|path| path.display().to_string()),
        session_logs_directory: runtime_debug
            .session_logs_directory
            .map(|path| path.display().to_string()),
        stale_sessions_abandoned_at_boot: runtime_debug.stale_sessions_abandoned_at_boot,
    }
}
