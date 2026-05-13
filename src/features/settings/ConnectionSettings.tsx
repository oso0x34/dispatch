import {
  useEffect,
  useState,
} from "react";
import {
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import {
  connectOpenClaw,
  disconnectOpenClaw,
  getOpenClawStatus,
  getSetting,
  setSetting,
  type OpenClawConnectionStatusRecord,
} from "../../shared/lib/tauri";

const OPENCLAW_GATEWAY_SETTING_KEY = "openclaw.gateway_url";

type LoadStatus = "idle" | "loading" | "ready" | "error";
type ActionStatus = "idle" | "saving" | "connecting" | "disconnecting" | "refreshing";

function buildDisconnectedStatus(): OpenClawConnectionStatusRecord {
  return {
    state: "disconnected",
    gatewayUrl: null,
    connectedAt: null,
    lastError: null,
    protocolVersion: null,
    serverVersion: null,
    tickIntervalMs: null,
    availableMethods: [],
    availableEvents: [],
    helloSnapshot: null,
    statusDetails: null,
    healthDetails: null,
    presenceDetails: null,
    lastEventAt: null,
    lastEventSeq: null,
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function formatConnectionState(state: string) {
  return state
    .split(/[_-]+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function getConnectionTone(state: string): "ready" | "idle" | "loading" {
  if (state === "connected") {
    return "ready";
  }

  if (state === "disconnected") {
    return "idle";
  }

  return "loading";
}

type ConnectionSettingsProps = {
  active?: boolean;
};

export function ConnectionSettings({ active = true }: ConnectionSettingsProps) {
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [actionStatus, setActionStatus] = useState<ActionStatus>("idle");
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [savedGatewayUrl, setSavedGatewayUrl] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<OpenClawConnectionStatusRecord>(
    buildDisconnectedStatus(),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setStatus("loading");
    setErrorMessage(null);

    void Promise.all([
      getSetting<string | null>({ key: OPENCLAW_GATEWAY_SETTING_KEY }),
      getOpenClawStatus(),
    ])
      .then(([setting, nextConnectionStatus]) => {
        if (!active) {
          return;
        }

        const storedGatewayUrl = typeof setting?.value === "string" ? setting.value : "";
        setGatewayUrl(storedGatewayUrl);
        setSavedGatewayUrl(storedGatewayUrl);
        setConnectionStatus(nextConnectionStatus);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setConnectionStatus(buildDisconnectedStatus());
        setStatus("error");
        setErrorMessage(getErrorMessage(error, "OpenClaw connection settings failed to load."));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let mounted = true;
    let inFlight = false;

    const refreshConnectionStatus = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const nextConnectionStatus = await getOpenClawStatus();

        if (!mounted) {
          return;
        }

        setConnectionStatus(nextConnectionStatus);
        setStatus("ready");
        setErrorMessage(null);
      } catch (error: unknown) {
        if (!mounted) {
          return;
        }

        setStatus("error");
        setErrorMessage(getErrorMessage(error, "OpenClaw status refresh failed."));
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshConnectionStatus();
    }, 2_000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [active]);

  const isBusy = actionStatus !== "idle";
  const isDirty = gatewayUrl !== savedGatewayUrl;
  const connectionTone = getConnectionTone(connectionStatus.state);
  const statusSummary = status === "loading"
    ? "Loading live status..."
    : connectionStatus.gatewayUrl ?? "No active gateway URL";
  const savedSourceLabel = savedGatewayUrl || "Environment fallback";
  const serverLabel = connectionStatus.serverVersion ?? "Unavailable";
  const protocolLabel = connectionStatus.protocolVersion ?? "?";

  const persistGatewayUrl = async (value: string) => {
    await setSetting({
      key: OPENCLAW_GATEWAY_SETTING_KEY,
      value: value.trim() || null,
    });

    const normalizedValue = value.trim();
    setSavedGatewayUrl(normalizedValue);
    setGatewayUrl(normalizedValue);
  };

  const handleSaveGateway = async () => {
    setActionStatus("saving");
    setErrorMessage(null);

    try {
      await persistGatewayUrl(gatewayUrl);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "Gateway setting could not be saved."));
    } finally {
      setActionStatus("idle");
    }
  };

  const handleRefreshStatus = async () => {
    setActionStatus("refreshing");
    setErrorMessage(null);

    try {
      setConnectionStatus(await getOpenClawStatus());
      setStatus("ready");
    } catch (error: unknown) {
      setStatus("error");
      setErrorMessage(getErrorMessage(error, "OpenClaw status refresh failed."));
    } finally {
      setActionStatus("idle");
    }
  };

  const handleConnect = async () => {
    setActionStatus("connecting");
    setErrorMessage(null);

    try {
      if (isDirty) {
        await persistGatewayUrl(gatewayUrl);
      }

      setConnectionStatus(await connectOpenClaw({
        gatewayUrl: gatewayUrl.trim() || null,
      }));
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "OpenClaw could not connect."));
    } finally {
      setActionStatus("idle");
    }
  };

  const handleDisconnect = async () => {
    setActionStatus("disconnecting");
    setErrorMessage(null);

    try {
      setConnectionStatus(await disconnectOpenClaw());
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "OpenClaw could not disconnect."));
    } finally {
      setActionStatus("idle");
    }
  };

  return (
    <section
      data-testid="connection-settings"
      className="dispatch-surface rounded-lg p-3 sm:p-4"
    >
      <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-panel)]/60 p-3 sm:p-4">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="max-w-2xl">
            <p className="dispatch-text-muted text-[0.66rem] font-semibold tracking-[0.18em] uppercase">
              Connection
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h3 className="dispatch-heading text-base font-semibold">OpenClaw gateway</h3>
              <span
                className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em]"
                data-state={connectionTone}
              >
                <span
                  className="dispatch-status-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  data-state={connectionTone}
                />
                Live link
              </span>
            </div>
            <p className="dispatch-text-secondary mt-2 text-sm leading-6">
              Persist the gateway URL and control connect/disconnect. Rust owns the socket lifecycle and retry policy.
            </p>
          </div>

          <div className="grid w-full gap-2 sm:grid-cols-2 2xl:w-auto 2xl:max-w-[30rem] 2xl:grid-cols-3">
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Live state
              </p>
              <p className="dispatch-text-primary mt-1.5 text-sm font-semibold">
                {connectionStatus.state === "connected"
                  ? "Gateway reachable"
                  : connectionStatus.state === "disconnected"
                    ? "No active link"
                    : "Negotiating"}
              </p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                {statusSummary}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Saved source
              </p>
              <p className="dispatch-text-primary mt-1.5 text-sm font-semibold">
                {savedSourceLabel}
              </p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                {savedGatewayUrl ? "Stored in Dispatch settings" : "Falling back to process env"}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Server
              </p>
              <p className="dispatch-text-primary mt-1.5 text-sm font-semibold">
                {serverLabel}
              </p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                Protocol {protocolLabel} / {connectionStatus.availableMethods.length} methods
              </p>
            </div>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className="dispatch-alert mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(15rem,0.8fr)]">
        <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/80 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="dispatch-text-primary text-sm font-semibold">Gateway endpoint</p>
              <p className="dispatch-text-tertiary mt-1 text-[0.78rem] leading-5">
                Use a saved URL for this workspace, or leave it blank to inherit from `OPENCLAW_GATEWAY_URL`.
              </p>
            </div>
            {isDirty ? (
              <span className="rounded-full border border-[var(--surface-border-soft)] px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-amber-300">
                Unsaved
              </span>
            ) : (
              <span className="rounded-full border border-[var(--surface-border-soft)] px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em] dispatch-text-muted">
                In sync
              </span>
            )}
          </div>

          <label className="mt-4 block">
            <span className="dispatch-text-secondary text-xs font-semibold">
              Gateway URL
            </span>
            <input
              value={gatewayUrl}
              onChange={(event) => setGatewayUrl(event.target.value)}
              className="dispatch-input mt-1.5 h-10 w-full rounded-lg px-3 text-sm"
              placeholder="ws://127.0.0.1:18789"
              aria-label="Gateway URL"
            />
            <p className="dispatch-text-tertiary mt-1.5 text-xs leading-5">
              Leave blank to fall back to `OPENCLAW_GATEWAY_URL` from env.
            </p>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="dispatch-control inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-60"
              disabled={isBusy || !isDirty}
              onClick={() => {
                void handleSaveGateway();
              }}
            >
              {actionStatus === "saving" ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : null}
              <span>Save</span>
            </button>

            <button
              type="button"
              className="dispatch-control inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-60"
              disabled={isBusy}
              onClick={() => {
                void handleRefreshStatus();
              }}
            >
              {actionStatus === "refreshing" ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              <span>Refresh</span>
            </button>

            {connectionStatus.state === "connected" ? (
              <button
                type="button"
                className="dispatch-icon-button inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-60"
                disabled={isBusy}
                onClick={() => {
                  void handleDisconnect();
                }}
              >
                {actionStatus === "disconnecting" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : null}
                <span>Disconnect</span>
              </button>
            ) : (
              <button
                type="button"
                className="dispatch-action-button inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-60"
                disabled={isBusy}
                onClick={() => {
                  void handleConnect();
                }}
              >
                {actionStatus === "connecting" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : null}
                <span>Connect</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
          <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/80 px-3 py-3">
            <div className="flex items-center gap-2">
              <span
                className="dispatch-status-dot inline-block h-2 w-2 shrink-0 rounded-full"
                data-state={connectionTone}
              />
              <p className="dispatch-text-primary text-sm font-semibold">State</p>
            </div>
            <p className="dispatch-text-primary mt-2 text-sm font-medium">
              {formatConnectionState(connectionStatus.state)}
            </p>
            <p className="dispatch-text-tertiary mt-1 text-[0.78rem] leading-5">
              {statusSummary}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/80 px-3 py-3">
            <p className="dispatch-text-primary text-sm font-semibold">Connection metadata</p>
            <dl className="mt-2 space-y-2 text-[0.78rem] leading-5">
              <div className="flex items-start justify-between gap-3">
                <dt className="dispatch-text-tertiary">Saved source</dt>
                <dd className="dispatch-text-primary text-right font-medium">{savedSourceLabel}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="dispatch-text-tertiary">Server</dt>
                <dd className="dispatch-text-primary text-right font-medium">{serverLabel}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="dispatch-text-tertiary">Protocol</dt>
                <dd className="dispatch-text-primary text-right font-medium">{protocolLabel}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="dispatch-text-tertiary">Methods</dt>
                <dd className="dispatch-text-primary text-right font-medium">
                  {connectionStatus.availableMethods.length}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {connectionStatus.lastError ? (
        <div className="dispatch-alert mt-4 rounded-lg px-3 py-2 text-sm">
          {connectionStatus.lastError}
        </div>
      ) : null}
    </section>
  );
}
