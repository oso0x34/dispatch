// @vitest-environment jsdom

import {
  useEffect,
  useState,
} from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
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
import {
  PROJECT_FILE_REFRESH_EVENT,
  type ProjectContentSearchHitRecord,
  type ProjectFileRefreshEventRecord,
  type ProjectFilePreviewRecord,
  type ProjectRecord,
  type ProjectTreeEntryRecord,
} from "../../../shared/lib/tauri";
import { FilesTab } from "../FilesTab";

const invokeMock = vi.hoisted(() => vi.fn());
const openPathMock = vi.hoisted(() => vi.fn());
const eventListeners = vi.hoisted(() => new Map<string, (event: { payload: ProjectFileRefreshEventRecord }) => void>());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, callback: (event: { payload: ProjectFileRefreshEventRecord }) => void) => {
    eventListeners.set(eventName, callback);
    return () => {
      eventListeners.delete(eventName);
    };
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: openPathMock,
}));

type BackendState = {
  project: ProjectRecord;
  settings: Record<string, string | null>;
  trees: Record<string, ProjectTreeEntryRecord[]>;
  previews: Record<string, ProjectFilePreviewRecord>;
  pathSearchResults: Record<string, ProjectTreeEntryRecord[]>;
  contentSearchResults: Record<string, ProjectContentSearchHitRecord[]>;
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

function installBackendState() {
  const project = buildProject();
  const state: BackendState = {
    project,
    settings: {
      "app.active_project_id": project.id,
    },
    trees: {
      ".": [
        { path: "docs", name: "docs", kind: "directory" },
        { path: "README.md", name: "README.md", kind: "file" },
      ],
      docs: [
        { path: "docs/guide.md", name: "guide.md", kind: "file" },
      ],
    },
    previews: {
      "README.md": {
        path: "README.md",
        absolutePath: "/tmp/dispatch/README.md",
        name: "README.md",
        format: "markdown",
        content: "# Dispatch\n\nRoot readme",
      },
      "docs/guide.md": {
        path: "docs/guide.md",
        absolutePath: "/tmp/dispatch/docs/guide.md",
        name: "guide.md",
        format: "markdown",
        content: "## Guide\n\nNeedle content",
      },
    },
    pathSearchResults: {
      guide: [
        { path: "docs/guide.md", name: "guide.md", kind: "file" },
      ],
    },
    contentSearchResults: {
      needle: [
        { path: "docs/guide.md", lineNumber: 2, lineText: "Needle content" },
      ],
    },
  };

  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "list_projects":
        return [{ ...state.project }];
      case "get_setting":
        return {
          key: "app.active_project_id",
          value: state.settings["app.active_project_id"],
          updatedAt: 100,
        };
      case "set_setting":
        state.settings[String(args?.key ?? "")] = typeof args?.value === "string" || args?.value === null
          ? args.value
          : null;
        return {
          key: String(args?.key ?? ""),
          value: state.settings[String(args?.key ?? "")],
          updatedAt: 101,
        };
      case "start_project_file_watch":
        return {
          projectId: (args?.input as { projectId?: string } | undefined)?.projectId ?? null,
          debounceWindowMs: 150,
        };
      case "stop_project_file_watch":
        return true;
      case "list_project_tree": {
        const rootRelativePath = String((args?.input as { rootRelativePath?: string | null } | undefined)?.rootRelativePath ?? ".");
        return (state.trees[rootRelativePath] ?? []).map((entry) => ({ ...entry }));
      }
      case "read_project_file": {
        const relativePath = String((args?.input as { relativePath?: string } | undefined)?.relativePath ?? "");
        const preview = state.previews[relativePath];

        if (!preview) {
          throw new Error("project path was not found");
        }

        return { ...preview };
      }
      case "search_project_paths": {
        const query = String((args?.input as { query?: string } | undefined)?.query ?? "").toLowerCase();
        return (state.pathSearchResults[query] ?? []).map((entry) => ({ ...entry }));
      }
      case "search_project_content": {
        const query = String((args?.input as { query?: string } | undefined)?.query ?? "").toLowerCase();
        return (state.contentSearchResults[query] ?? []).map((entry) => ({ ...entry }));
      }
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });

  return state;
}

