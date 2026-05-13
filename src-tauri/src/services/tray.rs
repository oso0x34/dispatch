use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::OptionalExtension;
use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, WebviewWindow, Window, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

use crate::services::review_router::ReviewRouteOutcome;
use crate::{
    db::Database,
    error::{AppError, AppResult},
    services::pty_manager::{self, CreateShellSessionRequest, PtyManager},
};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const TRAY_ICON_ID: &str = "dispatch-tray";
pub const TRAY_MENU_SHOW_ID: &str = "dispatch.tray.show";
pub const TRAY_MENU_NEW_TERMINAL_ID: &str = "dispatch.tray.new-terminal";
pub const TRAY_MENU_QUIT_ID: &str = "dispatch.tray.quit";
const ACTIVE_PROJECT_SETTING_KEY: &str = "app.active_project_id";

pub struct TrayService {
    quitting: AtomicBool,
}

impl Default for TrayService {
    fn default() -> Self {
        Self {
            quitting: AtomicBool::new(false),
        }
    }
}

impl TrayService {
    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    pub fn mark_quitting(&self) {
        self.quitting.store(true, Ordering::SeqCst);
    }

    pub fn build<R: Runtime>(&self, app: &AppHandle<R>) -> AppResult<()> {
        if app.tray_by_id(TRAY_ICON_ID).is_some() {
            return Ok(());
        }

        let show_item = MenuItemBuilder::with_id(TRAY_MENU_SHOW_ID, "Show")
            .build(app)
            .map_err(|error| AppError::new(format!("failed to build tray Show item: {error}")))?;
        let new_terminal_item = MenuItemBuilder::with_id(TRAY_MENU_NEW_TERMINAL_ID, "New Terminal")
            .build(app)
            .map_err(|error| {
                AppError::new(format!("failed to build tray New Terminal item: {error}"))
            })?;
        let quit_item = MenuItemBuilder::with_id(TRAY_MENU_QUIT_ID, "Quit")
            .build(app)
            .map_err(|error| AppError::new(format!("failed to build tray Quit item: {error}")))?;
        let separator = PredefinedMenuItem::separator(app)
            .map_err(|error| AppError::new(format!("failed to build tray separator: {error}")))?;
        let menu = Menu::new(app)
            .map_err(|error| AppError::new(format!("failed to create tray menu: {error}")))?;
        menu.append(&show_item)
            .map_err(|error| AppError::new(format!("failed to append tray Show item: {error}")))?;
        menu.append(&new_terminal_item).map_err(|error| {
            AppError::new(format!("failed to append tray New Terminal item: {error}"))
        })?;
        menu.append(&separator)
            .map_err(|error| AppError::new(format!("failed to append tray separator: {error}")))?;
        menu.append(&quit_item)
            .map_err(|error| AppError::new(format!("failed to append tray Quit item: {error}")))?;

        let icon = app
            .default_window_icon()
            .cloned()
            .ok_or_else(|| AppError::new("default window icon is not configured"))?;

        TrayIconBuilder::with_id(TRAY_ICON_ID)
            .menu(&menu)
            .icon(icon)
            .tooltip(format_running_sessions_tooltip(0))
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| {
                let tray_service = app.state::<std::sync::Arc<TrayService>>().inner().clone();
                let database = app.state::<std::sync::Arc<Database>>().inner().clone();
                let pty_manager = app.state::<std::sync::Arc<PtyManager>>().inner().clone();

                if let Err(error) = tray_service.handle_menu_event(app, database.as_ref(), pty_manager.as_ref(), event.id()) {
                    tracing::error!(
                        menu_id = %event.id().as_ref(),
                        error = %error,
                        "tray menu action failed"
                    );
                }
            })
            .on_tray_icon_event(|tray, event| {
                if matches!(event, TrayIconEvent::Click { .. }) {
                    let app = tray.app_handle();
                    if let Err(error) = reveal_main_window(app) {
                        tracing::error!(error = %error, "tray click could not reveal the main window");
                    }
                }
            })
            .build(app)
            .map_err(|error| AppError::new(format!("failed to build tray icon: {error}")))?;

        Ok(())
    }

    pub fn handle_menu_event<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        database: &Database,
        pty_manager: &PtyManager,
        menu_id: &tauri::menu::MenuId,
    ) -> AppResult<()> {
        if menu_id == TRAY_MENU_SHOW_ID {
            return reveal_main_window(app);
        }

        if menu_id == TRAY_MENU_NEW_TERMINAL_ID {
            return create_new_terminal_from_tray(app, database, pty_manager);
        }

        if menu_id == TRAY_MENU_QUIT_ID {
            self.mark_quitting();
            app.exit(0);
        }

        Ok(())
    }
}

