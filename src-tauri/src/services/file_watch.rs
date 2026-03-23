use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, RecvTimeoutError, Sender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::{
    db::Database,
    error::{AppError, AppResult},
};

use super::{path_guard, project_registry};

pub const FILE_WATCH_REFRESH_EVENT_NAME: &str = "dispatch://files/refresh";

const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(75);
const DEFAULT_DEBOUNCE_WINDOW: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileWatchRegistration {
    pub project_id: String,
    pub debounce_window_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFilesRefreshEvent {
    pub project_id: String,
    pub changed_at_unix_ms: u64,
    pub changed_paths: Vec<String>,
}

#[derive(Debug)]
pub struct FileWatchService {
    active_watch: Mutex<Option<ActiveFileWatch>>,
    poll_interval: Duration,
    debounce_window: Duration,
}

#[derive(Debug)]
struct ActiveFileWatch {
    project_id: String,
    shutdown_sender: Sender<()>,
    join_handle: JoinHandle<()>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SnapshotEntry {
    is_dir: bool,
    byte_len: u64,
    modified_at_unix_ms: u128,
}

impl Default for FileWatchService {
    fn default() -> Self {
        Self::new()
    }
}

impl FileWatchService {
    pub fn new() -> Self {
        Self {
            active_watch: Mutex::new(None),
            poll_interval: DEFAULT_POLL_INTERVAL,
            debounce_window: DEFAULT_DEBOUNCE_WINDOW,
        }
    }

    pub fn with_timing(poll_interval: Duration, debounce_window: Duration) -> Self {
        Self {
            active_watch: Mutex::new(None),
            poll_interval,
            debounce_window,
        }
    }

    pub fn active_project_id(&self) -> Option<String> {
        self.active_watch
            .lock()
            .ok()
            .and_then(|active_watch| active_watch.as_ref().map(|watch| watch.project_id.clone()))
    }

    pub fn start_project_watch<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        database: &Database,
        project_id: &str,
    ) -> AppResult<ProjectFileWatchRegistration> {
        let app_handle = app.clone();
        self.start_project_watch_with_sink(database, project_id, move |event| {
            let _ = app_handle.emit(FILE_WATCH_REFRESH_EVENT_NAME, &event);
        })
    }

    pub fn start_project_watch_with_sink<F>(
        &self,
        database: &Database,
        project_id: &str,
        sink: F,
    ) -> AppResult<ProjectFileWatchRegistration>
    where
        F: Fn(ProjectFilesRefreshEvent) + Send + Sync + 'static,
    {
        let normalized_project_id = project_id.trim();
        if normalized_project_id.is_empty() {
            return Err(AppError::new("project not found"));
        }

        let project_root = load_project_root(database, normalized_project_id)?;
        let registration = ProjectFileWatchRegistration {
            project_id: normalized_project_id.to_string(),
            debounce_window_ms: self.debounce_window.as_millis() as u64,
        };

        {
            let active_watch = self
                .active_watch
                .lock()
                .map_err(|_| AppError::new("file watch service is unavailable"))?;
            if active_watch
                .as_ref()
                .map(|watch| watch.project_id == normalized_project_id)
                .unwrap_or(false)
            {
                return Ok(registration);
            }
        }

        self.stop_project_watch();

        let (shutdown_sender, shutdown_receiver) = mpsc::channel::<()>();
        let poll_interval = self.poll_interval;
        let debounce_window = self.debounce_window;
        let sink = Arc::new(sink);
        let project_id = normalized_project_id.to_string();
        let join_handle = thread::Builder::new()
            .name(format!("dispatch-file-watch-{project_id}"))
            .spawn(move || {
                watch_project_loop(
                    project_id,
                    project_root,
                    poll_interval,
                    debounce_window,
                    sink,
                    shutdown_receiver,
                );
            })
            .map_err(|error| AppError::new(format!("failed to start file watcher: {error}")))?;

        let mut active_watch = self
            .active_watch
            .lock()
            .map_err(|_| AppError::new("file watch service is unavailable"))?;
        *active_watch = Some(ActiveFileWatch {
            project_id: registration.project_id.clone(),
            shutdown_sender,
            join_handle,
        });

        Ok(registration)
    }

    pub fn stop_project_watch(&self) -> bool {
        let active_watch = match self.active_watch.lock() {
            Ok(mut active_watch) => active_watch.take(),
            Err(_) => None,
        };

        let Some(active_watch) = active_watch else {
            return false;
        };

        let _ = active_watch.shutdown_sender.send(());
        let _ = active_watch.join_handle.join();
        true
    }
}

impl Drop for FileWatchService {
    fn drop(&mut self) {
        let active_watch = match self.active_watch.get_mut() {
            Ok(active_watch) => active_watch.take(),
            Err(_) => None,
        };

        if let Some(active_watch) = active_watch {
            let _ = active_watch.shutdown_sender.send(());
            let _ = active_watch.join_handle.join();
        }
    }
}

fn watch_project_loop(
    project_id: String,
    project_root: PathBuf,
    poll_interval: Duration,
    debounce_window: Duration,
    sink: Arc<dyn Fn(ProjectFilesRefreshEvent) + Send + Sync>,
    shutdown_receiver: mpsc::Receiver<()>,
) {
    let mut snapshot = match collect_snapshot(&project_root) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            tracing::error!(error = %error.message(), project_id, "failed to initialize file watch snapshot");
            BTreeMap::new()
        }
    };
    let mut pending_paths = BTreeSet::new();
    let mut pending_since: Option<Instant> = None;

    loop {
        match shutdown_receiver.recv_timeout(poll_interval) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }

        match collect_snapshot(&project_root) {
            Ok(next_snapshot) => {
                let changed_paths = diff_snapshot_paths(&snapshot, &next_snapshot);

                if !changed_paths.is_empty() {
                    pending_paths.extend(changed_paths);
                    pending_since = Some(Instant::now());
                }

                snapshot = next_snapshot;
            }
            Err(error) => {
                tracing::warn!(
                    error = %error.message(),
                    project_id,
                    project_root = %project_root.display(),
                    "failed to refresh file watch snapshot"
                );
            }
        }

        if let Some(started_at) = pending_since {
            if started_at.elapsed() >= debounce_window {
                let changed_paths = pending_paths.iter().cloned().collect::<Vec<_>>();

                if !changed_paths.is_empty() {
                    sink(ProjectFilesRefreshEvent {
                        project_id: project_id.clone(),
                        changed_at_unix_ms: now_unix_millis(),
                        changed_paths,
                    });
                }

                pending_paths.clear();
                pending_since = None;
            }
        }
    }
}

