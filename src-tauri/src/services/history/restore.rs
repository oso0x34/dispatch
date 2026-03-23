use std::{fs, path::Path};

use git2::{build::CheckoutBuilder, ErrorCode, Repository};
use serde::{Deserialize, Serialize};

use crate::{
    db::Database,
    error::{AppError, AppResult},
    services::path_guard,
};

use super::{
    is_git_repository, load_project_root, load_project_save_point, validate_required_field,
    SavePoint,
};

const SAVE_POINT_RESTORE_STATUS_RESTORED: &str = "restored";
const SAVE_POINT_RESTORE_STATUS_UNSUPPORTED: &str = "unsupported";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavePointRestoreResult {
    pub status: String,
    pub ref_name: Option<String>,
    pub restored_paths: Vec<String>,
}

impl SavePointRestoreResult {
    fn restored(ref_name: String, restored_paths: Vec<String>) -> Self {
        Self {
            status: SAVE_POINT_RESTORE_STATUS_RESTORED.to_string(),
            ref_name: Some(ref_name),
            restored_paths,
        }
    }

    pub fn unsupported() -> Self {
        Self {
            status: SAVE_POINT_RESTORE_STATUS_UNSUPPORTED.to_string(),
            ref_name: None,
            restored_paths: Vec::new(),
        }
    }
}

pub fn restore_project_save_point(
    database: &Database,
    project_id: &str,
    ref_name: &str,
) -> AppResult<SavePointRestoreResult> {
    let normalized_project_id = validate_required_field("project id", project_id)?;
    let project_root = load_project_root(database, &normalized_project_id)?;
    if !is_git_repository(&project_root) {
        return Ok(SavePointRestoreResult::unsupported());
    }

    let save_point = load_project_save_point(database, &normalized_project_id, ref_name)?
        .ok_or_else(|| AppError::new("save point not found"))?;
    let repo = Repository::open(&project_root)
        .map_err(|error| git_error("open git repository for restore", error))?;
    let commit = load_save_point_commit(&repo, &save_point)?;
    let tree = commit
        .tree()
        .map_err(|error| git_error("read save-point tree for restore", error))?;
    let restored_paths = current_diff_paths(&repo, &tree, None)?;

    let mut checkout = CheckoutBuilder::new();
    checkout
        .force()
        .update_index(true)
        .recreate_missing(true)
        .remove_untracked(true);
    repo.checkout_tree(tree.as_object(), Some(&mut checkout))
        .map_err(|error| git_error("restore workspace from save point", error))?;

    Ok(SavePointRestoreResult::restored(
        save_point.ref_name,
        restored_paths,
    ))
}

pub fn restore_project_save_point_file(
    database: &Database,
    project_id: &str,
    ref_name: &str,
    relative_path: &str,
) -> AppResult<SavePointRestoreResult> {
    let normalized_project_id = validate_required_field("project id", project_id)?;
    let normalized_relative_path = validate_required_field("restore path", relative_path)?;
    let project_root = load_project_root(database, &normalized_project_id)?;
    if !is_git_repository(&project_root) {
        return Ok(SavePointRestoreResult::unsupported());
    }

    let save_point = load_project_save_point(database, &normalized_project_id, ref_name)?
        .ok_or_else(|| AppError::new("save point not found"))?;
    let repo = Repository::open(&project_root)
        .map_err(|error| git_error("open git repository for file restore", error))?;
    let commit = load_save_point_commit(&repo, &save_point)?;
    let tree = commit
        .tree()
        .map_err(|error| git_error("read save-point tree for file restore", error))?;
    let project_path = path_guard::assert_project_relative(
        database,
        &normalized_project_id,
        &normalized_relative_path,
    )?;

    if tree.get_path(Path::new(&normalized_relative_path)).is_ok() {
        let mut checkout = CheckoutBuilder::new();
        checkout
            .force()
            .update_index(true)
            .recreate_missing(true)
            .disable_pathspec_match(true)
            .path(&normalized_relative_path);
        repo.checkout_tree(tree.as_object(), Some(&mut checkout))
            .map_err(|error| git_error("restore file from save point", error))?;
    } else {
        if project_path.exists() {
            if project_path.is_dir() {
                return Err(AppError::new("project path is not a file"));
            }

            fs::remove_file(&project_path).map_err(|error| {
                AppError::new(format!(
                    "failed to remove restored project file {}: {error}",
                    project_path.display()
                ))
            })?;
        }

        let mut index = repo
            .index()
            .map_err(|error| git_error("open repository index for file restore", error))?;
        let _ = index.remove_path(Path::new(&normalized_relative_path));
        index
            .write()
            .map_err(|error| git_error("write repository index after file restore", error))?;
    }

    Ok(SavePointRestoreResult::restored(
        save_point.ref_name,
        vec![normalized_relative_path],
    ))
}

fn current_diff_paths(
    repo: &Repository,
    tree: &git2::Tree<'_>,
    relative_path: Option<&str>,
) -> AppResult<Vec<String>> {
    let mut diff_options = git2::DiffOptions::new();
    diff_options
        .include_untracked(true)
        .recurse_untracked_dirs(true);
    if let Some(relative_path) = relative_path {
        diff_options.pathspec(relative_path);
    }

    let diff = repo
        .diff_tree_to_workdir_with_index(Some(tree), Some(&mut diff_options))
        .map_err(|error| git_error("diff save point against current workspace", error))?;

    Ok(diff
        .deltas()
        .map(|delta| {
            delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .unwrap_or_else(|| Path::new(""))
                .to_string_lossy()
                .to_string()
        })
        .collect())
}

fn load_save_point_commit<'repo>(
    repo: &'repo Repository,
    save_point: &SavePoint,
) -> AppResult<git2::Commit<'repo>> {
    match repo.find_reference(&save_point.ref_name) {
        Ok(reference) => reference
            .peel_to_commit()
            .map_err(|error| git_error("resolve save-point ref to commit", error)),
        Err(error) if error.code() == ErrorCode::NotFound => repo
            .find_commit(
                git2::Oid::from_str(&save_point.commit_oid).map_err(|parse_error| {
                    AppError::new(format!("save point commit oid is invalid: {parse_error}"))
                })?,
            )
            .map_err(|git_error_value| {
                git_error("load save-point commit from metadata", git_error_value)
            }),
        Err(error) => Err(git_error("load save-point ref", error)),
    }
}

fn git_error(context: &str, error: git2::Error) -> AppError {
    AppError::new(format!("failed to {context}: {error}"))
}
