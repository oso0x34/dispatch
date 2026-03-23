use std::{
    ffi::OsStr,
    fs,
    fs::OpenOptions,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{Manager, Runtime};
use tracing_appender::{non_blocking, non_blocking::WorkerGuard};
use tracing_subscriber::{util::SubscriberInitExt, EnvFilter};

use crate::error::{AppError, AppResult};

const ACTIVE_LOG_NAME: &str = "dispatch.log";
const ROTATED_LOG_PREFIX: &str = "dispatch.";
const ROTATED_LOG_SUFFIX: &str = ".log";
const MAX_LOG_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ROTATED_LOG_FILES: usize = 10;
const SECONDS_PER_DAY: u64 = 86_400;

pub struct LoggingState {
    log_directory: PathBuf,
    _guard: Mutex<WorkerGuard>,
}

impl LoggingState {
    pub fn log_directory(&self) -> &Path {
        &self.log_directory
    }

    pub fn active_log_path(&self) -> PathBuf {
        self.log_directory.join(ACTIVE_LOG_NAME)
    }
}

pub fn init<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> AppResult<LoggingState> {
    let log_directory = app_handle
        .path()
        .app_log_dir()
        .map_err(|error| AppError::new(format!("failed to resolve app log directory: {error}")))?;

    fs::create_dir_all(&log_directory)
        .map_err(|error| AppError::new(format!("failed to create log directory: {error}")))?;

    let file_writer = DispatchLogWriter::new(log_directory.clone())?;
    let (non_blocking_writer, guard) = non_blocking(file_writer);

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("dispatch=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_ansi(false)
        .with_target(false)
        .compact()
        .with_writer(non_blocking_writer)
        .finish()
        .try_init()
        .map_err(|error| {
            AppError::new(format!("failed to initialize tracing subscriber: {error}"))
        })?;

    tracing::info!(
      log_directory = %log_directory.display(),
      active_log = ACTIVE_LOG_NAME,
      "dispatch logging initialized"
    );

    Ok(LoggingState {
        log_directory,
        _guard: Mutex::new(guard),
    })
}

struct DispatchLogWriter {
    log_directory: PathBuf,
    active_log_path: PathBuf,
    file: Option<std::fs::File>,
    current_day: u64,
    current_size: u64,
}

impl DispatchLogWriter {
    fn new(log_directory: PathBuf) -> AppResult<Self> {
        let active_log_path = log_directory.join(ACTIVE_LOG_NAME);
        let file = open_log_file(&active_log_path)?;
        let metadata = file.metadata().ok();

        Ok(Self {
            log_directory,
            active_log_path,
            file: Some(file),
            current_day: unix_day(SystemTime::now()),
            current_size: metadata.map_or(0, |entry| entry.len()),
        })
    }

    fn rotate_if_needed(&mut self, incoming_len: usize) -> io::Result<()> {
        let now = SystemTime::now();
        let next_day = unix_day(now);
        let exceeds_size =
            self.current_size.saturating_add(incoming_len as u64) > MAX_LOG_FILE_BYTES;
        let day_changed = next_day != self.current_day && self.current_size > 0;

        if !exceeds_size && !day_changed {
            return Ok(());
        }

        self.rotate(now, next_day)
    }

    fn rotate(&mut self, now: SystemTime, next_day: u64) -> io::Result<()> {
        if let Some(mut file) = self.file.take() {
            file.flush()?;
        }

        let archived_log_path = self.log_directory.join(format!(
            "{ROTATED_LOG_PREFIX}{}{ROTATED_LOG_SUFFIX}",
            rotation_timestamp(now),
        ));

        if self.active_log_path.exists() {
            fs::rename(&self.active_log_path, archived_log_path)?;
        }

        self.prune_rotated_logs()?;

        self.file = Some(open_log_file(&self.active_log_path)?);
        self.current_day = next_day;
        self.current_size = 0;

        Ok(())
    }

    fn prune_rotated_logs(&self) -> io::Result<()> {
        let mut entries = fs::read_dir(&self.log_directory)?
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| {
                let file_type = entry.file_type().ok()?;

                if !file_type.is_file() {
                    return None;
                }

                let file_name = entry.file_name();

                if !is_rotated_dispatch_log(file_name.as_os_str()) {
                    return None;
                }

                let modified_at = entry
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .unwrap_or(UNIX_EPOCH);

                Some((entry.path(), modified_at))
            })
            .collect::<Vec<_>>();

        if entries.len() <= MAX_ROTATED_LOG_FILES {
            return Ok(());
        }

        entries.sort_by_key(|(_, modified_at)| *modified_at);

        let remove_count = entries.len() - MAX_ROTATED_LOG_FILES;

        for (path, _) in entries.into_iter().take(remove_count) {
            fs::remove_file(path)?;
        }

        Ok(())
    }
}

impl Write for DispatchLogWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.rotate_if_needed(buf.len())?;

        let file = self
            .file
            .as_mut()
            .ok_or_else(|| io::Error::other("dispatch log file is unavailable"))?;

        let written = file.write(buf)?;
        self.current_size = self.current_size.saturating_add(written as u64);

        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        match self.file.as_mut() {
            Some(file) => file.flush(),
            None => Ok(()),
        }
    }
}

fn open_log_file(path: &Path) -> io::Result<std::fs::File> {
    OpenOptions::new().create(true).append(true).open(path)
}

fn unix_day(now: SystemTime) -> u64 {
    now.duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
        / SECONDS_PER_DAY
}

fn rotation_timestamp(now: SystemTime) -> String {
    let duration = now.duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO);

    format!("{}-{:03}", duration.as_secs(), duration.subsec_millis())
}

fn is_rotated_dispatch_log(file_name: &OsStr) -> bool {
    let Some(file_name) = file_name.to_str() else {
        return false;
    };

    file_name.starts_with(ROTATED_LOG_PREFIX)
        && file_name.ends_with(ROTATED_LOG_SUFFIX)
        && file_name != ACTIVE_LOG_NAME
}
