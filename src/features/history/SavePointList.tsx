import {
  History,
  LoaderCircle,
  Plus,
  Search,
} from "lucide-react";

import type { SavePointRecord } from "../../shared/lib/tauri";

type SavePointListProps = {
  savePoints: SavePointRecord[];
  totalCount: number;
  selectedRefName: string | null;
  searchQuery: string;
  listStatus: "idle" | "loading" | "ready" | "error";
  listError: string | null;
  isCreating: boolean;
  onSearchQueryChange: (query: string) => void;
  onSelectSavePoint: (savePoint: SavePointRecord) => void;
  onCreateManualSavePoint: () => void;
};

export function formatSavePointLabel(refName: string) {
  const tail = refName.split("/").pop() ?? refName;
  const segments = tail.split("-");
  const label = /^\d+$/.test(segments[0] ?? "")
    ? segments.slice(1).join(" ")
    : tail.replace(/-/g, " ");

  return label
    .replace(/\bpre agent\b/g, "pre-agent")
    .replace(/\bpost agent\b/g, "post-agent");
}

export function formatSavePointStage(stage: string) {
  if (stage === "pre_agent") {
    return "Pre-agent";
  }

  if (stage === "post_agent") {
    return "Post-agent";
  }

  if (stage === "manual") {
    return "Manual";
  }

  return stage.replace(/_/g, " ");
}

function stageBadgeClassName(stage: string) {
  if (stage === "pre_agent") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }

  if (stage === "post_agent") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }

  if (stage === "manual") {
    return "border-sky-500/25 bg-sky-500/10 text-sky-300";
  }

  return "border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] dispatch-text-muted";
}

export function formatSavePointTimestamp(createdAt: number) {
  const now = Date.now();
  const diffMs = now - createdAt;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) {
    return "just now";
  }

  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(createdAt);
}

function renderEmptyState(searchQuery: string) {
  if (searchQuery.trim().length > 0) {
    return "No save points match this search.";
  }

  return "No save points yet.";
}

export function SavePointList({
  savePoints,
  totalCount,
  selectedRefName,
  searchQuery,
  listStatus,
  listError,
  isCreating,
  onSearchQueryChange,
  onSelectSavePoint,
  onCreateManualSavePoint,
}: SavePointListProps) {
  const unsupported = listError === "project is not a git repository";

  return (
    <section className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--surface-border-soft)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <History size={13} className="dispatch-text-muted shrink-0" />
              <span className="dispatch-text-muted text-[0.65rem] font-medium uppercase tracking-wide">
                Save Points
              </span>
            </div>
            <p className="mt-1 text-[0.74rem] leading-5 text-[var(--text-muted)]">
              Keep recovery points visible and choose the exact moment you want to inspect or restore.
            </p>
          </div>

          <button
            type="button"
            disabled={isCreating || unsupported}
            className="dispatch-action-button inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[0.8rem] px-3 py-2 text-[0.68rem] font-medium"
            onClick={onCreateManualSavePoint}
            aria-label="Create manual save point"
          >
            {isCreating
              ? <LoaderCircle className="animate-spin" size={11} />
              : <Plus size={11} />}
            <span>{isCreating ? "Creating\u2026" : "Save point"}</span>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-[0.66rem] text-[var(--text-subtle)]">
          <span>
            {searchQuery.trim().length > 0
              ? `${savePoints.length}/${totalCount} visible`
              : `${totalCount} total`}
          </span>
          <span>{unsupported ? "Git required" : "Recovery rail"}</span>
        </div>
      </div>

      <div className="border-b border-[var(--surface-border-soft)] px-4 py-3">
        <label className="min-w-0">
          <span className="sr-only">Search save points</span>
          <div className="relative rounded-[0.95rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-1">
            <Search
              className="dispatch-text-subtle pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
              size={12}
            />
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search save points"
              className="h-9 w-full rounded-[0.85rem] border-none bg-transparent pl-8 pr-3 text-[0.72rem] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-subtle)]"
            />
          </div>
        </label>
      </div>

      {listError ? (
        <div className="dispatch-alert mx-4 mt-3 rounded-[0.95rem] px-3 py-2 text-xs" role="alert">
          {unsupported
            ? "History is unavailable until this project lives in an existing git repository."
            : listError}
        </div>
      ) : null}

      {listStatus === "loading" ? (
        <div className="dispatch-text-secondary flex items-center gap-1.5 px-4 py-4 text-xs">
          <LoaderCircle className="animate-spin" size={12} />
          <span>Loading save points</span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {savePoints.length === 0 ? (
            <p className="dispatch-text-muted px-3 py-4 text-center text-xs">
              {renderEmptyState(searchQuery)}
            </p>
          ) : (
            <div className="space-y-2">
              {savePoints.map((savePoint) => {
                const isSelected = savePoint.refName === selectedRefName;

                return (
                  <button
                    key={savePoint.refName}
                    type="button"
                    className={`flex w-full items-start gap-2 rounded-[1rem] border px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ${
                      isSelected
                        ? "border-[var(--accent-blue-border-faint)] bg-[linear-gradient(180deg,rgba(59,130,246,0.12),rgba(59,130,246,0.05))] shadow-[0_16px_32px_rgba(0,0,0,0.18)]"
                        : "border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.02)] hover:-translate-y-px hover:border-[rgba(59,130,246,0.18)] hover:bg-[rgba(255,255,255,0.04)]"
                    }`}
                    onClick={() => onSelectSavePoint(savePoint)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`truncate text-[0.72rem] font-medium capitalize leading-tight ${isSelected ? "dispatch-text-primary" : "dispatch-text-strong"}`}>
                          {formatSavePointLabel(savePoint.refName)}
                        </p>
                        <span className={`shrink-0 rounded-full border px-1.5 py-px text-[0.55rem] font-medium uppercase leading-none tracking-wide ${stageBadgeClassName(savePoint.stage)}`}>
                          {formatSavePointStage(savePoint.stage)}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="dispatch-text-muted text-[0.6rem]">
                          {formatSavePointTimestamp(savePoint.createdAt)}
                        </span>
                        <span className="dispatch-text-subtle font-mono text-[0.58rem]">
                          {savePoint.commitOid.slice(0, 7)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
