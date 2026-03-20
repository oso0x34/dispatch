use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    commands::projects::{
        create_project_with_db, delete_project_with_db, get_project_with_db, list_projects_with_db,
    },
    db::Database,
    services::project_registry,
};

#[test]
fn project_commands_expose_project_scoped_root_paths_and_persist_rows() -> Result<(), Box<dyn Error>>
{
    let temp_root = unique_temp_directory("projects-db");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let nested_directory = project_root.join("nested");

    fs::create_dir_all(&nested_directory)?;

    let database = Database::initialize_at(&database_path)?;
    let requested_root = nested_directory.join("..");
    let created = create_project_with_db(
        &database,
        " Dispatch Workspace ".to_string(),
        requested_root.to_string_lossy().into_owned(),
    )?;
    let canonical_root = fs::canonicalize(&project_root)?;
    let canonical_root_string = canonical_root.to_string_lossy().into_owned();

    assert_eq!(created.name, "Dispatch Workspace");
    assert_eq!(created.root_relative_path, ".");

    let stored = project_registry::get_project(&database, &created.id)?
        .expect("created project should be stored in the registry");
    assert_eq!(stored.root_path, canonical_root_string);

    let listed = list_projects_with_db(&database)?;
    assert_eq!(listed, vec![created.clone()]);

    let fetched = get_project_with_db(&database, created.id.clone())?;
    assert_eq!(fetched, Some(created.clone()));

    drop(database);

    let reopened = Database::initialize_at(&database_path)?;
    let reopened_list = list_projects_with_db(&reopened)?;
    assert_eq!(reopened_list, vec![created.clone()]);
    let reopened_project = get_project_with_db(&reopened, created.id.clone())?;
    assert_eq!(reopened_project, Some(created.clone()));

    assert!(
        delete_project_with_db(&reopened, created.id.clone())?,
        "delete_project should report success for an existing project"
    );
    assert!(
        project_root.exists(),
        "deleting a project row must not delete the underlying project directory"
    );
    assert!(
        get_project_with_db(&reopened, created.id.clone())?.is_none(),
        "get_project should return None after deletion"
    );
    assert!(
        list_projects_with_db(&reopened)?.is_empty(),
        "list_projects should be empty after deleting the only project"
    );

    drop(reopened);
    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn create_project_rejects_duplicate_canonical_root_paths() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("projects-dedupe");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let project_root = temp_root.join("workspace");
    let nested_directory = project_root.join("nested");

    fs::create_dir_all(&nested_directory)?;

    let database = Database::initialize_at(&database_path)?;
    create_project_with_db(
        &database,
        "Primary Workspace".to_string(),
        nested_directory.join("..").to_string_lossy().into_owned(),
    )?;

    let duplicate_error = create_project_with_db(
        &database,
        "Duplicate Workspace".to_string(),
        project_root.to_string_lossy().into_owned(),
    )
    .expect_err("duplicate canonical project roots should be rejected");

    assert!(
        duplicate_error.to_string().contains("already registered"),
        "duplicate error should explain that the canonical project root is already registered"
    );
    assert_eq!(
        list_projects_with_db(&database)?.len(),
        1,
        "duplicate registration attempts must not create extra rows"
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
