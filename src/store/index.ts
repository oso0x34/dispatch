import { createStore } from "zustand/vanilla";

import {
  createUiSlice,
  type UiSlice,
} from "./uiSlice";

export type DispatchStore = UiSlice;

export function createDispatchStore() {
  return createStore<DispatchStore>()((...args) => ({
    ...createUiSlice(...args),
  }));
}
