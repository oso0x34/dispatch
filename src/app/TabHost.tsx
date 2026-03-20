import type { ReactNode } from "react";

import { ErrorBoundary } from "../shared/components/ErrorBoundary";
import { AgentsPlaceholder } from "../features/agents/AgentsPlaceholder";
import { ChatPlaceholder } from "../features/chat/ChatPlaceholder";
import { FilesPlaceholder } from "../features/files/FilesPlaceholder";
import { HistoryPlaceholder } from "../features/history/HistoryPlaceholder";
import { ProjectsPlaceholder } from "../features/projects/ProjectsPlaceholder";
import { TasksPlaceholder } from "../features/tasks/TasksPlaceholder";
import { useDispatchStore } from "./providers";
import type { TabId } from "../store/uiSlice";

const tabPanels: Record<TabId, ReactNode> = {
  projects: <ProjectsPlaceholder />,
  agents: <AgentsPlaceholder />,
  tasks: <TasksPlaceholder />,
  files: <FilesPlaceholder />,
  history: <HistoryPlaceholder />,
  chat: <ChatPlaceholder />,
};

export function TabHost() {
  const activeTab = useDispatchStore((state) => state.activeTab);

  return <ErrorBoundary>{tabPanels[activeTab]}</ErrorBoundary>;
}
