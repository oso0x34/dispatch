import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { ErrorBoundary } from "../shared/components/ErrorBoundary";
import { AgentsPlaceholder } from "../features/agents/AgentsPlaceholder";
import { ChatPlaceholder } from "../features/chat/ChatPlaceholder";
import { FilesPlaceholder } from "../features/files/FilesPlaceholder";
import { HistoryPlaceholder } from "../features/history/HistoryPlaceholder";
import { ProjectsPlaceholder } from "../features/projects/ProjectsPlaceholder";
import { useDispatchStore } from "./providers";
import {
  lazyPanelTabs,
  type PanelTabId,
} from "../store/uiSlice";

type LazyPanelTabId = (typeof lazyPanelTabs)[number];

const tabPanels: Record<PanelTabId, { label: string; content: ReactNode }> = {
  projects: {
    label: "Projects tab",
    content: <ProjectsPlaceholder />,
  },
  agents: {
    label: "Agents tab",
    content: <AgentsPlaceholder />,
  },
  files: {
    label: "Files tab",
    content: <FilesPlaceholder />,
  },
  history: {
    label: "History tab",
    content: <HistoryPlaceholder />,
  },
  chat: {
    label: "Chat tab",
    content: <ChatPlaceholder />,
  },
};

function isLazyPanelTab(tab: PanelTabId): tab is LazyPanelTabId {
  return tab === "agents" || tab === "files" || tab === "history" || tab === "chat";
}

export function TabHost() {
  const activeTab = useDispatchStore((state) => state.activeTab);
  const [mountedPanels, setMountedPanels] = useState<Record<LazyPanelTabId, boolean>>(() => ({
    agents: activeTab === "agents",
    files: activeTab === "files",
    history: activeTab === "history",
    chat: activeTab === "chat",
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

  return (
    <div className="flex min-h-full flex-col">
      {activeTab === "projects" ? (
        <div data-tab-panel="projects">
          <ErrorBoundary surfaceName={tabPanels.projects.label}>
            {tabPanels.projects.content}
          </ErrorBoundary>
        </div>
      ) : null}

      {lazyPanelTabs.map((tab) => (
        mountedPanels[tab] ? (
          <div
            key={tab}
            data-tab-panel={tab}
            style={{
              display: activeTab === tab ? "block" : "none",
            }}
          >
            <ErrorBoundary surfaceName={tabPanels[tab].label}>
              {tabPanels[tab].content}
            </ErrorBoundary>
          </div>
        ) : null
      ))}
    </div>
  );
}
