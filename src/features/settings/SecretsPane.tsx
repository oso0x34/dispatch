import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  KeyRound,
  LoaderCircle,
  Trash2,
} from "lucide-react";

import {
  clearSecret,
  getSecretStatus,
  setSecret,
  type SecretStatus,
} from "../../shared/lib/tauri";

type LoadStatus = "idle" | "loading" | "ready" | "error";
type SecretAction = "idle" | "saving" | "clearing";

type SecretDefinition = {
  key: string;
  label: string;
  description: string;
};

const secretDefinitions: SecretDefinition[] = [
  {
    key: "OPENCLAW_GATEWAY_TOKEN",
    label: "OpenClaw gateway token",
    description: "Optional token for authenticated OpenClaw deployments.",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    description: "Used by local agent profiles expecting Anthropic credentials.",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API key",
    description: "Used by local agent profiles expecting OpenAI credentials.",
  },
  {
    key: "GOOGLE_API_KEY",
    label: "Google API key",
    description: "Used by local agent profiles expecting Google credentials.",
  },
];

function createDraftState() {
  return Object.fromEntries(
    secretDefinitions.map((definition) => [definition.key, ""]),
  ) as Record<string, string>;
}

function createStatusState(defaultStatus: SecretStatus = "missing") {
  return Object.fromEntries(
    secretDefinitions.map((definition) => [definition.key, defaultStatus]),
  ) as Record<string, SecretStatus | string>;
}

