use std::path::Path;

use git2::{Delta, DiffOptions, ErrorCode, Patch, Repository, Tree};
use serde::{Deserialize, Serialize};

use crate::{
    db::Database,
    error::{AppError, AppResult},
};

use super::{
    is_git_repository, load_project_root, load_project_save_point, validate_required_field,
    SavePoint,
};

const SAVE_POINT_DIFF_STATUS_READY: &str = "ready";
const SAVE_POINT_DIFF_STATUS_UNSUPPORTED: &str = "unsupported";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavePointDiffSummary {
    pub files_changed: usize,
    pub insertions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavePointDiffFile {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: String,
    pub is_binary: bool,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavePointDiff {
    pub project_id: String,
    pub ref_name: String,
    pub commit_oid: String,
    pub base_commit_oid: Option<String>,
    pub summary: SavePointDiffSummary,
    pub files: Vec<SavePointDiffFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavePointDiffResult {
    pub status: String,
    pub diff: Option<SavePointDiff>,
}

impl SavePointDiffResult {
    fn ready(diff: SavePointDiff) -> Self {
        Self {
            status: SAVE_POINT_DIFF_STATUS_READY.to_string(),
            diff: Some(diff),
        }
    }

    pub fn unsupported() -> Self {
        Self {
            status: SAVE_POINT_DIFF_STATUS_UNSUPPORTED.to_string(),
            diff: None,
        }
    }
}

pub fn get_save_point_diff(
    database: &Database,
    project_id: &str,
    ref_name: &str,
) -> AppResult<SavePointDiffResult> {
    let normalized_project_id = validate_required_field("project id", project_id)?;
    let project_root = load_project_root(database, &normalized_project_id)?;
    if !is_git_repository(&project_root) {
        return Ok(SavePointDiffResult::unsupported());
    }

    let save_point = load_project_save_point(database, &normalized_project_id, ref_name)?
        .ok_or_else(|| AppError::new("save point not found"))?;
    let repo = Repository::open(&project_root)
        .map_err(|error| git_error("open git repository for save-point diff", error))?;
    let save_commit = load_save_point_commit(&repo, &save_point)?;
    let save_tree = save_commit
        .tree()
        .map_err(|error| git_error("read save-point tree for diff", error))?;
    let base_tree = load_base_tree(&repo, &save_point)?;

    let mut diff_options = DiffOptions::new();
    diff_options
        .include_untracked(true)
        .recurse_untracked_dirs(true);
    let diff = repo
        .diff_tree_to_tree(
            base_tree.as_ref(),
            Some(&save_tree),
            Some(&mut diff_options),
        )
        .map_err(|error| git_error("diff save point against base tree", error))?;
    let stats = diff
        .stats()
        .map_err(|error| git_error("compute save-point diff stats", error))?;

    let mut files = Vec::new();
    for (index, delta) in diff.deltas().enumerate() {
        let is_binary = delta.old_file().is_binary() || delta.new_file().is_binary();
        let patch = if is_binary {
            String::new()
        } else {
            match Patch::from_diff(&diff, index)
                .map_err(|error| git_error("build save-point patch", error))?
            {
                Some(mut patch) => String::from_utf8_lossy(
                    patch
                        .to_buf()
                        .map_err(|error| git_error("format save-point patch", error))?
                        .as_ref(),
                )
                .to_string(),
                None => String::new(),
            }
        };

        files.push(SavePointDiffFile {
            path: diff_path(&delta),
            previous_path: delta.old_file().path().and_then(|path| {
                let old_path = path.to_string_lossy().to_string();
                let new_path = delta.new_file().path().map(|value| value.to_string_lossy());
                match new_path {
                    Some(new_path) if new_path == old_path => None,
                    _ => Some(old_path),
                }
            }),
            status: delta_status(delta.status()).to_string(),
            is_binary,
            patch,
        });
    }

    Ok(SavePointDiffResult::ready(SavePointDiff {
        project_id: save_point.project_id,
        ref_name: save_point.ref_name,
        commit_oid: save_point.commit_oid,
        base_commit_oid: save_point.base_head_oid,
        summary: SavePointDiffSummary {
            files_changed: stats.files_changed(),
            insertions: stats.insertions(),
            deletions: stats.deletions(),
        },
        files,
    }))
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

fn load_base_tree<'repo>(
    repo: &'repo Repository,
    save_point: &SavePoint,
) -> AppResult<Option<Tree<'repo>>> {
    let Some(base_head_oid) = save_point.base_head_oid.as_deref() else {
        return Ok(Some(empty_tree(repo)?));
    };

    let base_oid = git2::Oid::from_str(base_head_oid).map_err(|error| {
        AppError::new(format!("save point base commit oid is invalid: {error}"))
    })?;

    match repo.find_commit(base_oid) {
        Ok(commit) => commit
            .tree()
            .map(Some)
            .map_err(|error| git_error("read save-point base tree", error)),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(Some(empty_tree(repo)?)),
        Err(error) => Err(git_error("load save-point base commit", error)),
    }
}

fn empty_tree(repo: &Repository) -> AppResult<Tree<'_>> {
    let tree_oid = repo
        .treebuilder(None)
        .map_err(|error| git_error("create empty tree builder", error))?
        .write()
        .map_err(|error| git_error("write empty tree", error))?;

    repo.find_tree(tree_oid)
        .map_err(|error| git_error("load empty tree", error))
}

fn diff_path(delta: &git2::DiffDelta<'_>) -> String {
    delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .unwrap_or_else(|| Path::new(""))
        .to_string_lossy()
        .to_string()
}

fn delta_status(delta: Delta) -> &'static str {
    match delta {
        Delta::Added => "added",
        Delta::Deleted => "deleted",
        Delta::Modified => "modified",
        Delta::Renamed => "renamed",
        Delta::Copied => "copied",
        Delta::Typechange => "typechange",
        Delta::Ignored => "ignored",
        Delta::Unreadable => "unreadable",
        Delta::Untracked => "untracked",
        Delta::Conflicted => "conflicted",
        _ => "unknown",
    }
}

fn git_error(context: &str, error: git2::Error) -> AppError {
    AppError::new(format!("failed to {context}: {error}"))
}
