// @vitest-environment jsdom

import {
  useEffect,
  useState,
} from "react";
import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { TabHost } from "../TabHost";
import {
  AppProviders,
  useDispatchStore,
} from "../providers";

type HeavyTabId = "tasks" | "agents" | "files" | "history" | "chat";

const mountCounts = vi.hoisted<Record<HeavyTabId, number>>(() => ({
  tasks: 0,
  agents: 0,
  files: 0,
  history: 0,
  chat: 0,
}));

function createHeavyTabMock(tab: HeavyTabId) {
  return function HeavyTabMock() {
    const [instanceId] = useState(() => `${tab}-${mountCounts[tab] + 1}`);

    useEffect(() => {
      mountCounts[tab] += 1;
    }, []);

    return (
      <div
        data-testid={`${tab}-surface`}
        data-instance-id={instanceId}
      >
        {tab}
      </div>
    );
  };
}

vi.mock("../../features/agents/AgentsTab", () => ({
  AgentsTab: createHeavyTabMock("agents"),
}));

vi.mock("../../features/tasks/TasksTab", () => ({
  TasksTab: createHeavyTabMock("tasks"),
}));

vi.mock("../../features/files/FilesTab", () => ({
  FilesTab: createHeavyTabMock("files"),
}));

vi.mock("../../features/history/HistoryTab", () => ({
  HistoryTab: createHeavyTabMock("history"),
}));

vi.mock("../../features/chat/ChatTab", () => ({
  ChatTab: createHeavyTabMock("chat"),
}));

afterEach(() => {
  cleanup();

  for (const tab of Object.keys(mountCounts) as HeavyTabId[]) {
    mountCounts[tab] = 0;
  }
});

function TabHostHarness() {
  const setActiveTab = useDispatchStore((state) => state.setActiveTab);

  return (
    <>
      <button type="button" onClick={() => setActiveTab("tasks")}>
        Open Tasks
      </button>
      <button type="button" onClick={() => setActiveTab("agents")}>
        Open Agents
      </button>
      <button type="button" onClick={() => setActiveTab("files")}>
        Open Files
      </button>
      <button type="button" onClick={() => setActiveTab("history")}>
        Open History
      </button>
      <button type="button" onClick={() => setActiveTab("chat")}>
        Open Chat
      </button>
      <TabHost />
    </>
  );
}

function renderTabHost() {
  const user = userEvent.setup();

  render(
    <AppProviders>
      <TabHostHarness />
    </AppProviders>,
  );

  return { user };
}

function getTabPanel(tab: HeavyTabId) {
  return document.querySelector<HTMLElement>(`[data-tab-panel="${tab}"]`);
}

describe("TabHost", () => {
  it("mounts the default orchestrate surface and lazy-mounts the remaining tabs on first activation", async () => {
    const { user } = renderTabHost();

    expect(await screen.findByTestId("chat-surface")).toBeTruthy();
    expect(mountCounts.chat).toBe(1);

    for (const tab of ["tasks", "agents", "files", "history"] as HeavyTabId[]) {
      expect(screen.queryByTestId(`${tab}-surface`)).toBeNull();
      expect(mountCounts[tab]).toBe(0);
    }

    await user.click(screen.getByRole("button", { name: "Open Tasks" }));
    expect(await screen.findByTestId("tasks-surface")).toBeTruthy();
    expect(mountCounts.tasks).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open Agents" }));
    expect(await screen.findByTestId("agents-surface")).toBeTruthy();
    expect(mountCounts.agents).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open Files" }));
    expect(await screen.findByTestId("files-surface")).toBeTruthy();
    expect(mountCounts.files).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open History" }));
    expect(await screen.findByTestId("history-surface")).toBeTruthy();
    expect(mountCounts.history).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open Chat" }));
    expect(await screen.findByTestId("chat-surface")).toBeTruthy();
    expect(mountCounts.chat).toBe(1);
  });

  it("keeps heavy tabs mounted after switching away and does not remount them", async () => {
    const { user } = renderTabHost();

    await user.click(screen.getByRole("button", { name: "Open Agents" }));

    const agentsSurface = await screen.findByTestId("agents-surface");
    const firstInstanceId = agentsSurface.getAttribute("data-instance-id");

    expect(firstInstanceId).toBe("agents-1");
    expect(mountCounts.agents).toBe(1);
    expect(getTabPanel("agents")?.style.display).toBe("flex");

    await user.click(screen.getByRole("button", { name: "Open Chat" }));

    expect(screen.getByTestId("agents-surface")).toBeTruthy();
    expect(getTabPanel("agents")?.style.display).toBe("none");
    expect(mountCounts.agents).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open Agents" }));

    expect(screen.getByTestId("agents-surface").getAttribute("data-instance-id")).toBe(firstInstanceId);
    expect(getTabPanel("agents")?.style.display).toBe("flex");
    expect(mountCounts.agents).toBe(1);
  });
});
