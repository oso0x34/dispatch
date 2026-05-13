use std::path::Path;

use git2::{ErrorCode, Oid, Repository, Signature, Status, StatusOptions, Tree};
use serde::{Deserialize, Serialize};

use crate::{
    db::Database,
    error::{AppError, AppResult},
};

use super::{
    is_git_repository, load_project_root, now_unix_seconds, record_save_point,
    validate_required_field, RecordSavePointInput, SavePoint, SAVE_POINT_REF_PREFIX,
    SAVE_POINT_STAGE_MANUAL, SAVE_POINT_STAGE_POST_AGENT, SAVE_POINT_STAGE_PRE_AGENT,
};

const SAVE_POINT_CREATE_STATUS_CREATED: &str = "created";
const SAVE_POINT_CREATE_STATUS_UNSUPPORTED: &str = "unsupported";
const SYNTHETIC_AUTHOR_NAME: &str = "Dispatch";
const SYNTHETIC_AUTHOR_EMAIL: &str = "dispatch@local";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavePointCreateResult {
    pub status: String,
    pub save_point: Option<SavePoint>,
}

impl SavePointCreateResult {
    fn created(save_point: SavePoint) -> Self {
        Self {
            status: SAVE_POINT_CREATE_STATUS_CREATED.to_string(),
            save_point: Some(save_point),
        }
    }

    pub fn unsupported() -> Self {
        Self {
            status: SAVE_POINT_CREATE_STATUS_UNSUPPORTED.to_string(),
            save_point: None,
        }
    }

    pub fn is_unsupported(&self) -> bool {
        self.status == SAVE_POINT_CREATE_STATUS_UNSUPPORTED
    }
}

enum LatestRefSnapshot {
    Missing,
    Direct(Oid),
    Symbolic(String),
}

pub fn create_pre_agent_save_point(
    database: &Database,
    project_id: &str,
    run_id: &str,
) -> AppResult<SavePointCreateResult> {
    let normalized_run_id = validate_required_field("run id", run_id)?;
    create_save_point(
        database,
        project_id,
        Some(normalized_run_id.clone()),
        SAVE_POINT_STAGE_PRE_AGENT,
        &format!("pre-agent-{normalized_run_id}"),
        &format!("Dispatch pre-agent save point for {normalized_run_id}"),
    )
}

pub fn create_post_agent_save_point(
    database: &Database,
    project_id: &str,
    run_id: &str,
) -> AppResult<SavePointCreateResult> {
    let normalized_run_id = validate_required_field("run id", run_id)?;
    create_save_point(
        database,
        project_id,
        Some(normalized_run_id.clone()),
        SAVE_POINT_STAGE_POST_AGENT,
        &format!("post-agent-{normalized_run_id}"),
        &format!("Dispatch post-agent save point for {normalized_run_id}"),
    )
}

pub fn create_manual_save_point(
    database: &Database,
    project_id: &str,
    label: Option<&str>,
) -> AppResult<SavePointCreateResult> {
    let manual_suffix = normalize_label(
        label.and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        }),
        "manual",
    );
    let ref_label = if manual_suffix == "manual" {
        "manual".to_string()
    } else {
        format!("manual-{manual_suffix}")
    };
    let message = if manual_suffix == "manual" {
        "Dispatch manual save point".to_string()
    } else {
        format!("Dispatch manual save point: {manual_suffix}")
    };

    create_save_point(
        database,
        project_id,
        None,
        SAVE_POINT_STAGE_MANUAL,
        &ref_label,
        &message,
    )
}