pub fn handle_main_window_event<R: Runtime>(
    tray_service: &TrayService,
    window: &Window<R>,
    event: &WindowEvent,
) -> AppResult<()> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Ok(());
    }

    if tray_service.is_quitting() {
        return Ok(());
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        window
            .hide()
            .map_err(|error| AppError::new(format!("failed to hide window to tray: {error}")))?;
    }

    Ok(())
}

pub fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    let window = main_window(app)?;

    if window.is_minimized().map_err(|error| {
        AppError::new(format!("failed to inspect window minimized state: {error}"))
    })? {
        window
            .unminimize()
            .map_err(|error| AppError::new(format!("failed to unminimize window: {error}")))?;
    }

    window
        .show()
        .map_err(|error| AppError::new(format!("failed to show main window: {error}")))?;
    window
        .set_focus()
        .map_err(|error| AppError::new(format!("failed to focus main window: {error}")))?;

    Ok(())
}

pub fn hide_main_window<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    main_window(app)?
        .hide()
        .map_err(|error| AppError::new(format!("failed to hide main window: {error}")))
}

pub fn main_window_visible<R: Runtime>(app: &AppHandle<R>) -> AppResult<bool> {
    main_window(app)?.is_visible().map_err(|error| {
        AppError::new(format!("failed to inspect main window visibility: {error}"))
    })
}

pub fn refresh_running_session_tooltip<R: Runtime>(
    app: &AppHandle<R>,
    database: &Database,
) -> AppResult<()> {
    let Some(tray) = app.tray_by_id(TRAY_ICON_ID) else {
        return Ok(());
    };

    let running_session_count = count_running_sessions(database)?;
    tray.set_tooltip(Some(format_running_sessions_tooltip(running_session_count)))
        .map_err(|error| AppError::new(format!("failed to update tray tooltip: {error}")))
}

pub fn show_notification<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) -> AppResult<()> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| AppError::new(format!("failed to send notification: {error}")))
}

pub fn notify_task_status<R: Runtime>(
    app: &AppHandle<R>,
    database: &Database,
    project_id: &str,
    task_id: &str,
    status: &str,
) -> AppResult<()> {
    let Some((title, body)) =
        build_task_status_notification(database, project_id, task_id, status)?
    else {
        return Ok(());
    };

    show_notification(app, &title, &body)
}

pub fn notify_review_outcome<R: Runtime>(
    app: &AppHandle<R>,
    database: &Database,
    session_id: &str,
    outcome: &ReviewRouteOutcome,
) -> AppResult<()> {
    let Some(task_title) = load_task_title_by_session_id(database, session_id)? else {
        return Ok(());
    };

    let Some((decision_label, completed)) = review_outcome_label(outcome) else {
        return Ok(());
    };

    let (review_title, review_body) =
        build_review_complete_notification(&task_title, decision_label);
    show_notification(app, &review_title, &review_body)?;

    if completed {
        let (title, body) = build_task_completed_notification(&task_title);
        show_notification(app, &title, &body)?;
    }

    Ok(())
}

pub fn notify_review_complete<R: Runtime>(
    app: &AppHandle<R>,
    task_title: &str,
    decision_label: &str,
) -> AppResult<()> {
    let (title, body) = build_review_complete_notification(task_title, decision_label);
    show_notification(app, &title, &body)
}

fn create_new_terminal_from_tray<R: Runtime>(
    app: &AppHandle<R>,
    database: &Database,
    pty_manager: &PtyManager,
) -> AppResult<()> {
    let Some(project_id) = load_active_project_id(database)? else {
        let _ = reveal_main_window(app);
        let _ = show_notification(
            app,
            "Dispatch needs an active project",
            "Select a project before opening a new terminal from the tray.",
        );
        return Ok(());
    };

    pty_manager::create_shell_session(
        database,
        pty_manager,
        CreateShellSessionRequest {
            project_id,
            task_id: None,
            shell: None,
        },
    )?;

    reveal_main_window(app)
}

fn main_window<R: Runtime>(app: &AppHandle<R>) -> AppResult<WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::new("main window is unavailable"))
}

