use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::error::AppResult;

const MIGRATIONS_TABLE: &str = "dispatch_migrations";

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "001_init",
        sql: include_str!("../../migrations/001_init.sql"),
    },
    Migration {
        version: 2,
        name: "002_agent_profiles",
        sql: include_str!("../../migrations/002_agent_profiles.sql"),
    },
    Migration {
        version: 3,
        name: "003_task_metadata",
        sql: include_str!("../../migrations/003_task_metadata.sql"),
    },
    Migration {
        version: 4,
        name: "004_save_points",
        sql: include_str!("../../migrations/004_save_points.sql"),
    },
    Migration {
        version: 5,
        name: "005_chat_cache",
        sql: include_str!("../../migrations/005_chat_cache.sql"),
    },
    Migration {
        version: 6,
        name: "006_native_cli_profiles",
        sql: include_str!("../../migrations/006_native_cli_profiles.sql"),
    },
];

pub(crate) fn run_pending_migrations(connection: &mut Connection) -> AppResult<Vec<&'static str>> {
    ensure_migrations_table(connection)?;

    let applied_versions = load_applied_versions(connection)?;
    let mut applied_migrations = Vec::new();

    for migration in MIGRATIONS {
        if applied_versions.contains(&migration.version) {
            continue;
        }

        let transaction = connection.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            &format!(
                "INSERT INTO {MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?1, ?2, ?3)"
            ),
            params![migration.version, migration.name, now_unix_seconds()],
        )?;
        transaction.commit()?;
        applied_migrations.push(migration.name);
    }

    Ok(applied_migrations)
}

fn ensure_migrations_table(connection: &Connection) -> AppResult<()> {
    connection.execute_batch(&format!(
        "
        CREATE TABLE IF NOT EXISTS {MIGRATIONS_TABLE} (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at INTEGER NOT NULL CHECK(applied_at >= 0)
        );
        "
    ))?;

    Ok(())
}

fn load_applied_versions(connection: &Connection) -> AppResult<Vec<i64>> {
    let mut statement = connection.prepare(&format!(
        "SELECT version FROM {MIGRATIONS_TABLE} ORDER BY version"
    ))?;
    let versions = statement
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(versions)
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
