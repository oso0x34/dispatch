import { useEffect, useRef } from "react";

import { TabHost } from "./TabHost";
import { useDispatchStore } from "./providers";
import { fetchHealth } from "../shared/tauri/health";
import { TopBar } from "../shared/components/TopBar";
import { TabBar } from "../shared/components/TabBar";

export function App() {
  const bootStatus = useDispatchStore((state) => state.bootStatus);
  const bootError = useDispatchStore((state) => state.bootError);
  const health = useDispatchStore((state) => state.health);
  const setBootLoading = useDispatchStore((state) => state.setBootLoading);
  const setBootError = useDispatchStore((state) => state.setBootError);
  const setHealth = useDispatchStore((state) => state.setHealth);
  const hasBootstrapped = useRef(false);

  useEffect(() => {
    if (hasBootstrapped.current) {
      return;
    }

    hasBootstrapped.current = true;
    setBootLoading();

    void fetchHealth()
      .then((payload) => {
        setHealth(payload);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown Tauri boot error.";
        setBootError(message);
      });
  }, [setBootError, setBootLoading, setHealth]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5 sm:px-6 sm:py-6">
        <TopBar
          bootStatus={bootStatus}
          bootError={bootError}
          health={health}
        />

        <section className="dispatch-panel mt-4 flex flex-1 flex-col overflow-hidden rounded-[28px]">
          <TabBar />

          <main className="flex-1 overflow-auto px-5 py-6 sm:px-6">
            {bootError ? (
              <div className="dispatch-alert mb-5 rounded-2xl px-4 py-3 text-sm">
                {bootError}
              </div>
            ) : null}

            <TabHost />
          </main>
        </section>
      </div>
    </div>
  );
}
