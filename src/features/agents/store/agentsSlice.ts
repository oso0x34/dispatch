import type { StateCreator } from "zustand";

import {
  dispatchOpenClawSession as dispatchOpenClawSessionCommand,
  dispatchAgent as dispatchAgentCommand,
  createTerminalSession as createTerminalSessionCommand,
  getOpenClawSidebarSnapshot,
  getTerminalWorkspace,
  killOpenClawSession as killOpenClawSessionCommand,
  terminateTerminalSession as terminateTerminalSessionCommand,
  type OpenClawConnectionStatusRecord,
  type OpenClawDispatchSessionResultRecord,
  type OpenClawSidebarSessionRecord,
  type OpenClawSidebarSnapshotRecord,
  type TerminalSessionRecord,
} from "../../../shared/lib/tauri";
import type { DispatchStore } from "../../../store";

export type TerminalWorkspaceStatus = "idle" | "loading" | "ready" | "error";
export type TerminalAction = "idle" | "creating" | "dispatching" | "terminating";
type TerminalWorkspaceLoadOptions = {
  force?: boolean;
};

export type TerminalAgentSessionRecord = TerminalSessionRecord & {
  kind: "terminal";
};

export type OpenClawAgentSessionRecord = OpenClawSidebarSessionRecord & {
  kind: "openclaw";
};

export type AgentSessionRecord =
  | TerminalAgentSessionRecord
  | OpenClawAgentSessionRecord;

export type AgentsSlice = {
  workspaceProjectId: string | null;
  workspaceStatus: TerminalWorkspaceStatus;
  terminalAction: TerminalAction;
  workspaceError: string | null;
  websocketBaseUrl: string | null;
  openClawStatus: OpenClawConnectionStatusRecord | null;
  sessions: AgentSessionRecord[];
  selectedSessionId: string | null;
  initializeTerminalWorkspace: (
    projectId: string | null,
    options?: TerminalWorkspaceLoadOptions,
  ) => Promise<void>;
  refreshTerminalWorkspace: () => Promise<void>;
  selectSession: (sessionId: string) => void;
  createTerminalSession: (input?: {
    taskId?: string | null;
    shell?: string | null;
  }) => Promise<TerminalSessionRecord>;
  dispatchAgent: (input: {
    profileId: string;
    taskId?: string | null;
    prompt?: string | null;
  }) => Promise<TerminalSessionRecord>;
  dispatchViaVicam: (input: {
    taskId?: string | null;
    prompt: string;
  }) => Promise<OpenClawDispatchSessionResultRecord>;
  terminateSession: (sessionId: string) => Promise<boolean>;
  clearTerminalError: () => void;
};

type DispatchState = DispatchStore & AgentsSlice;

function disconnectedOpenClawStatus(): OpenClawConnectionStatusRecord {
  return {
    state: "disconnected",
    gatewayUrl: null,
    connectedAt: null,
    lastError: null,
    protocolVersion: null,
    serverVersion: null,
    tickIntervalMs: null,
    availableMethods: [],
    availableEvents: [],
    helloSnapshot: null,
    statusDetails: null,
    healthDetails: null,
    presenceDetails: null,
    lastEventAt: null,
    lastEventSeq: null,
  };
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

function toTerminalAgentSession(session: TerminalSessionRecord): TerminalAgentSessionRecord {
  return {
    ...session,
    kind: "terminal",
  };
}

function toOpenClawAgentSession(
  session: OpenClawSidebarSessionRecord,
): OpenClawAgentSessionRecord {
  return {
    ...session,
    kind: "openclaw",
  };
}

function sortSessions(sessions: AgentSessionRecord[]) {
  return [...sessions].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return right.createdAt - left.createdAt;
    }

    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return right.id.localeCompare(left.id);
  });
}

function mergeAgentSessions(
  terminalSessions: TerminalSessionRecord[],
  openClawSessions: OpenClawSidebarSessionRecord[],
) {
  return sortSessions([
    ...terminalSessions.map(toTerminalAgentSession),
    ...openClawSessions.map(toOpenClawAgentSession),
  ]);
}

function resolveSelectedSessionId(
  currentSelectedSessionId: string | null,
  sessions: AgentSessionRecord[],
) {
  if (
    currentSelectedSessionId
    && sessions.some((session) => session.id === currentSelectedSessionId)
  ) {
    return currentSelectedSessionId;
  }

  return sessions[0]?.id ?? null;
}

function upsertSession(
  sessions: AgentSessionRecord[],
  session: TerminalSessionRecord,
) {
  return sortSessions([
    toTerminalAgentSession(session),
    ...sessions.filter((candidate) => candidate.id !== session.id),
  ]);
}

