import {
  useEffect,
  useState,
} from "react";
import {
  ArrowUpRight,
  LoaderCircle,
  Plus,
} from "lucide-react";

import { useDispatchStore } from "../../app/providers";
import {
  listAgentRegistryEntries,
  type AgentRegistryEntryRecord,
  type TaskPriority,
  type TaskSubtaskRecord,
  type TaskWorkflowState,
} from "../../shared/lib/tauri";
import { DispatchModal } from "../agents/DispatchModal";
import { KanbanBoard } from "./KanbanBoard";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

type TasksTabProps = {
  linkedTaskId?: string | null;
};

type AgentModeStatus = "idle" | "loading" | "ready" | "error";

type AgentModeOption = {
  value: string;
  label: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function buildAgentModeOptions(entries: AgentRegistryEntryRecord[]) {
  const options: AgentModeOption[] = [
    { value: "", label: "None" },
  ];

  for (const entry of entries) {
    const value = entry.selectionMode === "auto"
      ? "auto"
      : `profile:${entry.id}`;

    if (options.some((option) => option.value === value)) {
      continue;
    }

    options.push({
      value,
      label: entry.name,
    });
  }

  return options;
}

function resolveCompletedAt(
  currentCompletedAt: number | null,
  workflowState: TaskWorkflowState,
) {
  if (workflowState === "done") {
    return currentCompletedAt ?? Math.floor(Date.now() / 1000);
  }

  return null;
}

function resolveInitialDispatchProfileId(assignedAgentMode: string | null | undefined) {
  if (!assignedAgentMode) {
    return null;
  }

  if (assignedAgentMode === "auto") {
    return "auto";
  }

  if (assignedAgentMode.startsWith("profile:")) {
    const profileId = assignedAgentMode.slice("profile:".length).trim();
    return profileId || null;
  }

  return null;
}

export function TasksTab({ linkedTaskId = null }: TasksTabProps) {
  const projects = useDispatchStore((state) => state.projects);
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const tasksStatus = useDispatchStore((state) => state.tasksStatus);
  const taskAction = useDispatchStore((state) => state.taskAction);
  const tasksError = useDispatchStore((state) => state.tasksError);
  const tasks = useDispatchStore((state) => state.tasks);
  const selectedTaskId = useDispatchStore((state) => state.selectedTaskId);
  const initializeTasks = useDispatchStore((state) => state.initializeTasks);
  const refreshTasks = useDispatchStore((state) => state.refreshTasks);
  const selectTask = useDispatchStore((state) => state.selectTask);
  const createTask = useDispatchStore((state) => state.createTask);
  const updateTask = useDispatchStore((state) => state.updateTask);
  const removeTask = useDispatchStore((state) => state.removeTask);
  const clearTasksError = useDispatchStore((state) => state.clearTasksError);
  const workspaceProjectId = useDispatchStore((state) => state.workspaceProjectId);
  const terminalAction = useDispatchStore((state) => state.terminalAction);
  const openClawStatus = useDispatchStore((state) => state.openClawStatus);
  const initializeTerminalWorkspace = useDispatchStore((state) => state.initializeTerminalWorkspace);
  const dispatchAgent = useDispatchStore((state) => state.dispatchAgent);
  const dispatchViaOpenClaw = useDispatchStore((state) => state.dispatchViaOpenClaw);
  const clearTerminalError = useDispatchStore((state) => state.clearTerminalError);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [agentModeStatus, setAgentModeStatus] = useState<AgentModeStatus>("idle");
  const [agentModeOptions, setAgentModeOptions] = useState<AgentModeOption[]>([
    { value: "", label: "None" },
  ]);
  const [agentModeError, setAgentModeError] = useState<string | null>(null);
  const [dispatchTaskId, setDispatchTaskId] = useState<string | null>(null);

  useEffect(() => {
    void initializeTasks();
  }, [activeProjectId, initializeTasks]);

  useEffect(() => {
    void initializeTerminalWorkspace(activeProjectId);
  }, [activeProjectId, initializeTerminalWorkspace]);

  useEffect(() => {
    if (!activeProjectId) {
      setAgentModeStatus("idle");
      setAgentModeOptions([{ value: "", label: "None" }]);
      setAgentModeError(null);
      return;
    }

    let active = true;
    setAgentModeStatus("loading");
    setAgentModeError(null);

    void listAgentRegistryEntries()
      .then((entries) => {
        if (!active) {
          return;
        }

        setAgentModeOptions(buildAgentModeOptions(entries));
        setAgentModeStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setAgentModeOptions([{ value: "", label: "None" }]);
        setAgentModeStatus("error");
        setAgentModeError(getErrorMessage(error, "Agent profiles failed to load."));
      });

    return () => {
      active = false;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!linkedTaskId) {
      return;
    }

    if (tasks.some((task) => task.id === linkedTaskId)) {
      selectTask(linkedTaskId);
    }
  }, [linkedTaskId, selectTask, tasks]);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const isCreating = taskAction === "creating";
  const isUpdating = taskAction === "updating";
  const isDeleting = taskAction === "deleting";
  const isDispatching = terminalAction === "dispatching";
  const dispatchTask = tasks.find((task) => task.id === dispatchTaskId) ?? null;
  const inProgressCount = tasks.filter((task) => task.workflowState === "in_progress").length;
  const reviewCount = tasks.filter((task) => task.workflowState === "review").length;
  const blockedCount = tasks.filter((task) => task.workflowState === "blocked").length;
  const doneCount = tasks.filter((task) => task.workflowState === "done").length;

  const handleCreateTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      await createTask({
        title: newTaskTitle,
      });
      setNewTaskTitle("");
    } catch {
      return;
    }
  };

  const handleDeleteTask = async () => {
    if (!selectedTask) {
      return;
    }

    await removeTask(selectedTask.id);
  };

  const handleSaveTaskDetails = async (input: {
    taskId: string;
    title: string;
    descriptionMarkdown: string;
    priority: TaskPriority;
    labels: string[];
    subtasks: TaskSubtaskRecord[];
    reviewNotesMarkdown: string;
    assignee: string | null;
    assignedAgentMode: string | null;
    workflowState: TaskWorkflowState;
    blockedReason: string | null;
  }) => {
    if (!selectedTask) {
      return;
    }

    await updateTask({
      taskId: input.taskId,
      title: input.title,
      descriptionMarkdown: input.descriptionMarkdown,
      priority: input.priority,
      labels: input.labels,
      subtasks: input.subtasks,
      reviewNotesMarkdown: input.reviewNotesMarkdown,
      assignee: input.assignee,
      assignedAgentMode: input.assignedAgentMode,
      workflowState: input.workflowState,
      blockedReason: input.blockedReason,
      completedAt: resolveCompletedAt(selectedTask.completedAt, input.workflowState),
    });
  };

  const handleOpenDispatchModal = (taskId: string) => {
    selectTask(taskId);
    setDispatchTaskId(taskId);
  };

  if (!activeProjectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="dispatch-text-muted text-[0.78rem]">Select a project to manage tasks.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(255,255,255,0.04),transparent_24%),linear-gradient(180deg,rgba(8,10,15,0.8),rgba(9,11,16,0.96))]">
        <header className="border-b border-[var(--surface-border-soft)] bg-[rgba(9,11,17,0.86)] px-3 py-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[0.64rem] font-semibold uppercase tracking-[0.26em] text-[var(--text-subtle)]">
                  Tasks
                </span>
                <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 text-[0.64rem] font-medium text-[var(--text-muted)]">
                  {tasks.length} total
                </span>
              </div>
              <h1 className="mt-1 truncate text-[1.02rem] font-semibold tracking-tight text-[var(--text-primary)]">
                {activeProject?.name ?? "Task board"}
              </h1>
              <p className="mt-1 max-w-2xl text-[0.76rem] leading-5 text-[var(--text-muted)]">
                Plan work in columns, keep the active task in the side inspector, and dispatch directly from the board when something is ready to move.
              </p>
            </div>

            <div className="grid min-w-[16rem] grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "In progress", value: inProgressCount },
                { label: "Review", value: reviewCount },
                { label: "Blocked", value: blockedCount },
                { label: "Done", value: doneCount },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[1rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-2"
                >
                  <p className="text-[0.56rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-[0.8rem] font-semibold text-[var(--text-primary)]">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <form
            className="mt-3 grid gap-3 rounded-[1.05rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] lg:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)]"
            onSubmit={handleCreateTask}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                Quick Add
              </p>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <input
                  value={newTaskTitle}
                  onChange={(event) => {
                    setNewTaskTitle(event.target.value);
                    if (tasksError) {
                      clearTasksError();
                    }
                  }}
                  placeholder="New task..."
                  className="dispatch-input h-9 min-w-0 rounded-[0.85rem] px-3 text-[0.76rem]"
                />
                <button
                  type="submit"
                  disabled={isCreating}
                  className="dispatch-action-button inline-flex h-9 min-w-[5.5rem] shrink-0 items-center justify-center gap-1.5 rounded-[0.85rem] px-3 text-[0.76rem] font-medium disabled:opacity-60"
                >
                  {isCreating ? <LoaderCircle className="animate-spin" size={12} /> : <Plus size={13} />}
                  <span>Add</span>
                </button>
              </div>
            </div>

            <div className="min-w-0 rounded-[1rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.18)] px-3 py-2 text-left">
              <p className="text-[0.56rem] font-semibold uppercase tracking-[0.2em] text-[var(--text-subtle)]">
                Inspector target
              </p>
              <p className="mt-1 truncate text-[0.76rem] font-medium text-[var(--text-primary)]">
                {selectedTask ? selectedTask.title : "Nothing selected"}
              </p>
              <p className="mt-1 text-[0.66rem] leading-5 text-[var(--text-muted)]">
                {selectedTask
                  ? "The side drawer stays focused on this card while you edit."
                  : "Pick a card to open the editor and keep the task in view."}
              </p>
            </div>
          </form>
        </header>

        {tasksError ? (
          <div className="dispatch-alert mx-3 mt-3 rounded-[0.95rem] px-3 py-2 text-[0.72rem]">
            {tasksError}
          </div>
        ) : null}

        {tasksStatus === "loading" ? (
          <div className="flex flex-1 items-center justify-center">
            <LoaderCircle size={18} className="animate-spin dispatch-text-muted" />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 px-3 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
            <section className="flex min-h-[20rem] min-w-0 flex-col overflow-hidden rounded-[1.4rem] border border-[var(--surface-border-soft)] bg-[rgba(7,9,14,0.72)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--surface-border-soft)] px-4 py-3">
                <div>
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                    Board
                  </p>
                  <p className="mt-1 text-[0.76rem] text-[var(--text-muted)]">
                    Drag between stages. Dispatch from cards when work is ready to run.
                  </p>
                </div>
                <div className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[0.66rem] text-[var(--text-muted)]">
                  {tasks.length} cards
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                {tasks.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-4 py-8">
                    <div className="max-w-[28rem] rounded-[1.25rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-4 py-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-[var(--surface-border-soft)] bg-[rgba(59,130,246,0.08)]">
                        <Plus size={16} className="text-[var(--accent-blue-text)]" />
                      </div>
                      <p className="dispatch-text-secondary mt-3 text-[0.92rem] font-medium">
                        No tasks yet
                      </p>
                      <p className="dispatch-text-muted mt-2 text-[0.74rem] leading-relaxed">
                        Start with the quick-add composer above. The first card you create becomes the anchor for notes, subtasks, and review context in the inspector.
                      </p>

                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        {[
                          "Create a title",
                          "Select the card",
                          "Move it through the board",
                        ].map((step) => (
                          <div
                            key={step}
                            className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2 text-[0.68rem] font-medium text-[var(--text-muted)]"
                          >
                            {step}
                          </div>
                        ))}
                      </div>
                    </div>
                    <ArrowUpRight size={16} className="dispatch-text-subtle mt-4 -rotate-12" />
                  </div>
                ) : (
                  <KanbanBoard
                    tasks={tasks}
                    selectedTaskId={selectedTaskId}
                    linkedTaskId={linkedTaskId}
                    onSelectTask={selectTask}
                    onDispatchTask={handleOpenDispatchModal}
                    onMoveTask={async ({ taskId, workflowState }) => {
                      await updateTask({
                        taskId,
                        workflowState,
                        completedAt: workflowState === "done" ? Math.floor(Date.now() / 1000) : null,
                      });
                    }}
                  />
                )}
              </div>
            </section>

            <div className="min-h-[24rem] overflow-hidden rounded-[1.4rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,16,0.84)] shadow-[0_22px_60px_rgba(0,0,0,0.24)] xl:min-h-0">
              <TaskDetailDrawer
                task={selectedTask}
                isSaving={isUpdating}
                isDeleting={isDeleting}
                agentModeOptions={agentModeOptions}
                agentModeStatus={agentModeStatus}
                agentModeError={agentModeError}
                onSave={handleSaveTaskDetails}
                onDelete={handleDeleteTask}
              />
            </div>
          </div>
        )}
      </div>

      <DispatchModal
        open={Boolean(dispatchTaskId)}
        projectId={activeProjectId}
        projectName={activeProject?.name ?? null}
        openClawStatus={openClawStatus}
        initialProfileId={resolveInitialDispatchProfileId(dispatchTask?.assignedAgentMode)}
        isSubmitting={isDispatching}
        onClose={() => setDispatchTaskId(null)}
        onDispatch={async ({ profileId, prompt, route }) => {
          if (!activeProjectId || !dispatchTaskId) {
            return;
          }

          if (workspaceProjectId !== activeProjectId) {
            await initializeTerminalWorkspace(activeProjectId, { force: workspaceProjectId !== null });
          }

          clearTerminalError();
          if (route === "openclaw") {
            await dispatchViaOpenClaw({
              taskId: dispatchTaskId,
              prompt: prompt ?? "",
            });
          } else {
            await dispatchAgent({
              profileId,
              taskId: dispatchTaskId,
              prompt,
            });
          }
          await refreshTasks();
          setDispatchTaskId(null);
        }}
      />
    </>
  );
}
