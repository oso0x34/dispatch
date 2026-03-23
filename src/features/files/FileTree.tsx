import {
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  Image,
  LoaderCircle,
  X,
} from "lucide-react";

import type {
  ProjectContentSearchHitRecord,
  ProjectTreeEntryRecord,
} from "../../shared/lib/tauri";
import type { FileSearchMode, FileSearchStatus } from "./store/filesSlice";

type FileTreeProps = {
  currentDirectoryPath: string;
  treeEntries: ProjectTreeEntryRecord[];
  selectedPath: string | null;
  searchQuery: string;
  searchMode: FileSearchMode;
  searchStatus: FileSearchStatus;
  searchError: string | null;
  pathSearchResults: ProjectTreeEntryRecord[];
  contentSearchResults: ProjectContentSearchHitRecord[];
  onOpenDirectory: (path?: string | null) => void;
  onPreviewFile: (path: string) => void;
  onClearSearch: () => void;
  onSetSearchMode: (mode: FileSearchMode) => void;
};

function buildBreadcrumbs(currentDirectoryPath: string) {
  if (currentDirectoryPath === ".") {
    return [];
  }

  const segments = currentDirectoryPath.split("/");

  return [
    { label: "~", path: "." },
    ...segments.map((segment, index) => ({
      label: segment,
      path: segments.slice(0, index + 1).join("/"),
    })),
  ];
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "py":
    case "rs":
    case "go":
    case "rb":
    case "sh":
    case "bash":
    case "zsh":
    case "c":
    case "cpp":
    case "h":
    case "java":
    case "swift":
    case "kt":
    case "css":
    case "scss":
    case "html":
    case "vue":
    case "svelte":
      return <FileCode2 size={13} className="shrink-0 text-[var(--text-subtle)]" />;
    case "json":
    case "yaml":
    case "yml":
    case "toml":
    case "xml":
      return <FileJson size={13} className="shrink-0 text-[var(--text-subtle)]" />;
    case "md":
    case "mdx":
    case "txt":
    case "rst":
    case "log":
      return <FileText size={13} className="shrink-0 text-[var(--text-subtle)]" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "ico":
    case "webp":
      return <Image size={13} className="shrink-0 text-[var(--text-subtle)]" />;
    default:
      return <File size={13} className="shrink-0 text-[var(--text-subtle)]" />;
  }
}