function FilesHarness({ active = true }: { active?: boolean }) {
  const initializeProjects = useDispatchStore((state) => state.initializeProjects);

  useEffect(() => {
    void initializeProjects();
  }, [initializeProjects]);

  return <FilesTab active={active} />;
}

async function emitProjectRefresh(payload: ProjectFileRefreshEventRecord) {
  const listener = eventListeners.get("dispatch://files/refresh");

  if (!listener) {
    throw new Error("project file refresh listener is missing");
  }

  listener({ payload });
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  openPathMock.mockReset();
  eventListeners.clear();
});

describe("FilesTab", () => {
  it("searches paths, previews a result, and reuses the opener plugin", async () => {
    installBackendState();
    openPathMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <AppProviders>
        <FilesHarness />
      </AppProviders>,
    );

    await screen.findByText("Project files");

    await user.type(screen.getByRole("textbox", { name: "Search project files" }), "guide");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByRole("button", { name: /guide\.md/i });

    await user.click(screen.getAllByRole("button", { name: /guide\.md/i })[0]);

    await waitFor(() => {
      expect(screen.getByText(/^## Guide/)).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Open in editor" }));

    await waitFor(() => {
      expect(openPathMock).toHaveBeenCalledWith("/tmp/dispatch/docs/guide.md");
    });
  });

  it("switches to content search and reloads the tree on project refresh events", async () => {
    const backend = installBackendState();
    const user = userEvent.setup();

    render(
      <AppProviders>
        <FilesHarness />
      </AppProviders>,
    );

    await screen.findByText("Project files");

    await user.click(screen.getByRole("button", { name: "Content" }));
    await user.type(screen.getByRole("textbox", { name: "Search project files" }), "needle");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("Line 2");
    await user.click(screen.getByRole("button", { name: /docs\/guide\.md/i }));

    await waitFor(() => {
      expect(screen.getByText(/^## Guide/)).toBeTruthy();
    });

    backend.trees["."] = [
      { path: "docs", name: "docs", kind: "directory" },
      { path: "README.md", name: "README.md", kind: "file" },
      { path: "notes.txt", name: "notes.txt", kind: "file" },
    ];

    await emitProjectRefresh({
      projectId: "project-alpha",
      changedPaths: ["notes.txt"],
      changedAtUnixMs: 400,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeTruthy();
    });
  });

  it("only starts file watches and refresh listeners after the files surface becomes active", async () => {
    installBackendState();
    const user = userEvent.setup();

    function ToggleFilesHarness() {
      const [active, setActive] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setActive(true)}>
            Activate Files
          </button>
          <button type="button" onClick={() => setActive(false)}>
            Deactivate Files
          </button>
          <FilesHarness active={active} />
        </>
      );
    }

    render(
      <AppProviders>
        <ToggleFilesHarness />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.some(([command]) => command === "list_projects"),
      ).toBe(true);
    });

    expect(invokeMock).not.toHaveBeenCalledWith("list_project_tree", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("start_project_file_watch", expect.anything());
    expect(eventListeners.has(PROJECT_FILE_REFRESH_EVENT)).toBe(false);

    await user.click(screen.getByRole("button", { name: "Activate Files" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("start_project_file_watch", {
        input: {
          projectId: "project-alpha",
        },
      });
    });

    expect(eventListeners.has(PROJECT_FILE_REFRESH_EVENT)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Deactivate Files" }));

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.some(([command]) => command === "stop_project_file_watch"),
      ).toBe(true);
    });

    expect(eventListeners.has(PROJECT_FILE_REFRESH_EVENT)).toBe(false);
  });
});
