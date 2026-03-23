import {
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { FormEvent } from "react";

type BrowserStatus = "idle" | "checking" | "loading" | "ready" | "error";

type AddressBarProps = {
  value: string;
  errorMessage: string | null;
  browserStatus: BrowserStatus;
  canGoBack: boolean;
  canGoForward: boolean;
  submitLabel: string;
  onValueChange: (value: string) => void;
  onBack: () => void;
  onForward: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AddressBar({
  value,
  errorMessage,
  browserStatus,
  canGoBack,
  canGoForward,
  submitLabel,
  onValueChange,
  onBack,
  onForward,
  onSubmit,
}: AddressBarProps) {
  const isChecking = browserStatus === "checking";
  const isLoading = browserStatus === "loading";
  const statusLabel = isChecking
    ? "Checking reachability"
    : isLoading
      ? "Loading preview"
      : browserStatus === "error"
        ? "Needs attention"
        : "Ready";

  return (
    <div className="relative px-3 py-3 sm:px-4 sm:py-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.64rem] font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">
            Address bar
          </p>
          <p className="mt-1 text-[0.78rem] text-[var(--text-muted)]">
            Load a local preview and keep the target visible while you iterate.
          </p>
        </div>
        <span
          className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.66rem] text-[var(--text-muted)]"
          data-state={browserStatus}
        >
          {statusLabel}
        </span>
      </div>

      <form
        className="dispatch-toolbar flex items-center gap-1.5 rounded-[1rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.18)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
        onSubmit={onSubmit}
      >
        <button
          type="button"
          className="dispatch-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.85rem] disabled:opacity-50"
          aria-label="Back"
          disabled={!canGoBack || isChecking || isLoading}
          onClick={onBack}
        >
          <ArrowLeft size={14} />
        </button>

        <button
          type="button"
          className="dispatch-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.85rem] disabled:opacity-50"
          aria-label="Forward"
          disabled={!canGoForward || isChecking || isLoading}
          onClick={onForward}
        >
          <ArrowRight size={14} />
        </button>

        <button
          type="submit"
          className="dispatch-icon-button inline-flex h-8 min-w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-[0.85rem] px-3 text-[0.74rem] font-medium"
          aria-label="Load preview"
          title="Load preview"
          disabled={isChecking || isLoading}
        >
          {isChecking || isLoading ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          <span>{isChecking ? "Checking" : isLoading ? "Loading" : submitLabel}</span>
        </button>

        <input
          aria-label="Browser preview URL"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="http://localhost:3000"
          className="dispatch-input h-9 min-w-0 flex-1 rounded-[0.8rem] px-3 text-[0.76rem]"
        />
      </form>

      <p className="mt-2 px-1 text-[0.72rem] leading-5 text-[var(--text-tertiary)]">
        Only localhost targets are allowed. Navigation history stays local to this preview session.
      </p>

      {isChecking || isLoading ? (
        <div
          className="absolute bottom-0 left-0 h-[2px] w-full overflow-hidden"
          role="progressbar"
          aria-label={isChecking ? "Checking reachability" : "Loading preview"}
        >
          <div
            className="h-full w-1/3 animate-[addressBarProgress_1.2s_ease-in-out_infinite] rounded-full"
            style={{ background: "var(--accent-blue)" }}
          />
        </div>
      ) : null}

      {errorMessage ? (
        <div
          className="dispatch-alert mt-2 flex items-start gap-2 px-3 py-2 text-[0.74rem] leading-5"
          role="alert"
        >
          <span className="shrink-0 rounded-full border border-[var(--danger-border)] px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--danger-text)]">
            Error
          </span>
          <span className="min-w-0 text-[0.76rem]">{errorMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
