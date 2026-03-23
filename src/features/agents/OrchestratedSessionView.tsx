import {
  useEffect,
  useState,
} from "react";
import {
  Activity,
  Bot,
  Link2,
  RadioTower,
} from "lucide-react";

import {
  getOpenClawChatSnapshot,
  type ChatMessageRecord,
  type OpenClawConnectionStatusRecord,
  type TaskRecord,
} from "../../shared/lib/tauri";
import { MessageList } from "../chat/MessageList";
import {
  formatAutomatedReviewResult,
  parseLatestAutomatedReviewSummary,
} from "../tasks/reviewSummary";
import type { OpenClawAgentSessionRecord } from "./store/agentsSlice";
import { formatAgentSessionStatus } from "./store/agentsSlice";

type OrchestratedSessionViewProps = {
  session: OpenClawAgentSessionRecord;
  connectionStatus: OpenClawConnectionStatusRecord | null;
  linkedTask?: TaskRecord | null;
  active: boolean;
};

type TranscriptStatus = "idle" | "loading" | "ready" | "error";
type ViewMode = "overview" | "stream";

function formatTimestamp(value: number | null) {
  if (!value) {
    return "Unavailable";
  }

  return new Date(value * 1_000).toLocaleString();
}

function formatConnectionState(state: string | null | undefined) {
  if (!state) {
    return "Standalone mode";
  }

  return state
    .split(/[_-]+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTokenLabel(value: string) {
  return value
    .split(/[_-]+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTaskWorkflowState(workflowState: string) {
  return workflowState
    .split(/[_-]+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
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

function ReviewHandoffCard({
  session,
  linkedTask,
}: {
  session: OpenClawAgentSessionRecord;
  linkedTask: TaskRecord | null;
}) {
  const reviewSummary = linkedTask
    ? parseLatestAutomatedReviewSummary(linkedTask.reviewNotesMarkdown)
    : null;

  return (
    <section className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <p className="dispatch-text-muted text-[0.65rem] font-semibold uppercase tracking-[0.18em]">
        Review handoff
      </p>

      {linkedTask ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.65rem]">
            <span className="truncate">{linkedTask.title}</span>
            <span>·</span>
            <span className="dispatch-text-secondary shrink-0">{formatTaskWorkflowState(linkedTask.workflowState)}</span>
            {reviewSummary ? (
              <span className={`rounded-md px-1.5 py-0.5 font-medium ${
                reviewSummary.result === "PASS"
                  ? "border border-[rgba(94,197,151,0.22)] bg-[rgba(94,197,151,0.12)] text-[rgba(201,246,226,0.96)]"
                  : "border border-[rgba(255,193,90,0.22)] bg-[rgba(255,193,90,0.12)] text-[rgba(255,233,187,0.96)]"
              }`}
              >
                {formatAutomatedReviewResult(reviewSummary.result)}
              </span>
            ) : null}
          </div>

          <p className="dispatch-text-primary mt-2 text-xs font-medium">
            {reviewSummary
              ? "Latest automated review"
              : "No automated review decision recorded yet."}
          </p>

          <p className="dispatch-text-secondary mt-1 whitespace-pre-wrap text-xs leading-5">
            {reviewSummary
              ? reviewSummary.feedback
              : linkedTask.reviewNotesMarkdown.trim() || "Open the task drawer to capture review notes."}
          </p>

          {linkedTask.blockedReason ? (
            <p className="dispatch-text-secondary mt-2 rounded-md border border-[rgba(255,193,90,0.18)] bg-[rgba(255,193,90,0.08)] px-2 py-1.5 text-xs leading-5">
              Blocked: {linkedTask.blockedReason}
            </p>
          ) : null}

          {linkedTask.lastSessionId ? (
            <p className="dispatch-text-tertiary mt-2 truncate text-[0.65rem] leading-4" title={`Session ${linkedTask.lastSessionId}`}>
              Linked session {linkedTask.lastSessionId}
            </p>
          ) : null}
        </>
      ) : session.taskId ? (
        <p className="dispatch-text-secondary mt-2 text-xs leading-5">
          Task {session.taskId} is linked to this session. Open Tasks to inspect review notes.
        </p>
      ) : (
        <p className="dispatch-text-muted mt-2 text-xs leading-5">
          No task linked to this session.
        </p>
      )}
    </section>
  );
}

export function OrchestratedSessionView({
  session,
  connectionStatus,
  linkedTask = null,
  active,
}: OrchestratedSessionViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>("idle");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptStreamState, setTranscriptStreamState] = useState("cache_only");
  const [transcriptConnectionState, setTranscriptConnectionState] = useState(
    connectionStatus?.state ?? "disconnected",
  );
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);

  useEffect(() => {
    setViewMode("overview");
    setTranscriptStatus("idle");
    setTranscriptError(null);
    setTranscriptStreamState("cache_only");
    setTranscriptConnectionState(connectionStatus?.state ?? "disconnected");
    setMessages([]);
  }, [session.id]);

  useEffect(() => {
    if (viewMode === "stream") {
      return;
    }

    setTranscriptConnectionState(connectionStatus?.state ?? "disconnected");
  }, [connectionStatus?.state, viewMode]);

  useEffect(() => {
    if (!active || viewMode !== "stream") {
      return undefined;
    }

    let mounted = true;
    let inFlight = false;

    const refreshTranscript = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;
      setTranscriptStatus((current) => current === "ready" ? "ready" : "loading");

      try {
        const snapshot = await getOpenClawChatSnapshot({
          sessionKey: session.sessionKey,
          limit: 200,
        });

        if (!mounted) {
          return;
        }

        setMessages(snapshot.messages);
        setTranscriptStreamState(snapshot.streamState);
        setTranscriptConnectionState(snapshot.status.state);
        setTranscriptStatus("ready");
        setTranscriptError(null);
      } catch (error: unknown) {
        if (!mounted) {
          return;
        }

        setTranscriptStatus("error");
        setTranscriptError(getErrorMessage(error, "Transcript playback failed to load."));
      } finally {
        inFlight = false;
      }
    };

    void refreshTranscript();

    const intervalId = window.setInterval(() => {
      void refreshTranscript();
    }, 1_000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [active, session.sessionKey, viewMode]);

  if (viewMode === "stream") {
    return (
      <div className="flex h-full min-h-[18rem] flex-col gap-4 overflow-auto px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(10,14,20,0.96),rgba(6,9,13,0.92))] px-4 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.22)]">
          <div className="min-w-0 max-w-2xl">
            <p className="dispatch-text-muted text-[0.65rem] font-semibold uppercase tracking-[0.18em]">
              Orchestrated Session
            </p>
            <h3 className="dispatch-text-primary mt-1 truncate text-[0.95rem] font-semibold">
              {session.title}
            </h3>
            <p className="dispatch-text-secondary mt-1 text-xs leading-5">
              Transcript from the OpenClaw chat cache.
            </p>
          </div>

          <div className="inline-flex rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(10,14,26,0.64)] p-0.5 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={false}
              className="dispatch-text-secondary rounded-full px-2.5 py-1 transition-colors duration-150 hover:text-[var(--text-primary)]"
              onClick={() => setViewMode("overview")}
            >
              Overview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={true}
              className="dispatch-text-primary rounded-full bg-[rgba(255,255,255,0.08)] px-2.5 py-1 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.14)]"
              onClick={() => setViewMode("stream")}
            >
              Transcript
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,1fr)]">
          <div className="min-h-0">
            {transcriptError ? (
              <div className="dispatch-alert mb-3 rounded-[14px] px-3 py-2 text-xs">
                {transcriptError}
              </div>
            ) : null}

            <div className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[rgba(2,4,7,0.42)] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.2)]">
              <MessageList
                messages={messages}
                streamState={transcriptStreamState}
                connectionState={transcriptConnectionState}
                kicker="Transcript"
                heading={transcriptStatus === "loading" && messages.length === 0
                  ? "Loading orchestrated stream"
                  : "Orchestrated markdown stream"}
                emptyTitle="Waiting for the first orchestrated message"
                emptyDescription="Dispatch refreshes this session-specific transcript from the OpenClaw cache while the session is active."
                viewportClassName="max-h-[38rem]"
              />
            </div>
          </div>

          <div className="space-y-4">
            <ReviewHandoffCard session={session} linkedTask={linkedTask} />

            <section className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <p className="dispatch-text-muted text-[0.65rem] font-semibold uppercase tracking-[0.18em]">
                Stream source
              </p>
              <div className="mt-2 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <RadioTower size={12} className="text-accent-blue" />
                  <span className="dispatch-text-primary font-medium">
                    {formatConnectionState(transcriptConnectionState)}
                  </span>
                </div>
                <p className="dispatch-text-muted truncate leading-5" title={session.sessionKey}>
                  Session key {session.sessionKey}
                </p>
                <p className="dispatch-text-tertiary leading-4">
                  {formatAgentSessionStatus(session.status)} · {formatTokenLabel(session.sessionKind)}
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[18rem] flex-col gap-4 overflow-auto px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(10,14,20,0.96),rgba(6,9,13,0.92))] px-4 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.22)]">
        <div className="min-w-0 max-w-2xl">
          <p className="dispatch-text-muted text-[0.65rem] font-semibold uppercase tracking-[0.18em]">
            Orchestrated Session
          </p>
          <h3 className="dispatch-text-primary mt-1 truncate text-[0.95rem] font-semibold">
            {session.title}
          </h3>
          <p className="dispatch-text-secondary mt-1 text-xs leading-5">
            Mirroring this OpenClaw session. Switch to Transcript for the cached markdown stream.
          </p>
        </div>

        <div className="inline-flex rounded-full border border-[rgba(255,255,255,0.06)] bg-[rgba(10,14,26,0.64)] p-0.5 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={true}
            className="dispatch-text-primary rounded-full bg-[rgba(255,255,255,0.08)] px-2.5 py-1 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.14)]"
            onClick={() => setViewMode("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={false}
            className="dispatch-text-secondary rounded-full px-2.5 py-1 transition-colors duration-150 hover:text-[var(--text-primary)]"
            onClick={() => setViewMode("stream")}
          >
            Transcript
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(17rem,1fr)]">
        <section className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex flex-wrap gap-1.5 text-[0.65rem]">
            <span>OpenClaw</span>
            <span>·</span>
            <span className="dispatch-text-secondary">{formatAgentSessionStatus(session.status)}</span>
            <span>·</span>
            <span>{formatTokenLabel(session.sessionKind)}</span>
          </div>

          <p className="dispatch-text-secondary mt-2 text-xs leading-5">
            Overview keeps routing and activity context visible. Transcript handles the markdown playback path.
          </p>
        </section>

        <div className="space-y-4">
          <section className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <p className="dispatch-text-muted text-[0.65rem] font-semibold uppercase tracking-[0.18em]">
              Gateway
            </p>
            <div className="mt-2 space-y-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <RadioTower size={12} className="text-accent-blue" />
                <span className="dispatch-text-primary font-medium">
                  {formatConnectionState(connectionStatus?.state)}
                </span>
              </div>
              <p className="dispatch-text-tertiary leading-4">
                {connectionStatus?.gatewayUrl ?? "No gateway configured"}
              </p>
              {connectionStatus?.lastError ? (
                <p className="dispatch-text-secondary rounded-md border border-[var(--accent-error-border-faint)] bg-[rgba(186,73,73,0.08)] px-2 py-1.5 leading-5">
                  {connectionStatus.lastError}
                </p>
              ) : null}
            </div>
          </section>

          <ReviewHandoffCard session={session} linkedTask={linkedTask} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-1.5">
            <Link2 size={12} className="text-accent-blue" />
            <p className="dispatch-text-primary text-xs font-medium">Session key</p>
          </div>
          <p className="dispatch-text-secondary mt-1 break-all text-xs leading-5">
            {session.sessionKey}
          </p>
        </section>

        <section className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-1.5">
            <Bot size={12} className="text-accent-blue" />
            <p className="dispatch-text-primary text-xs font-medium">Agent routing</p>
          </div>
          <p className="dispatch-text-secondary mt-1 text-xs leading-5">
            {session.agentId ?? session.label ?? "Gateway-selected"}
          </p>
          {session.runId ? (
            <p className="dispatch-text-tertiary mt-0.5 break-all text-[0.65rem] leading-4">
              Run {session.runId}
            </p>
          ) : null}
        </section>

        <section className="rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-1.5">
            <Activity size={12} className="text-accent-blue" />
            <p className="dispatch-text-primary text-xs font-medium">Activity</p>
          </div>
          <p className="dispatch-text-secondary mt-1 text-xs leading-5">
            Last activity {formatTimestamp(session.lastActivityAt ?? session.updatedAt)}
          </p>
          <p className="dispatch-text-tertiary mt-0.5 text-[0.65rem] leading-4">
            Started {formatTimestamp(session.createdAt)}
          </p>
        </section>
      </div>
    </div>
  );
}