function createActionState() {
  return Object.fromEntries(
    secretDefinitions.map((definition) => [definition.key, "idle"]),
  ) as Record<string, SecretAction>;
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

function formatStatusLabel(status: SecretStatus | string) {
  switch (status) {
    case "keychain":
      return "Keychain";
    case "env":
      return "Env";
    case "missing":
      return "Missing";
    default:
      return status;
  }
}

function statusVariant(status: SecretStatus | string): "ready" | "loading" | "error" {
  switch (status) {
    case "keychain":
      return "ready";
    case "env":
      return "loading";
    case "missing":
      return "error";
    default:
      return "loading";
  }
}

function statusSummary(status: SecretStatus | string) {
  switch (status) {
    case "keychain":
      return "Stored in the OS keychain and available for local launch profiles.";
    case "env":
      return "Inherited from the current process environment at runtime.";
    case "missing":
      return "No value is available yet. Save one below or rely on env injection.";
    default:
      return "Status reported by the secret backend.";
  }
}

export function SecretsPane() {
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [drafts, setDrafts] = useState<Record<string, string>>(() => createDraftState());
  const [statusByKey, setStatusByKey] = useState<Record<string, SecretStatus | string>>(
    () => createStatusState(),
  );
  const [actionByKey, setActionByKey] = useState<Record<string, SecretAction>>(
    () => createActionState(),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setStatus("loading");
    setErrorMessage(null);

    void Promise.all(
      secretDefinitions.map(async (definition) => [
        definition.key,
        (await getSecretStatus({ key: definition.key })).status,
      ] as const),
    )
      .then((entries) => {
        if (!active) {
          return;
        }

        setStatusByKey(Object.fromEntries(entries));
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setStatus("error");
        setErrorMessage(getErrorMessage(error, "Secret status failed to load."));
      });

    return () => {
      active = false;
    };
  }, []);

  const isBusy = useMemo(
    () => Object.values(actionByKey).some((value) => value !== "idle"),
    [actionByKey],
  );
  const availableCount = Object.values(statusByKey).filter((value) => value === "keychain" || value === "env").length;
  const missingCount = secretDefinitions.length - availableCount;

  const setDraftValue = (key: string, value: string) => {
    setDrafts((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const setAction = (key: string, action: SecretAction) => {
    setActionByKey((current) => ({
      ...current,
      [key]: action,
    }));
  };

  const setSecretStatus = (key: string, nextStatus: SecretStatus | string) => {
    setStatusByKey((current) => ({
      ...current,
      [key]: nextStatus,
    }));
  };

  const handleSave = async (key: string) => {
    const value = drafts[key]?.trim() ?? "";

    if (!value) {
      return;
    }

    setAction(key, "saving");
    setErrorMessage(null);

    try {
      const result = await setSecret({ key, value });
      setSecretStatus(key, result.status);
      setDraftValue(key, "");
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "Secret save failed."));
    } finally {
      setAction(key, "idle");
    }
  };

  const handleClear = async (key: string) => {
    setAction(key, "clearing");
    setErrorMessage(null);

    try {
      const result = await clearSecret({ key });
      setSecretStatus(key, result.status);
      setDraftValue(key, "");
      setStatus("ready");
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "Secret clear failed."));
    } finally {
      setAction(key, "idle");
    }
  };

  return (
    <section
      data-testid="secrets-pane"
      className="dispatch-surface rounded-lg p-3 sm:p-4"
    >
      <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-panel)]/60 p-3 sm:p-4">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="max-w-2xl">
            <p className="dispatch-text-muted text-[0.66rem] font-semibold tracking-[0.18em] uppercase">
              Secrets
            </p>
            <h3 className="dispatch-heading mt-2 text-base font-semibold">Credential status</h3>
            <p className="dispatch-text-secondary mt-2 text-sm leading-6">
              Secrets are stored via OS keychain APIs. Inputs are write-only and cleared after save.
            </p>
          </div>

          <div className="grid w-full gap-2 sm:grid-cols-2 2xl:w-auto 2xl:max-w-[30rem] 2xl:grid-cols-3">
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Available
              </p>
              <p className="dispatch-text-primary mt-1.5 text-sm font-semibold">{availableCount}</p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                Ready from keychain or env
              </p>
            </div>
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Missing
              </p>
              <p className="dispatch-text-primary mt-1.5 text-sm font-semibold">{missingCount}</p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                Still need a saved or inherited value
              </p>
            </div>
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Input policy
              </p>
              <p className="dispatch-text-primary mt-1.5 text-sm font-semibold">Write-only</p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                Values never render back into the pane after save
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

      {status === "loading" ? (
        <div className="mt-4 flex items-center gap-3 px-1 py-2 text-sm">
          <LoaderCircle size={15} className="animate-spin text-accent-blue" />
          <span className="dispatch-text-secondary text-[0.8rem]">Loading secret status...</span>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {secretDefinitions.map((definition) => {
          const currentStatus = statusByKey[definition.key] ?? "missing";
          const action = actionByKey[definition.key] ?? "idle";
          const draftValue = drafts[definition.key] ?? "";
          const isSaving = action === "saving";
          const isClearing = action === "clearing";
          const tone = statusVariant(currentStatus);

          return (
            <div
              key={definition.key}
              data-testid={`secret-row-${definition.key}`}
              className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/80 p-3"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="dispatch-status-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      data-state={tone}
                    />
                    <p className="dispatch-text-primary text-sm font-semibold">{definition.label}</p>
                    <span
                      className="rounded-full border px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.14em]"
                      data-state={tone}
                    >
                      {formatStatusLabel(currentStatus)}
                    </span>
                  </div>
                  <p className="dispatch-text-secondary mt-2 text-[0.8rem] leading-5">
                    {definition.description}
                  </p>
                  <p className="dispatch-text-tertiary mt-1 text-[0.74rem] leading-5">
                    {statusSummary(currentStatus)}
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-panel)]/40 px-3 py-2 text-right">
                  <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                    Secret key
                  </p>
                  <p className="dispatch-text-primary mt-1 font-mono text-[0.72rem] leading-5">
                    {definition.key}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="block min-w-0 flex-1">
                  <span className="dispatch-text-secondary text-xs font-semibold">
                    New value
                  </span>
                  <input
                    type="password"
                    value={draftValue}
                    onChange={(event) => setDraftValue(definition.key, event.target.value)}
                    className="dispatch-input mt-1 h-9 w-full rounded-lg px-3 text-sm"
                    aria-label={`${definition.label} value`}
                    placeholder={definition.key}
                    autoComplete="off"
                    disabled={isBusy}
                  />
                </label>

                <button
                  type="button"
                  className="dispatch-action-button inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[0.78rem] font-medium disabled:opacity-60"
                  onClick={() => {
                    void handleSave(definition.key);
                  }}
                  disabled={isBusy || draftValue.trim().length === 0}
                  aria-label={`Save ${definition.label}`}
                >
                  {isSaving ? <LoaderCircle size={13} className="animate-spin" /> : <KeyRound size={13} />}
                  <span>Save</span>
                </button>

                <button
                  type="button"
                  className="dispatch-icon-button inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-60"
                  onClick={() => {
                    void handleClear(definition.key);
                  }}
                  disabled={isBusy || currentStatus === "missing"}
                  aria-label={`Clear ${definition.label}`}
                  title="Clear from keychain"
                >
                  {isClearing ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
