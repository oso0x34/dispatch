use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

use rusqlite::OptionalExtension;

use crate::{
    db::Database,
    error::{AppError, AppResult},
};

pub fn canonicalize_project_root(root_path: &Path) -> AppResult<PathBuf> {
    let canonical_root = fs::canonicalize(root_path).map_err(|error| {
        AppError::new(format!(
            "failed to canonicalize project root {}: {error}",
            root_path.display()
        ))
    })?;

    if !canonical_root.is_dir() {
        return Err(AppError::new(format!(
            "project root must be a directory: {}",
            canonical_root.display()
        )));
    }

    Ok(canonical_root)
}

pub fn assert_project_relative(
    database: &Database,
    project_id: &str,
    relative_path: impl AsRef<Path>,
) -> AppResult<PathBuf> {
    let project_root = load_project_root(database, project_id)?;
    resolve_project_relative(&project_root, relative_path.as_ref())
}

fn load_project_root(database: &Database, project_id: &str) -> AppResult<PathBuf> {
    let root_path = database.with_connection(|connection| -> AppResult<Option<String>> {
        let root_path = connection
            .query_row(
                "SELECT root_path FROM projects WHERE id = ?1",
                [project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        Ok(root_path)
    })?;

    let root_path = root_path
        .ok_or_else(|| AppError::new(format!("project {project_id} is not registered")))?;

    validate_registered_project_root(Path::new(&root_path))
}

fn validate_registered_project_root(root_path: &Path) -> AppResult<PathBuf> {
    if !root_path.is_absolute() {
        return Err(AppError::new(format!(
            "registered project root must be absolute: {}",
            root_path.display()
        )));
    }

    for ancestor in root_path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        let metadata = fs::symlink_metadata(ancestor).map_err(|error| {
            AppError::new(format!(
                "failed to inspect registered project root {}: {error}",
                ancestor.display()
            ))
        })?;

        if metadata.file_type().is_symlink() {
            return Err(AppError::new(format!(
                "registered project root resolves through symlink: {}",
                ancestor.display()
            )));
        }
    }

    let metadata = fs::metadata(root_path).map_err(|error| {
        AppError::new(format!(
            "failed to access registered project root {}: {error}",
            root_path.display()
        ))
    })?;

    if !metadata.is_dir() {
        return Err(AppError::new(format!(
            "registered project root must be a directory: {}",
            root_path.display()
        )));
    }

    Ok(root_path.to_path_buf())
}

fn resolve_project_relative(project_root: &Path, relative_path: &Path) -> AppResult<PathBuf> {
    if relative_path.as_os_str().is_empty() {
        return Ok(project_root.to_path_buf());
    }

    let mut resolved_path = project_root.to_path_buf();

    for component in relative_path.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(segment) => {
                let candidate_path = resolved_path.join(segment);
                match fs::symlink_metadata(&candidate_path) {
                    Ok(metadata) => {
                        let canonical_candidate =
                            fs::canonicalize(&candidate_path).map_err(|error| {
                                let path_kind = if metadata.file_type().is_symlink() {
                                    "symlink"
                                } else {
                                    "project path"
                                };

                                AppError::new(format!(
                                    "failed to canonicalize {path_kind} {}: {error}",
                                    candidate_path.display()
                                ))
                            })?;
                        ensure_within_project_root(project_root, &canonical_candidate)?;
                        resolved_path = canonical_candidate;
                    }
                    Err(error) if error.kind() == ErrorKind::NotFound => {
                        resolved_path = candidate_path;
                    }
                    Err(error) => {
                        return Err(AppError::new(format!(
                            "failed to inspect project path {}: {error}",
                            candidate_path.display()
                        )))
                    }
                }
            }
            Component::ParentDir => {
                return Err(AppError::new(format!(
                    "path traversal is not allowed: {}",
                    relative_path.display()
                )))
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::new(format!(
                    "absolute paths are not allowed: {}",
                    relative_path.display()
                )))
            }
        }
    }

    if resolved_path.exists() {
        let canonical_resolved = fs::canonicalize(&resolved_path).map_err(|error| {
            AppError::new(format!(
                "failed to canonicalize project path {}: {error}",
                resolved_path.display()
            ))
        })?;
        ensure_within_project_root(project_root, &canonical_resolved)?;
        return Ok(canonical_resolved);
    }

    if let Some(existing_parent) = nearest_existing_parent(&resolved_path) {
        ensure_within_project_root(project_root, &existing_parent)?;
    }

    Ok(resolved_path)
}

fn ensure_within_project_root(project_root: &Path, candidate_path: &Path) -> AppResult<()> {
    if candidate_path == project_root || candidate_path.starts_with(project_root) {
        return Ok(());
    }

    Err(AppError::new(format!(
        "path escapes project root: {}",
        candidate_path.display()
    )))
}

fn nearest_existing_parent(path: &Path) -> Option<PathBuf> {
    let mut current = path.to_path_buf();

    loop {
        if current.exists() {
            return fs::canonicalize(&current).ok();
        }

        current = current.parent()?.to_path_buf();
    }
}
