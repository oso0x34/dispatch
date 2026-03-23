import {
  LoaderCircle,
  Search,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { useDispatchStore } from "../../app/providers";
import {
  PROJECT_FILE_REFRESH_EVENT,
  listenToTauriEvent,
  startProjectFileWatch,
  stopProjectFileWatch,
  type ProjectFileRefreshEventRecord,
} from "../../shared/lib/tauri";
import { FilePreview } from "./FilePreview";
import { FileTree } from "./FileTree";

type FilesTabProps = {
  active?: boolean;
};

export function FilesTab({ active = true }: FilesTabProps) {
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const filesStatus = useDispatchStore((state) => state.filesStatus);
  const filesError = useDispatchStore((state) => state.filesError);
  const currentDirectoryPath = useDispatchStore((state) => state.currentDirectoryPath);
  const treeEntries = useDispatchStore((state) => state.treeEntries);
  const selectedPath = useDispatchStore((state) => state.selectedPath);
  const previewStatus = useDispatchStore((state) => state.previewStatus);
  const previewError = useDispatchStore((state) => state.previewError);
  const filePreview = useDispatchStore((state) => state.filePreview);
  const fileSearchQuery = useDispatchStore((state) => state.fileSearchQuery);
  const fileSearchMode = useDispatchStore((state) => state.fileSearchMode);
  const fileSearchStatus = useDispatchStore((state) => state.fileSearchStatus);
  const fileSearchError = useDispatchStore((state) => state.fileSearchError);
  const pathSearchResults = useDispatchStore((state) => state.pathSearchResults);
  const contentSearchResults = useDispatchStore((state) => state.contentSearchResults);
  const initializeFiles = useDispatchStore((state) => state.initializeFiles);
  const refreshFiles = useDispatchStore((state) => state.refreshFiles);
  const openDirectory = useDispatchStore((state) => state.openDirectory);
  const previewFile = useDispatchStore((state) => state.previewFile);
  const setFileSearchQuery = useDispatchStore((state) => state.setFileSearchQuery);
  const setFileSearchMode = useDispatchStore((state) => state.setFileSearchMode);
  const runFileSearch = useDispatchStore((state) => state.runFileSearch);
  const clearFileSearch = useDispatchStore((state) => state.clearFileSearch);
  const clearFilesError = useDispatchStore((state) => state.clearFilesError);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    void initializeFiles();
  }, [active, activeProjectId, initializeFiles]);

  useEffect(() => {
    if (!active) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listenToTauriEvent<ProjectFileRefreshEventRecord>(PROJECT_FILE_REFRESH_EVENT, (event) => {
      if (disposed || event.payload.projectId !== activeProjectId) {
        return;
      }

      void refreshFiles()
        .then(() => {
          clearFileSearch();
        })
        .catch((error: unknown) => {
          console.error("Dispatch failed to refresh project files.", error);
        });
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }

      unlisten = cleanup;
    }).catch((error: unknown) => {
      console.error("Dispatch failed to subscribe to project file refresh events.", error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, activeProjectId, refreshFiles]);

  useEffect(() => {
    if (!active || !activeProjectId) {
      return undefined;
    }

    void startProjectFileWatch({ projectId: activeProjectId }).catch((error: unknown) => {
      console.error("Dispatch failed to start the project file watch.", error);
    });

    return () => {
      void stopProjectFileWatch().catch((error: unknown) => {
        console.error("Dispatch failed to stop the project file watch.", error);
      });
    };
  }, [active, activeProjectId]);

  if (!activeProjectId) {
    return (
      <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.07),transparent_30%),linear-gradient(180deg,rgba(8,10,15,0.42),rgba(8,10,15,0.12))]">
        <p className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-4 py-2 text-[0.78rem] text-[var(--text-subtle)]">
          Select a project to browse files.
        </p>
      </div>
    );
  }

  const directoryLabel = currentDirectoryPath === "." ? "Project root" : currentDirectoryPath;
  const activeSelectionLabel = selectedPath ?? currentDirectoryPath;
  const searchResultCount = pathSearchResults.length + contentSearchResults.length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_26%),radial-gradient(circle_at_top_right,rgba(255,255,255,0.04),transparent_22%),linear-gradient(180deg,rgba(7,9,14,0.64),rgba(9,11,16,0.92))]">
      <header className="border-b border-[var(--surface-border-soft)] bg-[rgba(10,13,19,0.86)] px-4 py-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">
              Files
            </p>
            <h1 className="mt-1 truncate text-[1rem] font-semibold tracking-tight text-[var(--text-primary)]">
              Project files
            </h1>
            <p className="mt-1 max-w-2xl text-[0.78rem] leading-5 text-[var(--text-muted)]">
              Project explorer. Browse the tree on the left, inspect the selected file on the right, and keep search results anchored to the current directory.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.68rem] text-[var(--text-muted)]">
              <Search size={11} />
              {fileSearchQuery.trim() ? `Search: ${fileSearchQuery.trim()}` : "Explorer ready"}
            </span>
            <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.68rem] text-[var(--text-muted)]">
              {treeEntries.length} items
            </span>
            <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.68rem] text-[var(--text-muted)]">
              {directoryLabel}
            </span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)] gap-3 px-3 py-3">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.78)] shadow-[0_24px_60px_rgba(0,0,0,0.24)]">
          <div className="border-b border-[var(--surface-border-soft)] px-3 py-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runFileSearch().catch(() => undefined);
              }}
            >
              <div className="dispatch-input flex h-9 items-center gap-2 rounded-[0.85rem] px-3">
                <Search size={12} className="shrink-0 text-[var(--text-subtle)]" />
                <input
                  ref={searchInputRef}
                  value={fileSearchQuery}
                  onChange={(event) => {
                    setFileSearchQuery(event.target.value);
                    if (fileSearchError || filesError) {
                      clearFilesError();
                    }
                  }}
                  aria-label="Search project files"
                  placeholder="Search files..."
                  className="h-full w-full bg-transparent text-[0.76rem] text-[var(--text-primary)] placeholder:text-[var(--text-subtle)] outline-none border-none"
                />
                <button
                  type="submit"
                  className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 text-[0.66rem] font-medium text-[var(--text-primary)] transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                >
                  Search
                </button>
              </div>
            </form>

            <div className="mt-2 flex items-center justify-between gap-2 text-[0.65rem] text-[var(--text-subtle)]">
              <span className="truncate">{activeSelectionLabel}</span>
              <span>{fileSearchQuery.trim() ? `${searchResultCount} matches` : `${treeEntries.length} entries`}</span>
            </div>
          </div>

          {filesError ? (
            <div className="mx-3 mt-3 rounded-[0.95rem] border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-[0.72rem] text-[var(--danger-text)]">
              {filesError}
            </div>
          ) : null}

          {filesStatus === "loading" ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[0.72rem]">
              <LoaderCircle className="animate-spin text-[var(--text-muted)]" size={12} />
              <span className="text-[var(--text-muted)]">Loading workspace tree...</span>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            <FileTree
              currentDirectoryPath={currentDirectoryPath}
              treeEntries={treeEntries}
              selectedPath={selectedPath}
              searchQuery={fileSearchQuery}
              searchMode={fileSearchMode}
              searchStatus={fileSearchStatus}
              searchError={fileSearchError}
              pathSearchResults={pathSearchResults}
              contentSearchResults={contentSearchResults}
              onOpenDirectory={(path) => {
                void openDirectory(path).catch(() => undefined);
              }}
              onPreviewFile={(path) => {
                void previewFile(path).catch(() => undefined);
              }}
              onClearSearch={() => {
                clearFileSearch();
                searchInputRef.current?.focus();
              }}
              onSetSearchMode={setFileSearchMode}
            />
          </div>
        </aside>

        <FilePreview
          previewStatus={previewStatus}
          previewError={previewError}
          filePreview={filePreview}
        />
      </div>
    </div>
  );
}
