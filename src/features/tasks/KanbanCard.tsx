import {
  GripVertical,
  Rocket,
} from "lucide-react";

import type {
  TaskPriority,
  TaskRecord,
} from "../../shared/lib/tauri";

function getPriorityColor(priority: TaskPriority) {
  switch (priority) {
    case "urgent":
      return "bg-red-500";
    case "high":
      return "bg-orange-400";
    case "medium":
      return "bg-yellow-400";
    case "low":
      return "bg-blue-400";
    default:
      return "bg-[rgba(255,255,255,0.15)]";
  }
}

function getPriorityLabel(priority: TaskPriority) {
  switch (priority) {
    case "urgent":
      return "Urgent";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return "None";
  }
}

function getRunStateIndicator(lastRunState: string) {
  switch (lastRunState) {
    case "running":
      return { color: "bg-emerald-400", label: "Running" };
    case "succeeded":
      return { color: "bg-emerald-400", label: "Succeeded" };
    case "failed":
      return { color: "bg-red-400", label: "Failed" };
    case "canceled":
      return { color: "bg-amber-400", label: "Canceled" };
    default:
      return null;
  }
}

type KanbanCardProps = {
  task: TaskRecord;
  selected: boolean;
  linked: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDispatchTask?: (() => void) | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
};

export function KanbanCard({
  task,
  selected,
  linked,
  dragging,
  onSelect,
  onDispatchTask = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: KanbanCardProps) {
  const runState = getRunStateIndicator(task.lastRunState);
  const hasDescription = task.descriptionMarkdown.trim().length > 0;

  return (
    <article
      draggable
      data-testid={`kanban-card-${task.id}`}
      className={[
        "group relative flex w-full cursor-grab flex-col overflow-hidden rounded-[1rem] border transition-[border-color,background,box-shadow,opacity,transform] active:cursor-grabbing",
        selected
          ? "border-[var(--accent-blue-border)] bg-[linear-gradient(180deg,rgba(59,130,246,0.11),rgba(59,130,246,0.05))] shadow-[0_16px_34px_rgba(0,0,0,0.22)]"
          : "border-[var(--surface-border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] shadow-[0_10px_24px_rgba(0,0,0,0.16)] hover:-translate-y-px hover:border-[var(--accent-blue-border-faint)] hover:bg-[rgba(255,255,255,0.05)] hover:shadow-[0_18px_32px_rgba(0,0,0,0.22)]",
        linked ? "ring-1 ring-[rgba(59,130,246,0.22)]" : "",
        dragging ? "opacity-40" : "",
      ].join(" ")}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-2 px-3 py-3 text-left"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.18em] ${
                  task.priority === "urgent"
                    ? "bg-red-500/12 text-red-200"
                    : task.priority === "high"
                      ? "bg-orange-400/12 text-orange-100"
                      : task.priority === "medium"
                        ? "bg-yellow-400/12 text-yellow-100"
                        : task.priority === "low"
                          ? "bg-sky-400/12 text-sky-100"
                          : "bg-[rgba(255,255,255,0.06)] text-[var(--text-subtle)]"
                }`}
                title={getPriorityLabel(task.priority)}
                aria-label={`Priority: ${getPriorityLabel(task.priority)}`}
              >
                {getPriorityLabel(task.priority)}
              </span>
              {selected ? (
                <span className="rounded-full border border-[rgba(59,130,246,0.24)] bg-[rgba(59,130,246,0.12)] px-2 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.16em] text-[var(--accent-blue-text)]">
                  Selected
                </span>
              ) : null}
              {linked ? (
                <span className="rounded-full border border-[rgba(59,130,246,0.24)] bg-[rgba(59,130,246,0.12)] px-2 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.16em] text-[var(--accent-blue-text)]">
                  Linked
                </span>
              ) : null}
            </div>
            <p className="dispatch-text-primary mt-2 min-w-0 text-[0.8rem] font-semibold leading-5">
              {task.title}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <GripVertical size={12} className="dispatch-text-subtle opacity-0 transition group-hover:opacity-60" />
          </div>
        </div>

        {hasDescription ? (
          <p className="dispatch-text-secondary line-clamp-3 text-[0.7rem] leading-5">
            {task.descriptionMarkdown.trim()}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-[0.62rem]">
          {runState ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.18)] px-2 py-1">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${runState.color}`} />
              <span className="dispatch-text-muted">{runState.label}</span>
            </span>
          ) : null}
          {task.labels.length > 0 ? (
            task.labels.slice(0, 2).map((label) => (
              <span
                key={label}
                className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-[0.58rem] text-[var(--text-subtle)]"
              >
                {label}
              </span>
            ))
          ) : null}
        </div>
      </button>

      {onDispatchTask ? (
        <div className="border-t border-[var(--surface-border-faint)] bg-[rgba(0,0,0,0.12)] px-3 py-2.5">
          <button
            type="button"
            className="dispatch-action-button inline-flex h-8 w-full items-center justify-center gap-2 rounded-[0.8rem] px-3 text-[0.74rem] font-semibold"
            onClick={onDispatchTask}
          >
            <Rocket size={13} />
            <span>Send to Agent</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}
