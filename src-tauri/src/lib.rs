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
  logging::init();

  tauri::Builder::default()
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![health])
    .run(tauri::generate_context!())
    .expect("error while running Dispatch");
}
