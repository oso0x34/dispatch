import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@xterm/xterm/css/xterm.css";
import {
  LoaderCircle,
  Rocket,
  TerminalSquare,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

import { useDispatchStore } from "../../app/providers";
import {
  getBrowserPreviewTerminalOutput,
  isBrowserPreviewMode,
  type TerminalSessionRecord,
} from "../../shared/lib/tauri";
import { AgentSessionToolbar } from "./AgentSessionToolbar";
import { DispatchModal } from "./DispatchModal";
import { OrchestratedSessionView } from "./OrchestratedSessionView";
import { SessionSidebar } from "./SessionSidebar";
import {
  describeAgentSession,
  isOpenClawAgentSession,
  isTerminalAgentSession,
  type TerminalAgentSessionRecord,
} from "./store/agentsSlice";

type CopyState = "idle" | "copied" | "error" | "empty";

function getTerminalSocketUrl(websocketBaseUrl: string, sessionId: string) {
  return `${websocketBaseUrl}/ws/terminal/${sessionId}`;
}

function sendTerminalResize(socket: WebSocket, terminal: Terminal) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      type: "resize",
      rows: terminal.rows,
      cols: terminal.cols,
      pixelWidth: 0,
      pixelHeight: 0,
    }),
  );
}

type TauriInternalsWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: unknown;
  };
};

const TERMINAL_DEBUG_STORAGE_KEY = "dispatch:debug-terminal";

function isTauriLinuxRuntime() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return /linux/i.test(navigator.userAgent)
    && typeof (window as TauriInternalsWindow).__TAURI_INTERNALS__?.invoke === "function";
}

function isTerminalDebugEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return true;
  }

  try {
    return window.localStorage.getItem(TERMINAL_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function logTerminalDebug(enabled: boolean, message: string, details?: Record<string, unknown>) {
  if (!enabled) {
    return;
  }

  if (details) {
    console.debug(`[dispatch-terminal] ${message}`, details);
    return;
  }

  console.debug(`[dispatch-terminal] ${message}`);
}

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable
    || tagName === "input"
    || tagName === "textarea"
    || tagName === "select";
}

function encodeTerminalInputFromKey(event: KeyboardEvent): string | null {
  if (event.isComposing || event.metaKey) {
    return null;
  }

  switch (event.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\u007f";
    case "Tab":
      return event.shiftKey ? "\u001b[Z" : "\t";
    case "Escape":
      return "\u001b";
    case "ArrowUp":
      return "\u001b[A";
    case "ArrowDown":
      return "\u001b[B";
    case "ArrowRight":
      return "\u001b[C";
    case "ArrowLeft":
      return "\u001b[D";
    case "Home":
      return "\u001b[H";
    case "End":
      return "\u001b[F";
    case "Delete":
      return "\u001b[3~";
    case "PageUp":
      return "\u001b[5~";
    case "PageDown":
      return "\u001b[6~";
    default:
      break;
  }

  if (event.ctrlKey) {
    if (event.key === " " || event.key === "@") {
      return "\u0000";
    }

    const lowerKey = event.key.toLowerCase();
    if (lowerKey >= "a" && lowerKey <= "z") {
      return String.fromCharCode(lowerKey.charCodeAt(0) - 96);
    }

    switch (event.key) {
      case "[":
        return "\u001b";
      case "\\":
        return "\u001c";
      case "]":
        return "\u001d";
      case "^":
      case "6":
        return "\u001e";
      case "_":
      case "-":
        return "\u001f";
      default:
        return null;
    }
  }

  if (event.altKey && event.key.length === 1) {
    return `\u001b${event.key}`;
  }

  if (event.key.length === 1 && !event.altKey) {
    return event.key;
  }

  return null;
}

type TerminalSessionViewportProps = {
  session: TerminalSessionRecord;
  websocketBaseUrl: string;
  active: boolean;
  onOutputChunk: (sessionId: string, chunk: string) => void;
};

function PreviewTerminalViewport({
  session,
  active,
  onOutputChunk,
}: Pick<TerminalSessionViewportProps, "session" | "active" | "onOutputChunk">) {
  const output = getBrowserPreviewTerminalOutput(session.id) ?? `${session.program} /workspace/dispatch\n$`;

  useEffect(() => {
    if (!active) {
      return;
    }

    onOutputChunk(session.id, output);
  }, [active, onOutputChunk, output, session.id]);

  return (
    <div
      data-testid={`terminal-session-${session.id}`}
      className="relative h-full w-full overflow-hidden rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(8,12,18,0.92),rgba(6,9,14,0.98))] shadow-[0_20px_60px_rgba(0,0,0,0.28)]"
      aria-label={describeAgentSession({
        ...session,
        kind: "terminal",
      })}
      aria-hidden={!active}
    >
      <pre className="m-0 h-full w-full overflow-auto px-4 py-4 whitespace-pre-wrap font-mono text-[13px] leading-6 text-[rgba(235,241,249,0.94)]">
        {output}
      </pre>
    </div>
  );
}

function TerminalSessionViewport({
  session,
  websocketBaseUrl,
  active,
  onOutputChunk,
}: TerminalSessionViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef<TextDecoder>(new TextDecoder());
  const inputEncoderRef = useRef<TextEncoder>(new TextEncoder());
  const pendingInputRef = useRef<Uint8Array[]>([]);
  const focusFrameRef = useRef<number | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const focusTerminalNow = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.focus();

    const textarea = terminal.textarea;
    if (!textarea) {
      return;
    }

    if (isTauriLinuxRuntime()) {
      // WebKitGTK can ignore focused zero-size offscreen textareas.
      textarea.style.opacity = "0.001";
      if (!textarea.style.left || textarea.style.left.startsWith("-")) {
        textarea.style.left = "0px";
      }
      if (!textarea.style.top) {
        textarea.style.top = "0px";
      }
      if (!textarea.style.width || textarea.style.width === "0px") {
        textarea.style.width = "1px";
      }
      if (!textarea.style.height || textarea.style.height === "0px") {
        textarea.style.height = "1px";
      }
      if (!textarea.style.lineHeight || textarea.style.lineHeight === "0px") {
        textarea.style.lineHeight = "1px";
      }
    }

    if (document.activeElement !== textarea) {
      textarea.focus({ preventScroll: true });
    }
  }, []);

  const scheduleTerminalFocus = useCallback(() => {
    if (typeof window === "undefined") {
      focusTerminalNow();
      return;
    }

    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current);
    }

    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      focusTerminalNow();
    });
  }, [focusTerminalNow]);

  useEffect(() => () => {
    if (focusFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    const debugTerminal = isTerminalDebugEnabled();
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      theme: {
        background: "rgba(0, 0, 0, 0)",
        foreground: "#ecf0f7",
        cursor: "#dbeafe",
        selectionBackground: "rgba(59, 130, 246, 0.24)",
      },
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();
    let webglAddon: WebglAddon | null = null;
    const webglAllowed = !isTauriLinuxRuntime();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);

    if (webglAllowed) {
      try {
        webglAddon = new WebglAddon();
        terminal.loadAddon(webglAddon);
      } catch {
        webglAddon = null;
      }
    } else {
      logTerminalDebug(debugTerminal, "skipping WebGL renderer for Tauri Linux", {
        sessionId: session.id,
      });
    }

    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    pendingInputRef.current = [];

    const socket = new WebSocket(getTerminalSocketUrl(websocketBaseUrl, session.id));
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    const sendTerminalInput = (data: string, source: "xterm" | "fallback") => {
      const encodedInput = inputEncoderRef.current.encode(data);

      logTerminalDebug(debugTerminal, `${source} input`, {
        sessionId: session.id,
        length: encodedInput.byteLength,
        socketReadyState: socket.readyState,
      });

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encodedInput);
        return;
      }

      if (socket.readyState === WebSocket.CONNECTING) {
        pendingInputRef.current.push(encodedInput);
        logTerminalDebug(debugTerminal, "buffered terminal input while websocket connects", {
          sessionId: session.id,
          source,
          bufferedChunks: pendingInputRef.current.length,
        });
        return;
      }

      logTerminalDebug(debugTerminal, "dropped terminal input because websocket is not open", {
        sessionId: session.id,
        source,
        socketReadyState: socket.readyState,
      });
    };

    const syncResize = () => {
      fitAddon.fit();
      sendTerminalResize(socket, terminal);
    };

    const writeBinaryChunk = (chunk: Uint8Array) => {
      terminal.write(chunk);
      const decodedChunk = decoderRef.current.decode(chunk, { stream: true });
      if (decodedChunk) {
        onOutputChunk(session.id, decodedChunk);
      }
    };

    const handleSocketMessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        terminal.write(event.data);
        onOutputChunk(session.id, event.data);
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        writeBinaryChunk(new Uint8Array(event.data));
        return;
      }

      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buffer) => {
          writeBinaryChunk(new Uint8Array(buffer));
        });
      }
    };

    const flushPendingInput = () => {
      if (socket.readyState !== WebSocket.OPEN || pendingInputRef.current.length === 0) {
        return;
      }

      const pendingInput = pendingInputRef.current.splice(0);
      for (const chunk of pendingInput) {
        socket.send(chunk);
      }

      logTerminalDebug(debugTerminal, "flushed buffered terminal input", {
        sessionId: session.id,
        chunkCount: pendingInput.length,
      });
    };

    const handleSocketOpen = () => {
      logTerminalDebug(debugTerminal, "terminal websocket opened", {
        sessionId: session.id,
      });

      if (activeRef.current) {
        syncResize();
      }

      flushPendingInput();

      if (activeRef.current) {
        scheduleTerminalFocus();
      }
    };

    const handleSocketClose = (event: CloseEvent) => {
      logTerminalDebug(debugTerminal, "terminal websocket closed", {
        sessionId: session.id,
        code: event.code,
        readyState: socket.readyState,
      });
    };

    const handleSocketError = () => {
      logTerminalDebug(debugTerminal, "terminal websocket error", {
        sessionId: session.id,
        readyState: socket.readyState,
      });
    };

    const handleHostKeyDownCapture = (event: KeyboardEvent) => {
      logTerminalDebug(debugTerminal, "host keydown", {
        sessionId: session.id,
        key: event.key,
        code: event.code,
        target: event.target instanceof HTMLElement ? event.target.tagName.toLowerCase() : "unknown",
      });
    };

    const handleWindowKeyDownFallback = (event: KeyboardEvent) => {
      if (!activeRef.current) {
        return;
      }

      if (!isTauriLinuxRuntime()) {
        return;
      }

      const textarea = terminal.textarea;
      if (textarea && (event.target === textarea || document.activeElement === textarea)) {
        return;
      }

      if (event.defaultPrevented || isEditableEventTarget(event.target)) {
        return;
      }

      const encodedInput = encodeTerminalInputFromKey(event);
      if (!encodedInput) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      scheduleTerminalFocus();
      sendTerminalInput(encodedInput, "fallback");
    };

    socket.addEventListener("open", handleSocketOpen);
    socket.addEventListener("message", handleSocketMessage);
    socket.addEventListener("close", handleSocketClose);
    socket.addEventListener("error", handleSocketError);
    host.addEventListener("keydown", handleHostKeyDownCapture, true);
    window.addEventListener("keydown", handleWindowKeyDownFallback, true);

    const disposeTerminalKey = terminal.onKey(({ key, domEvent }) => {
      logTerminalDebug(debugTerminal, "xterm onKey", {
        sessionId: session.id,
        key,
        code: domEvent.code,
        ctrlKey: domEvent.ctrlKey,
        altKey: domEvent.altKey,
        metaKey: domEvent.metaKey,
      });
    });

    const disposeTerminalData = terminal.onData((data) => {
      sendTerminalInput(data, "xterm");
    });

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (!activeRef.current) {
            return;
          }

          syncResize();
        })
      : null;

    if (resizeObserver) {
      resizeObserver.observe(host);
    }

    if (activeRef.current) {
      syncResize();
      scheduleTerminalFocus();
    }

    return () => {
      resizeObserver?.disconnect();
      disposeTerminalData.dispose();
      disposeTerminalKey.dispose();
      host.removeEventListener("keydown", handleHostKeyDownCapture, true);
      window.removeEventListener("keydown", handleWindowKeyDownFallback, true);
      socket.removeEventListener("open", handleSocketOpen);
      socket.removeEventListener("message", handleSocketMessage);
      socket.removeEventListener("close", handleSocketClose);
      socket.removeEventListener("error", handleSocketError);
      socket.close();
      terminal.dispose();
      webglAddon?.dispose();
      pendingInputRef.current = [];
      fitAddonRef.current = null;
      socketRef.current = null;
      terminalRef.current = null;
    };
  }, [onOutputChunk, scheduleTerminalFocus, session.id, websocketBaseUrl]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    const fitAddon = fitAddonRef.current;

    if (!terminal || !socket || !fitAddon) {
      return;
    }

    if (!active) {
      return;
    }

    fitAddon.fit();
    sendTerminalResize(socket, terminal);
    scheduleTerminalFocus();
  }, [active, scheduleTerminalFocus]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[18px] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(5,8,12,0.92),rgba(2,4,7,0.98))] shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
      <div
        ref={hostRef}
        data-testid={`terminal-session-${session.id}`}
        className="h-full w-full min-h-0 rounded-[14px] outline-none"
        style={{ outline: "none" }}
        aria-label={describeAgentSession({
          ...session,
          kind: "terminal",
        })}
        aria-hidden={!active}
        onClick={scheduleTerminalFocus}
        onMouseDown={scheduleTerminalFocus}
      />
    </div>
  );
}