fn collect_snapshot(project_root: &Path) -> AppResult<BTreeMap<String, SnapshotEntry>> {
    let mut snapshot = BTreeMap::new();

    for entry in build_project_walker(project_root).build() {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();

        if path == project_root {
            continue;
        }

        let Ok(relative_path) = path.strip_prefix(project_root) else {
            continue;
        };
        let relative_path = relative_path_to_string(relative_path);
        let metadata = entry.metadata().map_err(|error| {
            AppError::new(format!(
                "failed to inspect project path {}: {error}",
                path.display()
            ))
        })?;
        let modified_at_unix_ms = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or_default();

        snapshot.insert(
            relative_path,
            SnapshotEntry {
                is_dir: metadata.is_dir(),
                byte_len: if metadata.is_file() {
                    metadata.len()
                } else {
                    0
                },
                modified_at_unix_ms,
            },
        );
    }

    Ok(snapshot)
}

fn diff_snapshot_paths(
    current: &BTreeMap<String, SnapshotEntry>,
    next: &BTreeMap<String, SnapshotEntry>,
) -> Vec<String> {
    let mut changed_paths = BTreeSet::new();

    for (path, entry) in next {
        if current.get(path) != Some(entry) {
            changed_paths.insert(path.clone());
        }
    }

    for path in current.keys() {
        if !next.contains_key(path) {
            changed_paths.insert(path.clone());
        }
    }

    changed_paths.into_iter().collect()
}

fn load_project_root(database: &Database, project_id: &str) -> AppResult<PathBuf> {
    let project = project_registry::get_project(database, project_id)?
        .ok_or_else(|| AppError::new("project not found"))?;

    path_guard::canonicalize_project_root(Path::new(&project.root_path))
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

fn relative_path_to_string(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        return ".".to_string();
    }

    path.components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
