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

type HeavyTabId = "agents" | "files" | "history" | "chat";

const mountCounts = vi.hoisted<Record<HeavyTabId, number>>(() => ({
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

vi.mock("../../features/agents/AgentsPlaceholder", () => ({
  AgentsPlaceholder: createHeavyTabMock("agents"),
}));

vi.mock("../../features/files/FilesPlaceholder", () => ({
  FilesPlaceholder: createHeavyTabMock("files"),
}));

vi.mock("../../features/history/HistoryPlaceholder", () => ({
  HistoryPlaceholder: createHeavyTabMock("history"),
}));

vi.mock("../../features/chat/ChatPlaceholder", () => ({
  ChatPlaceholder: createHeavyTabMock("chat"),
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
      <button type="button" onClick={() => setActiveTab("projects")}>
        Open Projects
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
  it("lazy-mounts each heavy tab only after first activation", async () => {
    const { user } = renderTabHost();

    for (const tab of Object.keys(mountCounts) as HeavyTabId[]) {
      expect(screen.queryByTestId(`${tab}-surface`)).toBeNull();
      expect(mountCounts[tab]).toBe(0);
    }

    await user.click(screen.getByRole("button", { name: "Open Agents" }));
    expect(screen.getByTestId("agents-surface")).toBeTruthy();
    expect(mountCounts.agents).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open Files" }));
    expect(screen.getByTestId("files-surface")).toBeTruthy();
    expect(mountCounts.files).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open History" }));
    expect(screen.getByTestId("history-surface")).toBeTruthy();
    expect(mountCounts.history).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open Chat" }));
    expect(screen.getByTestId("chat-surface")).toBeTruthy();
    expect(mountCounts.chat).toBe(1);
  });

  it("keeps heavy tabs mounted after switching away and does not remount them", async () => {
    const { user } = renderTabHost();

    await user.click(screen.getByRole("button", { name: "Open Agents" }));

    const agentsSurface = screen.getByTestId("agents-surface");
    const firstInstanceId = agentsSurface.getAttribute("data-instance-id");

    expect(firstInstanceId).toBe("agents-1");
    expect(mountCounts.agents).toBe(1);
    expect(getTabPanel("agents")?.style.display).toBe("block");

    await user.click(screen.getByRole("button", { name: "Open Projects" }));

    expect(screen.getByTestId("agents-surface")).toBeTruthy();
    expect(getTabPanel("agents")?.style.display).toBe("none");
    expect(mountCounts.agents).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open Agents" }));

    expect(screen.getByTestId("agents-surface").getAttribute("data-instance-id")).toBe(firstInstanceId);
    expect(getTabPanel("agents")?.style.display).toBe("block");
    expect(mountCounts.agents).toBe(1);
  });
});
