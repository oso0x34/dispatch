use std::{
    backtrace::Backtrace,
    fs::{self, OpenOptions},
    io::Write,
    panic::{self, PanicHookInfo},
    path::{Path, PathBuf},
    sync::OnceLock,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static PANIC_HOOK_READY: OnceLock<()> = OnceLock::new();

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug)]
pub struct AppError {
    message: String,
}

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

pub fn install_panic_hook(log_directory: PathBuf) -> AppResult<()> {
    if PANIC_HOOK_READY.set(()).is_err() {
        return Ok(());
    }

    fs::create_dir_all(&log_directory).map_err(|error| {
        AppError::new(format!("failed to prepare panic log directory: {error}"))
    })?;

    let previous_hook = panic::take_hook();

    panic::set_hook(Box::new(move |panic_info| {
        if let Err(error) = write_panic_log(&log_directory, panic_info) {
            eprintln!("failed to write panic log: {error}");
        }

        previous_hook(panic_info);
    }));

    Ok(())
}

impl std::fmt::Display for AppError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new(error.to_string())
    }
}

fn write_panic_log(log_directory: &Path, panic_info: &PanicHookInfo<'_>) -> std::io::Result<()> {
    let timestamp = SystemTime::now();
    let duration = timestamp
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO);
    let thread_name = thread::current().name().unwrap_or("unnamed");
    let panic_message = panic_payload(panic_info);
    let location = panic_info
        .location()
        .map(|location| {
            format!(
                "{}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            )
        })
        .unwrap_or_else(|| "unknown".to_string());
    let panic_log_path = log_directory.join(format!(
        "panic-{}-{:03}.log",
        duration.as_secs(),
        duration.subsec_millis(),
    ));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(panic_log_path)?;

    writeln!(
        file,
        "timestamp_unix={}.{:03}",
        duration.as_secs(),
        duration.subsec_millis()
    )?;
    writeln!(file, "thread={thread_name}")?;
    writeln!(file, "location={location}")?;
    writeln!(file, "message={panic_message}")?;
    writeln!(file)?;
    writeln!(file, "backtrace:")?;
    writeln!(file, "{}", Backtrace::force_capture())?;

    Ok(())
}

fn panic_payload(panic_info: &PanicHookInfo<'_>) -> String {
    if let Some(message) = panic_info.payload().downcast_ref::<&str>() {
        return (*message).to_string();
    }

    if let Some(message) = panic_info.payload().downcast_ref::<String>() {
        return message.clone();
    }

    "unknown panic payload".to_string()
}
