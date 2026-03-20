import type { StateCreator } from "zustand";

import type { HealthResponse } from "../shared/tauri/health";

export const tabDefinitions = [
  { id: "projects", label: "Projects" },
  { id: "agents", label: "Agents" },
  { id: "tasks", label: "Tasks" },
  { id: "files", label: "Files" },
  { id: "history", label: "History" },
  { id: "chat", label: "Chat" },
] as const;

export type TabId = (typeof tabDefinitions)[number]["id"];

export type BootStatus = "idle" | "loading" | "ready" | "error";

export type UiSlice = {
  activeTab: TabId;
  bootStatus: BootStatus;
  bootError: string | null;
  health: HealthResponse | null;
  setActiveTab: (tab: TabId) => void;
  setBootLoading: () => void;
  setBootError: (message: string) => void;
  setHealth: (health: HealthResponse) => void;
};

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  activeTab: "projects",
  bootStatus: "idle",
  bootError: null,
  health: null,
  setActiveTab: (tab) => {
    set({ activeTab: tab });
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
