import {
  createContext,
  type PropsWithChildren,
  useContext,
  useRef,
} from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import {
  createDispatchStore,
  type DispatchStore,
} from "../store";

const DispatchStoreContext = createContext<StoreApi<DispatchStore> | null>(null);

export function AppProviders({ children }: PropsWithChildren) {
  const storeRef = useRef<StoreApi<DispatchStore> | null>(null);

  if (!storeRef.current) {
    storeRef.current = createDispatchStore();
  }

  return (
    <DispatchStoreContext.Provider value={storeRef.current}>
      {children}
    </DispatchStoreContext.Provider>
  );
}

export function useDispatchStore<T>(selector: (state: DispatchStore) => T): T {
  const store = useContext(DispatchStoreContext);

  if (!store) {
    throw new Error("Dispatch store provider is missing.");
  }

  return useStore(store, selector);
}
