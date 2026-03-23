import { useEffect, useState } from "react";

import type {
  TaskRecord,
  TaskWorkflowState,
} from "../../shared/lib/tauri";
import { KanbanCard } from "./KanbanCard";
import { KanbanColumn } from "./KanbanColumn";

type BoardWorkflowState = Extract<
  TaskWorkflowState,
  "draft" | "planning" | "in_progress" | "review" | "done"
>;

const boardColumns: Array<{ id: BoardWorkflowState; label: string }> = [
  { id: "draft", label: "Draft" },
  { id: "planning", label: "Planning" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

type DragState = {
  taskId: string;
  workflowState: BoardWorkflowState;
};

type KanbanBoardProps = {
  tasks: TaskRecord[];
  selectedTaskId: string | null;
  linkedTaskId?: string | null;
  onSelectTask: (taskId: string) => void;
  onDispatchTask?: (taskId: string) => void;
  onMoveTask: (input: {
    taskId: string;
    workflowState: BoardWorkflowState;
  }) => Promise<void> | void;
};

function reconcileTaskOrder(previousTaskIds: string[], tasks: TaskRecord[]) {
  const taskIds = tasks.map((task) => task.id);
  const nextTaskIds = previousTaskIds.filter((taskId) => taskIds.includes(taskId));

  for (const taskId of taskIds) {
    if (!nextTaskIds.includes(taskId)) {
      nextTaskIds.push(taskId);
    }
  }

  return nextTaskIds;
}

function moveTaskBefore(orderedTaskIds: string[], taskId: string, beforeTaskId: string | null) {
  const nextTaskIds = orderedTaskIds.filter((candidate) => candidate !== taskId);

  if (!beforeTaskId) {
    nextTaskIds.push(taskId);
    return nextTaskIds;
  }

  const destinationIndex = nextTaskIds.indexOf(beforeTaskId);

  if (destinationIndex < 0) {
    nextTaskIds.push(taskId);
    return nextTaskIds;
  }

  nextTaskIds.splice(destinationIndex, 0, taskId);
  return nextTaskIds;
}

function isBoardWorkflowState(workflowState: TaskWorkflowState): workflowState is BoardWorkflowState {
  return boardColumns.some((column) => column.id === workflowState);
}

export function KanbanBoard({
  tasks,
  selectedTaskId,
  linkedTaskId = null,
  onSelectTask,
  onDispatchTask,
  onMoveTask,
}: KanbanBoardProps) {
  const boardTasks = tasks.filter((task) => isBoardWorkflowState(task.workflowState));
  const [orderedTaskIds, setOrderedTaskIds] = useState(() => boardTasks.map((task) => task.id));
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    setOrderedTaskIds((currentTaskIds) => reconcileTaskOrder(currentTaskIds, boardTasks));
  }, [tasks]);

  const orderedTasks = orderedTaskIds
    .map((taskId) => boardTasks.find((task) => task.id === taskId) ?? null)
    .filter((task): task is TaskRecord => Boolean(task));

  const handleDrop = (destinationWorkflowState: BoardWorkflowState, beforeTaskId: string | null) => {
    if (!dragState) {
      return;
    }

    const dragTaskId = dragState.taskId;
    const nextTaskIds = moveTaskBefore(orderedTaskIds, dragTaskId, beforeTaskId);
    setOrderedTaskIds(nextTaskIds);

    if (dragState.workflowState !== destinationWorkflowState) {
      void onMoveTask({
        taskId: dragTaskId,
        workflowState: destinationWorkflowState,
      });
    }

    setDragState(null);
  };

  return (
    <div className="grid h-full min-w-0 auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
      {boardColumns.map((column) => {
        const columnTasks = orderedTasks.filter((task) => task.workflowState === column.id);

        return (
          <KanbanColumn
            key={column.id}
            id={column.id}
            label={column.label}
            taskCount={columnTasks.length}
            onDropCard={() => handleDrop(column.id, null)}
          >
            {columnTasks.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                selected={task.id === selectedTaskId}
                linked={linkedTaskId === task.id}
                dragging={dragState?.taskId === task.id}
                onSelect={() => onSelectTask(task.id)}
                onDispatchTask={onDispatchTask ? () => onDispatchTask(task.id) : null}
                onDragStart={() => {
                  setDragState({
                    taskId: task.id,
                    workflowState: column.id,
                  });
                }}
                onDragEnd={() => {
                  setDragState(null);
                }}
                onDragOver={() => {
                  if (!dragState || dragState.taskId === task.id) {
                    return;
                  }

                  setOrderedTaskIds((currentTaskIds) => moveTaskBefore(currentTaskIds, dragState.taskId, task.id));
                }}
                onDrop={() => {
                  handleDrop(column.id, task.id);
                }}
              />
            ))}
          </KanbanColumn>
        );
      })}
    </div>
  );
}
