use std::time::{SystemTime, UNIX_EPOCH};

use dispatch_lib::{configure_app, AppState};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, INVOKE_KEY},
    webview::{InvokeRequest, WebviewWindowBuilder},
    Manager,
};

fn build_app() -> tauri::App<tauri::test::MockRuntime> {
    configure_app(mock_builder())
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch smoke app")
}

#[test]
fn app_boots_with_managed_app_state() {
    let app = build_app();
    let booted_at_unix = app.state::<AppState>().booted_at_unix();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_secs();

    assert!(
        booted_at_unix > 0,
        "managed app state should record a non-zero boot timestamp"
    );
    assert!(
        booted_at_unix <= now,
        "managed app state should not report a boot time in the future"
    );
}

#[test]
fn health_command_returns_boot_health_payload() {
    let app = build_app();
    let booted_at_unix = app.state::<AppState>().booted_at_unix();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build Dispatch smoke webview");

    let response = get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: "health".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost"
                .parse()
                .expect("failed to parse test invoke URL"),
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .expect("health command should resolve successfully");

    let payload = response
        .deserialize::<serde_json::Value>()
        .expect("health payload should deserialize into JSON");

    assert_eq!(payload["status"], "ok");
    assert_eq!(payload["appName"], "Dispatch");
    assert_eq!(payload["appVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(payload["bootedAtUnix"], booted_at_unix);
}
