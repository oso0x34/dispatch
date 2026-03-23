import {
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";

import { ErrorBoundary } from "../shared/components/ErrorBoundary";
import { useDispatchStore } from "./providers";
import {
  lazyPanelTabs,
  type PanelTabId,
} from "../store/uiSlice";

type LazyPanelTabId = (typeof lazyPanelTabs)[number];

const AgentsTab = lazy(async () => {
  const module = await import("../features/agents/AgentsTab");
  return { default: module.AgentsTab };
});

const TasksTab = lazy(async () => {
  const module = await import("../features/tasks/TasksTab");
  return { default: module.TasksTab };
});

const ChatTab = lazy(async () => {
  const module = await import("../features/chat/ChatTab");
  return { default: module.ChatTab };
});

const BrowserTab = lazy(async () => {
  const module = await import("../features/browser/BrowserTab");
  return { default: module.BrowserTab };
});

const FilesTab = lazy(async () => {
  const module = await import("../features/files/FilesTab");
  return { default: module.FilesTab };
});

const HistoryTab = lazy(async () => {
  const module = await import("../features/history/HistoryTab");
  return { default: module.HistoryTab };
});

function LazyPanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <LoaderCircle size={18} className="dispatch-text-muted animate-spin" />
    </div>
  );
}

const tabPanels: Record<PanelTabId, { label: string; render: (active: boolean) => ReactNode }> = {
  tasks: {
    label: "Tasks tab",
    render: () => null,
  },
  agents: {
    label: "Agents tab",
    render: (active) => <AgentsTab active={active} />,
  },
  files: {
    label: "Files tab",
    render: (active) => <FilesTab active={active} />,
  },
  history: {
    label: "History tab",
    render: () => <HistoryTab />,
  },
  chat: {
    label: "Chat tab",
    render: (active) => <ChatTab active={active} />,
  },
  browser: {
    label: "Browser tab",
    render: () => <BrowserTab />,
  },
};

function isLazyPanelTab(tab: PanelTabId): tab is LazyPanelTabId {
  return tab === "tasks"
    || tab === "agents"
    || tab === "files"
    || tab === "history"
    || tab === "chat"
    || tab === "browser";
}

export function TabHost() {
  const activeTab = useDispatchStore((state) => state.activeTab);
  const browserEnabled = useDispatchStore((state) => state.browserEnabled);
  const linkedTaskId = useDispatchStore((state) => state.overlayTaskId);
  const setActiveTab = useDispatchStore((state) => state.setActiveTab);
  const [mountedPanels, setMountedPanels] = useState<Record<LazyPanelTabId, boolean>>(() => ({
    tasks: activeTab === "tasks",
    agents: activeTab === "agents",
    files: activeTab === "files",
    history: activeTab === "history",
    chat: activeTab === "chat",
    browser: activeTab === "browser",
  }));

  useEffect(() => {
    if (!isLazyPanelTab(activeTab)) {
      return;
    }

    setMountedPanels((current) => {
      if (current[activeTab]) {
        return current;
      }

      return {
        ...current,
        [activeTab]: true,
      };
    });
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "browser" && !browserEnabled) {
      setActiveTab("chat");
    }
  }, [
    activeTab,
    browserEnabled,
    setActiveTab,
  ]);

  return (
    <div className="flex h-full flex-col">
      {lazyPanelTabs.map((tab) => (
        mountedPanels[tab] ? (
          <div
            key={tab}
            data-tab-panel={tab}
            className="h-full"
            style={{
              display: activeTab === tab ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <ErrorBoundary surfaceName={tabPanels[tab].label}>
              <Suspense fallback={<LazyPanelFallback />}>
                {tab === "tasks"
                  ? <TasksTab linkedTaskId={linkedTaskId} />
                  : tabPanels[tab].render(activeTab === tab)}
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : null
      ))}
    </div>
  );
}
