use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    db::Database,
    services::{path_guard, project_registry},
};

#[test]
fn assert_project_relative_resolves_project_children() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("path-guard-safe");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let src_directory = project_root.join("src");
    let existing_file = src_directory.join("main.rs");

    fs::create_dir_all(&src_directory)?;
    fs::write(&existing_file, "fn main() {}\n")?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;
    let canonical_project_root = fs::canonicalize(&project_root)?;
    let planned_file = canonical_project_root.join("src/generated/new.rs");

    let resolved_existing =
        path_guard::assert_project_relative(&database, &project.id, "src/main.rs")?;
    let resolved_planned =
        path_guard::assert_project_relative(&database, &project.id, "src/generated/new.rs")?;

    assert_eq!(resolved_existing, fs::canonicalize(&existing_file)?);
    assert_eq!(resolved_planned, planned_file);

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn assert_project_relative_rejects_parent_traversal() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("path-guard-parent");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");

    fs::create_dir_all(&project_root)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;

    let error = path_guard::assert_project_relative(&database, &project.id, "../outside.txt")
        .expect_err("parent traversal should be rejected");

    assert!(
        error.to_string().contains("traversal"),
        "error should mention traversal rejection"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn assert_project_relative_rejects_absolute_paths() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("path-guard-absolute");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let outside_root = temp_root.join("outside");
    let outside_file = outside_root.join("secret.txt");

    fs::create_dir_all(&project_root)?;
    fs::create_dir_all(&outside_root)?;
    fs::write(&outside_file, "secret\n")?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;

    let error = path_guard::assert_project_relative(&database, &project.id, &outside_file)
        .expect_err("absolute paths must be rejected");

    assert!(
        error.to_string().contains("absolute paths"),
        "error should mention absolute path rejection"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
#[cfg_attr(windows, ignore = "requires symlink privileges")]
fn assert_project_relative_rejects_symlink_escapes() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("path-guard-symlink");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let outside_root = temp_root.join("outside");
    let link_path = project_root.join("escape-link");
    let outside_file = outside_root.join("secret.txt");

    fs::create_dir_all(&project_root)?;
    fs::create_dir_all(&outside_root)?;
    fs::write(&outside_file, "secret\n")?;
    create_directory_symlink(&outside_root, &link_path)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;

    let error =
        path_guard::assert_project_relative(&database, &project.id, "escape-link/secret.txt")
            .expect_err("symlink escapes must be rejected");

    assert!(
        error.to_string().contains("escapes project root"),
        "error should mention project-root escape rejection"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
#[cfg_attr(windows, ignore = "requires symlink privileges")]
fn assert_project_relative_rejects_broken_symlink_escapes() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("path-guard-broken-symlink");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let outside_target = temp_root.join("outside-future");
    let link_path = project_root.join("escape-link");

    fs::create_dir_all(&project_root)?;
    create_directory_symlink(&outside_target, &link_path)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;

    let error =
        path_guard::assert_project_relative(&database, &project.id, "escape-link/secret.txt")
            .expect_err("broken symlink escapes must be rejected");

    assert!(
        error.to_string().contains("symlink"),
        "error should mention the rejected symlink component"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
#[cfg_attr(windows, ignore = "requires symlink privileges")]
fn assert_project_relative_rejects_registered_root_symlink_pivots() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("path-guard-root-pivot");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let relocated_root = temp_root.join("workspace-original");
    let outside_root = temp_root.join("outside");
    let secret_file = outside_root.join("secret.txt");

    fs::create_dir_all(&project_root)?;
    fs::create_dir_all(&outside_root)?;
    fs::write(&secret_file, "secret\n")?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &project_root)?;

    fs::rename(&project_root, &relocated_root)?;
    create_directory_symlink(&outside_root, &project_root)?;

    let error = path_guard::assert_project_relative(&database, &project.id, "secret.txt")
        .expect_err("registered roots swapped to symlinks must be rejected");

    assert!(
        error
            .to_string()
            .contains("registered project root resolves through symlink"),
        "error should mention the rejected registered-root symlink pivot"
    );

    drop(database);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[cfg(unix)]
fn create_directory_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn create_directory_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
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
