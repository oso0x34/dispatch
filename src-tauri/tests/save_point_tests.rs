use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    db::Database,
    services::{
        history::{
            create_manual_save_point, create_post_agent_save_point, create_pre_agent_save_point,
            latest_project_save_point, list_project_save_points, record_save_point,
            RecordSavePointInput, SavePointCreateResult, SAVE_POINT_STAGE_MANUAL,
            SAVE_POINT_STAGE_POST_AGENT, SAVE_POINT_STAGE_PRE_AGENT,
        },
        project_registry,
    },
};
use git2::Repository;

#[test]
fn save_points_persist_and_list_in_reverse_chronological_order_for_git_projects(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("save-point-list");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");
    fs::create_dir_all(&workspace)?;

    let base_head_oid = initialize_git_repository(&workspace)?;
    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    let pre_save_point = record_save_point(
        &database,
        RecordSavePointInput {
            project_id: project.id.clone(),
            run_id: Some("run-001".to_string()),
            ref_name: format!(
                "refs/dispatch/save-points/{}/1773966900-pre-agent-run-001",
                project.id
            ),
            commit_oid: base_head_oid.clone(),
            base_head_oid: Some(base_head_oid.clone()),
            stage: SAVE_POINT_STAGE_PRE_AGENT.to_string(),
        },
    )?;
    thread::sleep(Duration::from_secs(1));

    let manual_save_point = record_save_point(
        &database,
        RecordSavePointInput {
            project_id: project.id.clone(),
            run_id: None,
            ref_name: format!(
                "refs/dispatch/save-points/{}/1773967201-manual-before-refactor",
                project.id
            ),
            commit_oid: base_head_oid.clone(),
            base_head_oid: Some(base_head_oid.clone()),
            stage: SAVE_POINT_STAGE_MANUAL.to_string(),
        },
    )?;
    thread::sleep(Duration::from_secs(1));

    let post_save_point = record_save_point(
        &database,
        RecordSavePointInput {
            project_id: project.id.clone(),
            run_id: Some("run-001".to_string()),
            ref_name: format!(
                "refs/dispatch/save-points/{}/1773967128-post-agent-run-001",
                project.id
            ),
            commit_oid: base_head_oid.clone(),
            base_head_oid: Some(base_head_oid.clone()),
            stage: SAVE_POINT_STAGE_POST_AGENT.to_string(),
        },
    )?;

    let listed_save_points = list_project_save_points(&database, &project.id)?;
    assert_eq!(
        listed_save_points,
        vec![
            post_save_point.clone(),
            manual_save_point.clone(),
            pre_save_point.clone(),
        ]
    );

    assert_eq!(
        latest_project_save_point(&database, &project.id)?,
        Some(post_save_point)
    );

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn save_points_reject_duplicate_project_ref_names() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("save-point-duplicate");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");
    fs::create_dir_all(&workspace)?;

    let base_head_oid = initialize_git_repository(&workspace)?;
    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;
    let duplicate_ref_name = format!(
        "refs/dispatch/save-points/{}/1773966900-pre-agent-run-001",
        project.id
    );

    record_save_point(
        &database,
        RecordSavePointInput {
            project_id: project.id.clone(),
            run_id: Some("run-001".to_string()),
            ref_name: duplicate_ref_name.clone(),
            commit_oid: base_head_oid.clone(),
            base_head_oid: Some(base_head_oid.clone()),
            stage: SAVE_POINT_STAGE_PRE_AGENT.to_string(),
        },
    )?;

    let duplicate_error = record_save_point(
        &database,
        RecordSavePointInput {
            project_id: project.id.clone(),
            run_id: Some("run-001".to_string()),
            ref_name: duplicate_ref_name,
            commit_oid: base_head_oid,
            base_head_oid: None,
            stage: SAVE_POINT_STAGE_POST_AGENT.to_string(),
        },
    )
    .expect_err("duplicate save-point refs for the same project should be rejected");

    assert!(
        duplicate_error
            .to_string()
            .contains("UNIQUE constraint failed"),
        "duplicate ref errors should come from the project/ref uniqueness constraint"
    );

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn save_points_require_an_existing_git_repository() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("save-point-non-git");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");
    fs::create_dir_all(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    let record_error = record_save_point(
        &database,
        RecordSavePointInput {
            project_id: project.id.clone(),
            run_id: Some("run-001".to_string()),
            ref_name: format!(
                "refs/dispatch/save-points/{}/1773966900-pre-agent-run-001",
                project.id
            ),
            commit_oid: "deadbeef".to_string(),
            base_head_oid: None,
            stage: SAVE_POINT_STAGE_PRE_AGENT.to_string(),
        },
    )
    .expect_err("non-git projects should reject save-point metadata writes");
    assert!(record_error.to_string().contains("not a git repository"));

    let list_error = list_project_save_points(&database, &project.id)
        .expect_err("non-git projects should reject history discovery");
    assert!(list_error.to_string().contains("not a git repository"));

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn git_backed_save_points_create_symbolic_latest_refs_and_synthetic_identity(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("save-point-git-backed");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");
    fs::create_dir_all(&workspace)?;

    initialize_git_repository(&workspace)?;
    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    let pre_save_point = unwrap_created_save_point(create_pre_agent_save_point(
        &database,
        &project.id,
        "session-001",
    )?)?;

    fs::write(
        workspace.join("README.md"),
        "# Dispatch\n\nChanged by agent\n",
    )?;

    let post_save_point = unwrap_created_save_point(create_post_agent_save_point(
        &database,
        &project.id,
        "session-001",
    )?)?;

    let repo = Repository::open(&workspace)?;
    let latest_ref_name = format!("refs/dispatch/save-points/{}/latest", project.id);
    let latest_ref = repo.find_reference(&latest_ref_name)?;
    assert!(latest_ref.symbolic_target().is_some());
    assert_eq!(
        latest_ref.symbolic_target(),
        Some(post_save_point.ref_name.as_str())
    );

    let pre_commit = repo
        .find_reference(&pre_save_point.ref_name)?
        .peel_to_commit()?;
    let post_commit = repo
        .find_reference(&post_save_point.ref_name)?
        .peel_to_commit()?;

    for commit in [&pre_commit, &post_commit] {
        assert_eq!(commit.author().name(), Some("Dispatch"));
        assert_eq!(commit.author().email(), Some("dispatch@local"));
        assert_eq!(commit.committer().name(), Some("Dispatch"));
        assert_eq!(commit.committer().email(), Some("dispatch@local"));
    }

    assert_ne!(pre_commit.tree_id(), post_commit.tree_id());
    assert_eq!(
        latest_project_save_point(&database, &project.id)?,
        Some(post_save_point)
    );

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn manual_save_points_normalize_labels_and_return_typed_unsupported_results(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("save-point-manual");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let git_workspace = temp_root.join("git-workspace");
    let plain_workspace = temp_root.join("plain-workspace");
    fs::create_dir_all(&git_workspace)?;
    fs::create_dir_all(&plain_workspace)?;

    initialize_git_repository(&git_workspace)?;
    let database = Database::initialize_at(&database_path)?;
    let git_project = project_registry::create_project(&database, "Git Workspace", &git_workspace)?;
    let plain_project =
        project_registry::create_project(&database, "Plain Workspace", &plain_workspace)?;

    let manual_save_point = unwrap_created_save_point(create_manual_save_point(
        &database,
        &git_project.id,
        Some("Before Refactor!!"),
    )?)?;
    assert!(
        manual_save_point
            .ref_name
            .ends_with("manual-before-refactor"),
        "manual labels should be normalized into the ref path"
    );
    assert_eq!(manual_save_point.stage, SAVE_POINT_STAGE_MANUAL);

    let unsupported = create_manual_save_point(&database, &plain_project.id, None)?;
    assert!(unsupported.is_unsupported());
    assert_eq!(unsupported.save_point, None);

    cleanup_database_artifacts(&database_path);
    Ok(())
}

fn initialize_git_repository(workspace: &Path) -> Result<String, Box<dyn Error>> {
    run_git_command(workspace, &["init"])?;
    run_git_command(workspace, &["config", "user.name", "Dispatch Test"])?;
    run_git_command(workspace, &["config", "user.email", "dispatch-test@local"])?;

    fs::write(workspace.join("README.md"), "# Dispatch\n")?;
    run_git_command(workspace, &["add", "README.md"])?;
    run_git_command(workspace, &["commit", "-m", "Initial commit"])?;

    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(workspace)
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "git rev-parse HEAD failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(String::from_utf8(output.stdout)?.trim().to_string())
}

fn run_git_command(workspace: &Path, args: &[&str]) -> Result<(), Box<dyn Error>> {
    let output = Command::new("git")
        .args(args)
        .current_dir(workspace)
        .output()?;
    if output.status.success() {
        return Ok(());
    }

    Err(format!(
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    )
    .into())
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

fn unwrap_created_save_point(
    result: SavePointCreateResult,
) -> Result<dispatch_lib::services::history::SavePoint, Box<dyn Error>> {
    result
        .save_point
        .ok_or_else(|| format!("expected created save point, got status {}", result.status).into())
}
