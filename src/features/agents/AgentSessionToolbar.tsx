import {
  Copy,
  Expand,
  ListTodo,
  LoaderCircle,
  Minimize2,
  Square,
} from "lucide-react";

import {
  describeAgentSession,
  describeAgentSessionMeta,
  formatAgentSessionElapsed,
  formatAgentSessionStatus,
  isTerminalAgentSession,
  type AgentSessionRecord,
} from "./store/agentsSlice";

type CopyState = "idle" | "copied" | "error" | "empty";

type AgentSessionToolbarProps = {
  session: AgentSessionRecord | null;
  isFullscreen: boolean;
  isBusy: boolean;
  copyState: CopyState;
  onCopyOutput: () => void;
  onToggleFullscreen: () => void;
  onTerminate: () => void;
  onOpenTask: () => void;
};

function getStatusState(status: AgentSessionRecord["status"]) {
  if (status === "running") {
    return "ready";
  }

  if (status === "failed" || status === "canceled" || status === "abandoned") {
    return "error";
  }

  return "idle";
}

function getCopyLabel(copyState: CopyState) {
  if (copyState === "copied") {
    return "Copied";
  }

  if (copyState === "error") {
    return "Copy failed";
  }

  if (copyState === "empty") {
    return "No output yet";
  }

  return "Copy output";
}

function formatSessionSource(session: AgentSessionRecord) {
  if (session.kind === "openclaw") {
    return "OpenClaw";
  }

  return session.source
    .split(/[_-]+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSessionContext(session: AgentSessionRecord) {
  if (session.kind === "openclaw") {
    return describeAgentSessionMeta(session);
  }

  const cwdLabel = session.cwdRelativePath === "." ? "workspace root" : session.cwdRelativePath;
  return [cwdLabel, session.taskId ? `Task ${session.taskId}` : null]
    .filter(Boolean)
    .join(" · ");
}

export function AgentSessionToolbar({
  session,
  isFullscreen,
  isBusy,
  copyState,
  onCopyOutput,
  onToggleFullscreen,
  onTerminate,
  onOpenTask,
}: AgentSessionToolbarProps) {
  const canCopyOutput = Boolean(session && isTerminalAgentSession(session));
  const canTerminate = session !== null
    && (session.status === "running" || session.status === "pending")
    && !isBusy;
  const canOpenTask = Boolean(session?.taskId);

  return (
    <div
      className="dispatch-toolbar flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      role="toolbar"
      aria-label="Session controls"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {session ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[0.72rem]">
              <span
                className="dispatch-shell-status inline-block h-1.5 w-1.5"
                data-state={getStatusState(session.status)}
              />
              <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                {formatAgentSessionStatus(session.status)}
              </span>
              <span className="dispatch-text-primary min-w-0 truncate font-medium">
                {describeAgentSession(session)}
              </span>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.64rem] leading-5">
              <span className="rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.025)] px-2 py-0.5 text-[var(--text-muted)]">
                {formatSessionSource(session)}
              </span>
              <span className="rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2 py-0.5 text-[var(--text-subtle)]">
                {formatSessionContext(session)}
              </span>
              <span className="dispatch-text-subtle">
                {formatAgentSessionElapsed(session)}
              </span>
            </div>
          </>
        ) : (
          <span className="dispatch-text-muted">No session selected</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="dispatch-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md"
          aria-label={getCopyLabel(copyState)}
          onClick={onCopyOutput}
          disabled={!canCopyOutput}
          title={getCopyLabel(copyState)}
        >
          <Copy size={13} />
        </button>

        <button
          type="button"
          className="dispatch-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md"
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-pressed={isFullscreen}
          onClick={onToggleFullscreen}
          disabled={!session}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Expand size={13} />}
        </button>

        <button
          type="button"
          className="dispatch-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md"
          aria-label="Open linked task"
          onClick={onOpenTask}
          disabled={!canOpenTask}
          title={session?.taskId ? `Task ${session.taskId}` : "Linked task"}
        >
          <ListTodo size={13} />
        </button>

        <span className="mx-0.5 h-4 w-px bg-[var(--surface-border-soft)]" aria-hidden="true" />

        <button
          type="button"
          className="dispatch-action-button inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-[0.72rem] font-medium"
          aria-label={isBusy ? "Stopping session" : "Terminate session"}
          onClick={onTerminate}
          disabled={!canTerminate}
          title={isBusy ? "Stopping..." : "Kill session"}
        >
          {isBusy ? (
            <LoaderCircle size={13} className="animate-spin" />
          ) : (
            <Square size={13} />
          )}
          <span>{isBusy ? "Stop" : "Terminate"}</span>
        </button>
      </div>
    </div>
  );
}
