mod app_state;
mod commands;
pub mod db;
pub mod error;
pub mod logging;
pub mod models;
pub mod services;

use app_state::AppState;
use commands::health::health;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .setup(|app| {
            let logging_state = logging::init(&app.handle())?;
            error::install_panic_hook(logging_state.log_directory().to_path_buf())?;
            app.manage(logging_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![health])
        .run(tauri::generate_context!())
        .expect("error while running Dispatch");
}
