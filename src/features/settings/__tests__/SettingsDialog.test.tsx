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
import { SettingsDialog } from "../SettingsDialog";
import { TopBar } from "../../../shared/components/TopBar";
import type {
  AgentProfileRecord,
  OpenClawConnectionStatusRecord,
  ProjectRecord,
  SecretStatus,
} from "../../../shared/lib/tauri";

const invokeMock = vi.hoisted(() => vi.fn());
const ACTIVE_PROJECT_SETTING_KEY = "app.active_project_id";
const OPENCLAW_GATEWAY_SETTING_KEY = "openclaw.gateway_url";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

type BackendState = {
  projects: ProjectRecord[];
  settings: Record<string, unknown>;
  connectionStatus: OpenClawConnectionStatusRecord;
  secretStatuses: Record<string, SecretStatus | string>;
  agentProfiles: AgentProfileRecord[];
  nextProjectIndex: number;
};

function buildHealth() {
  return {
    status: "ok" as const,
    appName: "Dispatch",
    appVersion: "0.1.0",
    bootedAtUnix: 1_767_300_000,
    logDirectory: "/tmp/dispatch/logs",
    activeLogPath: "/tmp/dispatch/logs/dispatch.log",
    sessionLogsDirectory: "/tmp/dispatch/logs/sessions",
    staleSessionsAbandonedAtBoot: 2,
  };
}

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

function buildConnectionStatus(
  state: OpenClawConnectionStatusRecord["state"],
  gatewayUrl: string | null,
): OpenClawConnectionStatusRecord {
  return {
    state,
    gatewayUrl,
    connectedAt: state === "connected" ? 1_767_300_120 : null,
    lastError: null,
    protocolVersion: state === "connected" ? 3 : null,
    serverVersion: state === "connected" ? "mock-gateway" : null,
    tickIntervalMs: state === "connected" ? 250 : null,
    availableMethods: state === "connected"
      ? [
        "sessions.list",
        "sessions.spawn",
      ]
      : [],
    availableEvents: [],
    helloSnapshot: null,
    statusDetails: null,
    healthDetails: null,
    presenceDetails: null,
    lastEventAt: null,
    lastEventSeq: null,
  };
}

function installBackendState(options?: {
  projects?: ProjectRecord[];
  activeProjectId?: string | null;
  gatewayUrl?: string | null;
  connectionState?: OpenClawConnectionStatusRecord["state"];
}) {
  const state: BackendState = {
    projects: options?.projects?.map((project) => ({ ...project })) ?? [],
    settings: {},
    connectionStatus: buildConnectionStatus(
      options?.connectionState ?? "disconnected",
      options?.gatewayUrl ?? null,
    ),
    secretStatuses: {
      OPENCLAW_GATEWAY_TOKEN: "missing",
      ANTHROPIC_API_KEY: "missing",
      OPENAI_API_KEY: "missing",
      GOOGLE_API_KEY: "missing",
    },
    agentProfiles: [],
    nextProjectIndex: 1,
  };

  if (options?.activeProjectId !== undefined) {
    state.settings[ACTIVE_PROJECT_SETTING_KEY] = options.activeProjectId;
  }

  if (options?.gatewayUrl !== undefined) {
    state.settings[OPENCLAW_GATEWAY_SETTING_KEY] = options.gatewayUrl;
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

        const project = buildProject(`project-${state.nextProjectIndex}`, name);
        state.nextProjectIndex += 1;
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
      case "get_openclaw_status":
        return { ...state.connectionStatus };
      case "connect_openclaw": {
        const input = args?.input as Record<string, unknown> | undefined;
        const gatewayUrl = typeof input?.gatewayUrl === "string" && input.gatewayUrl.trim()
          ? input.gatewayUrl.trim()
          : typeof state.settings[OPENCLAW_GATEWAY_SETTING_KEY] === "string"
            ? String(state.settings[OPENCLAW_GATEWAY_SETTING_KEY])
            : "ws://env.openclaw:7331";

        state.connectionStatus = buildConnectionStatus("connected", gatewayUrl);
        return { ...state.connectionStatus };
      }
      case "disconnect_openclaw":
        state.connectionStatus = buildConnectionStatus("disconnected", state.connectionStatus.gatewayUrl);
        return { ...state.connectionStatus };
      case "get_secret_status": {
        const key = String(args?.key ?? "");
        return {
          status: state.secretStatuses[key] ?? "missing",
        };
      }
      case "set_secret": {
        const key = String(args?.key ?? "");
        state.secretStatuses[key] = "keychain";
        return {
          status: "keychain",
        };
      }
      case "clear_secret": {
        const key = String(args?.key ?? "");
        state.secretStatuses[key] = "missing";
        return {
          status: "missing",
        };
      }
      case "list_agent_profiles":
        return state.agentProfiles.map((profile) => ({
          ...profile,
          args: profile.args.map((argument) => ({ ...argument })),
          env: Object.fromEntries(
            Object.entries(profile.env).map(([key, value]) => [key, { ...value }]),
          ),
          cwd: { ...profile.cwd },
        }));
      case "save_agent_profile": {
        const profile = (args?.profile ?? {}) as AgentProfileRecord;
        const id = String(profile.id ?? "").trim();
        const name = String(profile.name ?? "").trim();
        const program = String(profile.program ?? "").trim();

        if (!id) {
          throw new Error("agent profile id cannot be blank");
        }

        if (id === "auto") {
          throw new Error("agent profile id is reserved");
        }

        if (!name) {
          throw new Error("agent profile name cannot be blank");
        }

        if (!program) {
          throw new Error("agent profile program cannot be blank");
        }

        const saved: AgentProfileRecord = {
          ...profile,
          id,
          name,
          program,
          createdAt: state.agentProfiles.find((entry) => entry.id === id)?.createdAt ?? 100,
          updatedAt: 101,
        };
        state.agentProfiles = [
          saved,
          ...state.agentProfiles.filter((entry) => entry.id !== saved.id),
        ];
        return {
          ...saved,
          args: saved.args.map((argument) => ({ ...argument })),
          env: Object.fromEntries(
            Object.entries(saved.env).map(([key, value]) => [key, { ...value }]),
          ),
          cwd: { ...saved.cwd },
        };
      }
      case "delete_agent_profile": {
        const profileId = String(args?.profileId ?? "");
        const previousLength = state.agentProfiles.length;
        state.agentProfiles = state.agentProfiles.filter((profile) => profile.id !== profileId);
        return previousLength !== state.agentProfiles.length;
      }
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });

  return state;
}

