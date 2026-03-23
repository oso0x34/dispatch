import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createDispatchStore,
  type DispatchStore,
} from "../../../store";
import type {
  ProjectRecord,
  TaskRecord,
} from "../../../shared/lib/tauri";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

type BackendState = {
  tasksByProject: Record<string, TaskRecord[]>;
  nextTaskIndex: number;
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

function buildTask(input: {
  id: string;
  projectId: string;
  title: string;
  workflowState?: TaskRecord["workflowState"];
  lastRunState?: TaskRecord["lastRunState"];
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
    workflowState: input.workflowState ?? "draft",
    lastRunState: input.lastRunState ?? "idle",
    lastSessionId: null,
    assignedAgentMode: null,
    markdownExportPath: null,
    blockedReason: null,
    createdAt: 100,
    updatedAt: input.updatedAt ?? 100,
    completedAt: null,
  };
}

function installBackendState(tasksByProject: Record<string, TaskRecord[]>) {
  const state: BackendState = {
    tasksByProject: Object.fromEntries(
      Object.entries(tasksByProject).map(([projectId, tasks]) => [
        projectId,
        tasks.map((task) => ({ ...task })),
      ]),
    ),
    nextTaskIndex: 1,
  };

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    const input = (args?.input as Record<string, unknown> | undefined) ?? {};

    switch (command) {
      case "list_tasks": {
        const projectId = String(input.projectId ?? "");
        return (state.tasksByProject[projectId] ?? []).map((task) => ({ ...task }));
      }
      case "create_task": {
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
          workflowState: (input.workflowState as TaskRecord["workflowState"] | null) ?? "draft",
          updatedAt: 100 + state.nextTaskIndex,
        });

        state.nextTaskIndex += 1;
        state.tasksByProject[projectId] = [
          task,
          ...(state.tasksByProject[projectId] ?? []),
        ];

        return { ...task };
      }
      case "update_task": {
        const projectId = String(input.projectId ?? "");
        const taskId = String(input.taskId ?? "");
        const tasks = state.tasksByProject[projectId] ?? [];
        const index = tasks.findIndex((task) => task.id === taskId);

        if (index < 0) {
          throw new Error("task not found");
        }

        const currentTask = tasks[index];
        const updatedTask: TaskRecord = {
          ...currentTask,
          title: typeof input.title === "string" ? input.title : currentTask.title,
          descriptionMarkdown: typeof input.descriptionMarkdown === "string"
            ? input.descriptionMarkdown
            : currentTask.descriptionMarkdown,
          priority: typeof input.priority === "string"
            ? input.priority as TaskRecord["priority"]
            : currentTask.priority,
          labels: Array.isArray(input.labels)
            ? input.labels as string[]
            : currentTask.labels,
          subtasks: Array.isArray(input.subtasks)
            ? input.subtasks as TaskRecord["subtasks"]
            : currentTask.subtasks,
          reviewNotesMarkdown: typeof input.reviewNotesMarkdown === "string"
            ? input.reviewNotesMarkdown
            : currentTask.reviewNotesMarkdown,
          assignee: input.assignee === undefined
            ? currentTask.assignee
            : (input.assignee as string | null),
          workflowState: (input.workflowState as TaskRecord["workflowState"] | undefined)
            ?? currentTask.workflowState,
          lastRunState: (input.lastRunState as TaskRecord["lastRunState"] | undefined)
            ?? currentTask.lastRunState,
          lastSessionId: input.lastSessionId === undefined
            ? currentTask.lastSessionId
            : (input.lastSessionId as string | null),
          assignedAgentMode: input.assignedAgentMode === undefined
            ? currentTask.assignedAgentMode
            : (input.assignedAgentMode as string | null),
          markdownExportPath: input.markdownExportPath === undefined
            ? currentTask.markdownExportPath
            : (input.markdownExportPath as string | null),
          blockedReason: input.blockedReason === undefined
            ? currentTask.blockedReason
            : (input.blockedReason as string | null),
          completedAt: input.completedAt === undefined
            ? currentTask.completedAt
            : (input.completedAt as number | null),
          updatedAt: currentTask.updatedAt + 1,
        };

        state.tasksByProject[projectId] = [
          updatedTask,
          ...tasks.filter((task) => task.id !== taskId),
        ];

        return { ...updatedTask };
      }
      case "delete_task": {
        const projectId = String(input.projectId ?? "");
        const taskId = String(input.taskId ?? "");
        const tasks = state.tasksByProject[projectId] ?? [];
        const previousLength = tasks.length;
        state.tasksByProject[projectId] = tasks.filter((task) => task.id !== taskId);
        return previousLength !== state.tasksByProject[projectId].length;
      }
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });

  return state;
}

