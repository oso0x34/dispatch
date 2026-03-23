// @vitest-environment jsdom

import { useEffect } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { App } from "../App";
import { AppProviders, useDispatchStore } from "../providers";
import type {
  ProjectRecord,
  TaskRecord,
} from "../../shared/lib/tauri";

const invokeMock = vi.hoisted(() => vi.fn());
const registerMock = vi.hoisted(() => vi.fn());
const unregisterMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: registerMock.mockImplementation(async () => {}),
  unregister: unregisterMock.mockImplementation(async () => {}),
  unregisterAll: vi.fn(),
  isRegistered: vi.fn(),
}));

vi.mock("../../features/tasks/TasksTab", () => ({
  TasksTab: () => <div data-testid="tasks-tab-mock">Tasks tab</div>,
}));

vi.mock("../../features/agents/AgentsTab", () => ({
  AgentsTab: () => <div data-testid="agents-tab-mock">Agents tab</div>,
}));

vi.mock("../../features/chat/ChatTab", () => ({
  ChatTab: () => <div data-testid="chat-tab-mock">Chat tab</div>,
}));

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

function buildTask(input: {
  id: string;
  projectId: string;
  title: string;
  assignedAgentMode?: string | null;
  updatedAt?: number;
}): TaskRecord {
  return {
    id: input.id,
    projectId: input.projectId,
    title: input.title,
    descriptionMarkdown: "",
    priority: "none",
    labels: [],
    subtasks: [],
    reviewNotesMarkdown: "",
    assignee: null,
    workflowState: "draft",
    lastRunState: "idle",
    lastSessionId: null,
    assignedAgentMode: input.assignedAgentMode ?? null,
    markdownExportPath: null,
    blockedReason: null,
    createdAt: 100,
    updatedAt: input.updatedAt ?? 100,
    completedAt: null,
  };
}

type BackendState = {
  projects: ProjectRecord[];
  tasksByProject: Record<string, TaskRecord[]>;
  settings: Record<string, unknown>;
  nextTaskIndex: number;
};

function installBackendState(options?: {
  projects?: ProjectRecord[];
  activeProjectId?: string | null;
  tasksByProject?: Record<string, TaskRecord[]>;
}) {
  const state: BackendState = {
    projects: options?.projects?.map((project) => ({ ...project })) ?? [],
    tasksByProject: Object.fromEntries(
      Object.entries(options?.tasksByProject ?? {}).map(([projectId, tasks]) => [
        projectId,
        tasks.map((task) => ({ ...task })),
      ]),
    ),
    settings: {},
    nextTaskIndex: 1,
  };

  if (options?.activeProjectId !== undefined) {
    state.settings["app.active_project_id"] = options.activeProjectId;
  }

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "health":
        return {
          status: "ok",
          appName: "Dispatch",
          appVersion: "0.1.0",
          bootedAtUnix: 1_767_300_000,
          logDirectory: "/tmp/dispatch/logs",
          activeLogPath: "/tmp/dispatch/logs/dispatch.log",
          sessionLogsDirectory: "/tmp/dispatch/logs/sessions",
          staleSessionsAbandonedAtBoot: 0,
        };
      case "list_projects":
        return state.projects.map((project) => ({ ...project }));
      case "get_setting": {
        const key = String(args?.key ?? "");
        if (!(key in state.settings)) {
          return null;
        }

        return {
          key,
          value: state.settings[key],
          updatedAt: 100,
        };
      }
      case "set_setting": {
        const key = String(args?.key ?? "");
        state.settings[key] = args?.value ?? null;

        return {
          key,
          value: state.settings[key],
          updatedAt: 101,
        };
      }
      case "list_tasks": {
        const projectId = String((args?.input as { projectId?: string } | undefined)?.projectId ?? "");
        return (state.tasksByProject[projectId] ?? []).map((task) => ({ ...task }));
      }
      case "create_task": {
        const input = (args?.input as {
          projectId?: string;
          title?: string;
          assignedAgentMode?: string | null;
          workflowState?: string | null;
        } | undefined) ?? {};
        const projectId = String(input.projectId ?? "");
        const title = String(input.title ?? "").trim();

        if (!projectId) {
          throw new Error("project id cannot be blank");
        }

        if (!title) {
          throw new Error("task title cannot be blank");
        }

        const task = buildTask({
          id: `task-${state.nextTaskIndex}`,
          projectId,
          title,
          assignedAgentMode: input.assignedAgentMode,
          updatedAt: 100 + state.nextTaskIndex,
        });
        state.nextTaskIndex += 1;
        state.tasksByProject[projectId] = [
          task,
          ...(state.tasksByProject[projectId] ?? []),
        ];

        return { ...task };
      }
      case "get_terminal_workspace":
        return {
          websocketBaseUrl: "ws://localhost:5173",
          sessions: [],
        };
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
        const input = (args?.input as {
          projectId?: string;
          profileId?: string;
          taskId?: string | null;
          prompt?: string | null;
        } | undefined) ?? {};

        return {
          id: "session-1",
          projectId: String(input.projectId ?? ""),
          taskId: input.taskId ?? null,
          source: "dispatch",
          sessionKind: "terminal",
          status: "running",
          program: "codex",
          transport: "pty",
          cwdRelativePath: ".",
          startedAt: 100,
          endedAt: null,
          createdAt: 100,
          updatedAt: 100,
        };
      }
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });

  return state;
}

