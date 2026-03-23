// @vitest-environment jsdom

import {
  useEffect,
  useState,
} from "react";
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

import {
  AppProviders,
  useDispatchStore,
} from "../../../app/providers";
import type {
  OpenClawChatSnapshotRecord,
  ProjectRecord,
} from "../../../shared/lib/tauri";
import { ChatTab } from "../ChatTab";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

type BackendState = {
  projects: ProjectRecord[];
  activeProjectId: string;
  snapshot: OpenClawChatSnapshotRecord;
  sentMessages: Array<Record<string, unknown>>;
};

function buildProject(id: string, name: string): ProjectRecord {
  return {
    id,
    name,
    rootRelativePath: ".",
    createdAt: 100,
    updatedAt: 100,
    lastOpenedAt: null,
  };
}

function buildSnapshot(): OpenClawChatSnapshotRecord {
  return {
    status: {
      state: "connected",
      gatewayUrl: "ws://127.0.0.1:18789",
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
    },
    streamState: "live",
    conversationId: "main",
    sessionKey: "agent:main:global",
    messages: [
      {
        id: "user-1",
        conversationId: "main",
        projectId: "project-alpha",
        agentSessionId: null,
        role: "user",
        authorKind: "user",
        bodyMarkdown: "Please summarize the release status.",
        metadataJson: {
          source: "dispatch",
        },
        createdAt: 1_767_300_000,
      },
      {
        id: "assistant-1",
        conversationId: "main",
        projectId: "project-alpha",
        agentSessionId: "agent-session-1",
        role: "assistant",
        authorKind: "openclaw",
        bodyMarkdown: "# Streaming summary\n\n```ts\nconst answer = 42;\n```",
        metadataJson: {
          source: "stream",
          status: "streaming",
          partial: true,
          runId: "run-1",
        },
        createdAt: 1_767_300_030,
      },
    ],
  };
}

function installBackendState(): BackendState {
  const alpha = buildProject("project-alpha", "Alpha");
  const beta = buildProject("project-beta", "Beta");
  const state: BackendState = {
    projects: [
      alpha,
      beta,
    ],
    activeProjectId: alpha.id,
    snapshot: buildSnapshot(),
    sentMessages: [],
  };

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "list_projects":
        return state.projects.map((project) => ({ ...project }));
      case "get_setting":
        return {
          key: "app.active_project_id",
          value: state.activeProjectId,
          updatedAt: 100,
        };
      case "set_setting":
        return {
          key: String(args?.key ?? ""),
          value: args?.value ?? null,
          updatedAt: 101,
        };
      case "list_agent_registry_entries":
        return [
          { id: "auto", name: "Auto", selectionMode: "auto" },
          { id: "codex", name: "Codex", selectionMode: "profile" },
          { id: "gemini", name: "Gemini", selectionMode: "profile" },
        ];
      case "get_openclaw_chat_snapshot":
        return {
          ...state.snapshot,
          messages: [
            ...state.snapshot.messages,
            ...state.sentMessages.map((message, index) => ({
              id: String(message.id ?? `sent-${index}`),
              conversationId: String(message.conversationId ?? state.snapshot.conversationId),
              projectId: message.projectId === undefined ? null : String(message.projectId ?? ""),
              agentSessionId: null,
              role: "user",
              authorKind: "user",
              bodyMarkdown: String(message.bodyMarkdown ?? ""),
              metadataJson: {
                source: "dispatch",
                modelId: message.modelId ?? null,
              },
              createdAt: 1_767_300_100 + index,
            })),
          ],
        };
      case "send_openclaw_chat_message": {
        const input = args?.input as Record<string, unknown> | undefined;
        state.sentMessages.push({
          bodyMarkdown: input?.bodyMarkdown,
          projectId: input?.projectId,
          conversationId: input?.conversationId,
          sessionKey: input?.sessionKey,
          modelId: input?.modelId,
          id: `sent-${state.sentMessages.length + 1}`,
        });

        return {
          status: "accepted",
          runId: "run-2",
          sessionKey: "agent:main:global",
          conversationId: "main",
          message: {
            id: `sent-${state.sentMessages.length}`,
            conversationId: "main",
            projectId: input?.projectId ?? null,
            agentSessionId: null,
            role: "user",
            authorKind: "user",
            bodyMarkdown: String(input?.bodyMarkdown ?? ""),
            metadataJson: {
              source: "dispatch",
              modelId: input?.modelId ?? null,
              projectId: input?.projectId ?? null,
              conversationId: input?.conversationId ?? "main",
            },
            createdAt: 1_767_300_120,
          },
        };
      }
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });

  return state;
}

function ChatHarness({ active = true }: { active?: boolean }) {
  const initializeProjects = useDispatchStore((state) => state.initializeProjects);
  const activeTab = useDispatchStore((state) => state.activeTab);

  useEffect(() => {
    void initializeProjects();
  }, [initializeProjects]);

  return (
    <>
      <div data-testid="tab-state">{activeTab}</div>
      <ChatTab active={active} />
    </>
  );
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("ChatTab", () => {
  it("renders markdown chat output, shows context badges, and exposes the post-v1 voice note", async () => {
    installBackendState();

    render(
      <AppProviders>
        <ChatHarness />
      </AppProviders>,
    );

    await screen.findByText("Streaming summary");
    expect(document.querySelector("pre code")?.textContent).toContain("const answer = 42;");
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Create task" })).toBeTruthy();
    expect(screen.getAllByText(/Voice input is intentionally post-v1/i).length).toBeGreaterThan(0);
  });

  it("sends outgoing metadata with the selected project and model override", async () => {
    installBackendState();
    const user = userEvent.setup();

    render(
      <AppProviders>
        <ChatHarness />
      </AppProviders>,
    );

    await screen.findByText("Streaming summary");

    await user.selectOptions(screen.getByLabelText("Model selector"), "codex");
    await user.type(screen.getByPlaceholderText("Ask Orchestrate anything about this project..."), "Draft the review");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("send_openclaw_chat_message", {
        input: {
          bodyMarkdown: "Draft the review",
          projectId: "project-alpha",
          conversationId: "main",
          sessionKey: "agent:main:global",
          modelId: "codex",
        },
      });
    });
  });

  it("opens the tasks tab from the quick action affordance", async () => {
    installBackendState();
    const user = userEvent.setup();

    render(
      <AppProviders>
        <ChatHarness />
      </AppProviders>,
    );

    await screen.findByText("Streaming summary");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(screen.getByTestId("tab-state").textContent).toBe("tasks");
  });

  it("keeps chat snapshot polling dormant until the chat surface becomes active", async () => {
    const user = userEvent.setup();

    function ToggleChatHarness() {
      const [active, setActive] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setActive(true)}>
            Activate Chat
          </button>
          <ChatHarness active={active} />
        </>
      );
    }

    installBackendState();

    render(
      <AppProviders>
        <ToggleChatHarness />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.some(([command]) => command === "list_agent_registry_entries"),
      ).toBe(true);
    });

    expect(invokeMock).not.toHaveBeenCalledWith("get_openclaw_chat_snapshot", expect.anything());

    await user.click(screen.getByRole("button", { name: "Activate Chat" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_openclaw_chat_snapshot", {
        input: {
          conversationId: "main",
          sessionKey: "agent:main:global",
          limit: 200,
        },
      });
    });
  });
});
