import type { StateCreator } from "zustand";

import type { HealthResponse } from "../shared/tauri/health";

export type PanelTabId =
  | "projects"
  | "agents"
  | "files"
  | "history"
  | "chat";

export type OverlayId = "tasks" | "settings";

type PanelTabDefinition = {
  id: PanelTabId;
  label: string;
  surface: "panel";
};

type OverlayTabDefinition = {
  id: "tasks";
  label: string;
  surface: "overlay";
};

type TabDefinition = PanelTabDefinition | OverlayTabDefinition;

export const lazyPanelTabs = [
  "agents",
  "files",
  "history",
  "chat",
] as const satisfies readonly PanelTabId[];

export const tabDefinitions: readonly TabDefinition[] = [
  { id: "projects", label: "Projects", surface: "panel" },
  { id: "agents", label: "Agents", surface: "panel" },
  { id: "tasks", label: "Tasks", surface: "overlay" },
  { id: "files", label: "Files", surface: "panel" },
  { id: "history", label: "History", surface: "panel" },
  { id: "chat", label: "Chat", surface: "panel" },
] as const;

export type BootStatus = "idle" | "loading" | "ready" | "error";

export type UiSlice = {
  activeTab: PanelTabId;
  activeOverlay: OverlayId | null;
  bootStatus: BootStatus;
  bootError: string | null;
  health: HealthResponse | null;
  setActiveTab: (tab: PanelTabId) => void;
  toggleOverlay: (overlay: OverlayId) => void;
  closeOverlay: () => void;
  setBootLoading: () => void;
  setBootError: (message: string) => void;
  setHealth: (health: HealthResponse) => void;
};

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  activeTab: "projects",
  activeOverlay: null,
  bootStatus: "idle",
  bootError: null,
  health: null,
  setActiveTab: (tab) => {
    set({
      activeTab: tab,
      activeOverlay: null,
    });
  },
  toggleOverlay: (overlay) => {
    set((state) => ({
      activeOverlay: state.activeOverlay === overlay ? null : overlay,
    }));
  },
  closeOverlay: () => {
    set({
      activeOverlay: null,
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
