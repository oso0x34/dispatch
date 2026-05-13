use std::sync::Arc;

mod app_state;
pub mod commands;
pub mod db;
pub mod error;
pub mod logging;
pub mod models;
pub mod services;

pub use app_state::{AppState, RuntimeDebugSnapshot};

use tauri::Manager;

use commands::{
    agent_profiles::{
        delete_agent_profile, get_agent_profile, list_agent_profiles, list_agent_registry_entries,
        save_agent_profile,
    },
    dispatch::dispatch_agent,
    files::{
        list_project_tree, read_project_file, search_project_content, search_project_paths,
        start_project_file_watch, stop_project_file_watch,
    },
    health::health,
    history::{
        create_manual_save_point, get_project_save_point_diff, latest_project_save_point,
        list_project_save_points, restore_project_save_point, restore_project_save_point_file,
    },
    notifications::send_notification_preview,
    openclaw::{
        connect_openclaw, disconnect_openclaw, dispatch_openclaw_session,
        get_openclaw_chat_snapshot, get_openclaw_sidebar_snapshot, get_openclaw_status,
        kill_openclaw_session, list_openclaw_sessions, send_openclaw_chat_message,
        send_openclaw_message, spawn_openclaw_session,
    },
    projects::{create_project, delete_project, get_project, list_projects},
    settings::{
        clear_secret, get_secret_status, get_setting, list_settings, set_secret, set_setting,
    },
    tasks::{create_task, delete_task, list_tasks, update_task},
    terminal::{create_terminal_session, get_terminal_workspace, terminate_terminal_session},
    window::{hide_main_window, is_main_window_visible, show_main_window},
};
use db::Database;
use services::{
    file_watch::FileWatchService,
    openclaw::{OpenClawChatService, OpenClawClient},
    pty_manager::PtyManager,
    review_router::ReviewRouterService,
    session_supervisor, terminal_ws,
    tray::TrayService,
};

pub fn configure_app<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .manage(Arc::new(FileWatchService::default()))
        .manage(Arc::new(OpenClawChatService::default()))
        .manage(Arc::new(OpenClawClient::default()))
        .manage(Arc::new(ReviewRouterService::default()))
        .manage(Arc::new(PtyManager::default()))
        .manage(Arc::new(TrayService::default()))
        .on_window_event(|window, event| {
            let tray_service = window.state::<Arc<TrayService>>().inner().clone();
            if let Err(error) = services::tray::handle_main_window_event(tray_service.as_ref(), window, event) {
                tracing::error!(window = %window.label(), error = %error, "window lifecycle handler failed");
            }
        })
        .invoke_handler(tauri::generate_handler![
            health,
            list_agent_profiles,
            list_agent_registry_entries,
            get_agent_profile,
            save_agent_profile,
            delete_agent_profile,
            dispatch_agent,
            list_project_tree,
            read_project_file,
            search_project_paths,
            search_project_content,
            start_project_file_watch,
            stop_project_file_watch,
            list_project_save_points,
            latest_project_save_point,
            create_manual_save_point,
            get_project_save_point_diff,
            restore_project_save_point,
            restore_project_save_point_file,
            send_notification_preview,
            connect_openclaw,
            disconnect_openclaw,
            get_openclaw_status,
            get_openclaw_sidebar_snapshot,
            get_openclaw_chat_snapshot,
            list_openclaw_sessions,
            dispatch_openclaw_session,
            spawn_openclaw_session,
            send_openclaw_chat_message,
            send_openclaw_message,
            kill_openclaw_session,
            create_project,
            list_projects,
            get_project,
            delete_project,
            list_tasks,
            create_task,
            update_task,
            delete_task,
            get_setting,
            set_setting,
            list_settings,
            set_secret,
            get_secret_status,
            clear_secret,
            show_main_window,
            hide_main_window,
            is_main_window_visible,
            get_terminal_workspace,
            create_terminal_session,
            terminate_terminal_session
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_app(
        tauri::Builder::default().plugin(tauri_plugin_global_shortcut::Builder::new().build()),
    )
    .setup(|app| {
        let logging_state = logging::init(app.handle())?;
        error::install_panic_hook(logging_state.log_directory().to_path_buf())?;
        let database = Arc::new(Database::initialize_for_app(app.handle())?);
        let pty_manager = app.state::<Arc<PtyManager>>().inner().clone();
        let openclaw_client = app.state::<Arc<OpenClawClient>>().inner().clone();
        let openclaw_chat = app.state::<Arc<OpenClawChatService>>().inner().clone();
        let review_router = app.state::<Arc<ReviewRouterService>>().inner().clone();
        let tray_service = app.state::<Arc<TrayService>>().inner().clone();
        let session_supervisor =
            session_supervisor::SessionSupervisor::initialize(logging_state.log_directory())?;

        let abandoned_sessions =
            session_supervisor::abandon_stale_running_sessions(database.as_ref())?;
        if abandoned_sessions > 0 {
            tracing::warn!(
                abandoned_sessions,
                "marked stale running terminal sessions as abandoned"
            );
        }

        app.state::<AppState>()
            .configure_runtime_debug(RuntimeDebugSnapshot {
                log_directory: Some(logging_state.log_directory().to_path_buf()),
                active_log_path: Some(logging_state.active_log_path().to_path_buf()),
                session_logs_directory: Some(session_supervisor.session_logs_dir().to_path_buf()),
                stale_sessions_abandoned_at_boot: abandoned_sessions,
            });

        pty_manager.configure_ui(app.handle().clone())?;
        pty_manager.configure_supervision(
            database.clone(),
            Arc::downgrade(&pty_manager),
            session_supervisor.session_logs_dir().to_path_buf(),
        )?;
        pty_manager.configure_review_routing(openclaw_client, openclaw_chat, review_router)?;

        tray_service.build(app.handle())?;
        services::tray::refresh_running_session_tooltip(app.handle(), database.as_ref())?;

        app.manage(logging_state);
        app.manage(database.clone());
        app.manage(terminal_ws::spawn_terminal_ws_server(
            database,
            pty_manager,
        )?);

        Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running Dispatch");
}
