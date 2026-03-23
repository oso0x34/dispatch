// @vitest-environment jsdom

import { useEffect } from "react";
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

import {
  AppProviders,
  useDispatchStore,
} from "../../../app/providers";
import type {
  ProjectRecord,
  SavePointDiffRecord,
  SavePointDiffResultRecord,
  SavePointRecord,
} from "../../../shared/lib/tauri";
import { HistoryTab } from "../HistoryTab";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

type BackendState = {
  project: ProjectRecord;
  savePoints: SavePointRecord[];
  diffs: Record<string, SavePointDiffResultRecord>;
  restoreWorkspaceCalls: Array<{ projectId: string; refName: string }>;
  restoreFileCalls: Array<{ projectId: string; refName: string; relativePath: string }>;
};

function buildProject(): ProjectRecord {
  return {
    id: "project-alpha",
    name: "Alpha",
    rootRelativePath: ".",
    createdAt: 100,
    updatedAt: 100,
    lastOpenedAt: null,
  };
}

function buildSavePoint(overrides: Partial<SavePointRecord> = {}): SavePointRecord {
  return {
    projectId: "project-alpha",
    runId: null,
    refName: "refs/dispatch/save-points/project-alpha/1773967201-manual-before-refactor",
    commitOid: "abcdef1234567890",
    baseHeadOid: "1234567890abcdef",
    stage: "manual",
    createdAt: 1773967201000,
    ...overrides,
  };
}

function buildDiff(
  savePoint: SavePointRecord,
  overrides: Partial<SavePointDiffRecord> = {},
): SavePointDiffResultRecord {
  return {
    status: "ready",
    diff: {
      projectId: savePoint.projectId,
      refName: savePoint.refName,
      commitOid: savePoint.commitOid,
      baseCommitOid: savePoint.baseHeadOid,
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
      },
      files: [
        {
          path: "README.md",
          previousPath: null,
          status: "modified",
          isBinary: false,
          patch: "Fresh manual diff",
        },
      ],
      ...overrides,
    },
  };
}

function installBackendState() {
  const project = buildProject();
  const manualSavePoint = buildSavePoint();
  const preAgentSavePoint = buildSavePoint({
    refName: "refs/dispatch/save-points/project-alpha/1773966900-pre-agent-session-001",
    commitOid: "fedcba0987654321",
    stage: "pre_agent",
    runId: "session-001",
    createdAt: 1773966900000,
  });
  const state: BackendState = {
    project,
    savePoints: [
      manualSavePoint,
      preAgentSavePoint,
    ],
    diffs: {
      [manualSavePoint.refName]: buildDiff(manualSavePoint, {
        files: [
          {
            path: "README.md",
            previousPath: null,
            status: "modified",
            isBinary: false,
            patch: "Manual diff body",
          },
        ],
      }),
      [preAgentSavePoint.refName]: buildDiff(preAgentSavePoint, {
        files: [
          {
            path: "src/main.rs",
            previousPath: null,
            status: "modified",
            isBinary: false,
            patch: "Pre agent patch",
          },
        ],
      }),
    },
    restoreWorkspaceCalls: [],
    restoreFileCalls: [],
  };

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "list_projects":
        return [{ ...state.project }];
      case "get_setting":
        return {
          key: "app.active_project_id",
          value: state.project.id,
          updatedAt: 100,
        };
      case "set_setting":
        return {
          key: String(args?.key ?? ""),
          value: args?.value ?? null,
          updatedAt: 101,
        };
      case "list_project_save_points":
        return state.savePoints.map((savePoint) => ({ ...savePoint }));
      case "get_project_save_point_diff": {
        const refName = String((args?.input as { refName?: string } | undefined)?.refName ?? "");
        const diff = state.diffs[refName];
        if (!diff) {
          throw new Error(`missing diff for ${refName}`);
        }

        return diff;
      }
      case "create_manual_save_point": {
        const savePoint = buildSavePoint({
          refName: "refs/dispatch/save-points/project-alpha/1773967400-manual-just-now",
          commitOid: "0011223344556677",
          createdAt: 1773967400000,
        });
        state.savePoints = [
          savePoint,
          ...state.savePoints.filter((candidate) => candidate.refName !== savePoint.refName),
        ];
        state.diffs[savePoint.refName] = buildDiff(savePoint);

        return {
          status: "created",
          savePoint,
        };
      }
      case "restore_project_save_point": {
        const input = (args?.input as { projectId?: string; refName?: string } | undefined) ?? {};
        state.restoreWorkspaceCalls.push({
          projectId: String(input.projectId ?? ""),
          refName: String(input.refName ?? ""),
        });
        return {
          status: "restored",
          refName: input.refName ?? null,
          restoredPaths: ["README.md"],
        };
      }
      case "restore_project_save_point_file": {
        const input = (args?.input as { projectId?: string; refName?: string; relativePath?: string } | undefined) ?? {};
        state.restoreFileCalls.push({
          projectId: String(input.projectId ?? ""),
          refName: String(input.refName ?? ""),
          relativePath: String(input.relativePath ?? ""),
        });
        return {
          status: "restored",
          refName: input.refName ?? null,
          restoredPaths: [input.relativePath ?? ""],
        };
      }
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });

  return state;
}

function HistoryHarness() {
  const initializeProjects = useDispatchStore((state) => state.initializeProjects);

  useEffect(() => {
    void initializeProjects();
  }, [initializeProjects]);

  return <HistoryTab />;
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("HistoryTab", () => {
  it("filters save points locally and loads a diff when a result is selected", async () => {
    installBackendState();
    const user = userEvent.setup();

    render(
      <AppProviders>
        <HistoryHarness />
      </AppProviders>,
    );

    await screen.findByText("Manual diff body");

    const searchInput = screen.getByRole("textbox", { name: "Search save points" });
    await user.type(searchInput, "pre-agent");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /manual before refactor/i })).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: /pre-agent session 001/i }));

    await screen.findByText("Pre agent patch");
  });

  it("creates manual save points and gates workspace and file restore behind confirmations", async () => {
    const backend = installBackendState();
    const user = userEvent.setup();

    render(
      <AppProviders>
        <HistoryHarness />
      </AppProviders>,
    );

    await screen.findByText("Manual diff body");

    await user.click(screen.getByRole("button", { name: "Create manual save point" }));

    await screen.findByText("Manual save point created: manual just now.");
    await screen.findByText("Fresh manual diff");

    await user.click(screen.getByRole("button", { name: "Restore workspace" }));
    const workspaceDialog = await screen.findByRole("dialog", { name: /restore the full workspace from manual just now/i });
    await user.click(within(workspaceDialog).getByRole("button", { name: "Restore workspace" }));

    await screen.findByText("Restored the workspace from manual just now.");
    expect(backend.restoreWorkspaceCalls).toEqual([
      {
        projectId: "project-alpha",
        refName: "refs/dispatch/save-points/project-alpha/1773967400-manual-just-now",
      },
    ]);

    await user.click(screen.getByRole("button", { name: "Restore file" }));
    const fileDialog = await screen.findByRole("dialog", { name: "Restore README.md?" });
    await user.click(within(fileDialog).getByRole("button", { name: "Restore file" }));

    await screen.findByText("Restored README.md from manual just now.");
    expect(backend.restoreFileCalls).toEqual([
      {
        projectId: "project-alpha",
        refName: "refs/dispatch/save-points/project-alpha/1773967400-manual-just-now",
        relativePath: "README.md",
      },
    ]);
  });
});
