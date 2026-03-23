import {
  FileDiff,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

import type {
  SavePointDiffFileRecord,
  SavePointDiffRecord,
  SavePointRecord,
} from "../../shared/lib/tauri";
import {
  formatSavePointLabel,
  formatSavePointStage,
  formatSavePointTimestamp,
} from "./SavePointList";

type DiffViewerProps = {
  selectedSavePoint: SavePointRecord | null;
  diffStatus: "idle" | "loading" | "ready" | "error";
  diffError: string | null;
  diff: SavePointDiffRecord | null;
  isRestoring: boolean;
  onRestoreWorkspace: () => void;
  onRestoreFile: (path: string) => void;
};

function fileStatusClassName(status: string) {
  if (status === "added") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }

  if (status === "deleted") {
    return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  }

  if (status === "modified") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }

  return "border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] dispatch-text-secondary";
}

function renderPatchLines(file: SavePointDiffFileRecord) {
  if (file.isBinary) {
    return (
      <div className="dispatch-text-muted px-3 py-2 text-xs italic">
        Binary file — diff not available.
      </div>
    );
  }

  const patch = file.patch.trim();
  if (patch.length === 0) {
    return (
      <div className="dispatch-text-muted px-3 py-2 text-xs italic">
        No textual changes recorded.
      </div>
    );
  }

  const lines = patch.split("\n");

  return (
    <table className="w-full border-collapse text-[0.68rem] leading-[1.6]">
      <tbody>
        {lines.map((line, index) => {
          let lineClass = "dispatch-text-primary";
          let bgClass = "";
          let gutterClass = "dispatch-text-subtle";

          if (line.startsWith("+")) {
            lineClass = "text-emerald-300";
            bgClass = "bg-emerald-500/[0.07]";
            gutterClass = "text-emerald-400/50";
          } else if (line.startsWith("-")) {
            lineClass = "text-rose-300";
            bgClass = "bg-rose-500/[0.07]";
            gutterClass = "text-rose-400/50";
          } else if (line.startsWith("@@")) {
            lineClass = "text-sky-400/70";
            bgClass = "bg-sky-500/[0.04]";
            gutterClass = "text-sky-400/30";
          }

          return (
            <tr key={index} className={bgClass}>
              <td className={`select-none px-2.5 py-0 text-right font-mono text-[0.58rem] ${gutterClass}`}>
                {index + 1}
              </td>
              <td className={`whitespace-pre-wrap break-all px-3 py-0 font-mono ${lineClass}`}>
                {line}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DiffViewer({
  selectedSavePoint,
  diffStatus,
  diffError,
  diff,
  isRestoring,
  onRestoreWorkspace,
  onRestoreFile,
}: DiffViewerProps) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-[var(--surface-border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)]">
            <FileDiff size={13} className="dispatch-text-muted shrink-0" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Diff viewer
            </p>
            <h3 className="dispatch-text-primary mt-1 truncate text-[0.9rem] font-semibold leading-tight">
              {selectedSavePoint
                ? formatSavePointLabel(selectedSavePoint.refName)
                : "No save point selected"}
            </h3>
            {selectedSavePoint ? (
              <p className="dispatch-text-secondary mt-0.5 text-[0.65rem]">
                {formatSavePointStage(selectedSavePoint.stage)} &middot; {formatSavePointTimestamp(selectedSavePoint.createdAt)}
              </p>
            ) : (
              <p className="dispatch-text-muted mt-0.5 text-[0.65rem]">
                Pick a save point from the list to inspect changes.
              </p>
            )}
          </div>

          <div className="shrink-0">
            <button
              type="button"
              disabled={!selectedSavePoint || isRestoring || diffStatus === "loading"}
              className="dispatch-danger-button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[0.85rem] px-3 py-2 text-[0.7rem] font-medium"
              onClick={onRestoreWorkspace}
              aria-label="Restore workspace"
            >
              {isRestoring ? <LoaderCircle className="animate-spin" size={12} /> : <RotateCcw size={12} />}
              <span>Restore workspace</span>
            </button>
            <p className="dispatch-text-subtle mt-1 text-right text-[0.58rem] uppercase tracking-[0.18em]">
              Reverts current workspace
            </p>
          </div>
        </div>

        {diff && selectedSavePoint ? (
          <div className="mt-3 grid gap-2 md:grid-cols-[auto_auto_auto_1fr]">
            <span className="rounded-[0.85rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2.5 py-2 text-[0.62rem] text-[var(--text-muted)]">
              {diff.summary.filesChanged} file{diff.summary.filesChanged !== 1 ? "s" : ""}
            </span>
            <span className="rounded-[0.85rem] border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2 text-[0.62rem] text-emerald-300">+{diff.summary.insertions}</span>
            <span className="rounded-[0.85rem] border border-rose-500/20 bg-rose-500/10 px-2.5 py-2 text-[0.62rem] text-rose-300">&minus;{diff.summary.deletions}</span>
            <div className="rounded-[0.85rem] border border-[rgba(251,191,36,0.16)] bg-[rgba(251,191,36,0.07)] px-2.5 py-2">
              <div className="flex items-center justify-between gap-3 text-[0.58rem] uppercase tracking-[0.16em] text-[var(--text-subtle)]">
                <span>Restore source</span>
                <span className="font-mono tracking-[0.1em]">{diff.commitOid.slice(0, 7)}</span>
              </div>
              <p className="dispatch-text-secondary mt-1 text-[0.68rem] leading-5">
                Review each changed file before restoring the full workspace.
              </p>
            </div>
          </div>
        ) : null}

        {diffError ? (
          <div className="dispatch-alert mt-3 rounded-[0.95rem] px-3 py-2 text-xs" role="alert">
            {diffError}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!selectedSavePoint ? (
          <div className="flex h-full items-center justify-center">
            <p className="dispatch-text-muted text-xs">
              No save point selected. Pick one from the left rail.
            </p>
          </div>
        ) : diffStatus === "loading" ? (
          <div className="flex items-center gap-1.5 px-3 py-3 text-xs">
            <LoaderCircle className="dispatch-text-secondary animate-spin" size={12} />
            <span className="dispatch-text-secondary">Loading diff</span>
          </div>
        ) : diff ? (
          diff.files.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="dispatch-text-muted text-xs">
                No file changes in this save point.
              </p>
            </div>
          ) : (
            <div className="space-y-3 p-3">
              {diff.files.map((file) => (
                <article
                  key={`${file.path}:${file.status}:${file.previousPath ?? "current"}`}
                  className="overflow-hidden rounded-[1rem] border border-[var(--surface-border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_12px_26px_rgba(0,0,0,0.16)]"
                >
                  <div className="border-b border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className={`shrink-0 rounded-full border px-1.5 py-px text-[0.52rem] font-medium uppercase leading-none tracking-wide ${fileStatusClassName(file.status)}`}>
                            {file.status}
                          </span>
                          {file.isBinary ? (
                            <span className="dispatch-text-subtle text-[0.58rem] uppercase tracking-[0.16em]">binary</span>
                          ) : null}
                        </div>
                        <p className="dispatch-text-primary mt-2 truncate font-mono text-[0.7rem] font-medium">
                          {file.path}
                        </p>
                        {file.previousPath ? (
                          <p className="dispatch-text-subtle mt-1 truncate text-[0.62rem]">
                            Previously {file.previousPath}
                          </p>
                        ) : (
                          <p className="dispatch-text-subtle mt-1 text-[0.62rem]">
                            Restore only this file if the rest of the snapshot is not needed.
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={isRestoring}
                        className="dispatch-danger-button inline-flex shrink-0 items-center justify-center gap-1 rounded-[0.75rem] px-2.5 py-1.5 text-[0.62rem] font-medium"
                        onClick={() => onRestoreFile(file.path)}
                        aria-label="Restore file"
                      >
                        <RotateCcw size={10} />
                        <span>Restore file</span>
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    {renderPatchLines(file)}
                  </div>
                </article>
              ))}
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="dispatch-text-muted text-xs">
              Diff data is unavailable.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