function StoreProbe() {
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const selectedTaskId = useDispatchStore((state) => state.selectedTaskId);
  const initializeProjects = useDispatchStore((state) => state.initializeProjects);
  const initializeTasks = useDispatchStore((state) => state.initializeTasks);

  useEffect(() => {
    void initializeProjects();
  }, [initializeProjects]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    void initializeTasks();
  }, [activeProjectId, initializeTasks]);

  return (
    <div data-testid="store-probe">
      {activeProjectId ?? ""}
      |
      {selectedTaskId ?? ""}
    </div>
  );
}

function renderApp() {
  const user = userEvent.setup();

  render(
    <AppProviders>
      <StoreProbe />
      <App />
    </AppProviders>,
  );

  return { user };
}

async function waitForStoreState(activeProjectId: string, selectedTaskId = "") {
  await waitFor(() => {
    expect(screen.getByTestId("store-probe").textContent).toBe(`${activeProjectId}|${selectedTaskId}`);
  });
}

afterEach(async () => {
  await Promise.resolve();
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 150));

  invokeMock.mockReset();
  registerMock.mockReset();
  unregisterMock.mockReset();
});

describe("App command palette", () => {
  it("creates a task from the palette query and opens the Tasks tab", async () => {
    const project = buildProject("project-alpha", "Alpha");
    installBackendState({
      projects: [project],
      activeProjectId: project.id,
      tasksByProject: {
        [project.id]: [],
      },
    });
    const { user } = renderApp();

    await waitForStoreState(project.id);

    await user.click(screen.getByRole("button", { name: "Open command palette" }));

    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    await user.type(screen.getByRole("textbox", { name: "Search commands" }), "Follow-up bug");
    await user.click(within(palette).getByRole("button", { name: /Create task/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_task", {
        input: {
          projectId: project.id,
          title: "Follow-up bug",
          descriptionMarkdown: null,
          priority: null,
          labels: null,
          subtasks: null,
          reviewNotesMarkdown: null,
          assignee: null,
          workflowState: null,
          assignedAgentMode: null,
          blockedReason: null,
        },
      });
    });

    expect(await screen.findByTestId("tasks-tab-mock")).toBeTruthy();
  });

  it("dispatches the selected task with its assigned profile", async () => {
    const project = buildProject("project-alpha", "Alpha");
    const task = buildTask({
      id: "task-1",
      projectId: project.id,
      title: "Ship palette tests",
      assignedAgentMode: "profile:codex",
    });
    installBackendState({
      projects: [project],
      activeProjectId: project.id,
      tasksByProject: {
        [project.id]: [task],
      },
    });
    const { user } = renderApp();

    await waitForStoreState(project.id, task.id);

    await user.click(screen.getByRole("button", { name: "Open command palette" }));
    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    await user.click(within(palette).getByRole("button", { name: /Dispatch selected task/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("dispatch_agent", {
        projectId: project.id,
        profileId: "codex",
        taskId: task.id,
        prompt: null,
      });
    });

    expect(await screen.findByTestId("agents-tab-mock")).toBeTruthy();
  });
});
