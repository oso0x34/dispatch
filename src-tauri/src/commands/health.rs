use serde::Serialize;

use crate::app_state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthPayload {
    pub status: &'static str,
    pub app_name: String,
    pub app_version: String,
    pub booted_at_unix: u64,
}

#[tauri::command]
pub fn health<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> HealthPayload {
    HealthPayload {
        status: "ok",
        app_name: app.package_info().name.to_string(),
        app_version: app.package_info().version.to_string(),
        booted_at_unix: state.booted_at_unix(),
    }
}
