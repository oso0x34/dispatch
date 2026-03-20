import type { LucideIcon } from "lucide-react";
import {
  FolderKanban,
  FolderTree,
  History,
  ListTodo,
  MessagesSquare,
  SquareTerminal,
} from "lucide-react";

import { useDispatchStore } from "../../app/providers";
import { tabDefinitions } from "../../store/uiSlice";

const tabIcons: Record<(typeof tabDefinitions)[number]["id"], LucideIcon> = {
  projects: FolderKanban,
  agents: SquareTerminal,
  tasks: ListTodo,
  files: FolderTree,
  history: History,
  chat: MessagesSquare,
};

export function TabBar() {
  const activeTab = useDispatchStore((state) => state.activeTab);
  const activeOverlay = useDispatchStore((state) => state.activeOverlay);
  const setActiveTab = useDispatchStore((state) => state.setActiveTab);
  const toggleOverlay = useDispatchStore((state) => state.toggleOverlay);
  const activeSurface = activeOverlay ?? activeTab;

  return (
    <div className="dispatch-divider border-y px-3 py-3 sm:px-4">
      <div className="flex flex-wrap gap-2">
        {tabDefinitions.map((tab) => {
          const Icon = tabIcons[tab.id];
          const isActive = tab.id === activeSurface;

          return (
            <button
              key={tab.id}
              type="button"
              className="dispatch-tab inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition"
              data-active={isActive}
              onClick={() => {
                if (tab.surface === "panel") {
                  setActiveTab(tab.id);
                  return;
                }

                toggleOverlay(tab.id);
              }}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
