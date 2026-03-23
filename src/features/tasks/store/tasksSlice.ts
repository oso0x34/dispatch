import type { StateCreator } from "zustand";

import {
  createTask as createTaskCommand,
  deleteTask as deleteTaskCommand,
  listTasks as listTasksCommand,
  updateTask as updateTaskCommand,
  type TaskPriority,
  type TaskRecord,
  type TaskRunState,
  type TaskSubtaskRecord,
  type TaskWorkflowState,
} from "../../../shared/lib/tauri";
import type { DispatchStore } from "../../../store";

export type TasksStatus = "idle" | "loading" | "ready" | "error";
export type TaskAction = "idle" | "creating" | "updating" | "deleting";
type TasksLoadOptions = {
  force?: boolean;
};

export type TasksSlice = {
  tasksProjectId: string | null;
  tasksStatus: TasksStatus;
  taskAction: TaskAction;
  tasksError: string | null;
  tasks: TaskRecord[];
  selectedTaskId: string | null;
  initializeTasks: (options?: TasksLoadOptions) => Promise<void>;
  refreshTasks: () => Promise<void>;
  selectTask: (taskId: string | null) => void;
  createTask: (input: {
    title: string;
    descriptionMarkdown?: string | null;
    priority?: TaskPriority | null;
    labels?: string[] | null;
    subtasks?: TaskSubtaskRecord[] | null;
    reviewNotesMarkdown?: string | null;
    assignee?: string | null;
    workflowState?: TaskWorkflowState | null;
    assignedAgentMode?: string | null;
    blockedReason?: string | null;
  }) => Promise<TaskRecord>;
  updateTask: (input: {
    taskId: string;
    title?: string;
    descriptionMarkdown?: string;
    priority?: TaskPriority;
    labels?: string[];
    subtasks?: TaskSubtaskRecord[];
    reviewNotesMarkdown?: string;
    assignee?: string | null;
    workflowState?: TaskWorkflowState;
    lastRunState?: TaskRunState;
    lastSessionId?: string | null;
    assignedAgentMode?: string | null;
    markdownExportPath?: string | null;
    blockedReason?: string | null;
    completedAt?: number | null;
  }) => Promise<TaskRecord>;
  removeTask: (taskId: string) => Promise<void>;
  clearTasksError: () => void;
};

type DispatchState = DispatchStore & TasksSlice;

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function sortTasks(tasks: TaskRecord[]) {
  return [...tasks].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    return right.id.localeCompare(left.id);
  });
}

function upsertTask(tasks: TaskRecord[], task: TaskRecord) {
  return sortTasks([
    task,
    ...tasks.filter((candidate) => candidate.id !== task.id),
  ]);
}

function resolveSelectedTaskId(currentSelectedTaskId: string | null, tasks: TaskRecord[]) {
  if (currentSelectedTaskId && tasks.some((task) => task.id === currentSelectedTaskId)) {
    return currentSelectedTaskId;
  }

  return tasks[0]?.id ?? null;
}

function taskProjectError(action: "load" | "create" | "update" | "delete") {
  switch (action) {
    case "create":
      return "Select a project before creating a task.";
    case "update":
      return "Select a project before updating a task.";
    case "delete":
      return "Select a project before deleting a task.";
    default:
      return "Select a project before loading tasks.";
  }
}

export const createTasksSlice: StateCreator<
  DispatchState,
  [],
  [],
  TasksSlice