fn create_save_point(
    database: &Database,
    project_id: &str,
    run_id: Option<String>,
    stage: &str,
    label: &str,
    message: &str,
) -> AppResult<SavePointCreateResult> {
    let normalized_project_id = validate_required_field("project id", project_id)?;
    let normalized_stage = validate_required_field("save point stage", stage)?;
    let project_root = load_project_root(database, &normalized_project_id)?;
    if !is_git_repository(&project_root) {
        return Ok(SavePointCreateResult::unsupported());
    }

    let repo = Repository::open(&project_root)
        .map_err(|error| git_error("open git repository for save point", error))?;
    let head_commit = load_head_commit(&repo)?;
    let base_head_oid = head_commit.as_ref().map(|commit| commit.id().to_string());
    let tree = build_snapshot_tree(&repo, head_commit.as_ref())?;
    let ref_name = next_save_point_ref_name(&repo, &normalized_project_id, label);
    let latest_ref_name = format!("{SAVE_POINT_REF_PREFIX}/{normalized_project_id}/latest");
    let latest_snapshot = snapshot_latest_ref(&repo, &latest_ref_name)?;
    let signature = Signature::now(SYNTHETIC_AUTHOR_NAME, SYNTHETIC_AUTHOR_EMAIL)
        .map_err(|error| git_error("build synthetic save-point signature", error))?;
    let parent_commits = head_commit.iter().collect::<Vec<_>>();
    let commit_oid = repo
        .commit(
            Some(&ref_name),
            &signature,
            &signature,
            message,
            &tree,
            &parent_commits,
        )
        .map_err(|error| git_error("create save-point commit", error))?;

    if let Err(error) = repo.reference_symbolic(
        &latest_ref_name,
        &ref_name,
        true,
        "Dispatch latest save point",
    ) {
        let _ = delete_reference_if_exists(&repo, &ref_name);
        return Err(git_error("update latest save-point ref", error));
    }

    let save_point = record_save_point(
        database,
        RecordSavePointInput {
            project_id: normalized_project_id.clone(),
            run_id,
            ref_name: ref_name.clone(),
            commit_oid: commit_oid.to_string(),
            base_head_oid,
            stage: normalized_stage,
        },
    );

    match save_point {
        Ok(save_point) => Ok(SavePointCreateResult::created(save_point)),
        Err(error) => {
            let _ = delete_reference_if_exists(&repo, &ref_name);
            let _ = restore_latest_ref(&repo, &latest_ref_name, latest_snapshot);
            Err(error)
        }
    }
}

fn load_head_commit(repo: &Repository) -> AppResult<Option<git2::Commit<'_>>> {
    match repo.head() {
        Ok(head) => head
            .peel_to_commit()
            .map(Some)
            .map_err(|error| git_error("resolve repository HEAD commit", error)),
        Err(error) if matches!(error.code(), ErrorCode::NotFound | ErrorCode::UnbornBranch) => {
            Ok(None)
        }
        Err(error) => Err(git_error("resolve repository HEAD", error)),
    }
}

fn build_snapshot_tree<'repo>(
    repo: &'repo Repository,
    head_commit: Option<&git2::Commit<'repo>>,
) -> AppResult<Tree<'repo>> {
    let mut index = repo
        .index()
        .map_err(|error| git_error("open repository index for save point", error))?;

    if let Some(head_commit) = head_commit {
        let head_tree = head_commit
            .tree()
            .map_err(|error| git_error("read HEAD tree for save point", error))?;
        index
            .read_tree(&head_tree)
            .map_err(|error| git_error("seed save-point index from HEAD tree", error))?;
    } else {
        index
            .clear()
            .map_err(|error| git_error("clear save-point index", error))?;
    }

    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo
        .statuses(Some(&mut status_options))
        .map_err(|error| git_error("read repository status for save point", error))?;
    for entry in statuses.iter() {
        let Some(path) = entry.path() else {
            continue;
        };
        let status = entry.status();
        let index_path = Path::new(path);

        if should_remove_path(status) {
            let _ = index.remove_path(index_path);
        }

        if should_add_path(status) {
            index
                .add_path(index_path)
                .map_err(|error| git_error("stage repository path in save-point index", error))?;
        }
    }

    let tree_oid = index
        .write_tree_to(repo)
        .map_err(|error| git_error("write save-point tree to repository", error))?;

    repo.find_tree(tree_oid)
        .map_err(|error| git_error("load save-point tree from repository", error))
}

fn should_remove_path(status: Status) -> bool {
    status.is_index_deleted() || status.is_wt_deleted()
}

fn should_add_path(status: Status) -> bool {
    status.is_index_new()
        || status.is_index_modified()
        || status.is_index_renamed()
        || status.is_index_typechange()
        || status.is_wt_new()
        || status.is_wt_modified()
        || status.is_wt_renamed()
        || status.is_wt_typechange()
        || status.is_conflicted()
}

fn next_save_point_ref_name(repo: &Repository, project_id: &str, label: &str) -> String {
    next_save_point_ref_name_with_timestamp(repo, project_id, label, now_unix_seconds())
}

fn next_save_point_ref_name_with_timestamp(
    repo: &Repository,
    project_id: &str,
    label: &str,
    timestamp: i64,
) -> String {
    let normalized_label = normalize_label(Some(label), "manual");
    let prefix = format!("{SAVE_POINT_REF_PREFIX}/{project_id}/{timestamp}-{normalized_label}");

    if repo.find_reference(&prefix).is_err() {
        return prefix;
    }

    let mut suffix = 2_u32;
    loop {
        let candidate = format!("{prefix}-{suffix}");
        if repo.find_reference(&candidate).is_err() {
            return candidate;
        }

        suffix += 1;
    }
}

