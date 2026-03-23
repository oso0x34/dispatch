use std::{
    fs,
    path::{Path, PathBuf},
};

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::UTF8, BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

use crate::{
    db::Database,
    error::{AppError, AppResult},
};

use super::{path_guard, project_registry};

const TREE_ENTRY_KIND_DIRECTORY: &str = "directory";
const TREE_ENTRY_KIND_FILE: &str = "file";
const FILE_FORMAT_MARKDOWN: &str = "markdown";
const FILE_FORMAT_TEXT: &str = "text";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTreeEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFilePreview {
    pub path: String,
    pub absolute_path: String,
    pub name: String,
    pub format: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContentSearchHit {
    pub path: String,
    pub line_number: u64,
    pub line_text: String,
}

pub fn list_project_tree(
    database: &Database,
    project_id: &str,
    root_relative_path: Option<&str>,
) -> AppResult<Vec<ProjectTreeEntry>> {
    let project_root = load_project_root(database, project_id)?;
    let requested_relative_path = root_relative_path.unwrap_or(".");
    let directory_path =
        path_guard::assert_project_relative(database, project_id, requested_relative_path)?;

    if !directory_path.exists() {
        return Err(AppError::new("project path was not found"));
    }

    if !directory_path.is_dir() {
        return Err(AppError::new("project path is not a directory"));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&directory_path).map_err(|error| {
        AppError::new(format!(
            "failed to read project directory {}: {error}",
            directory_path.display()
        ))
    })?;

    for entry in read_dir {
        let entry = entry.map_err(|error| {
            AppError::new(format!(
                "failed to inspect project directory {}: {error}",
                directory_path.display()
            ))
        })?;
        let relative_path = entry
            .path()
            .strip_prefix(&project_root)
            .map_err(|_| {
                AppError::new(format!(
                    "project path escapes project root: {}",
                    entry.path().display()
                ))
            })?
            .to_path_buf();
        let relative_path_string = relative_path_to_string(&relative_path);
        let validated_path = match path_guard::assert_project_relative(
            database,
            project_id,
            &relative_path_string,
        ) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let kind = if validated_path.is_dir() {
            TREE_ENTRY_KIND_DIRECTORY
        } else {
            TREE_ENTRY_KIND_FILE
        };

        entries.push(ProjectTreeEntry {
            path: relative_path_string,
            name: file_name,
            kind: kind.to_string(),
        });
    }

    entries.sort_by(|left, right| {
        if left.kind != right.kind {
            return if left.kind == TREE_ENTRY_KIND_DIRECTORY {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }

        left.name.to_lowercase().cmp(&right.name.to_lowercase())
    });

    Ok(entries)
}

pub fn read_project_file(
    database: &Database,
    project_id: &str,
    relative_path: &str,
) -> AppResult<ProjectFilePreview> {
    let project_root = load_project_root(database, project_id)?;
    let file_path = path_guard::assert_project_relative(database, project_id, relative_path)?;

    if !file_path.exists() {
        return Err(AppError::new("project path was not found"));
    }

    if !file_path.is_file() {
        return Err(AppError::new("project path is not a file"));
    }

    let bytes = fs::read(&file_path).map_err(|error| {
        AppError::new(format!(
            "failed to read project file {}: {error}",
            file_path.display()
        ))
    })?;

    if bytes.contains(&0) {
        return Err(AppError::new("project file is not previewable"));
    }

    let content =
        String::from_utf8(bytes).map_err(|_| AppError::new("project file is not previewable"))?;
    let path = file_path
        .strip_prefix(&project_root)
        .map_err(|_| {
            AppError::new(format!(
                "project path escapes project root: {}",
                file_path.display()
            ))
        })?
        .to_path_buf();

    Ok(ProjectFilePreview {
        path: relative_path_to_string(&path),
        absolute_path: file_path.to_string_lossy().into_owned(),
        name: file_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        format: detect_file_format(&file_path).to_string(),
        content,
    })
}

pub fn search_project_paths(
    database: &Database,
    project_id: &str,
    query: &str,
) -> AppResult<Vec<ProjectTreeEntry>> {
    let project_root = load_project_root(database, project_id)?;
    let query = normalize_search_query(query)?;
    let query_lower = query.to_ascii_lowercase();
    let mut results = Vec::new();

    for entry in build_project_walker(&project_root).build() {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if path == project_root {
            continue;
        }

        let Ok(relative_path) = path.strip_prefix(&project_root) else {
            continue;
        };
        let relative_path_string = relative_path_to_string(relative_path);
        if path_guard::assert_project_relative(database, project_id, &relative_path_string).is_err()
        {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let relative_path_lower = relative_path_string.to_ascii_lowercase();
        let name_lower = name.to_ascii_lowercase();
        if !relative_path_lower.contains(&query_lower) && !name_lower.contains(&query_lower) {
            continue;
        }

        let kind = if entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or(false)
        {
            TREE_ENTRY_KIND_DIRECTORY
        } else {
            TREE_ENTRY_KIND_FILE
        };

        results.push(ProjectTreeEntry {
            path: relative_path_string,
            name,
            kind: kind.to_string(),
        });
    }

    results.sort_by(|left, right| {
        if left.kind != right.kind {
            return if left.kind == TREE_ENTRY_KIND_DIRECTORY {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }

        left.path.to_lowercase().cmp(&right.path.to_lowercase())
    });

    Ok(results)
}

pub fn search_project_content(
    database: &Database,
    project_id: &str,
    query: &str,
) -> AppResult<Vec<ProjectContentSearchHit>> {
    let project_root = load_project_root(database, project_id)?;
    let query = normalize_search_query(query)?;
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(true)
        .fixed_strings(true)
        .build(&query)
        .map_err(|error| AppError::new(format!("project search query is invalid: {error}")))?;
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\0'))
        .line_number(true)
        .build();
    let mut results = Vec::new();

    for entry in build_project_walker(&project_root).build() {
        let Ok(entry) = entry else {
            continue;
        };

        if !entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
        {
            continue;
        }

        let path = entry.path();
        let Ok(relative_path) = path.strip_prefix(&project_root) else {
            continue;
        };
        let relative_path_string = relative_path_to_string(relative_path);
        if path_guard::assert_project_relative(database, project_id, &relative_path_string).is_err()
        {
            continue;
        }

        searcher
            .search_path(
                &matcher,
                path,
                UTF8(|line_number, line| {
                    results.push(ProjectContentSearchHit {
                        path: relative_path_string.clone(),
                        line_number,
                        line_text: line.trim_end_matches(['\n', '\r']).to_string(),
                    });

                    Ok(true)
                }),
            )
            .map_err(|error| AppError::new(format!("project content search failed: {error}")))?;
    }

    Ok(results)
}

fn load_project_root(database: &Database, project_id: &str) -> AppResult<PathBuf> {
    let project = project_registry::get_project(database, project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;

    path_guard::canonicalize_project_root(Path::new(&project.root_path))
}

fn relative_path_to_string(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        return ".".to_string();
    }

    path.components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn detect_file_format(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("md" | "markdown") => FILE_FORMAT_MARKDOWN,
        _ => FILE_FORMAT_TEXT,
    }
}

fn normalize_search_query(query: &str) -> AppResult<String> {
    let normalized = query.trim();

    if normalized.is_empty() {
        return Err(AppError::new("search query cannot be blank"));
    }

    Ok(normalized.to_string())
}

fn build_project_walker(project_root: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(project_root);
    builder.hidden(false);
    builder.git_ignore(true);
    builder.git_exclude(true);
    builder.git_global(true);
    builder.follow_links(false);
    builder.require_git(false);
    builder
}
