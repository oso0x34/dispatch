// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { TaskRecord } from "../../../shared/lib/tauri";
import { TaskDetailDrawer } from "../TaskDetailDrawer";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    projectId: "project-alpha",
    title: "Ship task drawer",
    descriptionMarkdown: "Initial markdown body",
    priority: "medium",
    labels: ["backend", "release"],
    subtasks: [
      {
        id: "subtask-1",
        text: "Write the drawer",
        completed: false,
      },
    ],
    reviewNotesMarkdown: "Pending review",
    assignee: "Avery",
    workflowState: "planning",
    lastRunState: "running",
    lastSessionId: "session-7",
    assignedAgentMode: "auto",
    markdownExportPath: null,
    blockedReason: null,
    createdAt: 100,
    updatedAt: 100,
    completedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("TaskDetailDrawer", () => {
  it("shows an empty selection state when no task is selected", async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "get_setting":
          return {
            key: "dispatch.review.auto_enabled",
            value: false,
            updatedAt: 100,
          };
        case "set_setting":
          return {
            key: String(args?.key ?? ""),
            value: args?.value ?? false,
            updatedAt: 101,
          };
        default:
          throw new Error(`Unexpected Tauri invoke: ${command}`);
      }
    });

    render(
      <TaskDetailDrawer
        task={null}
        isSaving={false}
        isDeleting={false}
        agentModeOptions={[
          { value: "", label: "None" },
        ]}
        agentModeStatus="idle"
        agentModeError={null}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getAllByText("No task selected").length).toBeGreaterThan(0);
    expect(screen.getByText("Task inspector")).toBeTruthy();
    expect(screen.getByText("Use Quick Add to create work")).toBeTruthy();
  });

  it("saves edited task metadata through the provided callback", async () => {
    const onSave = vi.fn(async () => {});
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "get_setting":
          return {
            key: "dispatch.review.auto_enabled",
            value: false,
            updatedAt: 100,
          };
        case "set_setting":
          return {
            key: String(args?.key ?? ""),
            value: args?.value ?? false,
            updatedAt: 101,
          };
        default:
          throw new Error(`Unexpected Tauri invoke: ${command}`);
      }
    });

    render(
      <TaskDetailDrawer
        task={buildTask()}
        isSaving={false}
        isDeleting={false}
        agentModeOptions={[
          { value: "", label: "None" },
          { value: "auto", label: "Auto" },
          { value: "profile:codex", label: "Codex" },
        ]}
        agentModeStatus="ready"
        agentModeError={null}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Ship task drawer v2" },
    });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "urgent" },
    });
    fireEvent.change(screen.getByPlaceholderText("backend, review, release"), {
      target: { value: "backend, docs, backend" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Worklog" }));

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Updated markdown body" },
    });
    fireEvent.change(screen.getByPlaceholderText("Subtask 1"), {
      target: { value: "Write the drawer carefully" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    fireEvent.change(screen.getByLabelText("Assignee"), {
      target: { value: "Jordan" },
    });
    fireEvent.change(screen.getByLabelText("Agent mode"), {
      target: { value: "profile:codex" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    fireEvent.change(screen.getByLabelText("Review notes"), {
      target: { value: "Ready for QA" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        taskId: "task-1",
        title: "Ship task drawer v2",
        descriptionMarkdown: "Updated markdown body",
        priority: "urgent",
        labels: ["backend", "docs"],
        subtasks: [
          {
            id: "subtask-1",
            text: "Write the drawer carefully",
            completed: false,
          },
        ],
        reviewNotesMarkdown: "Ready for QA",
        assignee: "Jordan",
        assignedAgentMode: "profile:codex",
        workflowState: "planning",
        blockedReason: null,
      });
    });

    expect(screen.getAllByText("session-7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("restores the original values when cancel is pressed", () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "get_setting":
          return {
            key: "dispatch.review.auto_enabled",
            value: false,
            updatedAt: 100,
          };
        case "set_setting":
          return {
            key: String(args?.key ?? ""),
            value: args?.value ?? false,
            updatedAt: 101,
          };
        default:
          throw new Error(`Unexpected Tauri invoke: ${command}`);
      }
    });

    render(
      <TaskDetailDrawer
        task={buildTask()}
        isSaving={false}
        isDeleting={false}
        agentModeOptions={[
          { value: "", label: "None" },
          { value: "auto", label: "Auto" },
        ]}
        agentModeStatus="ready"
        agentModeError={null}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    const labelsInput = screen.getByPlaceholderText("backend, review, release") as HTMLInputElement;

    fireEvent.change(titleInput, {
      target: { value: "Discard me" },
    });
    fireEvent.change(labelsInput, {
      target: { value: "temporary" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(titleInput.value).toBe("Ship task drawer");
    expect(labelsInput.value).toBe("backend, release");
  });

  it("loads and saves the global automated review preference", async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "get_setting":
          return {
            key: "dispatch.review.auto_enabled",
            value: true,
            updatedAt: 100,
          };
        case "set_setting":
          return {
            key: String(args?.key ?? ""),
            value: args?.value ?? false,
            updatedAt: 101,
          };
        default:
          throw new Error(`Unexpected Tauri invoke: ${command}`);
      }
    });

    render(
      <TaskDetailDrawer
        task={buildTask()}
        isSaving={false}
        isDeleting={false}
        agentModeOptions={[
          { value: "", label: "None" },
          { value: "auto", label: "Auto" },
        ]}
        agentModeStatus="ready"
        agentModeError={null}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    const automatedReview = await screen.findByLabelText("Automated review");
    expect((automatedReview as HTMLInputElement).checked).toBe(true);

    fireEvent.click(automatedReview);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("set_setting", {
        key: "dispatch.review.auto_enabled",
        value: false,
      });
    });
  });

  it("surfaces the persisted automated review handoff summary", async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "get_setting":
          return {
            key: "dispatch.review.auto_enabled",
            value: true,
            updatedAt: 100,
          };
        case "set_setting":
          return {
            key: String(args?.key ?? ""),
            value: args?.value ?? false,
            updatedAt: 101,
          };
        default:
          throw new Error(`Unexpected Tauri invoke: ${command}`);
      }
    });

    render(
      <TaskDetailDrawer
        task={buildTask({
          workflowState: "done",
          lastRunState: "succeeded",
          lastSessionId: "openclaw:review-session",
          reviewNotesMarkdown: "Initial review notes\n\n---\n\n### Automated Review\n\nRESULT: FAIL\n\nFEEDBACK: Fix the export path before release.",
        })}
        isSaving={false}
        isDeleting={false}
        agentModeOptions={[
          { value: "", label: "None" },
          { value: "auto", label: "Auto" },
        ]}
        agentModeStatus="ready"
        agentModeError={null}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(await screen.findByText("Review handoff")).toBeTruthy();
    expect(screen.getByText("Needs changes")).toBeTruthy();
    expect(screen.getByText("Fix the export path before release.")).toBeTruthy();
    expect(screen.getAllByText("openclaw:review-session").length).toBeGreaterThan(0);
  });

  it("updates the review handoff summary when the draft review notes change", async () => {
    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "get_setting":
          return {
            key: "dispatch.review.auto_enabled",
            value: true,
            updatedAt: 100,
          };
        case "set_setting":
          return {
            key: String(args?.key ?? ""),
            value: args?.value ?? false,
            updatedAt: 101,
          };
        default:
          throw new Error(`Unexpected Tauri invoke: ${command}`);
      }
    });

    render(
      <TaskDetailDrawer
        task={buildTask({
          reviewNotesMarkdown: "Initial review notes\n\n---\n\n### Automated Review\n\nRESULT: FAIL\n\nFEEDBACK: Fix the export path before release.",
        })}
        isSaving={false}
        isDeleting={false}
        agentModeOptions={[
          { value: "", label: "None" },
          { value: "auto", label: "Auto" },
        ]}
        agentModeStatus="ready"
        agentModeError={null}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(await screen.findByText("Needs changes")).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText("Capture review notes, QA checks, or follow-ups."),
      {
        target: { value: "Manual follow-up only" },
      },
    );

    expect(screen.queryByText("Needs changes")).toBeNull();
    expect(screen.getAllByText("Manual follow-up only").length).toBeGreaterThan(0);
  });
});