> = (set, get) => ({
  tasksProjectId: null,
  tasksStatus: "idle",
  taskAction: "idle",
  tasksError: null,
  tasks: [],
  selectedTaskId: null,
  initializeTasks: async (options) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      set({
        tasksProjectId: null,
        tasksStatus: "idle",
        tasksError: null,
        tasks: [],
        selectedTaskId: null,
      });
      return;
    }

    const currentProjectId = get().tasksProjectId;
    const currentStatus = get().tasksStatus;

    if (currentProjectId === projectId && currentStatus === "ready" && !options?.force) {
      return;
    }

    set({
      tasksProjectId: projectId,
      tasksStatus: "loading",
      tasksError: null,
    });

    try {
      const tasks = sortTasks(await listTasksCommand({ projectId }));

      if (get().activeProjectId !== projectId) {
        return;
      }

      set({
        tasksProjectId: projectId,
        tasksStatus: "ready",
        tasksError: null,
        tasks,
        selectedTaskId: resolveSelectedTaskId(get().selectedTaskId, tasks),
      });
    } catch (error: unknown) {
      if (get().activeProjectId !== projectId) {
        return;
      }

      set({
        tasksProjectId: projectId,
        tasksStatus: "error",
        tasksError: getErrorMessage(error, "Tasks failed to load."),
        tasks: [],
        selectedTaskId: null,
      });
    }
  },
  refreshTasks: async () => {
    await get().initializeTasks({ force: true });
  },
  selectTask: (taskId) => {
    if (!taskId) {
      set({
        selectedTaskId: null,
      });
      return;
    }

    const taskExists = get().tasks.some((task) => task.id === taskId);

    if (!taskExists) {
      return;
    }

    set({
      selectedTaskId: taskId,
      tasksError: null,
    });
  },
  createTask: async (input) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      const message = taskProjectError("create");
      set({
        tasksError: message,
      });
      throw new Error(message);
    }

    set({
      taskAction: "creating",
      tasksError: null,
    });

    try {
      const task = await createTaskCommand({
        projectId,
        title: input.title,
        descriptionMarkdown: input.descriptionMarkdown ?? null,
        priority: input.priority ?? null,
        labels: input.labels ?? null,
        subtasks: input.subtasks ?? null,
        reviewNotesMarkdown: input.reviewNotesMarkdown ?? null,
        assignee: input.assignee ?? null,
        workflowState: input.workflowState ?? null,
        assignedAgentMode: input.assignedAgentMode ?? null,
        blockedReason: input.blockedReason ?? null,
      });

      set((state) => ({
        tasksProjectId: projectId,
        tasksStatus: "ready",
        tasksError: null,
        tasks: upsertTask(state.tasks, task),
        selectedTaskId: task.id,
      }));

      return task;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Task creation failed.");

      set({
        tasksError: message,
      });

      throw new Error(message);
    } finally {
      set({
        taskAction: "idle",
      });
    }
  },
  updateTask: async (input) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      const message = taskProjectError("update");
      set({
        tasksError: message,
      });
      throw new Error(message);
    }

    set({
      taskAction: "updating",
      tasksError: null,
    });

    try {
      const task = await updateTaskCommand({
        projectId,
        taskId: input.taskId,
        title: input.title,
        descriptionMarkdown: input.descriptionMarkdown,
        priority: input.priority,
        labels: input.labels,
        subtasks: input.subtasks,
        reviewNotesMarkdown: input.reviewNotesMarkdown,
        assignee: input.assignee,
        workflowState: input.workflowState,
        lastRunState: input.lastRunState,
        lastSessionId: input.lastSessionId,
        assignedAgentMode: input.assignedAgentMode,
        markdownExportPath: input.markdownExportPath,
        blockedReason: input.blockedReason,
        completedAt: input.completedAt,
      });

      set((state) => ({
        tasksProjectId: projectId,
        tasksStatus: "ready",
        tasksError: null,
        tasks: upsertTask(state.tasks, task),
        selectedTaskId: task.id,
      }));

      return task;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Task update failed.");

      set({
        tasksError: message,
      });

      throw new Error(message);
    } finally {
      set({
        taskAction: "idle",
      });
    }
  },
  removeTask: async (taskId) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      const message = taskProjectError("delete");
      set({
        tasksError: message,
      });
      throw new Error(message);
    }

    if (!taskId.trim()) {
      const message = "Choose a task before deleting it.";
      set({
        tasksError: message,
      });
      throw new Error(message);
    }

    set({
      taskAction: "deleting",
      tasksError: null,
    });

    try {
      const deleted = await deleteTaskCommand({ projectId, taskId });

      if (!deleted) {
        throw new Error("The selected task could not be removed.");
      }

      set((state) => {
        const tasks = state.tasks.filter((task) => task.id !== taskId);

        return {
          tasksProjectId: projectId,
          tasksStatus: "ready",
          tasksError: null,
          tasks,
          selectedTaskId: resolveSelectedTaskId(state.selectedTaskId, tasks),
        };
      });
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Task deletion failed.");

      set({
        tasksError: message,
      });

      throw new Error(message);
    } finally {
      set({
        taskAction: "idle",
      });
    }
  },
  clearTasksError: () => {
    set({
      tasksError: null,
    });
  },
});
