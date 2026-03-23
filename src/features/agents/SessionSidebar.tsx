import {
  LoaderCircle,
  Plus,
} from "lucide-react";

import {
  describeAgentSession,
  describeAgentSessionMeta,
  formatAgentSessionElapsed,
  formatAgentSessionStatus,
  type AgentSessionRecord,
} from "./store/agentsSlice";

type SessionSidebarProps = {
  sessions: AgentSessionRecord[];
  selectedSessionId: string | null;
  isReady: boolean;
  isCreating: boolean;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
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

export function SessionSidebar({
  sessions,
  selectedSessionId,
  isReady,
  isCreating,
  onSelectSession,
  onCreateSession,
}: SessionSidebarProps) {
  const runningCount = sessions.filter((session) => session.status === "running").length;

  return (
    <aside className="dispatch-rail flex min-h-0 flex-col bg-[rgba(9,12,18,0.88)]">
      <div className="flex items-start justify-between gap-2 px-2.5 py-2">
        <div className="min-w-0">
          <span className="dispatch-text-muted text-[0.65rem] font-semibold uppercase tracking-[0.18em]">
            Sessions
          </span>
          <p className="dispatch-text-subtle mt-0.5 text-[0.6rem] leading-4">
            {runningCount} live · {sessions.length} total
          </p>
        </div>

        <button
          type="button"
          className="dispatch-icon-button flex h-8 w-8 items-center justify-center rounded-md"
          onClick={onCreateSession}
          disabled={!isReady || isCreating}
          aria-label="New shell session"
          title="New shell"
        >
          {isCreating ? (
            <LoaderCircle size={12} className="animate-spin" />
          ) : (
            <Plus size={12} />
          )}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5">
        {sessions.length === 0 ? (
          <p className="dispatch-text-subtle px-1.5 py-3 text-center text-[0.68rem] leading-4">
            No active sessions
          </p>
        ) : (
          <div role="list" className="flex flex-col gap-1">
            {sessions.map((session) => {
              const isSelected = session.id === selectedSessionId;

              return (
                <button
                  key={session.id}
                  type="button"
                  role="listitem"
                  aria-pressed={isSelected}
                  aria-label={describeAgentSession(session)}
                  className="group flex w-full flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[rgba(88,163,255,0.18)] hover:bg-[rgba(255,255,255,0.03)]"
                  style={{
                    borderColor: isSelected ? "rgba(88, 163, 255, 0.28)" : "rgba(255, 255, 255, 0.04)",
                    background: isSelected ? "rgba(59, 130, 246, 0.12)" : "rgba(255, 255, 255, 0.015)",
                    boxShadow: isSelected ? "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 24px rgba(0,0,0,0.18)" : "none",
                  }}
                  data-active={isSelected}
                  onClick={() => onSelectSession(session.id)}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="dispatch-shell-status inline-block h-1.5 w-1.5 shrink-0"
                      data-state={getStatusState(session.status)}
                    />
                    <span className="min-w-0 truncate text-[0.72rem] font-medium text-[var(--text-primary)]">
                      {describeAgentSession(session)}
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-1 text-[0.6rem] leading-4">
                    <span className="rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-1.5 py-0.5 text-[var(--text-subtle)]">
                      {formatAgentSessionStatus(session.status)}
                    </span>
                    <span className="dispatch-text-subtle min-w-0 truncate">
                      {describeAgentSessionMeta(session)}
                    </span>
                    <span className="dispatch-text-subtle shrink-0">
                      {formatAgentSessionElapsed(session)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
