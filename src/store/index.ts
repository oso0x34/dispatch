import { createStore } from "zustand/vanilla";

import {
  createUiSlice,
  type UiSlice,
} from "./uiSlice";
import {
  createProjectSlice,
  type ProjectSlice,
} from "./projectSlice";

export type DispatchStore = UiSlice & ProjectSlice;

export function createDispatchStore() {
  return createStore<DispatchStore>()((...args) => ({
    ...createUiSlice(...args),
    ...createProjectSlice(...args),
  }));
}