export function FileTree({
  currentDirectoryPath,
  treeEntries,
  selectedPath,
  searchQuery,
  searchMode,
  searchStatus,
  searchError,
  pathSearchResults,
  contentSearchResults,
  onOpenDirectory,
  onPreviewFile,
  onClearSearch,
  onSetSearchMode,
}: FileTreeProps) {
  const breadcrumbs = buildBreadcrumbs(currentDirectoryPath);
  const showSearchResults = searchQuery.trim().length > 0;
  const resultCount = searchMode === "content" ? contentSearchResults.length : pathSearchResults.length;

  const renderEntry = (entry: ProjectTreeEntryRecord) => {
    const isActive = selectedPath === entry.path;

    return (
      <button
        key={entry.path}
        type="button"
        className={`flex w-full items-center gap-2 rounded-[0.95rem] border px-3 py-2 text-left transition-colors duration-100 ${
          isActive
            ? "border-[var(--accent-blue-border-soft)] bg-[rgba(59,130,246,0.12)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            : "border-transparent bg-transparent text-[var(--text-secondary)] hover:border-[var(--surface-border-soft)] hover:bg-[rgba(255,255,255,0.035)] hover:text-[var(--text-primary)]"
        }`}
        data-active={isActive}
        onClick={() => {
          if (entry.kind === "directory") {
            onOpenDirectory(entry.path);
            return;
          }

          onPreviewFile(entry.path);
        }}
      >
        {entry.kind === "directory" ? (
          <Folder size={13} className={`shrink-0 ${isActive ? "text-accent-blue" : "text-[var(--accent-blue)] opacity-60"}`} />
        ) : (
          getFileIcon(entry.name)
        )}
        <span className="min-w-0 truncate text-[0.72rem] font-medium">{entry.name}</span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="rounded-[1rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-3">
        {breadcrumbs.length > 0 ? (
          <nav className="flex flex-wrap items-center gap-0.5 text-[0.68rem] leading-none">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <span key={crumb.path} className="flex items-center">
                  {index > 0 ? (
                    <ChevronRight size={10} className="mx-0.5 text-[var(--text-subtle)]" />
                  ) : null}
                  <button
                    type="button"
                    className={`rounded-full px-1.5 py-0.5 transition-colors duration-100 ${
                      isLast
                        ? "bg-[rgba(255,255,255,0.06)] text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                    onClick={() => onOpenDirectory(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </span>
              );
            })}
          </nav>
        ) : (
          <p className="text-[0.68rem] uppercase tracking-[0.2em] text-[var(--text-subtle)]">
            Root
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-2 text-[0.65rem] text-[var(--text-subtle)]">
          <span>{showSearchResults ? "Search results" : "Directory entries"}</span>
          <span>{showSearchResults ? `${resultCount} matches` : `${treeEntries.length} items`}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 rounded-[0.95rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] p-1.5">
        {(["path", "content"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`flex-1 rounded-[0.7rem] px-2.5 py-1.5 text-[0.64rem] font-medium leading-none transition-colors duration-100 ${
              searchMode === mode
                ? "bg-[rgba(255,255,255,0.08)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            onClick={() => onSetSearchMode(mode)}
          >
            {mode === "content" ? "Content" : "Paths"}
          </button>
        ))}
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[0.7rem] text-[var(--text-subtle)] transition-colors duration-100 hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-primary)]"
          onClick={onClearSearch}
          aria-label="Clear search"
        >
          <X size={12} />
        </button>
      </div>

      {showSearchResults ? (
        <div className="space-y-2">
          
          {searchError ? (
            <div className="rounded-[0.95rem] border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-[0.72rem] text-[var(--danger-text)]">
              {searchError}
            </div>
          ) : null}

          {searchStatus === "loading" ? (
            <div className="flex items-center gap-2 rounded-[0.95rem] border border-[var(--surface-border-faint)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[0.7rem]">
              <LoaderCircle className="animate-spin text-[var(--text-muted)]" size={11} />
              <span className="text-[var(--text-muted)]">Searching...</span>
            </div>
          ) : searchMode === "content" ? (
            <div className="space-y-1.5">
              {contentSearchResults.length === 0 ? (
                <p className="rounded-[0.95rem] border border-[var(--surface-border-faint)] bg-[rgba(255,255,255,0.02)] px-3 py-4 text-center text-[0.7rem] text-[var(--text-subtle)]">
                  No results.
                </p>
              ) : (
                contentSearchResults.map((hit) => (
                  <button
                    key={`${hit.path}:${hit.lineNumber}:${hit.lineText}`}
                    type="button"
                    className={`flex w-full flex-col gap-1 rounded-[0.95rem] border px-3 py-2 text-left transition-colors duration-100 ${
                      selectedPath === hit.path
                        ? "border-[var(--accent-blue-border-soft)] bg-[rgba(59,130,246,0.1)] text-[var(--text-primary)]"
                        : "border-transparent bg-[rgba(255,255,255,0.02)] text-[var(--text-secondary)] hover:border-[var(--surface-border-soft)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-primary)]"
                    }`}
                    data-active={selectedPath === hit.path}
                    onClick={() => onPreviewFile(hit.path)}
                  >
                    <span className="truncate text-[0.72rem] font-medium">{hit.path}</span>
                    <div className="flex min-w-0 items-center gap-1 truncate text-[0.64rem] text-[var(--text-subtle)] font-mono">
                      <span>Line {hit.lineNumber}</span>
                      <span aria-hidden="true">:</span>
                      <span className="min-w-0 truncate">{hit.lineText}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              {pathSearchResults.length === 0 ? (
                <p className="rounded-[0.95rem] border border-[var(--surface-border-faint)] bg-[rgba(255,255,255,0.02)] px-3 py-4 text-center text-[0.7rem] text-[var(--text-subtle)]">
                  No results.
                </p>
              ) : (
                pathSearchResults.map((entry) => renderEntry(entry))
              )}
            </div>
          )}
        </div>
          ) : (
            <div className="space-y-1.5">
              {treeEntries.length === 0 ? (
            <p className="rounded-[0.95rem] border border-[var(--surface-border-faint)] bg-[rgba(255,255,255,0.02)] px-3 py-4 text-center text-[0.7rem] text-[var(--text-subtle)]">
              Empty directory.
            </p>
          ) : (
            treeEntries.map((entry) => renderEntry(entry))
          )}
        </div>
      )}
    </div>
  );
}
