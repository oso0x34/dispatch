// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  OpenClawConnectionStatusRecord,
  TaskRecord,
} from "../../../shared/lib/tauri";
import { OrchestratedSessionView } from "../OrchestratedSessionView";
import type { OpenClawAgentSessionRecord } from "../store/agentsSlice";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function buildConnectionStatus(): OpenClawConnectionStatusRecord {
  return {
    state: "connected",
    gatewayUrl: "ws://127.0.0.1:7331",
    connectedAt: 1_767_300_000,
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

function buildSession(): OpenClawAgentSessionRecord {
  return {
    kind: "openclaw",
    id: "openclaw:review-session",
    sessionKey: "agent:review:global",
    title: "Automated review loop",
    subtitle: "Review",
    source: "openclaw",
    sessionKind: "orchestrated_agent",
    status: "running",
    taskId: "task-1",
    agentId: "codex",
    label: "Review",
    runId: "run-123",
    createdAt: 1_767_300_010,
    updatedAt: 1_767_300_090,
    lastActivityAt: 1_767_300_090,
  };
}

function buildTask(): TaskRecord {
  return {
    id: "task-1",
    projectId: "project-alpha",
    title: "Ship orchestrated review",
    descriptionMarkdown: "Review the final task output",
    priority: "high",
    labels: [
      "review",
      "phase-8",
    ],
    subtasks: [],
    reviewNotesMarkdown: "Initial notes\n\n---\n\n### Automated Review\n\nRESULT: PASS\n\nFEEDBACK: Reviewed and approved.",
    assignee: "Avery",
    workflowState: "done",
    lastRunState: "succeeded",
    lastSessionId: "openclaw:review-session",
    assignedAgentMode: "auto",
    markdownExportPath: null,
    blockedReason: null,
    createdAt: 100,
    updatedAt: 100,
    completedAt: 100,
  };
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("OrchestratedSessionView", () => {
  it("toggles into transcript mode and surfaces linked review handoff feedback", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_openclaw_chat_snapshot") {
        return {
          status: buildConnectionStatus(),
          streamState: "live",
          conversationId: "review-conversation",
          sessionKey: "agent:review:global",
          messages: [
            {
              id: "message-1",
              conversationId: "review-conversation",
              projectId: "project-alpha",
              agentSessionId: "openclaw:review-session",
              role: "assistant",
              authorKind: "openclaw",
              bodyMarkdown: "# Streaming summary\n\n```ts\nconst verdict = \"pass\";\n```",
              metadataJson: {
                status: "streaming",
                partial: true,
              },
              createdAt: 1_767_300_100,
            },
          ],
        };
      }

      throw new Error(`Unexpected Tauri invoke: ${command}`);
    });

    const user = userEvent.setup();

    render(
      <OrchestratedSessionView
        session={buildSession()}
        connectionStatus={buildConnectionStatus()}
        linkedTask={buildTask()}
        active
      />,
    );

    expect(screen.getByText("Automated review loop")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Transcript" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_openclaw_chat_snapshot", {
        input: {
          sessionKey: "agent:review:global",
          limit: 200,
        },
      });
    });

    expect(await screen.findByText("Streaming summary")).toBeTruthy();
    expect(screen.getByText("Reviewed and approved.")).toBeTruthy();
    expect(document.querySelector("pre code")?.textContent).toContain("const verdict = \"pass\";");
  });

  it("keeps transcript polling dormant until the orchestrated surface becomes active", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <OrchestratedSessionView
        session={buildSession()}
        connectionStatus={buildConnectionStatus()}
        linkedTask={buildTask()}
        active={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Transcript" }));
    expect(screen.getByText("Waiting for the first orchestrated message")).toBeTruthy();

    expect(invokeMock).not.toHaveBeenCalledWith("get_openclaw_chat_snapshot", expect.anything());

    invokeMock.mockResolvedValue({
      status: buildConnectionStatus(),
      streamState: "live",
      conversationId: "review-conversation",
      sessionKey: "agent:review:global",
      messages: [],
    });

    rerender(
      <OrchestratedSessionView
        session={buildSession()}
        connectionStatus={buildConnectionStatus()}
        linkedTask={buildTask()}
        active
      />,
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_openclaw_chat_snapshot", {
        input: {
          sessionKey: "agent:review:global",
          limit: 200,
        },
      });
    });
  });
});
