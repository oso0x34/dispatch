import {
  useEffect,
  useRef,
  type FormEvent,
} from "react";
import {
  Globe,
  LoaderCircle,
  MonitorSmartphone,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { useDispatchStore } from "../../app/providers";
import { AddressBar } from "./AddressBar";

const PREVIEW_REACHABILITY_TIMEOUT_MS = 6_000;
const PREVIEW_LOAD_TIMEOUT_MS = 8_000;
const UNREACHABLE_PREVIEW_ERROR =
  "Dispatch could not reach that localhost app. Make sure it is running and accepting connections.";
const IFRAME_LOAD_TIMEOUT_ERROR =
  "Dispatch mounted the preview, but the iframe did not finish loading in time.";
const IFRAME_LOAD_ERROR =
  "Dispatch mounted the preview, but the iframe reported a load failure.";

const QUICK_TARGETS = [
  "http://localhost:3000",
  "http://127.0.0.1:4173",
  "http://localhost:8080",
];

type BrowserRuntimeStatus = "idle" | "checking" | "loading" | "ready" | "error";

async function probeBrowserTarget(target: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, PREVIEW_REACHABILITY_TIMEOUT_MS);

  try {
    await fetch(target, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    return {
      reachable: true,
      reason: null,
    };
  } catch {
    return {
      reachable: false,
      reason: UNREACHABLE_PREVIEW_ERROR,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getBrowserTone(browserStatus: BrowserRuntimeStatus, browserCurrentUrl: string | null) {
  if (browserStatus === "checking") {
    return "checking";
  }

  if (browserStatus === "loading") {
    return "loading";
  }

  if (browserStatus === "error") {
    return "error";
  }

  if (browserCurrentUrl) {
    return "ready";
  }

  return "idle";
}

function getBrowserStateLabel(browserStatus: BrowserRuntimeStatus, browserCurrentUrl: string | null) {
  if (browserStatus === "checking") {
    return "Checking reachability";
  }

  if (browserStatus === "loading") {
    return "Loading preview";
  }

  if (browserStatus === "error") {
    return "Needs attention";
  }

  if (browserCurrentUrl) {
    return "Preview live";
  }

  return "Idle";
}

function getBrowserStateNote(
  browserStatus: BrowserRuntimeStatus,
  browserCurrentUrl: string | null,
  browserError: string | null,
) {
  if (browserStatus === "checking") {
    return "Dispatch is probing the target before mounting the iframe.";
  }

  if (browserStatus === "loading") {
    return "Dispatch mounted the iframe and is waiting for the page to finish loading.";
  }

  if (browserStatus === "error") {
    return browserError ? "See the alert below for details." : "The target could not be reached.";
  }

  if (browserCurrentUrl) {
    return "The iframe is mounted against the current localhost target.";
  }

  return "Enter a local URL to mount the preview.";
}

function getBrowserTargetLabel(activeBrowserUrl: string | null, browserAddressDraft: string) {
  if (activeBrowserUrl) {
    try {
      return new URL(activeBrowserUrl).host;
    } catch {
      return activeBrowserUrl;
    }
  }

  const draft = browserAddressDraft.trim();

  return draft || "No target loaded";
}

function getBrowserEmptyTitle(browserStatus: BrowserRuntimeStatus) {
  if (browserStatus === "checking") {
    return "Waiting for the localhost app to answer before mounting the iframe.";
  }

  if (browserStatus === "loading") {
    return "The preview is mounted and waiting for the page to finish loading.";
  }

  if (browserStatus === "error") {
    return "The target was rejected or could not be reached.";
  }

  return "Enter a URL and press Enter to load a preview.";
}

function getBrowserEmptyBody(
  browserStatus: BrowserRuntimeStatus,
  browserStateNote: string,
) {
  if (browserStatus === "checking") {
    return "Dispatch keeps the draft visible while it probes the target.";
  }

  if (browserStatus === "loading") {
    return browserStateNote;
  }

  if (browserStatus === "error") {
    return "See the alert below for details.";
  }

  return "Dispatch only loads local targets, so this stays focused on the apps you are actively building and debugging.";
}

export function BrowserTab() {
  const navigationAttemptRef = useRef(0);
  const browserEnabled = useDispatchStore((state) => state.browserEnabled);
  const browserPolicyNote = useDispatchStore((state) => state.browserPolicyNote);
  const browserAddressDraft = useDispatchStore((state) => state.browserAddressDraft);
  const browserCurrentUrl = useDispatchStore((state) => state.browserCurrentUrl);
  const browserPendingUrl = useDispatchStore((state) => state.browserPendingUrl);
  const browserStatus = useDispatchStore((state) => state.browserStatus);
  const browserError = useDispatchStore((state) => state.browserError);
  const browserHistory = useDispatchStore((state) => state.browserHistory);
  const browserHistoryIndex = useDispatchStore((state) => state.browserHistoryIndex);
  const browserNavigationNonce = useDispatchStore((state) => state.browserNavigationNonce);
  const setBrowserAddressDraft = useDispatchStore((state) => state.setBrowserAddressDraft);
  const clearBrowserError = useDispatchStore((state) => state.clearBrowserError);
  const navigateBrowser = useDispatchStore((state) => state.navigateBrowser);
  const beginBrowserNavigation = useDispatchStore((state) => state.beginBrowserNavigation);
  const completeBrowserNavigation = useDispatchStore((state) => state.completeBrowserNavigation);
  const failBrowserNavigation = useDispatchStore((state) => state.failBrowserNavigation);
  const activeBrowserUrl = browserPendingUrl ?? browserCurrentUrl;
  const canGoBack = browserHistoryIndex > 0;
  const canGoForward = browserHistoryIndex >= 0 && browserHistoryIndex < browserHistory.length - 1;
  const browserTone = getBrowserTone(browserStatus, browserCurrentUrl);
  const browserStateLabel = getBrowserStateLabel(browserStatus, browserCurrentUrl);
  const browserStateNote = getBrowserStateNote(browserStatus, browserCurrentUrl, browserError);
  const browserTargetLabel = getBrowserTargetLabel(activeBrowserUrl, browserAddressDraft);
  const submitLabel = browserCurrentUrl && browserAddressDraft.trim() === browserCurrentUrl
    ? "Reload"
    : "Load";

  const queueBrowserNavigation = async (
    target: string,
    options: {
      mode: "new" | "history" | "reload";
      historyIndex?: number | null;
    },
  ) => {
    const validation = navigateBrowser(target);

    if (!validation.allowed || !validation.normalizedUrl) {
      return;
    }

    const attemptId = navigationAttemptRef.current + 1;
    navigationAttemptRef.current = attemptId;

    const probe = await probeBrowserTarget(validation.normalizedUrl);

    if (navigationAttemptRef.current !== attemptId) {
      return;
    }

    if (!probe.reachable) {
      failBrowserNavigation(probe.reason ?? UNREACHABLE_PREVIEW_ERROR);
      return;
    }

    beginBrowserNavigation(validation.normalizedUrl, options);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    await queueBrowserNavigation(browserAddressDraft, {
      mode: browserCurrentUrl && browserAddressDraft.trim() === browserCurrentUrl
        ? "reload"
        : "new",
    });
  };

  const handleBack = () => {
    const target = browserHistory[browserHistoryIndex - 1];

    if (!target) {
      return;
    }

    void queueBrowserNavigation(target, {
      mode: "history",
      historyIndex: browserHistoryIndex - 1,
    });
  };

  const handleForward = () => {
    const target = browserHistory[browserHistoryIndex + 1];

    if (!target) {
      return;
    }

    void queueBrowserNavigation(target, {
      mode: "history",
      historyIndex: browserHistoryIndex + 1,
    });
  };

  useEffect(() => {
    if (browserStatus !== "loading" || !browserPendingUrl) {
      return undefined;
    }

    const attemptId = navigationAttemptRef.current;
    const timeoutId = window.setTimeout(() => {
      if (navigationAttemptRef.current !== attemptId) {
        return;
      }

      failBrowserNavigation(IFRAME_LOAD_TIMEOUT_ERROR);
    }, PREVIEW_LOAD_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [browserNavigationNonce, browserPendingUrl, browserStatus, failBrowserNavigation]);

  if (!browserEnabled) {
    return (
      <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_28%),linear-gradient(180deg,rgba(8,10,15,0.42),rgba(8,10,15,0.12))] px-4 py-6">
        <div className="grid w-full max-w-4xl gap-3 lg:grid-cols-[minmax(0,1.25fr)_18rem]">
          <section className="rounded-[1.4rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.78)] px-6 py-6 shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--surface-border-soft)] bg-[rgba(59,130,246,0.1)] text-[var(--accent-blue-text)]">
                <Globe size={18} />
              </div>
              <div>
                <p className="text-[0.64rem] font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">
                  Browser
                </p>
                <h2 className="mt-1 text-[1rem] font-semibold tracking-tight text-[var(--text-primary)]">
                  Browser preview is disabled.
                </h2>
              </div>
            </div>

            <p className="mt-4 max-w-xl text-[0.8rem] leading-6 text-[var(--text-muted)]">
              Enable it in settings to preview localhost apps without leaving Dispatch.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.66rem] text-[var(--text-muted)]">
                Localhost only
              </span>
              <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.66rem] text-[var(--text-muted)]">
                HTTP preview
              </span>
              <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.66rem] text-[var(--text-muted)]">
                Reachability check
              </span>
            </div>
          </section>

          <aside className="rounded-[1.4rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.72)] px-5 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.18)]">
            <p className="text-[0.64rem] font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">
              Policy
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
              Local preview is intentionally constrained.
            </p>
            <p className="mt-2 text-[0.78rem] leading-6 text-[var(--text-muted)]">
              {browserPolicyNote}
            </p>
            <div className="mt-4 rounded-2xl border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
              <p className="text-[0.64rem] font-semibold uppercase tracking-[0.2em] text-[var(--text-subtle)]">
                Next step
              </p>
              <p className="mt-2 text-[0.8rem] leading-6 text-[var(--text-secondary)]">
                Turn it on in Settings, then point the address bar at a local dev server.
              </p>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.1),transparent_28%),radial-gradient(circle_at_top_right,rgba(255,255,255,0.05),transparent_24%),linear-gradient(180deg,rgba(7,9,14,0.78),rgba(9,11,16,0.96))]">
      <header className="border-b border-[var(--surface-border-soft)] bg-[rgba(9,11,17,0.86)] px-3 py-3 backdrop-blur-sm sm:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="flex items-center gap-2">
              <Sparkles size={11} className="text-accent-blue" />
              <p className="text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">
                Experimental localhost preview
              </p>
            </div>
            <h1 className="mt-2 text-[1rem] font-semibold tracking-tight text-[var(--text-primary)] sm:text-[1.05rem]">
              Open a local app without leaving Dispatch
            </h1>
            <p className="mt-1 max-w-2xl text-[0.78rem] leading-5 text-[var(--text-muted)]">
              Point this pane at `localhost` or `127.0.0.1`, keep your shell visible elsewhere, and verify changes in one workspace.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span
                className="rounded-full border px-3 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.16em]"
                data-state={browserTone}
              >
                {browserStateLabel}
              </span>
              <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.66rem] text-[var(--text-muted)]">
                Localhost only
              </span>
              <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.66rem] text-[var(--text-muted)]">
                Target: {browserTargetLabel}
              </span>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[32rem]">
            <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.025)] px-3 py-3">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
                State
              </p>
              <p className="mt-1.5 text-sm font-semibold text-[var(--text-primary)]">
                {browserStateLabel}
              </p>
              <p className="mt-1 text-[0.74rem] leading-5 text-[var(--text-tertiary)]">
                {browserStateNote}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.025)] px-3 py-3">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
                Target
              </p>
              <p className="mt-1.5 truncate text-sm font-semibold text-[var(--text-primary)]">
                {browserTargetLabel}
              </p>
              <p className="mt-1 text-[0.74rem] leading-5 text-[var(--text-tertiary)]">
                {browserAddressDraft.trim() || "Draft a localhost URL below."}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.025)] px-3 py-3">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-subtle)]">
                Policy
              </p>
              <p className="mt-1.5 text-sm font-semibold text-[var(--text-primary)]">
                Localhost only
              </p>
              <p className="mt-1 text-[0.74rem] leading-5 text-[var(--text-tertiary)]">
                {browserPolicyNote}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 sm:px-4">
        <section className="rounded-[1.25rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.78)] shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
          <AddressBar
            value={browserAddressDraft}
            errorMessage={browserError}
            browserStatus={browserStatus}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            submitLabel={submitLabel}
            onValueChange={(value) => {
              setBrowserAddressDraft(value);
              if (browserError) {
                clearBrowserError();
              }
            }}
            onBack={handleBack}
            onForward={handleForward}
            onSubmit={handleSubmit}
          />
        </section>

        <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="relative min-h-0 overflow-hidden rounded-[1.4rem] border border-[var(--surface-border-soft)] bg-[rgba(7,9,14,0.7)] shadow-[0_24px_70px_rgba(0,0,0,0.33)]">
            {activeBrowserUrl ? (
              <>
                <iframe
                  key={`${activeBrowserUrl}:${browserNavigationNonce}`}
                  title="Localhost browser preview"
                  src={activeBrowserUrl}
                  sandbox="allow-same-origin allow-scripts allow-forms"
                  className="block h-full w-full border-0"
                  style={{ borderRadius: 0 }}
                  onLoad={() => {
                    if (browserStatus !== "loading" || !browserPendingUrl) {
                      return;
                    }

                    completeBrowserNavigation(browserPendingUrl);
                  }}
                  onError={() => {
                    if (browserStatus !== "loading") {
                      return;
                    }

                    failBrowserNavigation(IFRAME_LOAD_ERROR);
                  }}
                />

                {browserStatus === "loading" ? (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-end bg-[linear-gradient(180deg,rgba(7,9,14,0.16),rgba(7,9,14,0.02))] p-4">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.82)] px-3 py-1.5 text-[0.72rem] text-[var(--text-muted)] shadow-[0_14px_34px_rgba(0,0,0,0.28)]">
                      <LoaderCircle size={13} className="animate-spin text-accent-blue" />
                      <span>Loading preview…</span>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-5 sm:p-6">
                <div className="grid w-full max-w-3xl gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
                  <div className="rounded-[1.3rem] border border-[var(--surface-border-soft)] bg-[linear-gradient(180deg,rgba(59,130,246,0.1),rgba(255,255,255,0.02))] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <div className="flex items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                      {browserStatus === "checking" || browserStatus === "loading" ? (
                        <LoaderCircle size={12} className="animate-spin text-accent-blue" />
                      ) : browserStatus === "error" ? (
                        <TriangleAlert size={12} className="text-accent-error" />
                      ) : (
                        <MonitorSmartphone size={12} className="text-accent-blue" />
                      )}
                      {browserStatus === "checking"
                        ? "Checking reachability"
                        : browserStatus === "loading"
                          ? "Loading preview"
                          : "Preview deck"}
                    </div>
                    <h2 className="mt-3 text-[1.05rem] font-semibold tracking-tight text-[var(--text-primary)]">
                      {getBrowserEmptyTitle(browserStatus)}
                    </h2>
                    <p className="mt-2 text-[0.78rem] leading-6 text-[var(--text-muted)]">
                      {getBrowserEmptyBody(browserStatus, browserStateNote)}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(browserStatus === "checking" || browserStatus === "loading"
                        ? [browserTargetLabel, browserStatus === "checking" ? "Probing" : "Mounting"]
                        : QUICK_TARGETS).map((target) => (
                        <button
                          key={target}
                          type="button"
                          className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.22)] px-3 py-1 text-[0.68rem] text-[var(--text-secondary)] disabled:opacity-70"
                          disabled={browserStatus === "checking" || browserStatus === "loading"}
                          onClick={() => {
                            setBrowserAddressDraft(target);
                            if (browserError) {
                              clearBrowserError();
                            }
                            void queueBrowserNavigation(target, { mode: "new" });
                          }}
                        >
                          {target}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.3rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.025)] px-5 py-5">
                    <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                      Guardrails
                    </p>
                    <ul className="mt-3 space-y-2 text-[0.74rem] leading-6 text-[var(--text-muted)]">
                      <li>Only `localhost` and `127.0.0.1` are allowed.</li>
                      <li>Navigation history stays inside this preview session.</li>
                      <li>The current draft stays in the address bar for quick retries.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </section>

          <aside className="grid min-h-0 gap-3">
            <section className="rounded-[1.3rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.74)] px-4 py-4 shadow-[0_18px_42px_rgba(0,0,0,0.2)]">
              <p className="text-[0.64rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                Session notes
              </p>
              <p className="mt-2 text-[0.8rem] leading-6 text-[var(--text-secondary)]">
                Keep the browser pointed at the target you are actively debugging. The draft remains in the address bar for quick retries.
              </p>
            </section>

            <section className="rounded-[1.3rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.74)] px-4 py-4 shadow-[0_18px_42px_rgba(0,0,0,0.2)]">
              <p className="text-[0.64rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                Current target
              </p>
              <p className="mt-2 truncate text-sm font-semibold text-[var(--text-primary)]">
                {activeBrowserUrl ? activeBrowserUrl : browserAddressDraft.trim() || "No target loaded"}
              </p>
              <p className="mt-1 text-[0.78rem] leading-6 text-[var(--text-muted)]">
                {browserStateNote}
              </p>
            </section>

            <section className="rounded-[1.3rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.74)] px-4 py-4 shadow-[0_18px_42px_rgba(0,0,0,0.2)]">
              <p className="text-[0.64rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                Policy
              </p>
              <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                Localhost only
              </p>
              <p className="mt-1 text-[0.78rem] leading-6 text-[var(--text-muted)]">
                {browserPolicyNote}
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
