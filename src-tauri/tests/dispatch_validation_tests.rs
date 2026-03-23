use std::{
    collections::BTreeMap,
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    db::Database,
    error::AppError,
    models::{AgentArg, AgentCwd, AgentEnvValue},
    services::{
        agent_registry::{save_agent_profile, SaveAgentProfileInput, AUTO_AGENT_PROFILE_ID},
        dispatch::{resolve_dispatch_launch, DispatchAgentRequest},
        project_registry,
    },
};
use rusqlite::params;

#[test]
fn resolve_dispatch_launch_builds_a_final_argv_vector_without_shell_parsing(
) -> Result<(), Box<dyn Error>> {
    let _env_lock = env_lock().lock().expect("env lock should not be poisoned");
    let temp_root = unique_temp_directory("dispatch-validation-argv");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_root = temp_root.join("workspace");

    fs::create_dir_all(&workspace_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace_root)?;
    let task_id = "task-dispatch-resolution";
    let task_title = "Ship release $(rm -rf /)";
    let task_body = "Line one\n\"quoted\"\n$(touch nope)";
    insert_task(&database, &project.id, task_id, task_title, task_body)?;

    let inherit_key = unique_env_key("DISPATCH_INHERIT");
    let secret_key = unique_env_key("DISPATCH_SECRET");
    let _inherit_env = ScopedEnvVar::set(&inherit_key, "inherit-value");
    let _secret_env = ScopedEnvVar::set(&secret_key, "secret-value");

    let mut env = BTreeMap::new();
    env.insert(
        "INHERITED_TOKEN".to_string(),
        AgentEnvValue::Inherit {
            key: inherit_key.clone(),
        },
    );
    env.insert(
        "SECRET_TOKEN".to_string(),
        AgentEnvValue::Secret {
            key: secret_key.clone(),
        },
    );
    env.insert(
        "STATIC_FLAG".to_string(),
        AgentEnvValue::Literal {
            value: "literal-value".to_string(),
        },
    );

    save_profile(
        &database,
        "structured-dispatch",
        vec![
            AgentArg::Literal {
                value: "exec".to_string(),
            },
            AgentArg::Prompt,
            AgentArg::Literal {
                value: "--project".to_string(),
            },
            AgentArg::ProjectPath,
            AgentArg::Literal {
                value: "--task-title".to_string(),
            },
            AgentArg::TaskTitle,
            AgentArg::Literal {
                value: "--task-body".to_string(),
            },
            AgentArg::TaskBody,
            AgentArg::Literal {
                value: "\"$(rm -rf /)\"; echo injected".to_string(),
            },
        ],
        env,
    )?;

    let prompt = "  ship it \"now\"\n$(touch nope)  ";
    let launch = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "structured-dispatch".to_string(),
            task_id: Some(task_id.to_string()),
            prompt: Some(prompt.to_string()),
        },
    )?;

    assert_eq!(launch.profile_id, "structured-dispatch");
    assert_eq!(launch.program, "codex");
    assert_eq!(launch.cwd, PathBuf::from(&project.root_path));
    assert_eq!(
        launch.args,
        vec![
            "exec".to_string(),
            prompt.to_string(),
            "--project".to_string(),
            project.root_path.clone(),
            "--task-title".to_string(),
            task_title.to_string(),
            "--task-body".to_string(),
            task_body.to_string(),
            "\"$(rm -rf /)\"; echo injected".to_string(),
        ]
    );

    let resolved_env = launch.env.into_iter().collect::<BTreeMap<_, _>>();
    assert_eq!(
        resolved_env.get("INHERITED_TOKEN"),
        Some(&"inherit-value".to_string())
    );
    assert_eq!(
        resolved_env.get("SECRET_TOKEN"),
        Some(&"secret-value".to_string())
    );
    assert_eq!(
        resolved_env.get("STATIC_FLAG"),
        Some(&"literal-value".to_string())
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn resolve_dispatch_launch_rejects_missing_and_blank_prompt_values() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("dispatch-validation-prompt");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_root = temp_root.join("workspace");

    fs::create_dir_all(&workspace_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace_root)?;

    save_profile(
        &database,
        "prompt-required",
        vec![AgentArg::Prompt],
        BTreeMap::new(),
    )?;

    for prompt in [None, Some(String::new()), Some("  \n\t  ".to_string())] {
        let error = resolve_dispatch_launch(
            &database,
            &DispatchAgentRequest {
                project_id: project.id.clone(),
                profile_id: "prompt-required".to_string(),
                task_id: None,
                prompt,
            },
        )
        .expect_err("prompt placeholder should reject missing and blank values");
        assert_eq!(error.message(), "dispatch prompt is required");
    }

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn resolve_dispatch_launch_allows_missing_prompt_for_seeded_native_cli_profiles(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("dispatch-validation-native-cli-defaults");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_root = temp_root.join("workspace");

    fs::create_dir_all(&workspace_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace_root)?;

    let codex_launch = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "codex".to_string(),
            task_id: None,
            prompt: None,
        },
    )?;
    assert_eq!(codex_launch.program, "codex");
    assert!(codex_launch.args.is_empty());

    let claude_launch = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "claude-code".to_string(),
            task_id: None,
            prompt: Some("Continue reviewing the repo".to_string()),
        },
    )?;
    assert_eq!(claude_launch.program, "claude");
    assert_eq!(
        claude_launch.args,
        vec!["Continue reviewing the repo".to_string()]
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn resolve_dispatch_launch_rejects_missing_unknown_and_cross_project_tasks(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("dispatch-validation-task");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_root = temp_root.join("workspace");
    let other_workspace_root = temp_root.join("other-workspace");

    fs::create_dir_all(&workspace_root)?;
    fs::create_dir_all(&other_workspace_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace_root)?;
    let other_project =
        project_registry::create_project(&database, "Other Workspace", &other_workspace_root)?;

    save_profile(
        &database,
        "task-required",
        vec![AgentArg::TaskTitle, AgentArg::TaskBody],
        BTreeMap::new(),
    )?;

    let missing_context_error = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "task-required".to_string(),
            task_id: None,
            prompt: None,
        },
    )
    .expect_err("task placeholders should reject missing task context");
    assert_eq!(
        missing_context_error.message(),
        "dispatch task context is required"
    );

    let missing_task_error = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "task-required".to_string(),
            task_id: Some("task-missing".to_string()),
            prompt: None,
        },
    )
    .expect_err("missing task ids should be rejected");
    assert_eq!(missing_task_error.message(), "task not found");

    insert_task(
        &database,
        &other_project.id,
        "task-foreign",
        "Other task",
        "Other task body",
    )?;

    let foreign_task_error = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "task-required".to_string(),
            task_id: Some("task-foreign".to_string()),
            prompt: None,
        },
    )
    .expect_err("cross-project tasks should be rejected");
    assert_eq!(
        foreign_task_error.message(),
        "task does not belong to project"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn resolve_dispatch_launch_rejects_missing_inherited_and_secret_env_values(
) -> Result<(), Box<dyn Error>> {
    let _env_lock = env_lock().lock().expect("env lock should not be poisoned");
    let temp_root = unique_temp_directory("dispatch-validation-env");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_root = temp_root.join("workspace");

    fs::create_dir_all(&workspace_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace_root)?;
    let missing_inherit_key = unique_env_key("DISPATCH_INHERIT_MISSING");
    let missing_secret_key = unique_env_key("DISPATCH_SECRET_MISSING");

    clear_env_var(&missing_inherit_key);
    clear_env_var(&missing_secret_key);

    let mut inherit_env = BTreeMap::new();
    inherit_env.insert(
        "OPENAI_API_KEY".to_string(),
        AgentEnvValue::Inherit {
            key: missing_inherit_key.clone(),
        },
    );
    save_profile(
        &database,
        "inherit-missing",
        vec![AgentArg::Literal {
            value: "exec".to_string(),
        }],
        inherit_env,
    )?;

    let missing_inherit_error = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "inherit-missing".to_string(),
            task_id: None,
            prompt: None,
        },
    )
    .expect_err("missing inherited env vars should be rejected");
    assert_eq!(
        missing_inherit_error.message(),
        format!("inherited env var is missing: {missing_inherit_key}")
    );

    let mut secret_env = BTreeMap::new();
    secret_env.insert(
        "OPENAI_API_KEY".to_string(),
        AgentEnvValue::Secret {
            key: missing_secret_key.clone(),
        },
    );
    save_profile(
        &database,
        "secret-missing",
        vec![AgentArg::Literal {
            value: "exec".to_string(),
        }],
        secret_env,
    )?;

    let missing_secret_error = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "secret-missing".to_string(),
            task_id: None,
            prompt: None,
        },
    )
    .expect_err("missing secrets should be rejected");
    assert_eq!(
        missing_secret_error.message(),
        format!("secret env var is missing: {missing_secret_key}")
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn resolve_dispatch_launch_rejects_unknown_project_unknown_profile_and_auto(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("dispatch-validation-lookup");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_root = temp_root.join("workspace");

    fs::create_dir_all(&workspace_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace_root)?;

    let missing_project_error = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: "project-missing".to_string(),
            profile_id: "codex".to_string(),
            task_id: None,
            prompt: Some("ship it".to_string()),
        },
    )
    .expect_err("unknown projects should be rejected");
    assert_eq!(missing_project_error.message(), "project not found");

    let missing_profile_error = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: "profile-missing".to_string(),
            task_id: None,
            prompt: Some("ship it".to_string()),
        },
    )
    .expect_err("unknown profiles should be rejected");
    assert_eq!(missing_profile_error.message(), "agent profile not found");

    clear_agent_profiles(&database)?;

    let auto_error = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: AUTO_AGENT_PROFILE_ID.to_string(),
            task_id: None,
            prompt: Some("ship it".to_string()),
        },
    )
    .expect_err("auto dispatch should reject when no local profiles exist");
    assert_eq!(
        auto_error.message(),
        "auto dispatch fallback has no local agent profile"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn resolve_dispatch_launch_prefers_the_saved_last_used_local_profile_for_auto(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("dispatch-validation-auto-fallback");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_root = temp_root.join("workspace");

    fs::create_dir_all(&workspace_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace_root)?;

    clear_agent_profiles(&database)?;

    save_profile(
        &database,
        "alpha",
        vec![AgentArg::Literal {
            value: "exec".to_string(),
        }],
        BTreeMap::new(),
    )?;
    save_profile(
        &database,
        "zeta",
        vec![AgentArg::Literal {
            value: "exec".to_string(),
        }],
        BTreeMap::new(),
    )?;

    let fallback_launch = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: AUTO_AGENT_PROFILE_ID.to_string(),
            task_id: None,
            prompt: Some("ship it".to_string()),
        },
    )?;
    assert_eq!(fallback_launch.profile_id, "alpha");

    database.with_connection(|connection| {
        connection.execute(
            "
            INSERT INTO settings (key, value_json, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
            ",
            params!["dispatch.last_used_local_profile_id", "\"zeta\"", 1_i64,],
        )?;

        Ok::<(), AppError>(())
    })?;

    let remembered_launch = resolve_dispatch_launch(
        &database,
        &DispatchAgentRequest {
            project_id: project.id.clone(),
            profile_id: AUTO_AGENT_PROFILE_ID.to_string(),
            task_id: None,
            prompt: Some("ship it".to_string()),
        },
    )?;
    assert_eq!(remembered_launch.profile_id, "zeta");

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

fn clear_agent_profiles(database: &Database) -> Result<(), Box<dyn Error>> {
    database.with_connection(|connection| {
        connection.execute("DELETE FROM agent_profiles", [])?;
        Ok::<(), AppError>(())
    })?;

    Ok(())
}

fn save_profile(
    database: &Database,
    id: &str,
    args: Vec<AgentArg>,
    env: BTreeMap<String, AgentEnvValue>,
) -> Result<(), Box<dyn Error>> {
    save_agent_profile(
        database,
        SaveAgentProfileInput {
            id: id.to_string(),
            name: format!("Profile {id}"),
            program: "codex".to_string(),
            args,
            env,
            cwd: AgentCwd::ProjectRoot,
        },
    )?;

    Ok(())
}

fn insert_task(
    database: &Database,
    project_id: &str,
    task_id: &str,
    title: &str,
    description_markdown: &str,
) -> Result<(), Box<dyn Error>> {
    let now = unix_timestamp();
    database.with_connection(|connection| {
        connection.execute(
            "
            INSERT INTO tasks (
                id,
                project_id,
                title,
                description_markdown,
                workflow_state,
                last_run_state,
                last_session_id,
                assigned_agent_mode,
                markdown_export_path,
                blocked_reason,
                created_at,
                updated_at,
                completed_at
            )
            VALUES (?1, ?2, ?3, ?4, 'draft', 'idle', NULL, NULL, NULL, NULL, ?5, ?5, NULL)
            ",
            params![task_id, project_id, title, description_markdown, now],
        )?;

        Ok::<(), dispatch_lib::error::AppError>(())
    })?;

    Ok(())
}

fn unique_env_key(label: &str) -> String {
    format!(
        "{label}_{}_{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is before unix epoch")
            .as_nanos()
    )
}

fn env_lock() -> &'static Mutex<()> {
    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    ENV_LOCK.get_or_init(|| Mutex::new(()))
}

struct ScopedEnvVar {
    key: String,
}

impl ScopedEnvVar {
    fn set(key: &str, value: &str) -> Self {
        unsafe {
            std::env::set_var(key, value);
        }

        Self {
            key: key.to_string(),
        }
    }
}

impl Drop for ScopedEnvVar {
    fn drop(&mut self) {
        clear_env_var(&self.key);
    }
}

fn clear_env_var(key: &str) {
    unsafe {
        std::env::remove_var(key);
    }
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before unix epoch")
        .as_secs() as i64
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