function SettingsHarness() {
  const activeOverlay = useDispatchStore((state) => state.activeOverlay);
  const initializeProjects = useDispatchStore((state) => state.initializeProjects);

  useEffect(() => {
    void initializeProjects();
  }, [initializeProjects]);

  return (
    <>
      <TopBar />
      {activeOverlay === "settings" ? (
        <SettingsDialog
          bootStatus="ready"
          bootError={null}
          health={buildHealth()}
        />
      ) : null}
    </>
  );
}

function renderSettingsHarness(options?: {
  projects?: ProjectRecord[];
  activeProjectId?: string | null;
  gatewayUrl?: string | null;
  connectionState?: OpenClawConnectionStatusRecord["state"];
}) {
  const backendState = installBackendState(options);
  const user = userEvent.setup();

  render(
    <AppProviders>
      <SettingsHarness />
    </AppProviders>,
  );

  return {
    backendState,
    user,
  };
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("SettingsDialog", () => {
  it("opens from the shell and preserves pane navigation state while open", async () => {
    const alpha = buildProject("project-alpha", "Alpha");
    const { user } = renderSettingsHarness({
      projects: [alpha],
      activeProjectId: alpha.id,
      gatewayUrl: "ws://127.0.0.1:7331",
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = await screen.findByTestId("settings-dialog");
    const connectionPane = within(dialog).getByTestId("connection-settings");
    const gatewayInput = within(connectionPane).getByLabelText("Gateway URL") as HTMLInputElement;

    expect(gatewayInput.value).toBe("ws://127.0.0.1:7331");

    await user.clear(gatewayInput);
    await user.type(gatewayInput, "ws://127.0.0.1:7444");
    await user.click(within(dialog).getByRole("button", { name: "Projects" }));

    expect(within(dialog).getByTestId("projects-pane")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Connection" }));

    expect((within(dialog).getByLabelText("Gateway URL") as HTMLInputElement).value).toBe("ws://127.0.0.1:7444");
  });

  it("persists the gateway setting and reflects live connect and disconnect status", async () => {
    const { backendState, user } = renderSettingsHarness({
      projects: [buildProject("project-alpha", "Alpha")],
      activeProjectId: "project-alpha",
      gatewayUrl: "ws://127.0.0.1:7331",
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = await screen.findByTestId("settings-dialog");
    const connectionPane = within(dialog).getByTestId("connection-settings");
    const gatewayInput = within(connectionPane).getByLabelText("Gateway URL") as HTMLInputElement;

    await user.clear(gatewayInput);
    await user.type(gatewayInput, "ws://127.0.0.1:7444");
    await user.click(within(connectionPane).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(backendState.settings[OPENCLAW_GATEWAY_SETTING_KEY]).toBe("ws://127.0.0.1:7444");
    });

    await user.click(within(connectionPane).getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(within(connectionPane).getByText("Connected")).toBeTruthy();
    });

    await user.click(within(connectionPane).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(within(connectionPane).getByText("Disconnected")).toBeTruthy();
    });
  });

  it("lists projects and supports add and remove flows from the projects pane", async () => {
    const alpha = buildProject("project-alpha", "Alpha");
    const { backendState, user } = renderSettingsHarness({
      projects: [alpha],
      activeProjectId: alpha.id,
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = await screen.findByTestId("settings-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Projects" }));

    const projectsPane = within(dialog).getByTestId("projects-pane");
    expect(within(projectsPane).getByText("Alpha")).toBeTruthy();

    await user.click(within(projectsPane).getByRole("button", { name: "Add project" }));

    const addProjectDialog = await screen.findByRole("dialog", { name: "Add project" });
    await user.type(within(addProjectDialog).getByLabelText("Project name"), "Beta");
    await user.type(within(addProjectDialog).getByLabelText("Root path"), "/tmp/beta");
    await user.click(within(addProjectDialog).getByRole("button", { name: "Add project" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add project" })).toBeNull();
    });
    await waitFor(() => {
      expect(within(screen.getByTestId("projects-pane")).getByText("Beta")).toBeTruthy();
    });

    await user.click(within(screen.getByTestId("projects-pane")).getByRole("button", { name: "Remove Alpha" }));

    await waitFor(() => {
      expect(backendState.projects.map((project) => project.name)).toEqual(["Beta"]);
    });
  });

  it("shows runtime diagnostics and stale-session cleanup details in the about pane", async () => {
    const alpha = buildProject("project-alpha", "Alpha");
    const { user } = renderSettingsHarness({
      projects: [alpha],
      activeProjectId: alpha.id,
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = await screen.findByTestId("settings-dialog");
    await user.click(within(dialog).getByRole("button", { name: "About" }));

    const aboutPane = within(dialog).getByTestId("settings-about-pane");

    expect(within(aboutPane).getByText("/tmp/dispatch/logs")).toBeTruthy();
    expect(within(aboutPane).getByText("/tmp/dispatch/logs/dispatch.log")).toBeTruthy();
    expect(within(aboutPane).getByText("/tmp/dispatch/logs/sessions")).toBeTruthy();
    expect(within(aboutPane).getByText("2")).toBeTruthy();
  });

  it("shows secret status and supports write-only set and clear flows from the settings shell", async () => {
    const { backendState, user } = renderSettingsHarness();

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = await screen.findByTestId("settings-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Secrets" }));

    const secretsPane = within(dialog).getByTestId("secrets-pane");
    const secretRow = within(secretsPane).getByTestId("secret-row-OPENAI_API_KEY");
    const secretInput = within(secretRow).getByLabelText("OpenAI API key value") as HTMLInputElement;

    expect(within(secretRow).getByText("Missing")).toBeTruthy();

    await user.type(secretInput, "sk-test-123");
    await user.click(within(secretRow).getByRole("button", { name: "Save OpenAI API key" }));

    await waitFor(() => {
      expect(backendState.secretStatuses.OPENAI_API_KEY).toBe("keychain");
    });
    await waitFor(() => {
      expect(within(secretRow).getByText("Keychain")).toBeTruthy();
    });
    expect(secretInput.value).toBe("");

    await user.click(within(secretRow).getByRole("button", { name: "Clear OpenAI API key" }));

    await waitFor(() => {
      expect(backendState.secretStatuses.OPENAI_API_KEY).toBe("missing");
    });
    await waitFor(() => {
      expect(within(secretRow).getByText("Missing")).toBeTruthy();
    });
  });

  it("creates, validates, updates, and deletes agent profiles from the settings shell", async () => {
    const { backendState, user } = renderSettingsHarness();

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    const dialog = await screen.findByTestId("settings-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Agent Registry" }));

    const registryPane = within(dialog).getByTestId("agent-registry-pane");

    await user.type(within(registryPane).getByLabelText("Profile ID"), "auto");
    await user.type(within(registryPane).getByLabelText("Display name"), "Reserved");
    await user.click(within(registryPane).getByRole("button", { name: "Save profile" }));

    expect((await within(registryPane).findByRole("alert")).textContent).toContain("agent profile id is reserved");

    await user.click(within(registryPane).getByRole("button", { name: "New profile" }));
    await user.type(within(registryPane).getByLabelText("Profile ID"), "custom-reviewer");
    await user.type(within(registryPane).getByLabelText("Display name"), "Custom Reviewer");
    await user.clear(within(registryPane).getByLabelText("Program"));
    await user.type(within(registryPane).getByLabelText("Program"), "codex");
    await user.click(within(registryPane).getAllByRole("button", { name: "Add" })[1]);
    await user.type(within(registryPane).getByLabelText("Env key 1"), "OPENAI_API_KEY");
    await user.type(within(registryPane).getByLabelText("Env source value 1"), "OPENAI_API_KEY");
    await user.click(within(registryPane).getByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(backendState.agentProfiles.some((profile) => profile.id === "custom-reviewer")).toBe(true);
    });
    await waitFor(() => {
      expect(within(registryPane).getByText("Custom Reviewer")).toBeTruthy();
    });

    const displayNameInput = within(registryPane).getByLabelText("Display name") as HTMLInputElement;
    await user.clear(displayNameInput);
    await user.type(displayNameInput, "Custom Reviewer v2");
    await user.click(within(registryPane).getByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(
        backendState.agentProfiles.find((profile) => profile.id === "custom-reviewer")?.name,
      ).toBe("Custom Reviewer v2");
    });

    await user.click(within(registryPane).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(backendState.agentProfiles.some((profile) => profile.id === "custom-reviewer")).toBe(false);
    });
  });
});