async function loadOpenClawSidebarSnapshot(): Promise<OpenClawSidebarSnapshotRecord> {
  try {
    return await getOpenClawSidebarSnapshot();
  } catch {
    return {
      status: disconnectedOpenClawStatus(),
      sessions: [],
    };
  }
}

export function isTerminalAgentSession(
  session: AgentSessionRecord,
): session is TerminalAgentSessionRecord {
  return session.kind === "terminal";
}

export function isOpenClawAgentSession(
  session: AgentSessionRecord,
): session is OpenClawAgentSessionRecord {
  return session.kind === "openclaw";
}

function humanizeStatus(status: string) {
  return status
    .split(/[_-]+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function describeAgentSession(session: AgentSessionRecord) {
  if (isOpenClawAgentSession(session)) {
    const title = session.title.trim();
    return title || session.sessionKey.trim() || "OpenClaw session";
  }

  const idParts = session.id
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
  const shortId = idParts[0] === "session" && idParts.length >= 4
    ? `${idParts[1]}:${idParts[idParts.length - 1]}`
    : idParts[idParts.length - 1] ?? session.id.trim();
  const programName = session.program.split(/[\\/]/).pop()?.trim() || session.program.trim();
  const suffix = shortId ? `#${shortId}` : "";

  if (!programName && !suffix) {
    return "Terminal session";
  }

  if (!programName) {
    return suffix;
  }

  return suffix ? `${programName} ${suffix}` : programName;
}

export function describeAgentSessionMeta(session: AgentSessionRecord) {
  if (isOpenClawAgentSession(session)) {
    return session.subtitle.trim() || session.sessionKind;
  }

  return `${session.source} · ${session.sessionKind}`;
}

export function formatAgentSessionElapsed(
  session: AgentSessionRecord,
  now = Date.now(),
) {
  if (session.status === "pending") {
    return "Queued";
  }

  if (isOpenClawAgentSession(session)) {
    const startedAt = session.createdAt;
    const finishedAt = session.status === "running"
      ? Math.floor(now / 1_000)
      : session.lastActivityAt ?? session.updatedAt ?? startedAt;
    const elapsedSeconds = Math.max(0, finishedAt - startedAt);
    const hours = Math.floor(elapsedSeconds / 3_600);
    const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
    const seconds = elapsedSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    }

    if (minutes > 0) {
      return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    }

    return `${seconds}s`;
  }

  const startedAt = session.startedAt ?? session.createdAt;
  const finishedAt = session.endedAt ?? (session.status === "running" ? Math.floor(now / 1_000) : startedAt);
  const elapsedSeconds = Math.max(0, finishedAt - startedAt);
  const hours = Math.floor(elapsedSeconds / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

export function formatAgentSessionStatus(status: AgentSessionRecord["status"]) {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    case "abandoned":
      return "Abandoned";
    default:
      return humanizeStatus(status);
  }
}

export const createAgentsSlice: StateCreator<
  DispatchState,
  [],
  [],
  AgentsSlice
> = (set, get) => ({
  workspaceProjectId: null,
  workspaceStatus: "idle",
  terminalAction: "idle",
  workspaceError: null,
  websocketBaseUrl: null,
  openClawStatus: null,
  sessions: [],
  selectedSessionId: null,
  initializeTerminalWorkspace: async (projectId, options) => {
    if (!projectId) {
      set({
        workspaceProjectId: null,
        workspaceStatus: "idle",
        workspaceError: null,
        websocketBaseUrl: null,
        openClawStatus: null,
        sessions: [],
        selectedSessionId: null,
      });
      return;
    }

    const currentProjectId = get().workspaceProjectId;
    const currentStatus = get().workspaceStatus;

    if (currentProjectId === projectId && currentStatus === "ready" && !options?.force) {
      return;
    }

    set({
      workspaceProjectId: projectId,
      workspaceStatus: "loading",
      workspaceError: null,
    });

    try {
      const [workspace, openClawSnapshot] = await Promise.all([
        getTerminalWorkspace({ projectId }),
        loadOpenClawSidebarSnapshot(),
      ]);

      if (get().workspaceProjectId !== projectId) {
        return;
      }

      const sessions = mergeAgentSessions(
        workspace.sessions,
        openClawSnapshot.sessions,
      );

      set({
        workspaceProjectId: projectId,
        workspaceStatus: "ready",
        workspaceError: null,
        websocketBaseUrl: workspace.websocketBaseUrl,
        openClawStatus: openClawSnapshot.status,
        sessions,
        selectedSessionId: resolveSelectedSessionId(
          get().selectedSessionId,
          sessions,
        ),
      });
    } catch (error: unknown) {
      if (get().workspaceProjectId !== projectId) {
        return;
      }

      set({
        workspaceStatus: "error",
        workspaceError: getErrorMessage(error, "Terminal workspace failed to load."),
        websocketBaseUrl: null,
        openClawStatus: disconnectedOpenClawStatus(),
        sessions: [],
        selectedSessionId: null,
      });
    }
  },
  refreshTerminalWorkspace: async () => {
    const projectId = get().workspaceProjectId;

    await get().initializeTerminalWorkspace(projectId, { force: true });
  },
  selectSession: (sessionId) => {
    const sessionExists = get().sessions.some((session) => session.id === sessionId);

    if (!sessionExists) {
      return;
    }

    set({
      selectedSessionId: sessionId,
      workspaceError: null,
    });
  },
  createTerminalSession: async (input) => {
    const projectId = get().workspaceProjectId;

    if (!projectId) {
      const message = "Select a project before creating a terminal session.";
      set({
        workspaceError: message,
      });
      throw new Error(message);
    }

    set({
      terminalAction: "creating",
      workspaceError: null,
    });

    try {
      const session = await createTerminalSessionCommand({
        projectId,
        taskId: input?.taskId ?? null,
        shell: input?.shell ?? null,
      });

      set((state) => ({
        sessions: upsertSession(state.sessions, session),
        selectedSessionId: session.id,
        workspaceStatus: "ready",
        workspaceError: null,
      }));

      return session;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Terminal session creation failed.");

      set({
        workspaceError: message,
      });

      throw new Error(message);
    } finally {
      set({
        terminalAction: "idle",
      });
    }
  },
  dispatchAgent: async (input) => {
    const projectId = get().workspaceProjectId;

    if (!projectId) {
      const message = "Select a project before dispatching an agent.";
      set({
        workspaceError: message,
      });
      throw new Error(message);
    }

    set({
      terminalAction: "dispatching",
      workspaceError: null,
    });

    try {
      const session = await dispatchAgentCommand({
        projectId,
        profileId: input.profileId,
        taskId: input.taskId ?? null,
        prompt: input.prompt ?? null,
      });

      set((state) => ({
        sessions: upsertSession(state.sessions, session),
        selectedSessionId: session.id,
        workspaceStatus: "ready",
        workspaceError: null,
      }));

      return session;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Agent dispatch failed.");

      set({
        workspaceError: message,
      });

      throw new Error(message);
    } finally {
      set({
        terminalAction: "idle",
      });
    }
  },
  dispatchViaVicam: async (input) => {
    const projectId = get().workspaceProjectId;

    if (!projectId) {
      const message = "Select a project before dispatching via VICAM.";
      set({
        workspaceError: message,
      });
      throw new Error(message);
    }

    set({
      terminalAction: "dispatching",
      workspaceError: null,
    });

    try {
      const result = await dispatchOpenClawSessionCommand({
        projectId,
        taskId: input.taskId ?? null,
        prompt: input.prompt,
      });

      if (get().workspaceProjectId === projectId) {
        await get().initializeTerminalWorkspace(projectId, { force: true });

        set((state) => ({
          selectedSessionId: state.sessions.some((session) => session.id === result.sessionId)
            ? result.sessionId
            : state.selectedSessionId,
          workspaceStatus: "ready",
          workspaceError: null,
        }));
      }

      return result;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "VICAM dispatch failed.");

      set({
        workspaceError: message,
      });

      throw new Error(message);
    } finally {
      set({
        terminalAction: "idle",
      });
    }
  },
  terminateSession: async (sessionId) => {
    const session = get().sessions.find((candidate) => candidate.id === sessionId) ?? null;

    if (!session) {
      const message = "Choose a session before terminating it.";
      set({
        workspaceError: message,
      });
      throw new Error(message);
    }

    set({
      terminalAction: "terminating",
      workspaceError: null,
    });

    try {
      if (isOpenClawAgentSession(session)) {
        await killOpenClawSessionCommand({
          sessionKey: session.sessionKey,
          runId: session.runId ?? null,
        });
      } else {
        const terminated = await terminateTerminalSessionCommand({ sessionId });

        if (!terminated) {
          throw new Error("Terminal session could not be terminated.");
        }
      }

      await get().refreshTerminalWorkspace();

      return true;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Session termination failed.");

      set({
        workspaceError: message,
      });

      throw new Error(message);
    } finally {
      set({
        terminalAction: "idle",
      });
    }
  },
  clearTerminalError: () => {
    set({
      workspaceError: null,
    });
  },
});
