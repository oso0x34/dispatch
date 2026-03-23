import type { HealthResponse } from "../shared/tauri/health";
import { EXPERIMENTAL_BROWSER_TAB_LABEL } from "../features/browser/store/browserSlice";
import type { StateCreator } from "zustand";

export type PanelTabId =
  | "tasks"
  | "agents"
  | "files"
  | "history"
  | "chat"
  | "browser";

export type OverlayId = "settings";

type PanelTabDefinition = {
  id: PanelTabId;
  label: string;
  surface: "panel";
};

type TabDefinition = PanelTabDefinition;

export const lazyPanelTabs = [
  "tasks",
  "agents",
  "files",
  "history",
  "chat",
  "browser",
] as const satisfies readonly PanelTabId[];

export const tabDefinitions: readonly TabDefinition[] = [
  { id: "chat", label: "Orchestrate", surface: "panel" },
  { id: "tasks", label: "Tasks", surface: "panel" },
  { id: "agents", label: "Agents", surface: "panel" },
  { id: "files", label: "Files", surface: "panel" },
  { id: "history", label: "History", surface: "panel" },
  { id: "browser", label: EXPERIMENTAL_BROWSER_TAB_LABEL, surface: "panel" },
] as const;

export type BootStatus = "idle" | "loading" | "ready" | "error";

export type UiSlice = {
  activeTab: PanelTabId;
  activeOverlay: OverlayId | null;
  overlayTaskId: string | null;
  commandPaletteOpen: boolean;
  bootStatus: BootStatus;
  bootError: string | null;
  health: HealthResponse | null;
  setActiveTab: (tab: PanelTabId) => void;
  openOverlay: (overlay: OverlayId) => void;
  toggleOverlay: (overlay: OverlayId) => void;
  openTasksOverlay: (taskId?: string | null) => void;
  closeOverlay: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  setBootLoading: () => void;
  setBootError: (message: string) => void;
  setHealth: (health: HealthResponse) => void;
};

const TAB_STORAGE_KEY = "dispatch.activeTab";

function getPersistedTab(): PanelTabId {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored && lazyPanelTabs.includes(stored as PanelTabId)) {
      return stored as PanelTabId;
    }
  } catch {
    // localStorage unavailable
  }
  return "chat";
}

function persistTab(tab: PanelTabId) {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // localStorage unavailable
  }
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  activeTab: getPersistedTab(),
  activeOverlay: null,
  overlayTaskId: null,
  commandPaletteOpen: false,
  bootStatus: "idle",
  bootError: null,
  health: null,
  setActiveTab: (tab) => {
    persistTab(tab);
    set({
      activeTab: tab,
      activeOverlay: null,
      overlayTaskId: null,
      commandPaletteOpen: false,
    });
  },
  openOverlay: (overlay) => {
    set({
      activeOverlay: overlay,
      overlayTaskId: null,
      commandPaletteOpen: false,
    });
  },
  toggleOverlay: (overlay) => {
    set((state) => ({
      activeOverlay: state.activeOverlay === overlay ? null : overlay,
      overlayTaskId: null,
      commandPaletteOpen: false,
    }));
  },
  openTasksOverlay: (taskId) => {
    persistTab("tasks");
    set({
      activeTab: "tasks",
      activeOverlay: null,
      overlayTaskId: taskId?.trim() ? taskId : null,
      commandPaletteOpen: false,
    });
  },
  closeOverlay: () => {
    set({
      activeOverlay: null,
      overlayTaskId: null,
    });
  },
  openCommandPalette: () => {
    set({
      activeOverlay: null,
      overlayTaskId: null,
      commandPaletteOpen: true,
    });
  },
  closeCommandPalette: () => {
    set({
      commandPaletteOpen: false,
    });
  },
  toggleCommandPalette: () => {
    set((state) => {
      if (state.commandPaletteOpen) {
        return {
          commandPaletteOpen: false,
        };
      }

      return {
        activeOverlay: null,
        overlayTaskId: null,
        commandPaletteOpen: true,
      };
    });
  },
  setBootLoading: () => {
    set({
      bootStatus: "loading",
      bootError: null,
    });
  },
  setBootError: (message) => {
    set({
      bootStatus: "error",
      bootError: message,
    });
  },
  setHealth: (health) => {
    set({
      health,
      bootStatus: "ready",
      bootError: null,
    });
  },
});
