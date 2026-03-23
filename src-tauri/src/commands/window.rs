use tauri::AppHandle;

use crate::{error::AppError, services::tray};

type CommandResult<T> = Result<T, String>;

fn window_command_error_message(error: AppError) -> String {
    let message = error.message();

    if matches!(message, "main window is unavailable") {
        return message.to_string();
    }

    "window command failed".to_string()
}

#[tauri::command]
pub fn show_main_window<R: tauri::Runtime>(app: AppHandle<R>) -> CommandResult<bool> {
    tray::reveal_main_window(&app)
        .and_then(|_| tray::main_window_visible(&app))
        .map_err(window_command_error_message)
}

#[tauri::command]
pub fn hide_main_window<R: tauri::Runtime>(app: AppHandle<R>) -> CommandResult<bool> {
    tray::hide_main_window(&app)
        .and_then(|_| tray::main_window_visible(&app))
        .map_err(window_command_error_message)
}

#[tauri::command]
pub fn is_main_window_visible<R: tauri::Runtime>(app: AppHandle<R>) -> CommandResult<bool> {
    tray::main_window_visible(&app).map_err(window_command_error_message)
}
