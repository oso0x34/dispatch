mod app_state;
pub mod commands;
pub mod db;
pub mod error;
pub mod logging;
pub mod models;
pub mod services;

pub use app_state::AppState;

use tauri::Manager;

use commands::{
    health::health,
    projects::{create_project, delete_project, get_project, list_projects},
};
use db::Database;

pub fn configure_app<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            health,
            create_project,
            list_projects,
            get_project,
            delete_project
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_app(tauri::Builder::default())
        .setup(|app| {
            let logging_state = logging::init(&app.handle())?;
            error::install_panic_hook(logging_state.log_directory().to_path_buf())?;
            let database = Database::initialize_for_app(&app.handle())?;

            app.manage(logging_state);
            app.manage(database);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Dispatch");
}