type TerminalPanelProps = {
  projectId: string | null;
  active: boolean;
};

export function TerminalPanel({ projectId, active }: TerminalPanelProps) {
  const browserPreviewMode = isBrowserPreviewMode();
  const projects = useDispatchStore((state) => state.projects);
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const workspaceProjectId = useDispatchStore((state) => state.workspaceProjectId);
  const workspaceStatus = useDispatchStore((state) => state.workspaceStatus);
  const terminalAction = useDispatchStore((state) => state.terminalAction);
  const workspaceError = useDispatchStore((state) => state.workspaceError);
  const websocketBaseUrl = useDispatchStore((state) => state.websocketBaseUrl);
  const openClawStatus = useDispatchStore((state) => state.openClawStatus);
  const sessions = useDispatchStore((state) => state.sessions);
  const selectedSessionId = useDispatchStore((state) => state.selectedSessionId);
  const tasksProjectId = useDispatchStore((state) => state.tasksProjectId);
  const tasksStatus = useDispatchStore((state) => state.tasksStatus);
  const tasks = useDispatchStore((state) => state.tasks);
  const initializeTerminalWorkspace = useDispatchStore((state) => state.initializeTerminalWorkspace);
  const initializeTasks = useDispatchStore((state) => state.initializeTasks);
  const refreshTerminalWorkspace = useDispatchStore((state) => state.refreshTerminalWorkspace);
  const selectSession = useDispatchStore((state) => state.selectSession);
  const createTerminalSession = useDispatchStore((state) => state.createTerminalSession);
  const dispatchAgent = useDispatchStore((state) => state.dispatchAgent);
  const dispatchViaOpenClaw = useDispatchStore((state) => state.dispatchViaOpenClaw);
  const terminateSession = useDispatchStore((state) => state.terminateSession);
  const openTasksOverlay = useDispatchStore((state) => state.openTasksOverlay);
  const clearTerminalError = useDispatchStore((state) => state.clearTerminalError);
  const dispatchButtonRef = useRef<HTMLButtonElement | null>(null);
  const sessionOutputRef = useRef<Record<string, string>>({});
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [fullscreenSessionId, setFullscreenSessionId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [mountedTerminalSessionIds, setMountedTerminalSessionIds] = useState<string[]>([]);

  useEffect(() => {
    if (!active) {
      return;
    }

    void initializeTerminalWorkspace(projectId);
  }, [active, initializeTerminalWorkspace, projectId]);

  useEffect(() => {
    const activeSessionIds = new Set(sessions.map((session) => session.id));

    for (const sessionId of Object.keys(sessionOutputRef.current)) {
      if (!activeSessionIds.has(sessionId)) {
        delete sessionOutputRef.current[sessionId];
      }
    }
  }, [sessions]);

  useEffect(() => {
    setCopyState("idle");
  }, [selectedSessionId]);

  useEffect(() => {
    if (copyState === "idle") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyState("idle");
    }, 1600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyState]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const selectedTerminalSession = selectedSession && isTerminalAgentSession(selectedSession)
    ? selectedSession
    : null;
  const selectedOpenClawSession = selectedSession && isOpenClawAgentSession(selectedSession)
    ? selectedSession
    : null;
  const terminalSessions = useMemo(
    () => sessions.filter(isTerminalAgentSession),
    [sessions],
  );
  const mountedTerminalSessions = useMemo(
    () => mountedTerminalSessionIds
      .map((sessionId) => terminalSessions.find((session) => session.id === sessionId) ?? null)
      .filter((session): session is TerminalAgentSessionRecord => session !== null),
    [mountedTerminalSessionIds, terminalSessions],
  );
  const linkedTask = selectedOpenClawSession?.taskId
    ? tasks.find((task) => task.id === selectedOpenClawSession.taskId) ?? null
    : null;
  const activeProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  useEffect(() => {
    setMountedTerminalSessionIds((current) => current.filter((sessionId) => (
      terminalSessions.some((session) => session.id === sessionId)
    )));
  }, [terminalSessions]);

  useEffect(() => {
    if (!selectedTerminalSession) {
      return;
    }

    setMountedTerminalSessionIds((current) => (
      current.includes(selectedTerminalSession.id)
        ? current
        : [...current, selectedTerminalSession.id]
    ));
  }, [selectedTerminalSession]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (!selectedOpenClawSession?.taskId) {
      return;
    }

    if (!projectId || activeProjectId !== projectId) {
      return;
    }

    if (tasksProjectId === projectId && (tasksStatus === "loading" || tasksStatus === "ready")) {
      return;
    }

    void initializeTasks();
  }, [
    active,
    activeProjectId,
    initializeTasks,
    projectId,
    selectedOpenClawSession?.taskId,
    tasksProjectId,
    tasksStatus,
  ]);

  const isReady = workspaceStatus === "ready" && Boolean(websocketBaseUrl);
  const isLoading = workspaceStatus === "loading"
    || (projectId !== null && workspaceProjectId !== projectId && workspaceStatus === "idle");
  const hasProject = projectId !== null;
  const showEmptyState = isReady && sessions.length === 0;
  const isCreating = terminalAction === "creating";
  const isDispatching = terminalAction === "dispatching";
  const isTerminating = terminalAction === "terminating";
  const isFullscreen = selectedSession !== null && fullscreenSessionId === selectedSession.id;

  const appendSessionOutput = useMemo(
    () => (sessionId: string, chunk: string) => {
      const currentOutput = sessionOutputRef.current[sessionId] ?? "";
      const nextOutput = `${currentOutput}${chunk}`;

      sessionOutputRef.current[sessionId] = nextOutput.length > 200_000
        ? nextOutput.slice(nextOutput.length - 200_000)
        : nextOutput;
    },
    [],
  );

  const handleCreateSession = () => {
    clearTerminalError();
    void createTerminalSession().catch(() => undefined);
  };

  const handleOpenDispatchModal = () => {
    clearTerminalError();
    setDispatchModalOpen(true);
  };

  const handleCopyOutput = async () => {
    if (!selectedTerminalSession) {
      return;
    }

    const output = sessionOutputRef.current[selectedTerminalSession.id] ?? "";
    if (!output.trim()) {
      setCopyState("empty");
      return;
    }

    const clipboard = typeof window !== "undefined"
      ? window.navigator.clipboard
      : navigator.clipboard;

    if (!clipboard?.writeText) {
      setCopyState("error");
      return;
    }

    try {
      await clipboard.writeText(output);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const handleToggleFullscreen = () => {
    if (!selectedSession) {
      return;
    }

    setFullscreenSessionId((current) => current === selectedSession.id ? null : selectedSession.id);
  };

  const handleTerminateSelectedSession = () => {
    if (!selectedSession) {
      return;
    }

    clearTerminalError();
    void terminateSession(selectedSession.id).catch(() => undefined);
  };

  const handleOpenLinkedTask = () => {
    if (!selectedSession?.taskId) {
      return;
    }

    openTasksOverlay(selectedSession.taskId);
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.05),transparent_24%),linear-gradient(180deg,rgba(3,5,8,0.96),rgba(5,7,11,0.98))]">
        {workspaceError ? (
          <div className="dispatch-alert mx-1.5 mt-1.5 rounded-[14px] px-3 py-2 text-[0.75rem] leading-5" role="alert">
            <span className="truncate">{workspaceError}</span>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-[8.75rem_minmax(0,1fr)] gap-2 p-1.5">
            <SessionSidebar
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              openClawStatus={openClawStatus}
              isReady={isReady}
              isCreating={isCreating}
              onSelectSession={selectSession}
            onCreateSession={handleCreateSession}
          />

          <div className="flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-[rgba(255,255,255,0.06)] bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_30%),linear-gradient(180deg,rgba(6,8,12,0.84),rgba(3,5,8,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.34)]">
            {!hasProject ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="dispatch-text-muted text-[0.78rem]">
                  Select a project to begin.
                </p>
              </div>
            ) : isLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2">
                <LoaderCircle size={18} className="animate-spin dispatch-text-muted" />
                <p className="dispatch-text-subtle text-[0.72rem]">Starting workspace</p>
              </div>
            ) : showEmptyState ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4">
                <div className="text-center">
                  <TerminalSquare size={20} className="mx-auto mb-2 dispatch-text-subtle" />
                  <p className="dispatch-text-muted text-[0.78rem]">
                    No active sessions
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="dispatch-action-button inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[0.75rem] font-medium"
                    onClick={handleCreateSession}
                    disabled={!isReady || isCreating}
                    aria-label="Start a new shell session"
                  >
                    <TerminalSquare size={13} />
                    <span>New shell</span>
                  </button>
                  <button
                    ref={dispatchButtonRef}
                    type="button"
                    className="dispatch-control inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[0.75rem] font-medium"
                    onClick={handleOpenDispatchModal}
                    disabled={isDispatching}
                    aria-label="Dispatch an agent"
                  >
                    <Rocket size={13} />
                    <span>Dispatch</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col p-1.5">
                {isFullscreen ? (
                  <div
                    className="fixed inset-0 z-[65] bg-[rgba(7,10,16,0.72)] backdrop-blur-sm"
                    onClick={() => setFullscreenSessionId(null)}
                    role="presentation"
                  />
                ) : null}

                <div className={isFullscreen ? "fixed inset-2 z-[70] flex flex-col overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[rgba(7,9,14,0.96)] shadow-[0_30px_90px_rgba(0,0,0,0.5)]" : "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px]"}>
                  <AgentSessionToolbar
                    session={selectedSession}
                    isFullscreen={isFullscreen}
                    isBusy={isTerminating}
                    copyState={copyState}
                    onCopyOutput={() => {
                      void handleCopyOutput();
                    }}
                    onToggleFullscreen={handleToggleFullscreen}
                    onTerminate={handleTerminateSelectedSession}
                    onOpenTask={handleOpenLinkedTask}
                  />

                  <div className="min-h-0 flex-1 overflow-hidden p-1.5">
                    {selectedOpenClawSession ? (
                      <div className="h-full overflow-hidden rounded-[18px] border border-[rgba(255,255,255,0.05)] bg-[rgba(8,12,18,0.44)] px-1 pb-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        <OrchestratedSessionView
                          session={selectedOpenClawSession}
                          connectionStatus={openClawStatus}
                          linkedTask={linkedTask}
                          active={active}
                        />
                      </div>
                    ) : (
                      <div className="relative h-full overflow-hidden bg-[rgba(0,0,0,0.48)] px-1 pb-2">
                        {browserPreviewMode ? (
                          selectedTerminalSession ? (
                            <PreviewTerminalViewport
                              session={selectedTerminalSession}
                              active={active}
                              onOutputChunk={appendSessionOutput}
                            />
                          ) : null
                        ) : isReady && websocketBaseUrl ? (
                          mountedTerminalSessions.map((session) => {
                            const isSelected = session.id === selectedTerminalSession?.id;

                            return (
                              <div
                                key={session.id}
                                className={isSelected ? "h-full" : "hidden h-full"}
                                aria-hidden={!isSelected}
                              >
                                <TerminalSessionViewport
                                  session={session}
                                  websocketBaseUrl={websocketBaseUrl}
                                  active={active && isSelected}
                                  onOutputChunk={appendSessionOutput}
                                />
                              </div>
                            );
                          })
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <DispatchModal
        open={dispatchModalOpen}
        projectId={projectId}
        projectName={activeProject?.name ?? null}
        openClawStatus={openClawStatus}
        isSubmitting={isDispatching}
        onClose={() => setDispatchModalOpen(false)}
        onDispatch={async ({ profileId, prompt, route }) => {
          if (projectId && workspaceProjectId !== projectId) {
            await initializeTerminalWorkspace(projectId, { force: workspaceProjectId !== null });
          }

          clearTerminalError();
          if (route === "openclaw") {
            await dispatchViaOpenClaw({
              prompt: prompt ?? "",
            });
          } else {
            await dispatchAgent({
              profileId,
              prompt,
            });
          }
        }}
        returnFocusRef={dispatchButtonRef}
      />
    </>
  );
}
