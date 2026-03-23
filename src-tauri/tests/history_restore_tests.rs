use std::{
    collections::BTreeMap,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    db::Database,
    services::{
        history::{
            create_manual_save_point, get_save_point_diff, restore_project_save_point,
            restore_project_save_point_file, SavePointCreateResult,
        },
        project_registry,
    },
};
use git2::{BranchType, Repository};

#[test]
fn save_point_diff_reports_add_modify_delete_changes() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("history-diff");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;
    let base_head_oid = initialize_git_repository(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    fs::write(
        workspace.join("README.md"),
        "# Dispatch\n\nChanged snapshot\n",
    )?;
    fs::create_dir_all(workspace.join("docs"))?;
    fs::write(workspace.join("docs/guide.md"), "Guide snapshot\n")?;
    fs::remove_file(workspace.join("notes.txt"))?;

    let save_point = unwrap_created_save_point(create_manual_save_point(
        &database,
        &project.id,
        Some("Before Restore"),
    )?)?;

    let diff_result = get_save_point_diff(&database, &project.id, &save_point.ref_name)?;
    assert_eq!(diff_result.status, "ready");

    let diff = diff_result
        .diff
        .ok_or("expected diff payload for git-backed save point")?;
    assert_eq!(diff.project_id, project.id);
    assert_eq!(diff.ref_name, save_point.ref_name);
    assert_eq!(diff.base_commit_oid, Some(base_head_oid));
    assert_eq!(diff.summary.files_changed, 3);
    assert!(diff.summary.insertions > 0);
    assert!(diff.summary.deletions > 0);

    let files = diff
        .files
        .into_iter()
        .map(|file| (file.path.clone(), file))
        .collect::<BTreeMap<_, _>>();

    let readme_diff = files.get("README.md").ok_or("missing README.md diff")?;
    assert_eq!(readme_diff.status, "modified");
    assert!(!readme_diff.is_binary);
    assert!(readme_diff.patch.contains("Changed snapshot"));

    let added_file = files
        .get("docs/guide.md")
        .ok_or("missing docs/guide.md diff")?;
    assert_eq!(added_file.status, "added");
    assert!(added_file.patch.contains("Guide snapshot"));

    let deleted_file = files.get("notes.txt").ok_or("missing notes.txt diff")?;
    assert_eq!(deleted_file.status, "deleted");
    assert!(deleted_file.patch.contains("Notes v1"));

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn restore_project_save_point_rewinds_workspace_and_preserves_refs() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("history-restore-full");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;
    initialize_git_repository(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    fs::write(
        workspace.join("README.md"),
        "# Dispatch\n\nSave-point snapshot\n",
    )?;
    fs::write(workspace.join("notes.txt"), "Snapshot notes\n")?;

    let save_point = unwrap_created_save_point(create_manual_save_point(
        &database,
        &project.id,
        Some("Workspace Restore"),
    )?)?;
    let local_branches_before = local_branch_names(&workspace)?;
    let latest_ref_target_before = latest_ref_target(&workspace, &project.id)?;

    fs::write(
        workspace.join("README.md"),
        "# Dispatch\n\nDirty workspace\n",
    )?;
    fs::write(workspace.join("notes.txt"), "Dirty notes\n")?;
    fs::write(workspace.join("scratch.tmp"), "remove me\n")?;

    let restore_result = restore_project_save_point(&database, &project.id, &save_point.ref_name)?;
    assert_eq!(restore_result.status, "restored");
    assert_eq!(restore_result.ref_name, Some(save_point.ref_name.clone()));
    assert!(
        restore_result
            .restored_paths
            .contains(&"README.md".to_string()),
        "full restore should report modified tracked files"
    );
    assert!(
        restore_result
            .restored_paths
            .contains(&"notes.txt".to_string()),
        "full restore should report modified tracked files"
    );
    assert!(
        restore_result
            .restored_paths
            .contains(&"scratch.tmp".to_string()),
        "full restore should report untracked paths that were removed"
    );

    assert_eq!(
        fs::read_to_string(workspace.join("README.md"))?,
        "# Dispatch\n\nSave-point snapshot\n"
    );
    assert_eq!(
        fs::read_to_string(workspace.join("notes.txt"))?,
        "Snapshot notes\n"
    );
    assert!(
        !workspace.join("scratch.tmp").exists(),
        "full restore should remove untracked files not present in the save point"
    );

    assert_eq!(local_branch_names(&workspace)?, local_branches_before);
    assert_eq!(
        latest_ref_target(&workspace, &project.id)?,
        latest_ref_target_before
    );

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn restore_project_save_point_file_rewinds_one_path_only() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("history-restore-file");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;
    initialize_git_repository(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    fs::write(
        workspace.join("README.md"),
        "# Dispatch\n\nScoped snapshot\n",
    )?;
    fs::write(workspace.join("notes.txt"), "Snapshot notes\n")?;

    let save_point = unwrap_created_save_point(create_manual_save_point(
        &database,
        &project.id,
        Some("Single File Restore"),
    )?)?;
    let latest_ref_target_before = latest_ref_target(&workspace, &project.id)?;

    fs::write(workspace.join("README.md"), "# Dispatch\n\nDirty readme\n")?;
    fs::write(workspace.join("notes.txt"), "Leave me dirty\n")?;

    let restore_result =
        restore_project_save_point_file(&database, &project.id, &save_point.ref_name, "README.md")?;
    assert_eq!(restore_result.status, "restored");
    assert_eq!(restore_result.ref_name, Some(save_point.ref_name.clone()));
    assert_eq!(restore_result.restored_paths, vec!["README.md".to_string()]);

    assert_eq!(
        fs::read_to_string(workspace.join("README.md"))?,
        "# Dispatch\n\nScoped snapshot\n"
    );
    assert_eq!(
        fs::read_to_string(workspace.join("notes.txt"))?,
        "Leave me dirty\n"
    );
    assert_eq!(
        latest_ref_target(&workspace, &project.id)?,
        latest_ref_target_before
    );

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn diff_and_restore_return_typed_unsupported_for_non_git_projects() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("history-unsupported");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;
    let ref_name = format!("refs/dispatch/save-points/{}/123-manual", project.id);

    let diff_result = get_save_point_diff(&database, &project.id, &ref_name)?;
    assert_eq!(diff_result.status, "unsupported");
    assert_eq!(diff_result.diff, None);

    let restore_result = restore_project_save_point(&database, &project.id, &ref_name)?;
    assert_eq!(restore_result.status, "unsupported");
    assert_eq!(restore_result.ref_name, None);
    assert!(restore_result.restored_paths.is_empty());

    let file_restore_result =
        restore_project_save_point_file(&database, &project.id, &ref_name, "README.md")?;
    assert_eq!(file_restore_result.status, "unsupported");
    assert_eq!(file_restore_result.ref_name, None);
    assert!(file_restore_result.restored_paths.is_empty());

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn restore_project_save_point_file_rejects_path_traversal() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("history-restore-path-validation");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;
    initialize_git_repository(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;
    let save_point = unwrap_created_save_point(create_manual_save_point(
        &database,
        &project.id,
        Some("Validation"),
    )?)?;

    let error = restore_project_save_point_file(
        &database,
        &project.id,
        &save_point.ref_name,
        "../README.md",
    )
    .expect_err("path traversal should be rejected for file restore");
    assert!(error.message().starts_with("path traversal is not allowed"));

    cleanup_database_artifacts(&database_path);
    Ok(())
}

fn initialize_git_repository(workspace: &Path) -> Result<String, Box<dyn Error>> {
    run_git_command(workspace, &["init"])?;
    run_git_command(workspace, &["config", "user.name", "Dispatch Test"])?;
    run_git_command(workspace, &["config", "user.email", "dispatch-test@local"])?;

    fs::write(workspace.join("README.md"), "# Dispatch\n")?;
    fs::write(workspace.join("notes.txt"), "Notes v1\n")?;
    run_git_command(workspace, &["add", "README.md", "notes.txt"])?;
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

fn local_branch_names(workspace: &Path) -> Result<Vec<String>, Box<dyn Error>> {
    let repo = Repository::open(workspace)?;
    let mut branches = Vec::new();

    for branch in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = branch?;
        if let Some(name) = branch.name()? {
            branches.push(name.to_string());
        }
    }

    branches.sort();
    Ok(branches)
}

fn latest_ref_target(workspace: &Path, project_id: &str) -> Result<Option<String>, Box<dyn Error>> {
    let repo = Repository::open(workspace)?;
    let latest_ref_name = format!("refs/dispatch/save-points/{project_id}/latest");
    let latest_ref = repo.find_reference(&latest_ref_name)?;

    Ok(latest_ref.symbolic_target().map(ToString::to_string))
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
