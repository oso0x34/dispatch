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
        assert_eq!(
            pragma_string(connection, "journal_mode")?.to_lowercase(),
            "wal"
        );

        let tables = schema_object_names(connection, "table")?;
        let expected_tables = BTreeSet::from([
            "agent_profiles".to_string(),
            "agent_sessions".to_string(),
            "chat_messages".to_string(),
            "dispatch_migrations".to_string(),
            "projects".to_string(),
            "save_points".to_string(),
            "settings".to_string(),
            "tasks".to_string(),
        ]);

        assert_eq!(tables, expected_tables);

        assert_eq!(
            table_columns(connection, "agent_profiles")?,
            vec![
                "id".to_string(),
                "name".to_string(),
                "program".to_string(),
                "args_json".to_string(),
                "env_json".to_string(),
                "cwd_json".to_string(),
                "created_at".to_string(),
                "updated_at".to_string(),
            ]
        );
        assert_eq!(
            table_columns(connection, "chat_messages")?,
            vec![
                "id".to_string(),
                "conversation_id".to_string(),
                "project_id".to_string(),
                "agent_session_id".to_string(),
                "role".to_string(),
                "author_kind".to_string(),
                "body_markdown".to_string(),
                "metadata_json".to_string(),
                "created_at".to_string(),
            ]
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
                "priority".to_string(),
                "labels_json".to_string(),
                "subtasks_json".to_string(),
                "review_notes_markdown".to_string(),
                "assignee".to_string(),
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
        assert_eq!(
            table_columns(connection, "save_points")?,
            vec![
                "project_id".to_string(),
                "ref_name".to_string(),
                "commit_oid".to_string(),
                "base_head_oid".to_string(),
                "run_id".to_string(),
                "stage".to_string(),
                "created_at".to_string(),
            ]
        );

        let indexes = schema_object_names(connection, "index")?;
        for required_index in [
            "idx_agent_profiles_name",
            "idx_tasks_project_workflow_updated_at",
            "idx_tasks_project_last_run_updated_at",
            "idx_agent_sessions_project_status_created_at",
            "idx_agent_sessions_task_created_at",
            "idx_chat_messages_project_conversation_created_at",
            "idx_save_points_project_created_at",
            "idx_save_points_project_run",
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

        let save_point_foreign_keys = foreign_keys(connection, "save_points")?;
        assert!(save_point_foreign_keys.contains(&(
            "project_id".to_string(),
            "projects".to_string(),
            "CASCADE".to_string(),
        )));

        let applied_migrations = migration_rows(connection)?;
        assert_eq!(
            applied_migrations,
            vec![
                (1, "001_init".to_string()),
                (2, "002_agent_profiles".to_string()),
                (3, "003_task_metadata".to_string()),
                (4, "004_save_points".to_string()),
                (5, "005_chat_cache".to_string()),
            ]
        );

        Ok(())
    })?;

    drop(database);

    let reopened = Database::initialize_at(&database_path)?;
    reopened.with_connection(|connection| -> Result<(), Box<dyn Error>> {
        let applied_migrations = migration_rows(connection)?;
        assert_eq!(
            applied_migrations,
            vec![
                (1, "001_init".to_string()),
                (2, "002_agent_profiles".to_string()),
                (3, "003_task_metadata".to_string()),
                (4, "004_save_points".to_string()),
                (5, "005_chat_cache".to_string()),
            ],
            "re-initializing the same database should not duplicate migration tracking"
        );

        Ok(())
    })?;

    cleanup_database_artifacts(&database_path);

    Ok(())
}

#[test]
fn existing_task_rows_receive_metadata_defaults_when_migrated() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("db-schema-upgrade");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let connection = Connection::open(&database_path)?;

    connection.execute_batch(include_str!("../migrations/001_init.sql"))?;
    connection.execute_batch(include_str!("../migrations/002_agent_profiles.sql"))?;
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS dispatch_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at INTEGER NOT NULL CHECK(applied_at >= 0)
        );
        ",
    )?;
    connection.execute(
        "INSERT INTO dispatch_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        (1_i64, "001_init", 100_i64),
    )?;
    connection.execute(
        "INSERT INTO dispatch_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        (2_i64, "002_agent_profiles", 200_i64),
    )?;
    connection.execute(
        "
        INSERT INTO projects (
            id,
            name,
            root_path,
            created_at,
            updated_at,
            last_opened_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ",
        (
            "project-legacy",
            "Legacy Project",
            "/tmp/dispatch-legacy",
            300_i64,
            300_i64,
            Option::<i64>::None,
        ),
    )?;
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
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ",
        (
            "task-legacy",
            "project-legacy",
            "Legacy Task",
            "Legacy body",
            "planning",
            "idle",
            Option::<String>::None,
            Some("auto".to_string()),
            Some("dispatch/tasks/legacy.md".to_string()),
            Some("Waiting on migration".to_string()),
            400_i64,
            500_i64,
            Option::<i64>::None,
        ),
    )?;
    drop(connection);

    let database = Database::initialize_at(&database_path)?;

    database.with_connection(|connection| -> Result<(), Box<dyn Error>> {
        let migrated_task = connection.query_row(
            "
            SELECT
                priority,
                labels_json,
                subtasks_json,
                review_notes_markdown,
                assignee,
                assigned_agent_mode,
                markdown_export_path,
                blocked_reason
            FROM tasks
            WHERE id = ?1
            ",
            ["task-legacy"],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )?;

        assert_eq!(migrated_task.0, "none");
        assert_eq!(migrated_task.1, "[]");
        assert_eq!(migrated_task.2, "[]");
        assert_eq!(migrated_task.3, "");
        assert_eq!(migrated_task.4, None);
        assert_eq!(migrated_task.5.as_deref(), Some("auto"));
        assert_eq!(migrated_task.6.as_deref(), Some("dispatch/tasks/legacy.md"));
        assert_eq!(migrated_task.7.as_deref(), Some("Waiting on migration"));

        assert_eq!(
            migration_rows(connection)?,
            vec![
                (1, "001_init".to_string()),
                (2, "002_agent_profiles".to_string()),
                (3, "003_task_metadata".to_string()),
                (4, "004_save_points".to_string()),
                (5, "005_chat_cache".to_string()),
            ]
        );

        assert_eq!(
            table_columns(connection, "save_points")?,
            vec![
                "project_id".to_string(),
                "ref_name".to_string(),
                "commit_oid".to_string(),
                "base_head_oid".to_string(),
                "run_id".to_string(),
                "stage".to_string(),
                "created_at".to_string(),
            ]
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
