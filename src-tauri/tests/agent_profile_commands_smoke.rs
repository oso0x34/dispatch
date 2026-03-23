use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{configure_app, db::Database};
use serde_json::{json, Value};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, INVOKE_KEY},
    webview::{InvokeRequest, WebviewWindowBuilder},
};

fn invoke_command(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: Value,
) -> Result<Value, Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost"
                .parse()
                .expect("failed to parse test invoke URL"),
            body: InvokeBody::from(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|response| {
        response
            .deserialize::<Value>()
            .expect("IPC payload should deserialize into JSON")
    })
}

#[test]
fn agent_profile_commands_list_registry_entries_and_mutate_profiles_over_ipc(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("agent-profile-commands");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Arc::new(Database::initialize_at(&database_path)?);
    let app = configure_app(mock_builder())
        .manage(database)
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch agent profile command test app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build Dispatch agent profile command test webview");

    let registry_entries = invoke_command(&webview, "list_agent_registry_entries", json!({}))
        .expect("list_agent_registry_entries should resolve successfully");
    let registry_entries = registry_entries
        .as_array()
        .expect("registry entries should be returned as an array");
    assert_eq!(registry_entries[0]["id"], "auto");
    assert_eq!(registry_entries[0]["selectionMode"], "auto");
    assert_eq!(registry_entries[1]["selectionMode"], "profile");

    let stored_profiles = invoke_command(&webview, "list_agent_profiles", json!({}))
        .expect("list_agent_profiles should resolve successfully");
    let stored_profiles = stored_profiles
        .as_array()
        .expect("stored profiles should be returned as an array");
    assert_eq!(stored_profiles.len(), 3);
    assert_eq!(stored_profiles[0]["args"][0]["kind"], "optional_prompt");
    assert_eq!(stored_profiles[1]["args"][0]["kind"], "optional_prompt");
    assert_eq!(stored_profiles[2]["args"][0]["kind"], "prompt");
    assert!(
        stored_profiles
            .iter()
            .all(|profile| profile.get("command").is_none()),
        "typed profile payloads must not expose a raw shell command template field"
    );

    let saved = invoke_command(
        &webview,
        "save_agent_profile",
        json!({
            "profile": {
                "id": "custom-reviewer",
                "name": "Custom Reviewer",
                "program": "codex",
                "args": [
                    { "kind": "literal", "value": "exec" },
                    { "kind": "prompt" }
                ],
                "env": {
                    "OPENAI_API_KEY": { "kind": "secret", "key": "OPENAI_API_KEY" }
                },
                "cwd": { "kind": "project_root" }
            }
        }),
    )
    .expect("save_agent_profile should resolve successfully");

    assert_eq!(saved["id"], "custom-reviewer");
    assert_eq!(saved["program"], "codex");
    assert_eq!(saved["args"][0]["kind"], "literal");
    assert_eq!(saved["args"][1]["kind"], "prompt");
    assert_eq!(saved["env"]["OPENAI_API_KEY"]["kind"], "secret");

    let fetched = invoke_command(
        &webview,
        "get_agent_profile",
        json!({ "profileId": "custom-reviewer" }),
    )
    .expect("get_agent_profile should resolve successfully");
    assert_eq!(fetched, saved);

    let deleted = invoke_command(
        &webview,
        "delete_agent_profile",
        json!({ "profileId": "custom-reviewer" }),
    )
    .expect("delete_agent_profile should resolve successfully");
    assert_eq!(deleted, json!(true));

    let reserved_id_error = invoke_command(
        &webview,
        "save_agent_profile",
        json!({
            "profile": {
                "id": "auto",
                "name": "Reserved",
                "program": "codex",
                "args": [{ "kind": "prompt" }],
                "env": {},
                "cwd": { "kind": "project_root" }
            }
        }),
    )
    .expect_err("reserved profile ids should be rejected");
    assert_eq!(reserved_id_error, json!("agent profile id is reserved"));

    drop(webview);
    drop(app);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

fn unique_temp_directory(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "dispatch-{label}-{}-{timestamp}",
        std::process::id()
    ));

    fs::create_dir_all(&path).expect("failed to create temp test directory");

    path
}

fn cleanup_database_artifacts(database_path: &Path) {
    for path in [
        database_path.to_path_buf(),
        database_path.with_extension("sqlite3-shm"),
        database_path.with_extension("sqlite3-wal"),
    ] {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    if let Some(parent) = database_path.parent() {
        let _ = fs::remove_dir_all(parent);
    }
}
