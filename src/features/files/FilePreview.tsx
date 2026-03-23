import { openPath } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import type { ProjectFilePreviewRecord } from "../../shared/lib/tauri";
import type { FilePreviewStatus } from "./store/filesSlice";

import "highlight.js/styles/github-dark.css";

type FilePreviewProps = {
  previewStatus: FilePreviewStatus;
  previewError: string | null;
  filePreview: ProjectFilePreviewRecord | null;
};

function isMarkdown(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "md" || ext === "mdx";
}

export function FilePreview({
  previewStatus,
  previewError,
  filePreview,
}: FilePreviewProps) {
  const [openError, setOpenError] = useState<string | null>(null);

  const handleOpenInEditor = async () => {
    if (!filePreview) {
      return;
    }

    try {
      setOpenError(null);
      await openPath(filePreview.absolutePath);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.trim()) {
        setOpenError(error.message);
        return;
      }

      setOpenError("Could not open file.");
    }
  };

  const renderMarkdown = filePreview && isMarkdown(filePreview.name);

  const numberedLines = useMemo(() => {
    if (!filePreview || renderMarkdown) {
      return null;
    }

    return filePreview.content.split("\n");
  }, [filePreview, renderMarkdown]);
  const previewKindLabel = renderMarkdown ? "Markdown" : filePreview ? "Text" : "Preview";

  return (
    <div className="dispatch-pane flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.78)] shadow-[0_24px_60px_rgba(0,0,0,0.24)]">
      <div className="border-b border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
        {filePreview ? (
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <FileText size={12} className="text-[var(--text-subtle)]" />
                <span className="truncate text-[0.82rem] font-semibold text-[var(--text-primary)]">
                  {filePreview.name}
                </span>
                <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.16em] text-[var(--text-subtle)]">
                  {previewKindLabel}
                </span>
              </div>
              <p className="truncate text-[0.68rem] text-[var(--text-muted)]">
                {filePreview.path}
              </p>
            </div>

            <button
              type="button"
              className="dispatch-icon-button inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.7rem]"
              aria-label="Open in editor"
              onClick={() => {
                void handleOpenInEditor();
              }}
            >
              <ExternalLink size={11} />
              <span>Open</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.76rem] text-[var(--text-subtle)]">No file selected</span>
            <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.18em] text-[var(--text-subtle)]">
              Preview
            </span>
          </div>
        )}
      </div>

      {openError ? (
        <div className="mx-4 mt-3 rounded-[0.95rem] border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-[0.72rem] text-[var(--danger-text)]">
          {openError}
        </div>
      ) : null}

      {previewError ? (
        <div className="mx-4 mt-3 rounded-[0.95rem] border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-[0.72rem] text-[var(--danger-text)]">
          {previewError}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {previewStatus === "loading" ? (
          <div className="flex items-center gap-2 rounded-[1rem] border border-[var(--surface-border-faint)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-[0.76rem]">
            <LoaderCircle className="animate-spin text-[var(--text-muted)]" size={13} />
            <span className="text-[var(--text-muted)]">Loading...</span>
          </div>
        ) : filePreview ? (
          renderMarkdown ? (
            <div className="dispatch-markdown rounded-[1.15rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.02)] px-5 py-4 text-xs leading-6">
              <span className="sr-only">{filePreview.content}</span>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className ?? "");
                    const language = match?.[1] ?? "code";
                    const isBlockCode = Boolean(className);

                    if (!isBlockCode) {
                      return (
                        <code
                          {...props}
                          className="rounded-md border border-[rgba(88,163,255,0.18)] bg-[rgba(88,163,255,0.08)] px-1 py-0.5 text-[0.92em]"
                        >
                          {children}
                        </code>
                      );
                    }

                    return (
                      <div className="my-3 overflow-hidden rounded-[0.95rem] border border-[rgba(88,163,255,0.16)] bg-[#0b1020]">
                        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] px-3 py-1.5 text-[0.6rem] uppercase tracking-wide text-[rgba(255,255,255,0.56)]">
                          <span>{language}</span>
                        </div>
                        <pre className="overflow-auto px-3 py-2.5 text-xs leading-5">
                          <code {...props} className={className}>
                            {children}
                          </code>
                        </pre>
                      </div>
                    );
                  },
                  h1({ children }) {
                    return <h3 className="mb-1.5 text-sm font-semibold tracking-tight text-[rgba(255,255,255,0.96)]">{children}</h3>;
                  },
                  h2({ children }) {
                    return <h4 className="mb-1.5 text-xs font-semibold tracking-tight text-[rgba(255,255,255,0.96)]">{children}</h4>;
                  },
                  p({ children }) {
                    return <p className="mb-2 text-[rgba(234,239,247,0.9)] last:mb-0">{children}</p>;
                  },
                  ul({ children }) {
                    return <ul className="mb-2 list-disc space-y-0.5 pl-4 text-[rgba(234,239,247,0.9)]">{children}</ul>;
                  },
                  ol({ children }) {
                    return <ol className="mb-2 list-decimal space-y-0.5 pl-4 text-[rgba(234,239,247,0.9)]">{children}</ol>;
                  },
                  a({ children, href }) {
                    return (
                      <a
                        href={href}
                        className="text-[rgba(129,191,255,0.95)] underline decoration-[rgba(129,191,255,0.28)] underline-offset-4"
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {filePreview.content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex overflow-hidden rounded-[1.15rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.02)] text-[0.78rem] leading-[1.65]">
              <div
                className="select-none border-r border-[var(--surface-border-faint)] bg-[rgba(255,255,255,0.02)] py-4 pr-3 pl-3 text-right font-mono text-[0.68rem] leading-[1.65] text-[var(--text-subtle)]"
                aria-hidden="true"
              >
                {numberedLines?.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre className="m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words py-4 pl-4 pr-4 font-mono text-[0.78rem] leading-[1.7] text-[var(--text-primary)]">
                {filePreview.content}
              </pre>
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-4 py-2 text-[0.76rem] text-[var(--text-subtle)]">
              Select a file to preview.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
