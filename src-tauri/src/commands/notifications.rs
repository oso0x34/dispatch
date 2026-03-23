use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{error::AppError, services::tray};

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPreviewInput {
    pub title: String,
    pub body: String,
}

fn notification_command_error_message(error: AppError) -> String {
    let message = error.message();

    if matches!(
        message,
        "notification title cannot be blank" | "notification body cannot be blank"
    ) {
        return message.to_string();
    }

    "notification command failed".to_string()
}

fn normalize_preview_input(
    input: NotificationPreviewInput,
) -> Result<NotificationPreviewInput, AppError> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::new("notification title cannot be blank"));
    }

    let body = input.body.trim();
    if body.is_empty() {
        return Err(AppError::new("notification body cannot be blank"));
    }

    Ok(NotificationPreviewInput {
        title: title.to_string(),
        body: body.to_string(),
    })
}

#[tauri::command]
pub fn send_notification_preview<R: tauri::Runtime>(
    app: AppHandle<R>,
    input: NotificationPreviewInput,
) -> CommandResult<bool> {
    let input = normalize_preview_input(input).map_err(notification_command_error_message)?;
    tray::show_notification(&app, &input.title, &input.body)
        .map(|_| true)
        .map_err(notification_command_error_message)
}

#[cfg(test)]
mod tests {
    use super::{normalize_preview_input, NotificationPreviewInput};

    #[test]
    fn notification_preview_rejects_blank_title() {
        let error = normalize_preview_input(NotificationPreviewInput {
            title: "   ".to_string(),
            body: "Hello".to_string(),
        })
        .expect_err("blank titles should be rejected");
        assert_eq!(error.message(), "notification title cannot be blank");
    }

    #[test]
    fn notification_preview_rejects_blank_body() {
        let error = normalize_preview_input(NotificationPreviewInput {
            title: "Dispatch".to_string(),
            body: "   ".to_string(),
        })
        .expect_err("blank bodies should be rejected");
        assert_eq!(error.message(), "notification body cannot be blank");
    }
}
