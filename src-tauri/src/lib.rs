mod app_state;
mod commands;
pub mod db;
pub mod error;
pub mod logging;
pub mod models;
pub mod services;

pub use app_state::AppState;

use commands::health::health;

pub fn configure_app<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![health])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_app(tauri::Builder::default())
        .setup(|app| {
            let logging_state = logging::init(&app.handle())?;
            error::install_panic_hook(logging_state.log_directory().to_path_buf())?;
            app.manage(logging_state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Dispatch");
}
