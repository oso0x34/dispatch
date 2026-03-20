use std::{
    collections::BTreeSet,
    error::Error,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{configure_app, db::Database};
use rusqlite::Connection;
use tauri::{test::mock_builder, Manager};

fn build_app() -> tauri::App<tauri::test::MockRuntime> {
    configure_app(mock_builder())
        .build(tauri::generate_context!())
        .expect("failed to build Dispatch test app")
}

#[test]
fn database_bootstrap_uses_tauri_app_data_directory() -> Result<(), Box<dyn Error>> {
    let app = build_app();
    let expected_app_data_dir = app.path().app_data_dir()?;
    let database = Database::initialize_for_app(&app.handle())?;

    assert!(
        database.path().starts_with(&expected_app_data_dir),
        "database path should live under the Tauri app data directory: expected prefix {}, got {}",
        expected_app_data_dir.display(),
        database.path().display()
    );
    assert_eq!(
        database.path().file_name().and_then(|name| name.to_str()),
        Some("dispatch.sqlite3")
    );
    assert!(
        database.path().exists(),
        "database file should exist after bootstrap"
    );

    Ok(())
}

#[test]
fn fresh_database_matches_expected_schema_shape() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("db-schema");
    let database_path = temp_root.join("dispatch-test.sqlite3");

    let database = Database::initialize_at(&database_path)?;

    assert!(
        database_path.exists(),
        "fresh bootstrap should create the sqlite file"
    );

    database.with_connection(|connection| -> Result<(), Box<dyn Error>> {
        assert_eq!(pragma_i64(connection, "foreign_keys")?, 1);
        assert_eq!(pragma_string(connection, "journal_mode")?.to_lowercase(), "wal");

        let tables = schema_object_names(connection, "table")?;
        let expected_tables = BTreeSet::from([
            "agent_sessions".to_string(),
            "dispatch_migrations".to_string(),
            "projects".to_string(),
            "settings".to_string(),
            "tasks".to_string(),
        ]);

        assert_eq!(tables, expected_tables);
        assert!(
            !tables.contains("chat_messages"),
            "DISPATCH-008 should only create the four ticket-scoped domain tables plus migration tracking"
        );

        assert_eq!(
            table_columns(connection, "projects")?,
            vec![
                "id".to_string(),
                "name".to_string(),
                "root_path".to_string(),
                "created_at".to_string(),
                "updated_at".to_string(),
                "last_opened_at".to_string(),
            ]
        );
        assert_eq!(
            table_columns(connection, "tasks")?,
            vec![
                "id".to_string(),
                "project_id".to_string(),
                "title".to_string(),
                "description_markdown".to_string(),
                "workflow_state".to_string(),
                "last_run_state".to_string(),
                "last_session_id".to_string(),
                "assigned_agent_mode".to_string(),
                "markdown_export_path".to_string(),
                "blocked_reason".to_string(),
                "created_at".to_string(),
                "updated_at".to_string(),
                "completed_at".to_string(),
            ]
        );
        assert_eq!(
            table_columns(connection, "agent_sessions")?,
            vec![
                "id".to_string(),
                "project_id".to_string(),
                "task_id".to_string(),
                "source".to_string(),
                "session_kind".to_string(),
                "status".to_string(),
                "program".to_string(),
                "args_json".to_string(),
                "env_keys_json".to_string(),
                "cwd".to_string(),
                "transport".to_string(),
                "exit_code".to_string(),
                "started_at".to_string(),
                "ended_at".to_string(),
                "created_at".to_string(),
                "updated_at".to_string(),
            ]
        );
        assert_eq!(
            table_columns(connection, "settings")?,
            vec![
                "key".to_string(),
                "value_json".to_string(),
                "updated_at".to_string(),
            ]
        );

        let indexes = schema_object_names(connection, "index")?;
        for required_index in [
            "idx_tasks_project_workflow_updated_at",
            "idx_tasks_project_last_run_updated_at",
            "idx_agent_sessions_project_status_created_at",
            "idx_agent_sessions_task_created_at",
        ] {
            assert!(
                indexes.contains(required_index),
                "expected schema index {required_index} to exist"
            );
        }

        let task_foreign_keys = foreign_keys(connection, "tasks")?;
        assert!(task_foreign_keys.contains(&(
            "project_id".to_string(),
            "projects".to_string(),
            "CASCADE".to_string(),
        )));
        assert!(task_foreign_keys.contains(&(
            "last_session_id".to_string(),
            "agent_sessions".to_string(),
            "SET NULL".to_string(),
        )));

        let session_foreign_keys = foreign_keys(connection, "agent_sessions")?;
        assert!(session_foreign_keys.contains(&(
            "project_id".to_string(),
            "projects".to_string(),
            "CASCADE".to_string(),
        )));
        assert!(session_foreign_keys.contains(&(
            "task_id".to_string(),
            "tasks".to_string(),
            "SET NULL".to_string(),
        )));

        let applied_migrations = migration_rows(connection)?;
        assert_eq!(applied_migrations, vec![(1, "001_init".to_string())]);

        Ok(())
    })?;

    drop(database);

    let reopened = Database::initialize_at(&database_path)?;
    reopened.with_connection(|connection| -> Result<(), Box<dyn Error>> {
        let applied_migrations = migration_rows(connection)?;
        assert_eq!(
            applied_migrations,
            vec![(1, "001_init".to_string())],
            "re-initializing the same database should not duplicate migration tracking"
        );

        Ok(())
    })?;

    cleanup_database_artifacts(&database_path);

    Ok(())
}

fn schema_object_names(
    connection: &Connection,
    object_type: &str,
) -> Result<BTreeSet<String>, Box<dyn Error>> {
    let mut statement = connection.prepare(
        "SELECT name FROM sqlite_master WHERE type = ?1 AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let names = statement
        .query_map([object_type], |row| row.get::<_, String>(0))?
        .collect::<Result<BTreeSet<_>, _>>()?;

    Ok(names)
}

fn table_columns(connection: &Connection, table_name: &str) -> Result<Vec<String>, Box<dyn Error>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info('{table_name}')"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(columns)
}

fn foreign_keys(
    connection: &Connection,
    table_name: &str,
) -> Result<BTreeSet<(String, String, String)>, Box<dyn Error>> {
    let mut statement = connection.prepare(&format!("PRAGMA foreign_key_list('{table_name}')"))?;
    let keys = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(3)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .collect::<Result<BTreeSet<_>, _>>()?;

    Ok(keys)
}

fn migration_rows(connection: &Connection) -> Result<Vec<(i64, String)>, Box<dyn Error>> {
    let mut statement =
        connection.prepare("SELECT version, name FROM dispatch_migrations ORDER BY version")?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

fn pragma_i64(connection: &Connection, pragma_name: &str) -> Result<i64, Box<dyn Error>> {
    Ok(connection.query_row(&format!("PRAGMA {pragma_name}"), [], |row| row.get(0))?)
}

fn pragma_string(connection: &Connection, pragma_name: &str) -> Result<String, Box<dyn Error>> {
    Ok(connection.query_row(&format!("PRAGMA {pragma_name}"), [], |row| row.get(0))?)
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
