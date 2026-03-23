use std::{
    collections::BTreeMap,
    error::Error,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    db::Database,
    models::{AgentArg, AgentCwd, AgentEnvValue},
    services::agent_registry::{
        self, list_agent_profiles, list_agent_registry_entries, save_agent_profile,
        SaveAgentProfileInput,
    },
};

#[test]
fn fresh_database_seeds_default_agent_profiles_and_auto_registry_entry(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("agent-registry-defaults");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Database::initialize_at(&database_path)?;

    let profiles = list_agent_profiles(&database)?;
    let profile_ids = profiles
        .iter()
        .map(|profile| profile.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(profile_ids, vec!["claude-code", "codex", "gemini"]);
    assert_eq!(profiles[0].program, "claude");
    assert_eq!(profiles[0].args, vec![AgentArg::OptionalPrompt]);
    assert_eq!(profiles[1].program, "codex");
    assert_eq!(profiles[1].args, vec![AgentArg::OptionalPrompt]);
    assert_eq!(profiles[2].program, "gemini");
    assert_eq!(profiles[2].args, vec![AgentArg::Prompt]);
    assert!(
        profiles
            .iter()
            .all(|profile| !profile.program.contains(' ') || !profile.args.is_empty()),
        "profiles should store structured program/args data instead of a single shell template"
    );

    let registry_entries = list_agent_registry_entries(&database)?;
    assert_eq!(
        registry_entries[0].id,
        agent_registry::AUTO_AGENT_PROFILE_ID
    );
    assert_eq!(registry_entries[0].selection_mode, "auto");
    assert_eq!(registry_entries[1].selection_mode, "profile");

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn save_agent_profile_creates_updates_and_deletes_structured_profiles() -> Result<(), Box<dyn Error>>
{
    let temp_root = unique_temp_directory("agent-registry-save");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Database::initialize_at(&database_path)?;
    let mut env = BTreeMap::new();
    env.insert(
        "OPENAI_API_KEY".to_string(),
        AgentEnvValue::Secret {
            key: "OPENAI_API_KEY".to_string(),
        },
    );

    let created = save_agent_profile(
        &database,
        SaveAgentProfileInput {
            id: "custom-reviewer".to_string(),
            name: "Custom Reviewer".to_string(),
            program: "codex".to_string(),
            args: vec![
                AgentArg::Literal {
                    value: "exec".to_string(),
                },
                AgentArg::Prompt,
            ],
            env,
            cwd: AgentCwd::ProjectRoot,
        },
    )?;

    assert_eq!(created.id, "custom-reviewer");
    assert_eq!(created.name, "Custom Reviewer");
    assert_eq!(created.program, "codex");
    assert_eq!(
        created.args,
        vec![
            AgentArg::Literal {
                value: "exec".to_string(),
            },
            AgentArg::Prompt,
        ]
    );

    let fetched = agent_registry::get_agent_profile(&database, "custom-reviewer")?
        .expect("saved agent profile should be queryable");
    assert_eq!(fetched, created);

    let updated = save_agent_profile(
        &database,
        SaveAgentProfileInput {
            id: "custom-reviewer".to_string(),
            name: "Custom Reviewer v2".to_string(),
            program: "gemini".to_string(),
            args: vec![AgentArg::Prompt],
            env: BTreeMap::new(),
            cwd: AgentCwd::ProjectRoot,
        },
    )?;

    assert_eq!(updated.id, "custom-reviewer");
    assert_eq!(updated.name, "Custom Reviewer v2");
    assert_eq!(updated.program, "gemini");
    assert_eq!(updated.args, vec![AgentArg::Prompt]);
    assert_eq!(updated.created_at, created.created_at);
    assert!(updated.updated_at >= created.updated_at);

    let deleted = agent_registry::delete_agent_profile(&database, "custom-reviewer")?;
    assert!(deleted);
    assert!(
        agent_registry::get_agent_profile(&database, "custom-reviewer")?.is_none(),
        "deleted agent profile should be removed from SQLite"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn save_agent_profile_rejects_reserved_auto_id_and_invalid_env_keys() -> Result<(), Box<dyn Error>>
{
    let temp_root = unique_temp_directory("agent-registry-validation");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let database = Database::initialize_at(&database_path)?;
    let mut invalid_env = BTreeMap::new();
    invalid_env.insert(
        "OPENAI API KEY".to_string(),
        AgentEnvValue::Literal {
            value: "secret".to_string(),
        },
    );

    let reserved_id_error = save_agent_profile(
        &database,
        SaveAgentProfileInput {
            id: "auto".to_string(),
            name: "Reserved".to_string(),
            program: "codex".to_string(),
            args: vec![AgentArg::Prompt],
            env: BTreeMap::new(),
            cwd: AgentCwd::ProjectRoot,
        },
    )
    .expect_err("auto should remain a registry placeholder, not a stored row");
    assert_eq!(reserved_id_error.message(), "agent profile id is reserved");

    let invalid_env_error = save_agent_profile(
        &database,
        SaveAgentProfileInput {
            id: "custom-invalid".to_string(),
            name: "Invalid Env".to_string(),
            program: "codex".to_string(),
            args: vec![AgentArg::Prompt],
            env: invalid_env,
            cwd: AgentCwd::ProjectRoot,
        },
    )
    .expect_err("invalid env names should be rejected");
    assert_eq!(
        invalid_env_error.message(),
        "agent env key must be an env-style identifier"
    );

    drop(database);
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
