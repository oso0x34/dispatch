// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { OpenClawConnectionStatusRecord } from "../../../shared/lib/tauri";
import { SessionSidebar } from "../SessionSidebar";
import type {
  AgentSessionRecord,
  OpenClawAgentSessionRecord,
  TerminalAgentSessionRecord,
} from "../store/agentsSlice";

function buildOpenClawStatus(
  state: OpenClawConnectionStatusRecord["state"],
): OpenClawConnectionStatusRecord {
  return {
    state,
    gatewayUrl: state === "disconnected" ? null : "ws://127.0.0.1:7331",
    connectedAt: state === "connected" ? 1_763_372_400 : null,
    lastError: null,
    protocolVersion: 3,
    serverVersion: "mock-gateway",
    tickIntervalMs: 250,
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

function buildTerminalSession(): TerminalAgentSessionRecord {
  return {
    kind: "terminal",
    id: "session-4242-1764000000000000000-1",
    projectId: "project-alpha",
    taskId: null,
    source: "direct_dispatch",
    sessionKind: "direct_agent",
    status: "running",
    program: "/bin/bash",
    transport: "terminal.websocket",
    cwdRelativePath: ".",
    startedAt: 1_763_372_100,
    endedAt: null,
    createdAt: 1_763_372_100,
    updatedAt: 1_763_372_100,
  };
}

function buildOpenClawSession(): OpenClawAgentSessionRecord {
  return {
    kind: "openclaw",
    id: "openclaw:agent:main:global",
    sessionKey: "agent:main:global",
    title: "Review loop",
    subtitle: "Review · Agent codex · agent:main:global",
    source: "openclaw",
    sessionKind: "orchestrated_agent",
    status: "running",
    taskId: null,
    agentId: "codex",
    label: "Review",
    runId: "run-123",
    createdAt: 1_763_372_200,
    updatedAt: 1_763_372_260,
    lastActivityAt: 1_763_372_260,
  };
}

function renderSidebar(
  sessions: AgentSessionRecord[],
  _openClawStatus: OpenClawConnectionStatusRecord,
) {
  const onSelectSession = vi.fn();
  const onCreateSession = vi.fn();

  render(
    <SessionSidebar
      sessions={sessions}
      selectedSessionId={sessions[0]?.id ?? null}
      isReady={true}
      isCreating={false}
      onSelectSession={onSelectSession}
      onCreateSession={onCreateSession}
    />,
  );

  return {
    onSelectSession,
    onCreateSession,
  };
}

describe("OpenClawStatus", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the disconnected sidebar state without orchestrated sessions", () => {
    renderSidebar([], buildOpenClawStatus("disconnected"));

    expect(screen.getByText(/Standalone mode/i)).toBeTruthy();
    expect(screen.getByText("No sessions yet.")).toBeTruthy();
  });

  it("shows connected orchestrated sessions with a distinct openclaw badge", () => {
    renderSidebar([buildOpenClawSession()], buildOpenClawStatus("connected"));

    expect(screen.getByText(/OpenClaw connected/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review loop/i })).toBeTruthy();
    expect(screen.getAllByText("OpenClaw").length).toBeGreaterThan(0);
    expect(screen.getByText(/Review · Agent codex/i)).toBeTruthy();
  });

  it("renders mixed local and orchestrated sessions in the same sidebar", () => {
    renderSidebar(
      [
        buildOpenClawSession(),
        buildTerminalSession(),
      ],
      buildOpenClawStatus("connected"),
    );

    expect(screen.getByRole("button", { name: /Review loop/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /bash #4242:1/i })).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.getAllByText("OpenClaw").length).toBeGreaterThan(0);
  });
});