fn load_active_project_id(database: &Database) -> AppResult<Option<String>> {
    database.with_connection(|connection| {
        let value_json = connection
            .query_row(
                "SELECT value_json FROM settings WHERE key = ?1",
                [ACTIVE_PROJECT_SETTING_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        match value_json {
            Some(value_json) => parse_active_project_id(&value_json),
            None => Ok(None),
        }
    })
}

fn parse_active_project_id(value_json: &str) -> AppResult<Option<String>> {
    let value: Value = serde_json::from_str(value_json).map_err(|error| {
        AppError::new(format!(
            "failed to deserialize active project setting: {error}"
        ))
    })?;
    Ok(value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string))
}

fn count_running_sessions(database: &Database) -> AppResult<usize> {
    database.with_connection(|connection| {
        let count = connection.query_row(
            "SELECT COUNT(*) FROM agent_sessions WHERE status = 'running'",
            [],
            |row| row.get::<_, i64>(0),
        )?;

        Ok(usize::try_from(count).unwrap_or_default())
    })
}

fn format_running_sessions_tooltip(running_sessions: usize) -> String {
    if running_sessions == 1 {
        return "Dispatch · 1 running session".to_string();
    }

    format!("Dispatch · {running_sessions} running sessions")
}

fn build_task_status_notification(
    database: &Database,
    project_id: &str,
    task_id: &str,
    status: &str,
) -> AppResult<Option<(String, String)>> {
    let task_title =
        load_task_title(database, project_id, task_id)?.unwrap_or_else(|| task_id.to_string());

    let notification = match status {
        "failed" => Some((
            "Task failed".to_string(),
            format!("{task_title} exited with a failure status."),
        )),
        _ => None,
    };

    Ok(notification)
}

fn build_review_complete_notification(task_title: &str, decision_label: &str) -> (String, String) {
    (
        "Review complete".to_string(),
        format!("{task_title}: {decision_label}"),
    )
}

fn build_task_completed_notification(task_title: &str) -> (String, String) {
    (
        "Task completed".to_string(),
        format!("{task_title} passed review and is complete."),
    )
}

fn review_outcome_label(outcome: &ReviewRouteOutcome) -> Option<(&'static str, bool)> {
    match outcome {
        ReviewRouteOutcome::Passed => Some(("PASS", true)),
        ReviewRouteOutcome::Failed => Some(("FAIL", false)),
        _ => None,
    }
}

fn load_task_title(
    database: &Database,
    project_id: &str,
    task_id: &str,
) -> AppResult<Option<String>> {
    database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT title FROM tasks WHERE project_id = ?1 AND id = ?2",
                [project_id, task_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(Into::into)
    })
}

fn load_task_title_by_session_id(
    database: &Database,
    session_id: &str,
) -> AppResult<Option<String>> {
    database.with_connection(|connection| {
        connection
            .query_row(
                "
                SELECT title
                FROM tasks
                WHERE last_session_id = ?1
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                ",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(Into::into)
    })
}

#[cfg(test)]
mod tests {
    use crate::services::review_router::ReviewRouteOutcome;

    use super::{
        build_review_complete_notification, build_task_completed_notification,
        build_task_status_notification, format_running_sessions_tooltip, parse_active_project_id,
        review_outcome_label,
    };

    #[test]
    fn active_project_setting_parser_accepts_trimmed_strings() {
        let project_id = parse_active_project_id("\" project-alpha \"")
            .expect("setting value should deserialize");
        assert_eq!(project_id.as_deref(), Some("project-alpha"));
    }

    #[test]
    fn active_project_setting_parser_ignores_null_values() {
        let project_id = parse_active_project_id("null").expect("null should deserialize");
        assert_eq!(project_id, None);
    }

    #[test]
    fn running_session_tooltip_formats_plural_counts() {
        assert_eq!(
            format_running_sessions_tooltip(0),
            "Dispatch · 0 running sessions"
        );
        assert_eq!(
            format_running_sessions_tooltip(1),
            "Dispatch · 1 running session"
        );
        assert_eq!(
            format_running_sessions_tooltip(2),
            "Dispatch · 2 running sessions"
        );
    }

    #[test]
    fn review_outcome_labels_only_notify_for_terminal_review_results() {
        assert_eq!(
            review_outcome_label(&ReviewRouteOutcome::Passed),
            Some(("PASS", true))
        );
        assert_eq!(
            review_outcome_label(&ReviewRouteOutcome::Failed),
            Some(("FAIL", false))
        );
        assert_eq!(review_outcome_label(&ReviewRouteOutcome::Ignored), None);
    }

    #[test]
    fn review_complete_notification_format_matches_task_title_and_decision() {
        assert_eq!(
            build_review_complete_notification("Inbox sync", "PASS"),
            (
                "Review complete".to_string(),
                "Inbox sync: PASS".to_string()
            )
        );
    }

    #[test]
    fn task_completed_notification_mentions_review_pass() {
        assert_eq!(
            build_task_completed_notification("Inbox sync"),
            (
                "Task completed".to_string(),
                "Inbox sync passed review and is complete.".to_string()
            )
        );
    }

    #[test]
    fn task_status_notification_ignores_success_ready_for_review_transitions() {
        let database = crate::db::Database::initialize_at(std::env::temp_dir().join(format!(
                "dispatch-tray-test-{}-{}.sqlite3",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("system clock should be after unix epoch")
                    .as_nanos()
            )))
        .expect("database should initialize");

        let notification =
            build_task_status_notification(&database, "project", "task", "succeeded")
                .expect("notification lookup should succeed");
        assert_eq!(notification, None);
    }
}
