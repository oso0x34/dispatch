use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use dispatch_lib::{
    db::Database,
    services::{
        file_watch::{FileWatchService, ProjectFilesRefreshEvent},
        project_registry,
    },
};

const TEST_POLL_INTERVAL: Duration = Duration::from_millis(20);
const TEST_DEBOUNCE_WINDOW: Duration = Duration::from_millis(80);

#[test]
fn file_watch_debounces_refresh_events_for_a_single_project() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("file-watch-debounce");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");
    fs::create_dir_all(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;
    let service = FileWatchService::with_timing(TEST_POLL_INTERVAL, TEST_DEBOUNCE_WINDOW);
    let (sender, receiver) = mpsc::channel::<ProjectFilesRefreshEvent>();

    assert_eq!(service.active_project_id(), None);

    let registration =
        service.start_project_watch_with_sink(&database, &project.id, move |event| {
            let _ = sender.send(event);
        })?;

    assert_eq!(registration.project_id, project.id);
    assert_eq!(
        registration.debounce_window_ms,
        TEST_DEBOUNCE_WINDOW.as_millis() as u64
    );
    assert_eq!(service.active_project_id(), Some(project.id.clone()));

    let watched_file = workspace.join("notes.txt");
    fs::write(&watched_file, "hello\n")?;
    thread::sleep(Duration::from_millis(30));
    fs::write(&watched_file, "hello again\n")?;

    let refresh_event = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("expected one debounced refresh event");
    assert_eq!(refresh_event.project_id, project.id);
    assert_eq!(refresh_event.changed_paths, vec!["notes.txt".to_string()]);
    assert!(refresh_event.changed_at_unix_ms > 0);

    let duplicate_event = receiver.recv_timeout(Duration::from_millis(220));
    assert!(
        duplicate_event.is_err(),
        "expected debounce to collapse rapid writes into one event"
    );

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn file_watch_replaces_the_active_project_and_stops_old_refreshes() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("file-watch-switch");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace_a = temp_root.join("workspace-a");
    let workspace_b = temp_root.join("workspace-b");
    fs::create_dir_all(&workspace_a)?;
    fs::create_dir_all(&workspace_b)?;

    let database = Database::initialize_at(&database_path)?;
    let project_a = project_registry::create_project(&database, "Workspace A", &workspace_a)?;
    let project_b = project_registry::create_project(&database, "Workspace B", &workspace_b)?;
    let service = FileWatchService::with_timing(TEST_POLL_INTERVAL, TEST_DEBOUNCE_WINDOW);
    let (sender, receiver) = mpsc::channel::<ProjectFilesRefreshEvent>();

    service.start_project_watch_with_sink(&database, &project_a.id, {
        let sender = sender.clone();
        move |event| {
            let _ = sender.send(event);
        }
    })?;

    service.start_project_watch_with_sink(&database, &project_b.id, move |event| {
        let _ = sender.send(event);
    })?;

    assert_eq!(service.active_project_id(), Some(project_b.id.clone()));

    fs::write(workspace_a.join("ignored-after-switch.txt"), "stale\n")?;
    thread::sleep(Duration::from_millis(220));
    assert!(
        receiver.try_recv().is_err(),
        "watch events from the replaced project should stop after the switch"
    );

    fs::write(workspace_b.join("fresh.txt"), "fresh\n")?;
    let refresh_event = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("expected refresh event for the active project");
    assert_eq!(refresh_event.project_id, project_b.id);
    assert_eq!(refresh_event.changed_paths, vec!["fresh.txt".to_string()]);

    cleanup_database_artifacts(&database_path);
    Ok(())
}

#[test]
fn file_watch_drop_stops_background_polling() -> Result<(), Box<dyn Error>> {
    let temp_root = unique_temp_directory("file-watch-drop");
    let database_path = temp_root.join("dispatch-test.sqlite3");
    let workspace = temp_root.join("workspace");
    fs::create_dir_all(&workspace)?;

    let database = Database::initialize_at(&database_path)?;
    let project = project_registry::create_project(&database, "Workspace", &workspace)?;
    let (sender, receiver) = mpsc::channel::<ProjectFilesRefreshEvent>();

    {
        let service = FileWatchService::with_timing(TEST_POLL_INTERVAL, TEST_DEBOUNCE_WINDOW);
        service.start_project_watch_with_sink(&database, &project.id, move |event| {
            let _ = sender.send(event);
        })?;
    }

    fs::write(workspace.join("after-drop.txt"), "done\n")?;
    thread::sleep(Duration::from_millis(220));
    assert!(
        receiver.try_recv().is_err(),
        "dropping the service should stop background polling"
    );

    cleanup_database_artifacts(&database_path);
    Ok(())
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
