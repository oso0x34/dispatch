use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::{
    db::Database,
    error::{AppError, AppResult},
};

use super::{path_guard, project_registry};

mod diff;
mod restore;
mod save_points;

pub const SAVE_POINT_REF_PREFIX: &str = "refs/dispatch/save-points";
pub const SAVE_POINT_STAGE_PRE_AGENT: &str = "pre_agent";
pub const SAVE_POINT_STAGE_POST_AGENT: &str = "post_agent";
pub const SAVE_POINT_STAGE_MANUAL: &str = "manual";

pub use diff::{
    get_save_point_diff, SavePointDiff, SavePointDiffFile, SavePointDiffResult,
    SavePointDiffSummary,
};
pub use restore::{
    restore_project_save_point, restore_project_save_point_file, SavePointRestoreResult,
};
pub use save_points::{
    create_manual_save_point, create_post_agent_save_point, create_pre_agent_save_point,
    SavePointCreateResult,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavePoint {
    pub project_id: String,
    pub run_id: Option<String>,
    pub ref_name: String,
    pub commit_oid: String,
    pub base_head_oid: Option<String>,
    pub stage: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordSavePointInput {
    pub project_id: String,
    pub run_id: Option<String>,
    pub ref_name: String,
    pub commit_oid: String,
    pub base_head_oid: Option<String>,
    pub stage: String,
}

pub fn record_save_point(database: &Database, input: RecordSavePointInput) -> AppResult<SavePoint> {
    let project_root = load_project_root(database, &input.project_id)?;
    ensure_git_repository(&project_root)?;

    let project_id = validate_required_field("project id", &input.project_id)?;
    let ref_name = validate_ref_name(&project_id, &input.ref_name)?;
    let commit_oid = validate_required_field("save point commit oid", &input.commit_oid)?;
    let base_head_oid = normalize_optional_field(input.base_head_oid.as_deref());
    let run_id = normalize_optional_field(input.run_id.as_deref());
    let stage = validate_stage(&input.stage)?;
    let created_at = now_unix_millis();

    database.with_connection(|connection| {
        connection.execute(
            "
            INSERT INTO save_points (
                project_id,
                run_id,
                ref_name,
                commit_oid,
                base_head_oid,
                stage,
                created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ",
            params![
                project_id,
                run_id,
                ref_name,
                commit_oid,
                base_head_oid,
                stage,
                created_at,
            ],
        )?;

        Ok(SavePoint {
            project_id,
            run_id,
            ref_name,
            commit_oid,
            base_head_oid,
            stage,
            created_at,
        })
    })
}

pub fn list_project_save_points(
    database: &Database,
    project_id: &str,
) -> AppResult<Vec<SavePoint>> {
    let normalized_project_id = validate_required_field("project id", project_id)?;
    let project_root = load_project_root(database, &normalized_project_id)?;
    ensure_git_repository(&project_root)?;

    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "
            SELECT project_id, run_id, ref_name, commit_oid, base_head_oid, stage, created_at
            FROM save_points
            WHERE project_id = ?1
            ORDER BY created_at DESC, ref_name DESC
            ",
        )?;
        let save_points = statement
            .query_map([normalized_project_id.as_str()], row_to_save_point)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(save_points)
    })
}

pub fn latest_project_save_point(
    database: &Database,
    project_id: &str,
) -> AppResult<Option<SavePoint>> {
    let normalized_project_id = validate_required_field("project id", project_id)?;
    let project_root = load_project_root(database, &normalized_project_id)?;
    ensure_git_repository(&project_root)?;

    database.with_connection(|connection| {
        let save_point = connection
            .query_row(
                "
                SELECT project_id, run_id, ref_name, commit_oid, base_head_oid, stage, created_at
                FROM save_points
                WHERE project_id = ?1
                ORDER BY created_at DESC, ref_name DESC
                LIMIT 1
                ",
                [normalized_project_id.as_str()],
                row_to_save_point,
            )
            .optional()?;

        Ok(save_point)
    })
}

pub(crate) fn load_project_save_point(
    database: &Database,
    project_id: &str,
    ref_name: &str,
) -> AppResult<Option<SavePoint>> {
    let normalized_project_id = validate_required_field("project id", project_id)?;
    let project_root = load_project_root(database, &normalized_project_id)?;
    ensure_git_repository(&project_root)?;
    let normalized_ref_name = validate_ref_name(&normalized_project_id, ref_name)?;

    database.with_connection(|connection| {
        let save_point = connection
            .query_row(
                "
                SELECT project_id, run_id, ref_name, commit_oid, base_head_oid, stage, created_at
                FROM save_points
                WHERE project_id = ?1
                  AND ref_name = ?2
                LIMIT 1
                ",
                params![normalized_project_id, normalized_ref_name],
                row_to_save_point,
            )
            .optional()?;

        Ok(save_point)
    })
}

fn row_to_save_point(row: &Row<'_>) -> rusqlite::Result<SavePoint> {
    Ok(SavePoint {
        project_id: row.get(0)?,
        run_id: row.get(1)?,
        ref_name: row.get(2)?,
        commit_oid: row.get(3)?,
        base_head_oid: row.get(4)?,
        stage: row.get(5)?,
        created_at: row.get(6)?,
    })
}

pub(crate) fn load_project_root(database: &Database, project_id: &str) -> AppResult<PathBuf> {
    let project = project_registry::get_project(database, project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;

    path_guard::canonicalize_project_root(Path::new(&project.root_path))
}

pub(crate) fn is_git_repository(project_root: &Path) -> bool {
    project_root.join(".git").exists()
}

fn ensure_git_repository(project_root: &Path) -> AppResult<()> {
    if is_git_repository(project_root) {
        return Ok(());
    }

    Err(AppError::new("project is not a git repository"))
}

pub(crate) fn validate_required_field(field_name: &str, value: &str) -> AppResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(AppError::new(format!("{field_name} cannot be blank")));
    }

    Ok(normalized.to_string())
}

pub(crate) fn normalize_optional_field(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn validate_ref_name(project_id: &str, ref_name: &str) -> AppResult<String> {
    let normalized_ref_name = validate_required_field("save point ref name", ref_name)?;
    let project_ref_prefix = format!("{SAVE_POINT_REF_PREFIX}/{project_id}/");

    if !normalized_ref_name.starts_with(&project_ref_prefix) {
        return Err(AppError::new(
            "save point ref name is outside the Dispatch namespace",
        ));
    }

    if normalized_ref_name == format!("{project_ref_prefix}latest") {
        return Err(AppError::new(
            "save point ref name cannot use the derived latest alias",
        ));
    }

    Ok(normalized_ref_name)
}

fn validate_stage(stage: &str) -> AppResult<String> {
    let normalized_stage = validate_required_field("save point stage", stage)?;

    match normalized_stage.as_str() {
        SAVE_POINT_STAGE_PRE_AGENT | SAVE_POINT_STAGE_POST_AGENT | SAVE_POINT_STAGE_MANUAL => {
            Ok(normalized_stage)
        }
        _ => Err(AppError::new("save point stage is invalid")),
    }
}

pub(crate) fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

pub(crate) fn now_unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
