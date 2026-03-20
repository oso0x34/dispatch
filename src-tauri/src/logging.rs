use std::sync::OnceLock;

use tracing_subscriber::EnvFilter;

static LOGGING_READY: OnceLock<()> = OnceLock::new();

pub fn init() {
  LOGGING_READY.get_or_init(|| {
    let filter = EnvFilter::try_from_default_env()
      .unwrap_or_else(|_| EnvFilter::new("dispatch=info"));

    let _ = tracing_subscriber::fmt()
      .with_env_filter(filter)
      .with_target(false)
      .compact()
      .try_init();
  });
}
