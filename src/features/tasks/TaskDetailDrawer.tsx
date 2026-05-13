import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Check,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";

import {
  getSetting,
  setSetting,
} from "../../shared/lib/tauri";
import type {
  TaskPriority,
  TaskRecord,
  TaskSubtaskRecord,
  TaskWorkflowState,
} from "../../shared/lib/tauri";
import {
  formatAutomatedReviewResult,
  parseLatestAutomatedReviewSummary,
} from "./reviewSummary";

type AgentModeOption = {
  value: string;
  label: string;
};

type TaskDraft = {
  title: string;
  descriptionMarkdown: string;
  priority: TaskPriority;
  labelsText: string;
  subtasks: TaskSubtaskRecord[];
  reviewNotesMarkdown: string;
  assignee: string;
  assignedAgentMode: string;
  workflowState: TaskWorkflowState;
  blockedReason: string;
};

type TaskDrawerPanel = "overview" | "worklog" | "review";

type TaskDetailDrawerProps = {
  task: TaskRecord | null;
  isSaving: boolean;
  isDeleting: boolean;
  agentModeOptions: AgentModeOption[];
  agentModeStatus: "idle" | "loading" | "ready" | "error";
  agentModeError: string | null;
  onSave: (input: {
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
  }) => Promise<void> | void;
  onDelete: (taskId: string) => Promise<void> | void;
};

const workflowStates: TaskWorkflowState[] = [
  "draft",
  "planning",
  "in_progress",
  "review",
  "done",
  "blocked",
];

const priorityOptions: TaskPriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];

const AUTO_REVIEW_SETTING_KEY = "dispatch.review.auto_enabled";

type AutoReviewStatus = "idle" | "loading" | "saving" | "ready" | "error";

function formatWorkflowState(workflowState: TaskWorkflowState) {
  switch (workflowState) {
    case "in_progress":
      return "In Progress";
    default:
      return workflowState.charAt(0).toUpperCase() + workflowState.slice(1);
  }
}

function formatRunState(lastRunState: string) {
  return lastRunState.charAt(0).toUpperCase() + lastRunState.slice(1);
}

function formatPriority(priority: TaskPriority) {
  switch (priority) {
    case "none":
      return "No priority";
    default:
      return priority.charAt(0).toUpperCase() + priority.slice(1);
  }
}

function serializeLabels(labels: string[]) {
  return labels.join(", ");
}

function parseLabels(labelsText: string) {
  const labels: string[] = [];

  for (const candidate of labelsText.split(/[,\n]/)) {
    const normalized = candidate.trim();

    if (!normalized || labels.includes(normalized)) {
      continue;
    }

    labels.push(normalized);
  }

  return labels;
}

function buildDraft(task: TaskRecord): TaskDraft {
  return {
    title: task.title,
    descriptionMarkdown: task.descriptionMarkdown,
    priority: task.priority,
    labelsText: serializeLabels(task.labels),
    subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
    reviewNotesMarkdown: task.reviewNotesMarkdown,
    assignee: task.assignee ?? "",
    assignedAgentMode: task.assignedAgentMode ?? "",
    workflowState: task.workflowState,
    blockedReason: task.blockedReason ?? "",
  };
}

function resolveInitialPanel(task: TaskRecord | null): TaskDrawerPanel {
  if (!task) {
    return "overview";
  }

  const reviewSummary = parseLatestAutomatedReviewSummary(task.reviewNotesMarkdown ?? "");

  if (reviewSummary || task.workflowState === "review" || task.workflowState === "blocked") {
    return "review";
  }

  return "overview";
}

