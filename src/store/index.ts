import { createStore } from "zustand/vanilla";

import {
  createUiSlice,
  type UiSlice,
} from "./uiSlice";
import {
  createProjectSlice,
  type ProjectSlice,
} from "./projectSlice";
import {
  createAgentsSlice,
  type AgentsSlice,
} from "../features/agents/store/agentsSlice";
import {
  createTasksSlice,
  type TasksSlice,
} from "../features/tasks/store/tasksSlice";
import {
  createFilesSlice,
  type FilesSlice,
} from "../features/files/store/filesSlice";
import {
  createBrowserSlice,
  type BrowserSlice,
} from "../features/browser/store/browserSlice";

export type DispatchStore = UiSlice & ProjectSlice & AgentsSlice & TasksSlice & FilesSlice & BrowserSlice;

export function createDispatchStore() {
  return createStore<DispatchStore>()((...args) => ({
    ...createUiSlice(...args),
    ...createProjectSlice(...args),
    ...createAgentsSlice(...args),
    ...createTasksSlice(...args),
    ...createFilesSlice(...args),
    ...createBrowserSlice(...args),
  }));
}
