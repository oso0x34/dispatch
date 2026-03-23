use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    db::Database,
    services::{project_fs, project_registry},
};

#[test]
fn project_fs_lists_project_scoped_entries_and_reads_previewable_files(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("project-fs");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");
    let docs_dir = workspace.join("docs");
    let src_dir = workspace.join("src");

    fs::create_dir_all(&docs_dir)?;
    fs::create_dir_all(&src_dir)?;
    fs::write(
        workspace.join("README.md"),
        "# Dispatch\n\nProject overview\n",
    )?;
    fs::write(workspace.join("notes.txt"), "Plain text preview\n")?;
    fs::write(docs_dir.join("guide.md"), "## Guide\n\nRead me\n")?;
    fs::write(src_dir.join("main.rs"), "fn main() {}\n")?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    let root_entries = project_fs::list_project_tree(&database, &project.id, None)?;
    assert_eq!(
        root_entries
            .iter()
            .map(|entry| (
                entry.name.as_str(),
                entry.kind.as_str(),
                entry.path.as_str()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("docs", "directory", "docs"),
            ("src", "directory", "src"),
            ("notes.txt", "file", "notes.txt"),
            ("README.md", "file", "README.md"),
        ]
    );

    let docs_entries = project_fs::list_project_tree(&database, &project.id, Some("docs"))?;
    assert_eq!(
        docs_entries
            .iter()
            .map(|entry| (
                entry.name.as_str(),
                entry.kind.as_str(),
                entry.path.as_str()
            ))
            .collect::<Vec<_>>(),
        vec![("guide.md", "file", "docs/guide.md")]
    );

    let readme_preview = project_fs::read_project_file(&database, &project.id, "README.md")?;
    assert_eq!(readme_preview.path, "README.md");
    assert_eq!(
        readme_preview.absolute_path,
        workspace.join("README.md").to_string_lossy()
    );
    assert_eq!(readme_preview.name, "README.md");
    assert_eq!(readme_preview.format, "markdown");
    assert!(readme_preview.content.contains("Project overview"));

    let notes_preview = project_fs::read_project_file(&database, &project.id, "notes.txt")?;
    assert_eq!(
        notes_preview.absolute_path,
        workspace.join("notes.txt").to_string_lossy()
    );
    assert_eq!(notes_preview.format, "text");
    assert_eq!(notes_preview.content, "Plain text preview\n");

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn project_fs_rejects_invalid_paths_and_non_previewable_files() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("project-fs-validation");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");

    fs::create_dir_all(&workspace)?;
    fs::write(workspace.join("binary.bin"), [0_u8, 159, 146, 150])?;
    fs::write(workspace.join("notes.txt"), "Safe preview\n")?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    let absolute_path_error = project_fs::list_project_tree(&database, &project.id, Some("/tmp"))
        .expect_err("absolute tree paths should be rejected");
    assert!(absolute_path_error
        .message()
        .starts_with("absolute paths are not allowed"));

    let traversal_error = project_fs::read_project_file(&database, &project.id, "../notes.txt")
        .expect_err("path traversal should be rejected");
    assert!(traversal_error
        .message()
        .starts_with("path traversal is not allowed"));

    let directory_error = project_fs::read_project_file(&database, &project.id, ".")
        .expect_err("directories should not be previewed as files");
    assert_eq!(directory_error.message(), "project path is not a file");

    let binary_error = project_fs::read_project_file(&database, &project.id, "binary.bin")
        .expect_err("binary files should be rejected");
    assert_eq!(binary_error.message(), "project file is not previewable");

    let blank_query_error = project_fs::search_project_paths(&database, &project.id, "   ")
        .expect_err("blank search queries should be rejected");
    assert_eq!(blank_query_error.message(), "search query cannot be blank");

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn project_fs_searches_paths_and_content_while_hiding_gitignored_entries(
) -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("project-fs-search");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");
    let docs_dir = workspace.join("docs");
    let src_dir = workspace.join("src");
    let ignored_dir = workspace.join("ignored");

    fs::create_dir_all(&docs_dir)?;
    fs::create_dir_all(&src_dir)?;
    fs::create_dir_all(&ignored_dir)?;
    fs::write(workspace.join(".gitignore"), "ignored/\nignored.txt\n")?;
    fs::write(
        docs_dir.join("dispatch-notes.md"),
        "dispatch search notes\n",
    )?;
    fs::write(
        src_dir.join("main.rs"),
        "fn main() {\n    println!(\"dispatch needle\");\n}\n",
    )?;
    fs::write(
        workspace.join("ignored.txt"),
        "dispatch should stay hidden\n",
    )?;
    fs::write(ignored_dir.join("secret.md"), "dispatch needle hidden\n")?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;

    let path_hits = project_fs::search_project_paths(&database, &project.id, "dispatch")?;
    assert_eq!(
        path_hits
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>(),
        vec!["docs/dispatch-notes.md"]
    );

    let content_hits = project_fs::search_project_content(&database, &project.id, "needle")?;
    assert_eq!(
        content_hits
            .iter()
            .map(|hit| (hit.path.as_str(), hit.line_number, hit.line_text.as_str()))
            .collect::<Vec<_>>(),
        vec![("src/main.rs", 2, "    println!(\"dispatch needle\");")]
    );

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
