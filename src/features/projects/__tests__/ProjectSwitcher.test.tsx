// @vitest-environment jsdom

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

import { AppProviders } from "../../../app/providers";
import { ProjectSwitcher } from "../ProjectSwitcher";
import type { ProjectRecord } from "../../../shared/lib/tauri";

const invokeMock = vi.hoisted(() => vi.fn());
const ACTIVE_PROJECT_SETTING_KEY = "app.active_project_id";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

type BackendState = {
  projects: ProjectRecord[];
  settings: Record<string, unknown>;
  nextCreatedIndex: number;
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

function installBackendState(options?: {
  projects?: ProjectRecord[];
  activeProjectId?: string | null;
}) {
  const state: BackendState = {
    projects: options?.projects?.map((project) => ({ ...project })) ?? [],
    settings: {},
    nextCreatedIndex: 1,
  };

  if (options?.activeProjectId !== undefined) {
    state.settings[ACTIVE_PROJECT_SETTING_KEY] = options.activeProjectId;
  }

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "list_projects":
        return state.projects.map((project) => ({ ...project }));
      case "get_project": {
        const projectId = args?.projectId;
        return state.projects.find((project) => project.id === projectId) ?? null;
      }
      case "create_project": {
        const name = String(args?.name ?? "").trim();
        const rootPath = String(args?.rootPath ?? "").trim();

        if (!name) {
          throw new Error("project name cannot be blank");
        }

        if (!rootPath) {
          throw new Error("project root is invalid or inaccessible");
        }

        const index = state.nextCreatedIndex;
        state.nextCreatedIndex += 1;

        const project = buildProject(`project-${index}`, name);
        state.projects = [
          project,
          ...state.projects,
        ];

        return project;
      }
      case "delete_project": {
        const projectId = args?.projectId;
        const previousLength = state.projects.length;
        state.projects = state.projects.filter((project) => project.id !== projectId);
        return previousLength !== state.projects.length;
      }
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
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });

  return state;
}

function renderProjectSwitcher(options?: {
  projects?: ProjectRecord[];
  activeProjectId?: string | null;
}) {
  const backendState = installBackendState(options);
  const user = userEvent.setup();

  render(
    <AppProviders>
      <ProjectSwitcher />
    </AppProviders>,
  );

  return {
    backendState,
    user,
  };
}

function getSwitcherButton() {
  return screen.getByRole("button", { name: "Project switcher" });
}

async function waitForSwitcherTitle(title: string) {
  await waitFor(() => {
    expect(within(getSwitcherButton()).getByText(title)).toBeTruthy();
  });
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("ProjectSwitcher", () => {
  it("shows an empty state when no projects are registered", async () => {
    const { user } = renderProjectSwitcher();

    await waitForSwitcherTitle("No project selected");

    await user.click(getSwitcherButton());

    expect(screen.getByText("No projects registered yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
  });

  it("restores the active project from persisted settings on load", async () => {
    const alpha = buildProject("project-alpha", "Alpha");
    const beta = buildProject("project-beta", "Beta");
    const { user } = renderProjectSwitcher({
      projects: [
        alpha,
        beta,
      ],
      activeProjectId: beta.id,
    });

    await waitForSwitcherTitle("Beta");

    await user.click(getSwitcherButton());

    expect(screen.getByRole("button", { name: "Beta, active project" })).toBeTruthy();
  });

  it("adds a project from the dialog and makes it active", async () => {
    const { backendState, user } = renderProjectSwitcher();

    await waitForSwitcherTitle("No project selected");
    await user.click(getSwitcherButton());
    await user.click(screen.getByRole("button", { name: "Add project" }));

    const dialog = await screen.findByRole("dialog", { name: "Add project" });

    await user.type(within(dialog).getByLabelText("Project name"), "TX Flows");
    await user.type(within(dialog).getByLabelText("Root path"), "/tmp/tx-flows");
    await user.click(within(dialog).getByRole("button", { name: "Add project" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add project" })).toBeNull();
    });
    await waitForSwitcherTitle("TX Flows");

    expect(backendState.projects.map((project) => project.name)).toEqual(["TX Flows"]);
    expect(backendState.settings[ACTIVE_PROJECT_SETTING_KEY]).toBe("project-1");
  });

  it("switches the active project and persists the selection", async () => {
    const alpha = buildProject("project-alpha", "Alpha");
    const beta = buildProject("project-beta", "Beta");
    const { backendState, user } = renderProjectSwitcher({
      projects: [
        alpha,
        beta,
      ],
      activeProjectId: alpha.id,
    });

    await waitForSwitcherTitle("Alpha");
    await user.click(getSwitcherButton());
    await user.click(screen.getByRole("button", { name: "Switch to Beta" }));

    await waitForSwitcherTitle("Beta");

    expect(backendState.settings[ACTIVE_PROJECT_SETTING_KEY]).toBe(beta.id);
  });

  it("removes the active project and falls back to the next available project", async () => {
    const alpha = buildProject("project-alpha", "Alpha");
    const beta = buildProject("project-beta", "Beta");
    const { backendState, user } = renderProjectSwitcher({
      projects: [
        alpha,
        beta,
      ],
      activeProjectId: alpha.id,
    });

    await waitForSwitcherTitle("Alpha");
    await user.click(getSwitcherButton());
    await user.click(screen.getByRole("button", { name: "Remove Alpha" }));

    await waitForSwitcherTitle("Beta");

    expect(backendState.projects.map((project) => project.name)).toEqual(["Beta"]);
    expect(backendState.settings[ACTIVE_PROJECT_SETTING_KEY]).toBe(beta.id);
  });
});