function createTaskStore(projects: ProjectRecord[], activeProjectId: string | null) {
  const store = createDispatchStore();

  store.setState({
    projects,
    activeProjectId,
  } satisfies Partial<DispatchStore>);

  return store;
}

afterEach(() => {
  invokeMock.mockReset();
});

describe("tasksSlice", () => {
  it("loads empty and populated task sets from the active project scope", async () => {
    const alpha = buildProject("project-alpha", "Alpha");
    const beta = buildProject("project-beta", "Beta");
    installBackendState({
      [alpha.id]: [
        buildTask({
          id: "task-alpha",
          projectId: alpha.id,
          title: "Alpha task",
          updatedAt: 200,
        }),
      ],
      [beta.id]: [],
    });

    const store = createTaskStore([
      alpha,
      beta,
    ], alpha.id);

    await store.getState().initializeTasks();

    expect(invokeMock).toHaveBeenCalledWith("list_tasks", {
      input: {
        projectId: alpha.id,
      },
    });
    expect(store.getState().tasks.map((task) => task.id)).toEqual(["task-alpha"]);
    expect(store.getState().selectedTaskId).toBe("task-alpha");

    store.setState({ activeProjectId: beta.id });
    await store.getState().initializeTasks();

    expect(invokeMock).toHaveBeenLastCalledWith("list_tasks", {
      input: {
        projectId: beta.id,
      },
    });
    expect(store.getState().tasksProjectId).toBe(beta.id);
    expect(store.getState().tasks).toEqual([]);
    expect(store.getState().selectedTaskId).toBeNull();
  });

  it("creates updates and deletes tasks against the active project scope", async () => {
    const alpha = buildProject("project-alpha", "Alpha");
    installBackendState({
      [alpha.id]: [],
    });

    const store = createTaskStore([alpha], alpha.id);

    const createdTask = await store.getState().createTask({
      title: "Ship task board foundation",
    });

    expect(invokeMock).toHaveBeenCalledWith("create_task", {
      input: {
        projectId: alpha.id,
        title: "Ship task board foundation",
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
    expect(store.getState().tasks.map((task) => task.id)).toEqual([createdTask.id]);

    const updatedTask = await store.getState().updateTask({
      taskId: createdTask.id,
      workflowState: "review",
      completedAt: 777,
    });

    expect(invokeMock).toHaveBeenCalledWith("update_task", {
      input: {
        projectId: alpha.id,
        taskId: createdTask.id,
        title: undefined,
        descriptionMarkdown: undefined,
        priority: undefined,
        labels: undefined,
        subtasks: undefined,
        reviewNotesMarkdown: undefined,
        assignee: undefined,
        workflowState: "review",
        lastRunState: undefined,
        lastSessionId: undefined,
        assignedAgentMode: undefined,
        markdownExportPath: undefined,
        blockedReason: undefined,
        completedAt: 777,
      },
    });
    expect(updatedTask.workflowState).toBe("review");
    expect(store.getState().tasks[0]?.workflowState).toBe("review");

    await store.getState().removeTask(createdTask.id);

    expect(invokeMock).toHaveBeenCalledWith("delete_task", {
      input: {
        projectId: alpha.id,
        taskId: createdTask.id,
      },
    });
    expect(store.getState().tasks).toEqual([]);
    expect(store.getState().selectedTaskId).toBeNull();
  });
});