function nextSubtaskId(taskId: string, subtasks: TaskSubtaskRecord[]) {
  return `${taskId}-subtask-${subtasks.length + 1}-${Date.now()}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

/* ── Styled checkbox for dark mode ── */
function SubtaskCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={[
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition",
        checked
          ? "border-[var(--accent-blue-border)] bg-[var(--accent-blue-soft)]"
          : "border-[var(--surface-border)] bg-[var(--surface-control)] hover:border-[var(--accent-blue-border-faint)]",
      ].join(" ")}
      onClick={() => onChange(!checked)}
    >
      {checked ? <Check size={12} className="text-[var(--accent-blue-text)]" /> : null}
    </button>
  );
}

/* ── Section header helper ── */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="dispatch-text-muted text-[0.65rem] font-semibold uppercase tracking-wider">
      {children}
    </p>
  );
}

function InspectorCard({
  title,
  description,
  children,
  tone = "default",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "default" | "accent" | "warning";
}) {
  const toneClassName = tone === "accent"
    ? "border-[rgba(96,165,250,0.18)] bg-[linear-gradient(180deg,rgba(59,130,246,0.08),rgba(255,255,255,0.02))]"
    : tone === "warning"
      ? "border-[rgba(251,191,36,0.18)] bg-[linear-gradient(180deg,rgba(251,191,36,0.08),rgba(255,255,255,0.02))]"
      : "border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.025)]";

  return (
    <section className={`rounded-[1.05rem] border px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${toneClassName}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionHeader>{title}</SectionHeader>
          {description ? (
            <p className="dispatch-text-secondary mt-1 text-[0.72rem] leading-5">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function TaskDetailDrawer({
  task,
  isSaving,
  isDeleting,
  agentModeOptions,
  agentModeStatus,
  agentModeError,
  onSave,
  onDelete,
}: TaskDetailDrawerProps) {
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoReviewEnabled, setAutoReviewEnabled] = useState<boolean | null>(null);
  const [autoReviewStatus, setAutoReviewStatus] = useState<AutoReviewStatus>("loading");
  const [autoReviewError, setAutoReviewError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<TaskDrawerPanel>("overview");

  useEffect(() => {
    let active = true;

    setAutoReviewStatus("loading");
    setAutoReviewError(null);

    void getSetting<boolean>({ key: AUTO_REVIEW_SETTING_KEY })
      .then((setting) => {
        if (!active) {
          return;
        }

        setAutoReviewEnabled(setting?.value === true);
        setAutoReviewStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setAutoReviewEnabled(false);
        setAutoReviewStatus("error");
        setAutoReviewError(getErrorMessage(error, "Automated review preference failed to load."));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!task) {
      setDraft(null);
      setActionError(null);
      setActivePanel("overview");
      return;
    }

    setDraft(buildDraft(task));
    setActionError(null);
    setActivePanel(resolveInitialPanel(task));
  }, [task]);

  const resolvedAgentModeOptions = useMemo(() => {
    if (!draft?.assignedAgentMode) {
      return agentModeOptions;
    }

    if (agentModeOptions.some((option) => option.value === draft.assignedAgentMode)) {
      return agentModeOptions;
    }

    return [
      ...agentModeOptions,
      {
        value: draft.assignedAgentMode,
        label: draft.assignedAgentMode,
      },
    ];
  }, [agentModeOptions, draft?.assignedAgentMode]);

  const pristineDraft = useMemo(() => {
    if (!task) {
      return null;
    }

    return buildDraft(task);
  }, [task]);

  const isDirty = draft && pristineDraft
    ? JSON.stringify(draft) !== JSON.stringify(pristineDraft)
    : false;
  const reviewSummary = parseLatestAutomatedReviewSummary(draft?.reviewNotesMarkdown ?? "");
  const labelCount = draft ? parseLabels(draft.labelsText).length : 0;
  const subtaskCount = draft?.subtasks.length ?? 0;
  const isWorklogPanel = activePanel === "worklog";

  if (!task || !draft) {
    return (
      <section className="flex h-full flex-col items-center justify-center bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.07),transparent_30%),linear-gradient(180deg,rgba(8,10,15,0.48),rgba(8,10,15,0.14))] px-5 py-6 text-center">
        <div className="max-w-[22rem] rounded-[1.2rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.22em]">
            Task inspector
          </p>
          <p className="mt-2 text-[0.92rem] font-semibold text-[var(--text-primary)]">
            No task selected
          </p>
          <p className="dispatch-text-subtle mt-2 text-[0.72rem] leading-6">
            Select a task from the board to edit its title, labels, subtasks, and review notes in one place.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              "Use Quick Add to create work",
              "Drag cards between stages",
              "Keep review context attached",
              "Save changes from the footer",
            ].map((hint) => (
              <div
                key={hint}
                className="rounded-[0.85rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2 text-[0.66rem] font-medium leading-5 text-[var(--text-muted)]"
              >
                {hint}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const inspectorStats = [
    {
      label: "Last run",
      value: formatRunState(task.lastRunState),
    },
    {
      label: "Linked session",
      value: task.lastSessionId ?? "None",
      truncate: true,
    },
    {
      label: "Workflow",
      value: formatWorkflowState(draft.workflowState),
    },
    {
      label: "Dirty state",
      value: isDirty ? "Unsaved edits" : "Saved",
    },
  ];

  const handleCancel = () => {
    setDraft(buildDraft(task));
    setActionError(null);
  };

  const handleAutoReviewToggle = async (nextValue: boolean) => {
    const previousValue = autoReviewEnabled === true;

    setAutoReviewEnabled(nextValue);
    setAutoReviewStatus("saving");
    setAutoReviewError(null);

    try {
      await setSetting({
        key: AUTO_REVIEW_SETTING_KEY,
        value: nextValue,
      });
      setAutoReviewStatus("ready");
    } catch (error: unknown) {
      setAutoReviewEnabled(previousValue);
      setAutoReviewStatus("error");
      setAutoReviewError(getErrorMessage(error, "Automated review preference failed to save."));
    }
  };

  const handleSave = async () => {
    const labels = parseLabels(draft.labelsText);
    const normalizedSubtasks = draft.subtasks.map((subtask) => ({
      ...subtask,
      text: subtask.text.trim(),
    }));

    if (!draft.title.trim()) {
      setActionError("Task title cannot be blank.");
      return;
    }

    if (normalizedSubtasks.some((subtask) => !subtask.text)) {
      setActionError("Subtasks cannot be blank.");
      return;
    }

    setActionError(null);

    try {
      await onSave({
        taskId: task.id,
        title: draft.title.trim(),
        descriptionMarkdown: draft.descriptionMarkdown,
        priority: draft.priority,
        labels,
        subtasks: normalizedSubtasks,
        reviewNotesMarkdown: draft.reviewNotesMarkdown,
        assignee: draft.assignee.trim() || null,
        assignedAgentMode: draft.assignedAgentMode || null,
        workflowState: draft.workflowState,
        blockedReason: draft.workflowState === "blocked"
          ? draft.blockedReason.trim() || null
          : null,
      });
    } catch (error: unknown) {
      setActionError(getErrorMessage(error, "Task update failed."));
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-2.5">
          <section className={`rounded-[1.1rem] border border-[rgba(96,165,250,0.18)] bg-[linear-gradient(180deg,rgba(59,130,246,0.1),rgba(255,255,255,0.02))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isWorklogPanel ? "px-3 py-2.5" : "px-3 py-3"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="dispatch-text-muted text-[0.6rem] font-semibold uppercase tracking-[0.22em]">
                  Task inspector
                </p>
                <h3 className="dispatch-heading mt-1 text-[0.96rem] font-semibold leading-6">
                  {draft.title.trim() || task.title}
                </h3>
                <p className="dispatch-text-secondary mt-1 text-[0.7rem] leading-5">
                  {isWorklogPanel
                    ? "Keep the brief and checklist in view while you edit."
                    : "Keep routing, scope, and review context visible without leaving the board."}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5 text-[0.6rem]">
                <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-[var(--text-muted)]">
                  {formatPriority(draft.priority)}
                </span>
                <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-[var(--text-muted)]">
                  {formatRunState(task.lastRunState)}
                </span>
              </div>
            </div>

            {isWorklogPanel ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {inspectorStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.16)] px-2.5 py-1.5"
                  >
                    <span className="dispatch-text-subtle text-[0.54rem] font-semibold uppercase tracking-[0.18em]">
                      {stat.label}
                    </span>
                    <span className={`dispatch-text-primary text-[0.68rem] font-medium ${stat.truncate ? "inline-block max-w-[12rem] truncate align-bottom" : ""}`}>
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {inspectorStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.16)] px-3 py-2"
                  >
                    <SectionHeader>{stat.label}</SectionHeader>
                    <p className={`dispatch-text-primary mt-1 text-xs font-medium ${stat.truncate ? "truncate" : ""}`}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={`rounded-[1.05rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.025)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${isWorklogPanel ? "px-3 py-2.5" : "px-3 py-3"}`}>
            <div className={`flex flex-wrap gap-2 ${isWorklogPanel ? "items-center justify-between" : "items-center"}`}>
              {[
                {
                  id: "overview" as const,
                  label: "Overview",
                  note: "Routing, ownership, and task metadata.",
                },
                {
                  id: "worklog" as const,
                  label: "Worklog",
                  note: "Description and checklist details.",
                },
                {
                  id: "review" as const,
                  label: "Review",
                  note: "Handoff notes and automation controls.",
                },
              ].map((panel) => {
                const isActive = activePanel === panel.id;

                return (
                  <button
                    key={panel.id}
                    type="button"
                    className="rounded-full border px-3 py-1.5 text-[0.72rem] font-medium transition"
                    data-active={isActive}
                    onClick={() => setActivePanel(panel.id)}
                    style={{
                      borderColor: isActive
                        ? "color-mix(in srgb, var(--accent-blue) 42%, var(--surface-border-soft))"
                        : "var(--surface-border-soft)",
                      background: isActive
                        ? "rgba(59,130,246,0.12)"
                        : "rgba(255,255,255,0.03)",
                      color: isActive ? "var(--accent-blue-text)" : "var(--text-secondary)",
                    }}
                  >
                    {panel.label}
                  </button>
                );
              })}

              {isWorklogPanel ? (
                <p className="dispatch-text-muted text-[0.68rem] leading-5 sm:text-right">
                  Description and checklist stay in view with less chrome above them.
                </p>
              ) : null}
            </div>
            {isWorklogPanel ? null : (
              <p className="dispatch-text-muted mt-2 text-[0.68rem] leading-5">
                {activePanel === "overview"
                  ? "Routing, ownership, and saved task metadata stay together."
                  : "Review state, notes, and automation controls stay in one place."}
              </p>
            )}
          </section>

          {activePanel === "overview" ? (
            <>
              <InspectorCard
                title="Task snapshot"
                description="A compact readout of routing and task health while you edit."
                tone="accent"
              >
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2">
                    <SectionHeader>Assignee</SectionHeader>
                    <p className="dispatch-text-primary mt-1 truncate text-xs font-medium">
                      {draft.assignee.trim() || "Unassigned"}
                    </p>
                  </div>
                  <div className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2">
                    <SectionHeader>Labels</SectionHeader>
                    <p className="dispatch-text-primary mt-1 text-xs font-medium">
                      {labelCount > 0 ? `${labelCount} labels` : "No labels"}
                    </p>
                  </div>
                  <div className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2">
                    <SectionHeader>Subtasks</SectionHeader>
                    <p className="dispatch-text-primary mt-1 text-xs font-medium">
                      {subtaskCount > 0 ? `${subtaskCount} items` : "No subtasks"}
                    </p>
                  </div>
                  <div className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2">
                    <SectionHeader>Workflow</SectionHeader>
                    <p className="dispatch-text-primary mt-1 text-xs font-medium">
                      {formatWorkflowState(draft.workflowState)}
                    </p>
                  </div>
                  <div className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2">
                    <SectionHeader>Agent mode</SectionHeader>
                    <p className="dispatch-text-primary mt-1 truncate text-xs font-medium">
                      {draft.assignedAgentMode || "None"}
                    </p>
                  </div>
                  <div className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2">
                    <SectionHeader>Linked session</SectionHeader>
                    <p className="dispatch-text-primary mt-1 truncate text-xs font-medium">
                      {task.lastSessionId ?? "None"}
                    </p>
                  </div>
                </div>
              </InspectorCard>

              <InspectorCard
                title="Core fields"
                description="Title, workflow state, ownership, and routing stay grouped together."
                tone="accent"
              >
                <div className="grid gap-3">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                    <label className="block">
                      <SectionHeader>Title</SectionHeader>
                      <input
                        value={draft.title}
                        onChange={(event) => {
                          setDraft((currentDraft) => currentDraft ? {
                            ...currentDraft,
                            title: event.target.value,
                          } : currentDraft);
                        }}
                        className="dispatch-input mt-1 h-9 w-full rounded-[0.85rem] px-3 text-xs"
                        aria-label="Title"
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <SectionHeader>Workflow state</SectionHeader>
                        <select
                          value={draft.workflowState}
                          onChange={(event) => {
                            setDraft((currentDraft) => currentDraft ? {
                              ...currentDraft,
                              workflowState: event.target.value as TaskWorkflowState,
                            } : currentDraft);
                          }}
                          className="dispatch-input mt-1 h-9 w-full appearance-none rounded-[0.85rem] px-3 text-xs"
                          aria-label="Workflow state"
                        >
                          {workflowStates.map((workflowState) => (
                            <option key={workflowState} value={workflowState}>
                              {formatWorkflowState(workflowState)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <SectionHeader>Priority</SectionHeader>
                        <select
                          value={draft.priority}
                          onChange={(event) => {
                            setDraft((currentDraft) => currentDraft ? {
                              ...currentDraft,
                              priority: event.target.value as TaskPriority,
                            } : currentDraft);
                          }}
                          className="dispatch-input mt-1 h-9 w-full appearance-none rounded-[0.85rem] px-3 text-xs"
                          aria-label="Priority"
                        >
                          {priorityOptions.map((priority) => (
                            <option key={priority} value={priority}>
                              {formatPriority(priority)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <SectionHeader>Assignee</SectionHeader>
                      <input
                        value={draft.assignee}
                        onChange={(event) => {
                          setDraft((currentDraft) => currentDraft ? {
                            ...currentDraft,
                            assignee: event.target.value,
                          } : currentDraft);
                        }}
                        className="dispatch-input mt-1 h-9 w-full rounded-[0.85rem] px-3 text-xs"
                        placeholder="Human owner or reviewer"
                        aria-label="Assignee"
                      />
                    </label>

                    <label className="block">
                      <SectionHeader>Agent mode</SectionHeader>
                      <select
                        value={draft.assignedAgentMode}
                        onChange={(event) => {
                          setDraft((currentDraft) => currentDraft ? {
                            ...currentDraft,
                            assignedAgentMode: event.target.value,
                          } : currentDraft);
                        }}
                        className="dispatch-input mt-1 h-9 w-full appearance-none rounded-[0.85rem] px-3 text-xs"
                        aria-label="Agent mode"
                      >
                        {resolvedAgentModeOptions.map((option) => (
                          <option key={option.value || "none"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {agentModeStatus === "loading" ? (
                        <p className="dispatch-text-muted mt-1 text-[0.65rem]">
                          Loading agent profiles.
                        </p>
                      ) : null}
                      {agentModeError ? (
                        <p className="dispatch-text-muted mt-1 text-[0.65rem]">
                          {agentModeError}
                        </p>
                      ) : null}
                    </label>
                  </div>

                  <label className="block">
                    <SectionHeader>Labels</SectionHeader>
                    <input
                      value={draft.labelsText}
                      onChange={(event) => {
                        setDraft((currentDraft) => currentDraft ? {
                          ...currentDraft,
                          labelsText: event.target.value,
                        } : currentDraft);
                      }}
                      className="dispatch-input mt-1 h-9 w-full rounded-[0.85rem] px-3 text-xs"
                      placeholder="backend, review, release"
                    />
                    <p className="dispatch-text-muted mt-1 text-[0.65rem]">
                      Separate labels with commas.
                    </p>
                  </label>

                  {draft.workflowState === "blocked" ? (
                    <label className="block">
                      <SectionHeader>Blocked reason</SectionHeader>
                      <textarea
                        value={draft.blockedReason}
                        onChange={(event) => {
                          setDraft((currentDraft) => currentDraft ? {
                            ...currentDraft,
                            blockedReason: event.target.value,
                          } : currentDraft);
                        }}
                        rows={2}
                        className="dispatch-input mt-1 w-full rounded-[0.85rem] px-3 py-2 text-xs leading-5"
                        placeholder="Capture the blocker for the board."
                      />
                    </label>
                  ) : null}
                </div>
              </InspectorCard>
            </>
          ) : null}

          {activePanel === "worklog" ? (
            <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)]">
              <InspectorCard
                title="Task brief"
                description="Keep the problem statement or implementation notes close to the board."
              >
                <label className="block">
                  <SectionHeader>Description</SectionHeader>
                  <textarea
                    value={draft.descriptionMarkdown}
                    onChange={(event) => {
                      setDraft((currentDraft) => currentDraft ? {
                        ...currentDraft,
                        descriptionMarkdown: event.target.value,
                      } : currentDraft);
                    }}
                    rows={10}
                    className="dispatch-input mt-1 min-h-[16rem] w-full resize-y rounded-[0.85rem] px-3 py-2 text-xs leading-5"
                    placeholder="Markdown description for the task."
                    aria-label="Description"
                  />
                </label>
              </InspectorCard>

              <InspectorCard
                title="Checklist"
                description="Break the task into discrete items without leaving the editor."
              >
                <div className="rounded-[0.95rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <SectionHeader>Subtasks</SectionHeader>
                      <p className="dispatch-text-muted mt-1 text-[0.65rem]">
                        Break the task into checklist items.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="dispatch-icon-button inline-flex h-8 items-center justify-center gap-1.5 rounded-[0.8rem] px-2.5 text-xs"
                      onClick={() => {
                        setDraft((currentDraft) => currentDraft ? {
                          ...currentDraft,
                          subtasks: [
                            ...currentDraft.subtasks,
                            {
                              id: nextSubtaskId(task.id, currentDraft.subtasks),
                              text: "",
                              completed: false,
                            },
                          ],
                        } : currentDraft);
                      }}
                    >
                      <Plus size={12} />
                      <span>Add</span>
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {draft.subtasks.length === 0 ? (
                      <p className="dispatch-text-subtle text-xs">
                        No subtasks yet. Press Add to create one.
                      </p>
                    ) : draft.subtasks.map((subtask, index) => (
                      <div
                        key={subtask.id}
                        className="flex items-center gap-2 rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.025)] px-2 py-2"
                      >
                        <SubtaskCheckbox
                          checked={subtask.completed}
                          onChange={(checked) => {
                            setDraft((currentDraft) => currentDraft ? {
                              ...currentDraft,
                              subtasks: currentDraft.subtasks.map((candidate) => candidate.id === subtask.id ? {
                                ...candidate,
                                completed: checked,
                              } : candidate),
                            } : currentDraft);
                          }}
                        />
                        <input
                          value={subtask.text}
                          onChange={(event) => {
                            setDraft((currentDraft) => currentDraft ? {
                              ...currentDraft,
                              subtasks: currentDraft.subtasks.map((candidate) => candidate.id === subtask.id ? {
                                ...candidate,
                                text: event.target.value,
                              } : candidate),
                            } : currentDraft);
                          }}
                          className="dispatch-input min-w-0 flex-1 rounded-[0.8rem] px-3 py-1.5 text-xs"
                          placeholder={`Subtask ${index + 1}`}
                        />
                        <button
                          type="button"
                          className="dispatch-icon-button flex h-7 w-7 items-center justify-center rounded-[0.8rem]"
                          aria-label={`Remove subtask ${index + 1}`}
                          onClick={() => {
                            setDraft((currentDraft) => currentDraft ? {
                              ...currentDraft,
                              subtasks: currentDraft.subtasks.filter((candidate) => candidate.id !== subtask.id),
                            } : currentDraft);
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </InspectorCard>
            </div>
          ) : null}

          {activePanel === "review" ? (
            <>
              <InspectorCard
                title="Review handoff"
                description="Latest review outcome and operational context for this task."
                tone={reviewSummary?.result === "FAIL" || Boolean(draft.blockedReason) ? "warning" : "default"}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  {reviewSummary ? (
                    <span className={`rounded-full px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] ${
                      reviewSummary.result === "PASS"
                        ? "border border-[rgba(94,197,151,0.22)] bg-[rgba(94,197,151,0.12)] text-[rgba(201,246,226,0.96)]"
                        : "border border-[rgba(255,193,90,0.22)] bg-[rgba(255,193,90,0.12)] text-[rgba(255,233,187,0.96)]"
                    }`}
                    >
                      {formatAutomatedReviewResult(reviewSummary.result)}
                    </span>
                  ) : (
                    <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Review queue
                    </span>
                  )}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2">
                    <SectionHeader>Linked session</SectionHeader>
                    <p className="dispatch-text-primary mt-1 truncate text-xs font-medium">
                      {task.lastSessionId ?? "None"}
                    </p>
                  </div>
                  {draft.blockedReason ? (
                    <div className="rounded-[0.9rem] border border-[rgba(255,193,90,0.18)] bg-[rgba(255,193,90,0.08)] px-3 py-2">
                      <SectionHeader>Blocked</SectionHeader>
                      <p className="dispatch-text-primary mt-1 text-xs leading-5">
                        {draft.blockedReason}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2">
                      <SectionHeader>Review state</SectionHeader>
                      <p className="dispatch-text-primary mt-1 text-xs font-medium">
                        {reviewSummary ? "Review complete" : "Waiting on notes"}
                      </p>
                    </div>
                  )}
                </div>

                {reviewSummary ? (
                  <div className="mt-3 rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2.5">
                    <SectionHeader>Review feedback</SectionHeader>
                    <p className="dispatch-text-primary mt-1 whitespace-pre-wrap text-xs leading-5">
                      {reviewSummary.feedback}
                    </p>
                  </div>
                ) : draft.reviewNotesMarkdown.trim() ? (
                  <div className="mt-3 rounded-[0.9rem] border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.14)] px-3 py-2.5">
                    <SectionHeader>Review notes</SectionHeader>
                    <p className="dispatch-text-primary mt-1 whitespace-pre-wrap text-xs leading-5">
                      {draft.reviewNotesMarkdown.trim()}
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 rounded-[0.9rem] border border-dashed border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5">
                    <p className="dispatch-text-muted text-xs leading-5">
                      No review notes yet. Capture reviewer context below when the task is ready.
                    </p>
                  </div>
                )}
              </InspectorCard>

              <InspectorCard
                title="Review controls"
                description="Capture reviewer context and decide whether review should run automatically."
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <SectionHeader>Automation</SectionHeader>
                    <p className="dispatch-text-secondary mt-1 text-[0.72rem] leading-5">
                      Toggle automatic review routing for task updates.
                    </p>
                  </div>

                  {autoReviewEnabled === null && autoReviewStatus === "loading" ? (
                    <div className="dispatch-text-muted inline-flex items-center gap-1.5 text-xs">
                      <LoaderCircle className="animate-spin" size={12} />
                      <span>Loading</span>
                    </div>
                  ) : (
                    <label
                      className={[
                        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition",
                        autoReviewEnabled === true
                          ? "border-[var(--accent-blue-border)] bg-[var(--accent-blue-soft)]"
                          : "border-[var(--surface-border)] bg-[var(--surface-control)]",
                        autoReviewStatus === "saving" ? "opacity-60" : "",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label="Automated review"
                        checked={autoReviewEnabled === true}
                        disabled={autoReviewStatus === "saving"}
                        className="sr-only"
                        onChange={() => {
                          void handleAutoReviewToggle(!(autoReviewEnabled === true));
                        }}
                      />
                      <span
                        className={[
                          "inline-block h-3.5 w-3.5 rounded-full bg-[var(--text-primary)] transition-transform",
                          autoReviewEnabled === true ? "translate-x-[18px]" : "translate-x-[3px]",
                        ].join(" ")}
                      />
                    </label>
                  )}
                </div>

                <label className="block">
                  <SectionHeader>Review notes</SectionHeader>
                  <textarea
                    value={draft.reviewNotesMarkdown}
                    onChange={(event) => {
                      setDraft((currentDraft) => currentDraft ? {
                        ...currentDraft,
                        reviewNotesMarkdown: event.target.value,
                      } : currentDraft);
                    }}
                    rows={5}
                    className="dispatch-input mt-1 w-full rounded-[0.85rem] px-3 py-2 text-xs leading-5"
                    placeholder="Capture review notes, QA checks, or follow-ups."
                    aria-label="Review notes"
                  />
                </label>

                {autoReviewStatus === "loading" || autoReviewStatus === "saving" ? (
                  <p className="dispatch-text-muted mt-2 text-[0.65rem]">
                    {autoReviewStatus === "loading"
                      ? "Loading automated review preference."
                      : "Saving automated review preference."}
                  </p>
                ) : null}

                {autoReviewError ? (
                  <p className="dispatch-text-muted mt-2 text-[0.65rem]">
                    {autoReviewError}
                  </p>
                ) : null}
              </InspectorCard>
            </>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--surface-border-soft)] bg-[linear-gradient(180deg,rgba(10,13,19,0.98),rgba(9,11,16,1))] px-3 py-3">
        {actionError ? (
          <div className="dispatch-alert mb-3 rounded-[0.85rem] px-3 py-2 text-xs">
            {actionError}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={isDeleting}
            className="dispatch-danger-button inline-flex h-8 items-center justify-center gap-1.5 rounded-[0.8rem] px-3 text-xs font-medium disabled:opacity-60"
            onClick={() => {
              void onDelete(task.id);
            }}
          >
            {isDeleting ? <LoaderCircle className="animate-spin" size={12} /> : <Trash2 size={12} />}
            <span>{isDeleting ? "Deleting" : "Delete"}</span>
          </button>

          <div className="flex min-w-0 items-center gap-2">
            <p className="dispatch-text-muted hidden whitespace-nowrap text-[0.65rem] 2xl:block">
              {isDirty ? "Unsaved edits" : "All changes saved"}
            </p>
            <button
              type="button"
              disabled={!isDirty || isSaving}
              className="dispatch-icon-button inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[0.8rem] px-3 text-xs font-medium disabled:opacity-60"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!isDirty || isSaving}
              className="dispatch-action-button inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[0.8rem] px-3 text-xs font-medium disabled:opacity-60"
              onClick={() => {
                void handleSave();
              }}
            >
              {isSaving ? <LoaderCircle className="animate-spin" size={12} /> : null}
              <span>{isSaving ? "Saving" : "Save changes"}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
