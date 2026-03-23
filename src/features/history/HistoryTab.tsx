import {
  LoaderCircle,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { useDispatchStore } from "../../app/providers";
import {
  createManualSavePoint,
  getProjectSavePointDiff,
  listProjectSavePoints,
  restoreProjectSavePoint,
  restoreProjectSavePointFile,
  type SavePointDiffRecord,
  type SavePointRecord,
} from "../../shared/lib/tauri";
import { DiffViewer } from "./DiffViewer";
import {
  formatSavePointLabel,
  SavePointList,
} from "./SavePointList";
import { RestoreConfirmDialog } from "./RestoreConfirmDialog";

type AsyncStatus = "idle" | "loading" | "ready" | "error";
type ActionStatus = "idle" | "creating" | "restoring";
type StatusMessageTone = "success" | "error" | "info";

type StatusMessage = {
  tone: StatusMessageTone;
  text: string;
} | null;

type RestoreIntent =
  | {
      mode: "workspace";
      savePoint: SavePointRecord;
    }
  | {
      mode: "file";
      savePoint: SavePointRecord;
      filePath: string;
    };

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function isUnsupportedHistory(message: string | null) {
  return message === "project is not a git repository";
}

function filterSavePoints(savePoints: SavePointRecord[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return savePoints;
  }

  return savePoints.filter((savePoint) => {
    const searchableText = [
      formatSavePointLabel(savePoint.refName),
      savePoint.stage,
      savePoint.commitOid,
      savePoint.refName,
      savePoint.runId ?? "",
    ].join(" ").toLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

const STATUS_AUTO_DISMISS_MS = 5000;

export function HistoryTab() {
  const projects = useDispatchStore((state) => state.projects);
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const [savePoints, setSavePoints] = useState<SavePointRecord[]>([]);
  const [selectedRefName, setSelectedRefName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [listStatus, setListStatus] = useState<AsyncStatus>("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [diffStatus, setDiffStatus] = useState<AsyncStatus>("idle");
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diff, setDiff] = useState<SavePointDiffRecord | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [restoreIntent, setRestoreIntent] = useState<RestoreIntent | null>(null);

  const filteredSavePoints = filterSavePoints(savePoints, searchQuery);
  const selectedSavePoint = savePoints.find((savePoint) => savePoint.refName === selectedRefName) ?? null;
  const isCreating = actionStatus === "creating";
  const isRestoring = actionStatus === "restoring";

  const dismissStatus = useCallback(() => setStatusMessage(null), []);

  // Auto-dismiss status messages
  useEffect(() => {
    if (!statusMessage || statusMessage.tone === "error") {
      return;
    }

    const timer = setTimeout(dismissStatus, STATUS_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [statusMessage, dismissStatus]);

  useEffect(() => {
    if (!activeProjectId) {
      setSavePoints([]);
      setSelectedRefName(null);
      setSearchQuery("");
      setListStatus("idle");
      setListError(null);
      setDiffStatus("idle");
      setDiffError(null);
      setDiff(null);
      setActionStatus("idle");
      setStatusMessage(null);
      setRestoreIntent(null);
      return;
    }

    let active = true;
    setSearchQuery("");
    setListStatus("loading");
    setListError(null);
    setSavePoints([]);
    setSelectedRefName(null);
    setDiffStatus("idle");
    setDiffError(null);
    setDiff(null);
    setStatusMessage(null);
    setRestoreIntent(null);

    void listProjectSavePoints({ projectId: activeProjectId })
      .then((records) => {
        if (!active) {
          return;
        }

        setSavePoints(records);
        setSelectedRefName(records[0]?.refName ?? null);
        setListStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setSavePoints([]);
        setSelectedRefName(null);
        setListStatus("error");
        setListError(getErrorMessage(error, "Project history failed to load."));
      });

    return () => {
      active = false;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || !selectedRefName) {
      setDiffStatus("idle");
      setDiffError(null);
      setDiff(null);
      return;
    }

    let active = true;
    setDiffStatus("loading");
    setDiffError(null);

    void getProjectSavePointDiff({
      projectId: activeProjectId,
      refName: selectedRefName,
    })
      .then((result) => {
        if (!active) {
          return;
        }

        setDiff(result.diff);
        setDiffStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setDiff(null);
        setDiffStatus("error");
        setDiffError(getErrorMessage(error, "Save-point diff failed to load."));
      });

    return () => {
      active = false;
    };
  }, [activeProjectId, selectedRefName]);

  const handleCreateManualSavePoint = async () => {
    if (!activeProjectId) {
      return;
    }

    setActionStatus("creating");
    setStatusMessage(null);

    try {
      const result = await createManualSavePoint({ projectId: activeProjectId });

      if (result.status === "unsupported" || !result.savePoint) {
        setStatusMessage({
          tone: "info",
          text: "History is unavailable until this project lives in a git repository.",
        });
        return;
      }

      setSearchQuery("");
      setSavePoints((current) => [
        result.savePoint as SavePointRecord,
        ...current.filter((savePoint) => savePoint.refName !== result.savePoint?.refName),
      ]);
      setSelectedRefName(result.savePoint.refName);
      setListStatus("ready");
      setListError(null);
      setStatusMessage({
        tone: "success",
        text: `Manual save point created: ${formatSavePointLabel(result.savePoint.refName)}.`,
      });
    } catch (error: unknown) {
      setStatusMessage({
        tone: "error",
        text: getErrorMessage(error, "Manual save point failed."),
      });
    } finally {
      setActionStatus("idle");
    }
  };

  const handleConfirmRestore = async () => {
    if (!activeProjectId || !restoreIntent) {
      return;
    }

    setActionStatus("restoring");
    setStatusMessage(null);

    try {
      const result = restoreIntent.mode === "workspace"
        ? await restoreProjectSavePoint({
          projectId: activeProjectId,
          refName: restoreIntent.savePoint.refName,
        })
        : await restoreProjectSavePointFile({
          projectId: activeProjectId,
          refName: restoreIntent.savePoint.refName,
          relativePath: restoreIntent.filePath,
        });

      if (result.status === "unsupported") {
        setStatusMessage({
          tone: "info",
          text: "History is unavailable until this project lives in a git repository.",
        });
      } else if (restoreIntent.mode === "workspace") {
        setStatusMessage({
          tone: "success",
          text: `Restored the workspace from ${formatSavePointLabel(restoreIntent.savePoint.refName)}.`,
        });
      } else {
        setStatusMessage({
          tone: "success",
          text: `Restored ${restoreIntent.filePath} from ${formatSavePointLabel(restoreIntent.savePoint.refName)}.`,
        });
      }

      setRestoreIntent(null);
    } catch (error: unknown) {
      setStatusMessage({
        tone: "error",
        text: getErrorMessage(error, "Restore failed."),
      });
    } finally {
      setActionStatus("idle");
    }
  };

  let restoreDialogTitle = "";
  let restoreDialogDescription = "";
  let restoreDialogConfirmLabel = "Restore";

  if (restoreIntent) {
    const label = formatSavePointLabel(restoreIntent.savePoint.refName);

    if (restoreIntent.mode === "workspace") {
      restoreDialogTitle = `Restore the full workspace from ${label}?`;
      restoreDialogDescription =
        "This will overwrite all tracked and untracked changes in your working directory. Any unsaved work will be lost. This action cannot be undone.";
      restoreDialogConfirmLabel = "Restore workspace";
    } else {
      restoreDialogTitle = `Restore ${restoreIntent.filePath}?`;
      restoreDialogDescription = `This will overwrite ${restoreIntent.filePath} with its contents from save point "${label}". Any current changes to this file will be lost.`;
      restoreDialogConfirmLabel = "Restore file";
    }
  }

  const statusAlertClassName = statusMessage?.tone === "success"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
    : statusMessage?.tone === "info"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-100"
      : "border-rose-500/30 bg-rose-500/10 text-rose-100";
  const diffFileCount = diff?.summary.filesChanged ?? 0;

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_26%),radial-gradient(circle_at_top_right,rgba(255,255,255,0.04),transparent_20%),linear-gradient(180deg,rgba(8,10,15,0.78),rgba(9,11,16,0.96))]">
        {statusMessage ? (
          <div
            className={`mx-3 mt-3 flex items-center gap-2 rounded-[0.95rem] border px-3 py-2 text-[0.75rem] ${statusAlertClassName}`}
            role="status"
          >
            <span className="min-w-0 flex-1">{statusMessage.text}</span>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              onClick={dismissStatus}
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        ) : null}

        {!activeProjectId ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="dispatch-text-muted text-[0.78rem]">Select a project to view history.</p>
          </div>
        ) : listStatus === "loading" && !savePoints.length ? (
          <div className="flex flex-1 items-center justify-center">
            <LoaderCircle size={18} className="animate-spin dispatch-text-muted" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="border-b border-[var(--surface-border-soft)] bg-[rgba(9,11,17,0.86)] px-3 py-3 backdrop-blur-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">
                    History
                  </p>
                  <h1 className="mt-1 truncate text-[1rem] font-semibold tracking-tight text-[var(--text-primary)]">
                    {activeProject?.name ?? "Project history"}
                  </h1>
                  <p className="mt-1 max-w-2xl text-[0.78rem] leading-5 text-[var(--text-muted)]">
                    Inspect save points, compare file-level changes, and restore deliberately instead of scanning a flat log.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-[1rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
                    <p className="text-[0.56rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                      Save points
                    </p>
                    <p className="mt-1 text-[0.8rem] font-semibold text-[var(--text-primary)]">
                      {savePoints.length}
                    </p>
                  </div>
                  <div className="rounded-[1rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
                    <p className="text-[0.56rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                      Selected
                    </p>
                    <p className="mt-1 text-[0.8rem] font-semibold text-[var(--text-primary)]">
                      {selectedSavePoint ? formatSavePointLabel(selectedSavePoint.refName) : "None"}
                    </p>
                  </div>
                  <div className="rounded-[1rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-2">
                    <p className="text-[0.56rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                      Diff scope
                    </p>
                    <p className="mt-1 text-[0.8rem] font-semibold text-[var(--text-primary)]">
                      {diffStatus === "ready" ? `${diffFileCount} file${diffFileCount === 1 ? "" : "s"}` : "Waiting"}
                    </p>
                  </div>
                </div>
              </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,2fr)_minmax(0,3fr)] gap-3 px-3 py-3">
              <div className="min-h-0 overflow-hidden rounded-[1.35rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.76)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
                <SavePointList
                  savePoints={filteredSavePoints}
                  totalCount={savePoints.length}
                  selectedRefName={selectedRefName}
                  searchQuery={searchQuery}
                  listStatus={listStatus}
                  listError={listError}
                  isCreating={isCreating}
                  onSearchQueryChange={setSearchQuery}
                  onSelectSavePoint={(savePoint) => {
                    setSelectedRefName(savePoint.refName);
                    setStatusMessage(null);
                  }}
                  onCreateManualSavePoint={() => {
                    void handleCreateManualSavePoint();
                  }}
                />
              </div>

              <div className="min-h-0 overflow-hidden rounded-[1.35rem] border border-[var(--surface-border-soft)] bg-[rgba(7,9,14,0.7)] shadow-[0_24px_70px_rgba(0,0,0,0.33)]">
                <DiffViewer
                  selectedSavePoint={selectedSavePoint}
                  diffStatus={diffStatus}
                  diffError={isUnsupportedHistory(listError) ? null : diffError}
                  diff={diff}
                  isRestoring={isRestoring}
                  onRestoreWorkspace={() => {
                    if (!selectedSavePoint) {
                      return;
                    }

                    setRestoreIntent({
                      mode: "workspace",
                      savePoint: selectedSavePoint,
                    });
                  }}
                  onRestoreFile={(filePath) => {
                    if (!selectedSavePoint) {
                      return;
                    }

                    setRestoreIntent({
                      mode: "file",
                      savePoint: selectedSavePoint,
                      filePath,
                    });
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <RestoreConfirmDialog
        open={restoreIntent !== null}
        title={restoreDialogTitle}
        description={restoreDialogDescription}
        confirmLabel={restoreDialogConfirmLabel}
        isSubmitting={isRestoring}
        onConfirm={() => {
          void handleConfirmRestore();
        }}
        onCancel={() => {
          if (isRestoring) {
            return;
          }

          setRestoreIntent(null);
        }}
      />
    </>
  );
}
