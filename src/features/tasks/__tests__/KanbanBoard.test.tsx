// @vitest-environment jsdom

import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { TaskRecord } from "../../../shared/lib/tauri";
import { KanbanBoard } from "../KanbanBoard";

function buildTask(input: {
  id: string;
  title: string;
  workflowState: TaskRecord["workflowState"];
  priority?: TaskRecord["priority"];
  lastRunState?: TaskRecord["lastRunState"];
  updatedAt?: number;
}): TaskRecord {
  return {
    id: input.id,
    projectId: "project-alpha",
    title: input.title,
    descriptionMarkdown: "",
    priority: input.priority ?? "none",
    labels: [],
    subtasks: [],
    reviewNotesMarkdown: "",
    assignee: null,
    workflowState: input.workflowState,
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

function createDataTransfer() {
  const data = new Map<string, string>();

  return {
    effectAllowed: "move",
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    getData: (type: string) => data.get(type) ?? "",
  };
}

afterEach(() => {
  cleanup();
});

function getOrderedCardIds(column: HTMLElement) {
  return Array.from(column.querySelectorAll<HTMLElement>("[data-testid^='kanban-card-']"))
    .map((element) => element.getAttribute("data-testid"));
}

describe("KanbanBoard", () => {
  it("renders the five workflow columns and groups tasks by workflow state", () => {
    render(
      <KanbanBoard
        tasks={[
          buildTask({
            id: "task-1",
            title: "Draft task",
            workflowState: "draft",
            priority: "high",
            lastRunState: "running",
          }),
          buildTask({ id: "task-2", title: "Planning task", workflowState: "planning" }),
          buildTask({ id: "task-3", title: "Review task", workflowState: "review" }),
          buildTask({ id: "task-4", title: "Blocked task", workflowState: "blocked" }),
        ]}
        selectedTaskId={null}
        onSelectTask={() => {}}
        onMoveTask={() => {}}
      />,
    );

    expect(screen.getByTestId("kanban-column-draft")).toBeTruthy();
    expect(screen.getByTestId("kanban-column-planning")).toBeTruthy();
    expect(screen.getByTestId("kanban-column-in_progress")).toBeTruthy();
    expect(screen.getByTestId("kanban-column-review")).toBeTruthy();
    expect(screen.getByTestId("kanban-column-done")).toBeTruthy();

    expect(within(screen.getByTestId("kanban-column-draft")).getByText("Draft task")).toBeTruthy();
    expect(within(screen.getByTestId("kanban-column-draft")).getByText("High")).toBeTruthy();
    expect(within(screen.getByTestId("kanban-column-draft")).getAllByText("Running").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("kanban-column-planning")).getByText("Planning task")).toBeTruthy();
    expect(within(screen.getByTestId("kanban-column-review")).getByText("Review task")).toBeTruthy();
    expect(screen.queryByText("Blocked task")).toBeNull();
  });

  it("reorders tasks within the same column locally", async () => {
    render(
      <KanbanBoard
        tasks={[
          buildTask({ id: "task-a", title: "First draft", workflowState: "draft", updatedAt: 200 }),
          buildTask({ id: "task-b", title: "Second draft", workflowState: "draft", updatedAt: 100 }),
        ]}
        selectedTaskId={null}
        onSelectTask={() => {}}
        onMoveTask={() => {}}
      />,
    );

    const draftColumn = screen.getByTestId("kanban-column-draft");
    const firstCard = screen.getByTestId("kanban-card-task-a");
    const secondCard = screen.getByTestId("kanban-card-task-b");
    const dataTransfer = createDataTransfer();

    expect(getOrderedCardIds(draftColumn)[0]).toBe("kanban-card-task-a");

    fireEvent.dragStart(firstCard, { dataTransfer });
    fireEvent.dragOver(secondCard, { dataTransfer });
    fireEvent.drop(secondCard, { dataTransfer });
    fireEvent.dragEnd(firstCard, { dataTransfer });

    await waitFor(() => {
      expect(getOrderedCardIds(draftColumn)[0]).toBe("kanban-card-task-b");
    });
  });

  it("routes Send to Agent clicks through the provided callback", () => {
    const onDispatchTask = vi.fn();

    render(
      <KanbanBoard
        tasks={[
          buildTask({ id: "task-a", title: "Draft task", workflowState: "draft" }),
        ]}
        selectedTaskId={null}
        onSelectTask={() => {}}
        onDispatchTask={onDispatchTask}
        onMoveTask={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send to Agent" }));

    expect(onDispatchTask).toHaveBeenCalledWith("task-a");
  });

  it("moves a task across columns and persists the new workflow state", async () => {
    function Harness() {
      const [tasks, setTasks] = useState<TaskRecord[]>([
        buildTask({ id: "task-a", title: "Draft task", workflowState: "draft" }),
        buildTask({ id: "task-b", title: "Review task", workflowState: "review" }),
      ]);
      const [moveCallCount, setMoveCallCount] = useState(0);
      const moveTask = async ({ taskId, workflowState }: { taskId: string; workflowState: TaskRecord["workflowState"] }) => {
        setMoveCallCount((count) => count + 1);
        setTasks((currentTasks) => currentTasks.map((task) => (
          task.id === taskId
            ? {
              ...task,
              workflowState,
            }
            : task
        )));
      };

      return (
        <>
          <KanbanBoard
            tasks={tasks}
            selectedTaskId={null}
            onSelectTask={() => {}}
            onMoveTask={moveTask}
          />
          <div data-testid="move-call-count">{moveCallCount}</div>
        </>
      );
    }

    render(<Harness />);

    const draftCard = screen.getByTestId("kanban-card-task-a");
    const reviewColumn = screen.getByTestId("kanban-column-review");
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(draftCard, { dataTransfer });
    fireEvent.dragOver(reviewColumn, { dataTransfer });
    fireEvent.drop(reviewColumn, { dataTransfer });
    fireEvent.dragEnd(draftCard, { dataTransfer });

    await waitFor(() => {
      expect(within(reviewColumn).getByText("Draft task")).toBeTruthy();
    });
    expect(screen.getByTestId("move-call-count").textContent).toBe("1");
  });
});
