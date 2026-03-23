import type { ReactNode } from "react";

type KanbanColumnProps = {
  id: string;
  label: string;
  taskCount: number;
  children: ReactNode;
  onDropCard: () => void;
};

export function KanbanColumn({
  id,
  label,
  taskCount,
  children,
  onDropCard,
}: KanbanColumnProps) {
  return (
    <section
      data-testid={`kanban-column-${id}`}
      className="flex min-h-[15rem] min-w-[17rem] flex-col overflow-hidden rounded-[1.15rem] border border-[var(--surface-border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropCard();
      }}
    >
      {/* ── Column header: acts as a section divider ── */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.12)] px-3 py-2.5">
        <div>
          <span className="dispatch-text-secondary text-[0.64rem] font-semibold uppercase tracking-[0.22em]">
            {label}
          </span>
          <p className="mt-1 text-[0.64rem] text-[var(--text-subtle)]">
            {taskCount === 0 ? "Drop a card here" : `${taskCount} active`}
          </p>
        </div>
        <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.04)] px-1.5 text-[0.58rem] font-semibold dispatch-text-muted tabular-nums">
          {taskCount}
        </span>
      </div>

      <div className="flex min-h-[7rem] flex-1 flex-col gap-2 overflow-y-auto px-2 py-2">
        {children}
      </div>
    </section>
  );
}
