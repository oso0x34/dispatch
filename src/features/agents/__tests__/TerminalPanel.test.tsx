// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useDispatchStore } from "../../../app/providers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AppProviders } from "../../../app/providers";
import type {
  OpenClawSidebarSnapshotRecord,
  TerminalSessionRecord,
  TerminalWorkspaceRecord,
} from "../../../shared/lib/tauri";
import { TerminalPanel } from "../TerminalPanel";

const invokeMock = vi.hoisted(() => vi.fn());
const clipboardWriteTextMock = vi.hoisted(() => vi.fn());
const xtermMocks = vi.hoisted(() => {
  const terminalInstances: MockTerminal[] = [];
  const fitAddonInstances: MockFitAddon[] = [];

  class MockTerminal {
    rows = 24;
    cols = 80;
    textarea = document.createElement("textarea");
    loadAddon = vi.fn((_addon: object) => {});
    open = vi.fn((host: HTMLElement) => {
      host.appendChild(this.textarea);
    });
    write = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    onKey = vi.fn((_listener: (input: { key: string; domEvent: KeyboardEvent }) => void) => ({
      dispose: vi.fn(),
    }));
    onData = vi.fn((_listener: (data: string) => void) => ({
      dispose: vi.fn(),
    }));

    constructor() {
      terminalInstances.push(this);
    }
  }

  class MockFitAddon {
    fit = vi.fn();

    constructor() {
      fitAddonInstances.push(this);
    }
  }

  class MockSearchAddon {}
  class MockWebLinksAddon {}
  class MockWebglAddon {
    dispose = vi.fn();
  }

  return {
    terminalInstances,
    fitAddonInstances,
    MockTerminal,
    MockFitAddon,
    MockSearchAddon,
    MockWebLinksAddon,
    MockWebglAddon,
  };
});
const browserMocks = vi.hoisted(() => {
  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readonly url: string;
    readonly addEventListener = vi.fn((type: string, listener: (event: unknown) => void) => {
      const listeners = this.listeners[type] ?? new Set();
      listeners.add(listener);
      this.listeners[type] = listeners;
    });
    readonly removeEventListener = vi.fn((type: string, listener: (event: unknown) => void) => {
      this.listeners[type]?.delete(listener);
    });
    readonly send = vi.fn();
    readonly close = vi.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
    });
    readonly listeners: Record<string, Set<(event: unknown) => void>> = {};
    readyState = MockWebSocket.CONNECTING;
    binaryType = "blob";

    constructor(url: string) {
      this.url = url;
      MockWebSocket.instances.push(this);
    }

    open() {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open", new Event("open"));
    }

    emit(type: string, event: unknown) {
      for (const listener of this.listeners[type] ?? []) {
        listener(event);
      }
    }
  }

  class MockResizeObserver {
    static instances: MockResizeObserver[] = [];
    readonly observe = vi.fn();
    readonly disconnect = vi.fn();

    constructor() {
      MockResizeObserver.instances.push(this);
    }
  }

  return {
    MockWebSocket,
    MockResizeObserver,
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("@xterm/xterm", () => ({
  Terminal: xtermMocks.MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: xtermMocks.MockFitAddon,
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: xtermMocks.MockSearchAddon,
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: xtermMocks.MockWebLinksAddon,
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: xtermMocks.MockWebglAddon,
}));

type Deferred<TValue> = {
  promise: Promise<TValue>;
  resolve: (value: TValue) => void;
  reject: (error: unknown) => void;
};

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve: (value: TValue) => void = () => {};
  let reject: (error: unknown) => void = () => {};

  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function buildSession(input: {
  id: string;
  program: string;
  status: TerminalSessionRecord["status"];
  createdAt: number;
  startedAt?: number | null;
  endedAt?: number | null;
}): TerminalSessionRecord {
  return {
    id: input.id,
    projectId: "project-alpha",
    taskId: null,
    source: "direct",
    sessionKind: "shell",
    status: input.status,
    program: input.program,
    transport: "terminal.websocket",
    cwdRelativePath: ".",
    startedAt: input.startedAt ?? input.createdAt,
    endedAt: input.endedAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.endedAt ?? input.createdAt,
  };
}

function cloneWorkspace(workspace: TerminalWorkspaceRecord): TerminalWorkspaceRecord {
  return {
    websocketBaseUrl: workspace.websocketBaseUrl,
    sessions: workspace.sessions.map((session) => ({ ...session })),
  };
}

function buildOpenClawSidebarSnapshot(
  overrides?: Partial<OpenClawSidebarSnapshotRecord>,
): OpenClawSidebarSnapshotRecord {
  return {
    status: {
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
    },
    sessions: [],
    ...overrides,
  };
}

function renderTerminalPanel(projectId: string | null = "project-alpha") {
  const user = userEvent.setup();

  render(
    <AppProviders>
      <TerminalPanel projectId={projectId} active />
    </AppProviders>,
  );

  return { user };
}

function OverlayStateProbe() {
  const activeTab = useDispatchStore((state) => state.activeTab);
  const activeOverlay = useDispatchStore((state) => state.activeOverlay);
  const overlayTaskId = useDispatchStore((state) => state.overlayTaskId);

  return (
    <div data-testid="overlay-state">
      {`${activeTab}:${activeOverlay ?? "none"}:${overlayTaskId ?? "none"}`}
    </div>
  );
}

function renderTerminalPanelWithOverlayState(projectId: string | null = "project-alpha") {
  const user = userEvent.setup();

  render(
      <AppProviders>
      <OverlayStateProbe />
      <TerminalPanel projectId={projectId} active />
    </AppProviders>,
  );

  return { user };
}

function getViewport(sessionId: string) {
  return document.querySelector<HTMLElement>(`[data-testid="terminal-session-${sessionId}"]`);
}

function decodeWebSocketPayload(payload: unknown) {
  expect(ArrayBuffer.isView(payload)).toBe(true);
  return new TextDecoder().decode(payload as ArrayBufferView);
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-03-20T12:00:00.000Z").getTime());
  vi.stubGlobal("WebSocket", browserMocks.MockWebSocket);
  vi.stubGlobal("ResizeObserver", browserMocks.MockResizeObserver);
  const navigatorWithClipboard = window.navigator as Navigator & {
    clipboard?: { writeText: typeof clipboardWriteTextMock };
  };
  Object.defineProperty(navigatorWithClipboard, "clipboard", {
    configurable: true,
    value: {
      writeText: clipboardWriteTextMock,
    },
  });
  vi.stubGlobal("navigator", navigatorWithClipboard);
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: undefined,
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  clipboardWriteTextMock.mockReset();
  xtermMocks.terminalInstances.length = 0;
  xtermMocks.fitAddonInstances.length = 0;
  browserMocks.MockWebSocket.instances.length = 0;
  browserMocks.MockResizeObserver.instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TerminalPanel", () => {
  it("shows the readiness flow and only attaches the selected terminal session", async () => {
    const workspaceDeferred = createDeferred<TerminalWorkspaceRecord>();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const runningSession = buildSession({
      id: "session-4242-1764000000000000000-1",
      program: "/bin/bash",
      status: "running",
      createdAt: nowSeconds - 300,
      startedAt: nowSeconds - 265,
    });
    const finishedSession = buildSession({
      id: "session-4242-1764000000000000001-2",
      program: "/bin/zsh",
      status: "failed",
      createdAt: nowSeconds - 120,
      startedAt: nowSeconds - 130,
      endedAt: nowSeconds - 65,
    });

    invokeMock.mockImplementation((command: string) => {
      if (command === "get_terminal_workspace") {
        return workspaceDeferred.promise;
      }

      if (command === "get_openclaw_sidebar_snapshot") {
        return buildOpenClawSidebarSnapshot();
      }

      throw new Error(`Unexpected Tauri invoke: ${command}`);
    });

    renderTerminalPanel();

    expect(screen.getByText("Starting workspace")).toBeTruthy();

    workspaceDeferred.resolve({
      websocketBaseUrl: "ws://127.0.0.1:4555",
      sessions: [
        runningSession,
        finishedSession,
      ],
    });

    expect(await screen.findByRole("button", { name: /zsh #4242:2/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /bash #4242:1/i })).toBeTruthy();
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(1);
    });

    expect(browserMocks.MockWebSocket.instances[0]?.url).toBe(
      "ws://127.0.0.1:4555/ws/terminal/session-4242-1764000000000000001-2",
    );
    expect(getViewport("session-4242-1764000000000000001-2")).toBeTruthy();
    expect(getViewport("session-4242-1764000000000000000-1")).toBeNull();
  });

  it("keeps viewed terminal sessions mounted when the selected session changes", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const olderSession = buildSession({
      id: "session-4242-1764000000000000000-1",
      program: "/bin/bash",
      status: "running",
      createdAt: nowSeconds - 180,
      startedAt: nowSeconds - 180,
    });
    const newerSession = buildSession({
      id: "session-4242-1764000000000000001-2",
      program: "/bin/zsh",
      status: "running",
      createdAt: nowSeconds - 60,
      startedAt: nowSeconds - 60,
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_terminal_workspace") {
        return cloneWorkspace({
          websocketBaseUrl: "ws://127.0.0.1:4666",
          sessions: [
            olderSession,
            newerSession,
          ],
        });
      }

      if (command === "get_openclaw_sidebar_snapshot") {
        return buildOpenClawSidebarSnapshot();
      }

      throw new Error(`Unexpected Tauri invoke: ${command}`);
    });

    const { user } = renderTerminalPanel();

    expect(await screen.findByRole("button", { name: /zsh #4242:2/i })).toBeTruthy();

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(1);
      expect(xtermMocks.terminalInstances).toHaveLength(1);
    });

    const initialSocket = browserMocks.MockWebSocket.instances[0];
    initialSocket?.open();
    expect(getViewport("session-4242-1764000000000000001-2")).toBeTruthy();
    expect(getViewport("session-4242-1764000000000000000-1")).toBeNull();

    await user.click(screen.getByRole("button", { name: /bash #4242:1/i }));

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(2);
      expect(xtermMocks.terminalInstances).toHaveLength(2);
    });

    expect(initialSocket?.close).not.toHaveBeenCalled();
    expect(browserMocks.MockWebSocket.instances[1]?.url).toBe(
      "ws://127.0.0.1:4666/ws/terminal/session-4242-1764000000000000000-1",
    );
    expect(getViewport("session-4242-1764000000000000000-1")).toBeTruthy();
    expect(getViewport("session-4242-1764000000000000001-2")).toBeTruthy();
    expect(xtermMocks.fitAddonInstances[0]?.fit).toHaveBeenCalled();
    expect(xtermMocks.fitAddonInstances[1]?.fit).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /zsh #4242:2/i }));

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(2);
      expect(xtermMocks.terminalInstances).toHaveLength(2);
    });

    expect(browserMocks.MockWebSocket.instances[1]?.close).not.toHaveBeenCalled();
    expect(getViewport("session-4242-1764000000000000001-2")).toBeTruthy();
    expect(xtermMocks.fitAddonInstances[0]?.fit).toHaveBeenCalled();
    expect(xtermMocks.fitAddonInstances[1]?.fit).toHaveBeenCalled();
  });

  it("keeps terminal workspace loading dormant while the agents surface is inactive", async () => {
    invokeMock.mockResolvedValue(undefined);

    render(
      <AppProviders>
        <TerminalPanel projectId="project-alpha" active={false} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByText("Starting workspace")).toBeTruthy();
    });

    expect(invokeMock).not.toHaveBeenCalledWith("get_terminal_workspace", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("get_openclaw_sidebar_snapshot");
    expect(browserMocks.MockWebSocket.instances).toHaveLength(0);
  });

  it("keeps the selected terminal session mounted while the agents surface is hidden", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const runningSession = buildSession({
      id: "session-4300-1764000000000000000-1",
      program: "/bin/bash",
      status: "running",
      createdAt: nowSeconds - 30,
      startedAt: nowSeconds - 30,
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_terminal_workspace") {
        return cloneWorkspace({
          websocketBaseUrl: "ws://127.0.0.1:4770",
          sessions: [runningSession],
        });
      }

      if (command === "get_openclaw_sidebar_snapshot") {
        return buildOpenClawSidebarSnapshot();
      }

      throw new Error(`Unexpected Tauri invoke: ${command}`);
    });

    const { rerender } = render(
      <AppProviders>
        <TerminalPanel projectId="project-alpha" active />
      </AppProviders>,
    );

    expect(await screen.findByRole("button", { name: /bash #4300:1/i })).toBeTruthy();

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(1);
      expect(xtermMocks.terminalInstances).toHaveLength(1);
    });

    const socket = browserMocks.MockWebSocket.instances[0];
    const terminal = xtermMocks.terminalInstances[0];

    rerender(
      <AppProviders>
        <TerminalPanel projectId="project-alpha" active={false} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(1);
      expect(xtermMocks.terminalInstances).toHaveLength(1);
    });

    expect(socket?.close).not.toHaveBeenCalled();
    expect(terminal?.dispose).not.toHaveBeenCalled();

    rerender(
      <AppProviders>
        <TerminalPanel projectId="project-alpha" active />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(1);
      expect(xtermMocks.terminalInstances).toHaveLength(1);
    });
  });

  it("buffers terminal input until the websocket is open", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const runningSession = buildSession({
      id: "session-7000-1764000000000000000-1",
      program: "/bin/bash",
      status: "running",
      createdAt: nowSeconds - 30,
      startedAt: nowSeconds - 30,
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_terminal_workspace") {
        return cloneWorkspace({
          websocketBaseUrl: "ws://127.0.0.1:4888",
          sessions: [runningSession],
        });
      }

      if (command === "get_openclaw_sidebar_snapshot") {
        return buildOpenClawSidebarSnapshot();
      }

      throw new Error(`Unexpected Tauri invoke: ${command}`);
    });

    renderTerminalPanel();

    expect(await screen.findByRole("button", { name: /bash #7000:1/i })).toBeTruthy();

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(1);
      expect(xtermMocks.terminalInstances).toHaveLength(1);
    });

    const socket = browserMocks.MockWebSocket.instances[0];
    const onDataHandler = xtermMocks.terminalInstances[0]?.onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined;

    expect(onDataHandler).toBeTypeOf("function");

    onDataHandler?.("echo buffered\r");
    expect(socket?.send).not.toHaveBeenCalledWith("echo buffered\r");

    socket?.open();

    await waitFor(() => {
      expect(socket?.send).toHaveBeenCalledTimes(2);
    });

    const bufferedInputCall = socket?.send.mock.calls.find(
      ([payload]) => ArrayBuffer.isView(payload),
    );
    expect(bufferedInputCall).toBeTruthy();
    expect(decodeWebSocketPayload(bufferedInputCall?.[0])).toBe("echo buffered\r");
  });

  it("sends terminal input as binary websocket frames", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const runningSession = buildSession({
      id: "session-7200-1764000000000000000-1",
      program: "/bin/bash",
      status: "running",
      createdAt: nowSeconds - 10,
      startedAt: nowSeconds - 10,
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_terminal_workspace") {
        return cloneWorkspace({
          websocketBaseUrl: "ws://127.0.0.1:5001",
          sessions: [runningSession],
        });
      }

      if (command === "get_openclaw_sidebar_snapshot") {
        return buildOpenClawSidebarSnapshot();
      }

      throw new Error(`Unexpected Tauri invoke: ${command}`);
    });

    renderTerminalPanel();

    expect(await screen.findByRole("button", { name: /bash #7200:1/i })).toBeTruthy();

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(1);
      expect(xtermMocks.terminalInstances).toHaveLength(1);
    });

    const socket = browserMocks.MockWebSocket.instances[0];
    socket?.open();

    const onDataHandler = xtermMocks.terminalInstances[0]?.onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined;

    onDataHandler?.("ls -la\r");

    const binaryInputCall = socket?.send.mock.calls.find(
      ([payload]) => ArrayBuffer.isView(payload),
    );
    expect(binaryInputCall).toBeTruthy();
    expect(decodeWebSocketPayload(binaryInputCall?.[0])).toBe("ls -la\r");
  });

  it("skips the WebGL addon in the Tauri Linux runtime", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const runningSession = buildSession({
      id: "session-7100-1764000000000000000-1",
      program: "/bin/bash",
      status: "running",
      createdAt: nowSeconds - 20,
      startedAt: nowSeconds - 20,
    });

    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: vi.fn(),
      },
    });

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_terminal_workspace") {
        return cloneWorkspace({
          websocketBaseUrl: "ws://127.0.0.1:4999",
          sessions: [runningSession],
        });
      }

      if (command === "get_openclaw_sidebar_snapshot") {
        return buildOpenClawSidebarSnapshot();
      }

      throw new Error(`Unexpected Tauri invoke: ${command}`);
    });

    renderTerminalPanel();

    expect(await screen.findByRole("button", { name: /bash #7100:1/i })).toBeTruthy();

    await waitFor(() => {
      expect(xtermMocks.terminalInstances).toHaveLength(1);
    });

    const addonNames = xtermMocks.terminalInstances[0]?.loadAddon.mock.calls.map(
      ([addon]) => addon.constructor.name,
    ) ?? [];

    expect(addonNames).not.toContain("MockWebglAddon");
  });

  it("supports copy, fullscreen, linked-task navigation, and kill controls for the selected session", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const runningSession = {
      ...buildSession({
        id: "session-5150-1764000000000000000-1",
        program: "/bin/bash",
        status: "running",
        createdAt: nowSeconds - 45,
        startedAt: nowSeconds - 45,
      }),
      taskId: "task-123",
      source: "direct_dispatch",
      sessionKind: "direct_agent",
      transport: "pty",
    } satisfies TerminalSessionRecord;
    const canceledSession = {
      ...runningSession,
      status: "canceled",
      endedAt: nowSeconds,
      updatedAt: nowSeconds,
    } satisfies TerminalSessionRecord;

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_terminal_workspace") {
        return cloneWorkspace({
          websocketBaseUrl: "ws://127.0.0.1:4777",
          sessions: invokeMock.mock.calls.some(([calledCommand]) => calledCommand === "terminate_terminal_session")
            ? [canceledSession]
            : [runningSession],
        });
      }

      if (command === "get_openclaw_sidebar_snapshot") {
        return buildOpenClawSidebarSnapshot();
      }

      if (command === "terminate_terminal_session") {
        return true;
      }

      throw new Error(`Unexpected Tauri invoke: ${command}`);
    });

    const { user } = renderTerminalPanelWithOverlayState();

    expect(await screen.findByRole("button", { name: /bash #5150:1/i })).toBeTruthy();

    await waitFor(() => {
      expect(browserMocks.MockWebSocket.instances).toHaveLength(1);
    });

    const socket = browserMocks.MockWebSocket.instances[0];
    await waitFor(() => {
      expect(socket.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    });
    socket.open();
    socket.emit("message", {
      data: "dispatch-output\n",
    });
    await waitFor(() => {
      expect(xtermMocks.terminalInstances[0]?.write).toHaveBeenCalledWith("dispatch-output\n");
    });

    await user.click(screen.getByRole("button", { name: "Copy output" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(
      screen.getByRole("button", { name: "Exit fullscreen" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Open linked task" }));
    expect(screen.getByTestId("overlay-state").textContent).toContain("tasks:none:task-123");

    await user.click(screen.getByRole("button", { name: "Terminate session" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("terminate_terminal_session", {
        sessionId: runningSession.id,
      });
    });
    await waitFor(() => {
      expect(screen.getAllByText("Canceled").length).toBeGreaterThan(0);
    });
  });
});
