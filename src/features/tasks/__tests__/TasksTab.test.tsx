// @vitest-environment jsdom

import { useEffect } from "react";
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
  ProjectRecord,
  TaskRecord,
  TerminalSessionRecord,
} from "../../../shared/lib/tauri";
import { TasksTab } from "../TasksTab";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../agents/DispatchModal", () => ({
  DispatchModal: ({
    open,
    projectId,
    projectName,
    isSubmitting,
    initialProfileId,
    onClose,
    onDispatch,
  }: {
    open: boolean;
    projectId: string | null;
    projectName: string | null;
    isSubmitting: boolean;
    initialProfileId?: string | null;
    onClose: () => void;
    onDispatch: (input: {
      profileId: string;
      prompt: string | null;
      route: "local" | "openclaw";
    }) => Promise<void>;
  }) => {
    if (!open) {
      return null;
    }

    return (
      <div data-testid="dispatch-modal">
        <div data-testid="dispatch-context">{`${projectId ?? "none"}:${projectName ?? "none"}:${String(isSubmitting)}:${initialProfileId ?? "none"}`}</div>
        <button
          type="button"
          onClick={() => {
            void onDispatch({
              profileId: "codex",
              prompt: "Ship it",
              route: "local",
            });
          }}
        >
          Confirm dispatch
        </button>
        <button type="button" onClick={onClose}>
          Close modal
        </button>
      </div>
    );
  },
}));

type BackendState = {
  project: ProjectRecord;
  tasksByProject: Record<string, TaskRecord[]>;
  sessionsByProject: Record<string, TerminalSessionRecord[]>;
  nextSessionIndex: number;
};

function buildProject(): ProjectRecord {
  return {
    id: "project-alpha",
    name: "Alpha",
    rootRelativePath: ".",
    createdAt: 100,
    updatedAt: 100,
    lastOpenedAt: null,
  };
}

function buildTask(projectId: string): TaskRecord {
  return {
    id: "task-1",
    projectId,
    title: "Dispatchable task",
    descriptionMarkdown: "Task body",
    priority: "high",
    labels: [],
    subtasks: [],
    reviewNotesMarkdown: "",
    assignee: null,
    workflowState: "draft",
    lastRunState: "idle",
    lastSessionId: null,
    assignedAgentMode: null,
    markdownExportPath: "dispatch/tasks/task-1-dispatchable-task.md",
    blockedReason: null,
    createdAt: 100,
    updatedAt: 100,
    completedAt: null,
  };
}

function buildSession(projectId: string, taskId: string, index: number): TerminalSessionRecord {
  return {
    id: `session-${index}`,
    projectId,
    taskId,
    source: "direct_dispatch",
    sessionKind: "direct_agent",
    status: "running",
    program: "codex",
    transport: "pty",
    cwdRelativePath: ".",
    startedAt: 200 + index,
    endedAt: null,
    createdAt: 200 + index,
    updatedAt: 200 + index,
  };
}

function installBackendState() {
  const project = buildProject();
  const state: BackendState = {
    project,
    tasksByProject: {
      [project.id]: [
        buildTask(project.id),
      ],
    },
    sessionsByProject: {
      [project.id]: [],
    },
    nextSessionIndex: 1,
  };

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "list_projects":
        return [{ ...state.project }];
      case "get_setting":
        return {
          key: "app.active_project_id",
          value: state.project.id,
          updatedAt: 100,
        };
      case "set_setting":
        return {
          key: "app.active_project_id",
          value: args?.value ?? null,
          updatedAt: 100,
        };
      case "list_tasks": {
        const projectId = String((args?.input as { projectId?: string } | undefined)?.projectId ?? "");
        return (state.tasksByProject[projectId] ?? []).map((task) => ({ ...task }));
      }
      case "list_agent_registry_entries":
        return [
          { id: "auto", name: "Auto", selectionMode: "auto" },
          { id: "codex", name: "Codex", selectionMode: "profile" },
        ];
      case "get_terminal_workspace": {
        const projectId = String((args as { projectId?: string } | undefined)?.projectId ?? "");
        return {
          websocketBaseUrl: "ws://dispatch.test/terminals",
          sessions: (state.sessionsByProject[projectId] ?? []).map((session) => ({ ...session })),
        };
      }
      case "get_openclaw_sidebar_snapshot":
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
        };
      case "dispatch_agent": {
        const input = (args ?? {}) as {
          projectId?: string;
          profileId?: string;
          taskId?: string | null;
          prompt?: string | null;
        };
        const projectId = String(input.projectId ?? "");
        const taskId = String(input.taskId ?? "");
        const session = buildSession(projectId, taskId, state.nextSessionIndex);
        state.nextSessionIndex += 1;
        state.sessionsByProject[projectId] = [
          session,
          ...(state.sessionsByProject[projectId] ?? []),
        ];
        state.tasksByProject[projectId] = (state.tasksByProject[projectId] ?? []).map((task) => (
          task.id === taskId
            ? {
              ...task,
              workflowState: "in_progress",
              lastRunState: "running",
              lastSessionId: session.id,
              updatedAt: task.updatedAt + 1,
            }
            : task
        ));
        return { ...session };
      }
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });

  return state;
}

function TasksHarness() {
  const initializeProjects = useDispatchStore((state) => state.initializeProjects);

  useEffect(() => {
    void initializeProjects();
  }, [initializeProjects]);

  return <TasksTab />;
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("TasksTab", () => {
  it("shows an empty board state when the project has no tasks", async () => {
    const backend = installBackendState();
    backend.tasksByProject[backend.project.id] = [];

    render(
      <AppProviders>
        <TasksHarness />
      </AppProviders>,
    );

    expect(await screen.findByText("No tasks yet")).toBeTruthy();
    expect(screen.getByText("Create a title")).toBeTruthy();
    expect(screen.getByText("Nothing selected")).toBeTruthy();
  });

  it("dispatches from a task card through the shared modal and refreshes task linkage", async () => {
    const backend = installBackendState();
    const user = userEvent.setup();

    render(
      <AppProviders>
        <TasksHarness />
      </AppProviders>,
    );

    await screen.findByTestId("kanban-card-task-1");

    await user.click(screen.getByRole("button", { name: "Send to Agent" }));

    expect(screen.getByTestId("dispatch-modal")).toBeTruthy();
    expect(screen.getByTestId("dispatch-context").textContent).toBe("project-alpha:Alpha:false:none");

    await user.click(screen.getByRole("button", { name: "Confirm dispatch" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("dispatch_agent", {
        projectId: "project-alpha",
        profileId: "codex",
        taskId: "task-1",
        prompt: "Ship it",
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("dispatch-modal")).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    });
    expect(backend.tasksByProject[backend.project.id]?.[0]?.lastSessionId).toBe("session-1");
  });
});