fn normalize_label(value: Option<&str>, fallback: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_dash = false;

    for character in value.unwrap_or(fallback).chars() {
        let normalized = character.to_ascii_lowercase();
        if normalized.is_ascii_alphanumeric() {
            slug.push(normalized);
            previous_was_dash = false;
            continue;
        }

        if (normalized.is_ascii_whitespace() || matches!(normalized, '-' | '_' | '.' | '/' | ':'))
            && !slug.is_empty()
            && !previous_was_dash
        {
            slug.push('-');
            previous_was_dash = true;
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }

    if slug.is_empty() {
        fallback.to_string()
    } else {
        slug
    }
}

fn snapshot_latest_ref(repo: &Repository, latest_ref_name: &str) -> AppResult<LatestRefSnapshot> {
    let latest_ref = match repo.find_reference(latest_ref_name) {
        Ok(reference) => reference,
        Err(error) if error.code() == ErrorCode::NotFound => return Ok(LatestRefSnapshot::Missing),
        Err(error) => return Err(git_error("read previous latest save-point ref", error)),
    };

    if latest_ref.symbolic_target().is_some() {
        return Ok(LatestRefSnapshot::Symbolic(
            latest_ref.symbolic_target().unwrap_or_default().to_string(),
        ));
    }

    if let Some(target) = latest_ref.target() {
        return Ok(LatestRefSnapshot::Direct(target));
    }

    Ok(LatestRefSnapshot::Missing)
}

fn restore_latest_ref(
    repo: &Repository,
    latest_ref_name: &str,
    snapshot: LatestRefSnapshot,
) -> AppResult<()> {
    match snapshot {
        LatestRefSnapshot::Missing => {
            delete_reference_if_exists(repo, latest_ref_name)?;
        }
        LatestRefSnapshot::Direct(target) => {
            repo.reference(
                latest_ref_name,
                target,
                true,
                "Restore Dispatch latest save point",
            )
            .map_err(|error| git_error("restore latest save-point ref", error))?;
        }
        LatestRefSnapshot::Symbolic(target) => {
            repo.reference_symbolic(
                latest_ref_name,
                &target,
                true,
                "Restore Dispatch latest save point",
            )
            .map_err(|error| git_error("restore latest save-point ref", error))?;
        }
    }

    Ok(())
}

fn delete_reference_if_exists(repo: &Repository, ref_name: &str) -> AppResult<()> {
    match repo.find_reference(ref_name) {
        Ok(mut reference) => reference
            .delete()
            .map_err(|error| git_error("delete save-point ref", error)),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(()),
        Err(error) => Err(git_error("load save-point ref for deletion", error)),
    }
}

fn git_error(context: &str, error: git2::Error) -> AppError {
    AppError::new(format!("failed to {context}: {error}"))
}

#[cfg(test)]
mod tests {
    use std::{error::Error, fs};

    use git2::Repository;

    use super::{next_save_point_ref_name_with_timestamp, normalize_label};

    #[test]
    fn normalize_label_lowercases_and_sanitizes_manual_labels() {
        assert_eq!(
            normalize_label(Some("Before Refactor!!"), "manual"),
            "before-refactor"
        );
        assert_eq!(normalize_label(Some("  "), "manual"), "manual");
        assert_eq!(
            normalize_label(Some("session 01 / review"), "manual"),
            "session-01-review"
        );
    }

    #[test]
    fn next_save_point_ref_name_appends_a_numeric_suffix_for_same_second_collisions(
    ) -> Result<(), Box<dyn Error>> {
        let temp_root = std::env::temp_dir().join(format!(
            "dispatch-save-point-ref-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        ));
        fs::create_dir_all(&temp_root)?;

        let repo = Repository::init(&temp_root)?;
        let first = next_save_point_ref_name_with_timestamp(
            &repo,
            "project-alpha",
            "manual-before-refactor",
            1_773_967_201,
        );
        repo.reference(&first, repo.blob(&[])?, true, "seed ref for collision test")?;

        let second = next_save_point_ref_name_with_timestamp(
            &repo,
            "project-alpha",
            "manual-before-refactor",
            1_773_967_201,
        );

        assert_eq!(
            second,
            "refs/dispatch/save-points/project-alpha/1773967201-manual-before-refactor-2"
        );

        let _ = fs::remove_dir_all(temp_root);

        Ok(())
    }
}
