import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import { TabHost } from "./TabHost";
import { useDispatchStore } from "./providers";
import { ErrorBoundary } from "../shared/components/ErrorBoundary";
import { SettingsPlaceholder } from "../features/settings/SettingsPlaceholder";
import { TasksPlaceholder } from "../features/tasks/TasksPlaceholder";
import { fetchHealth } from "../shared/tauri/health";
import { TopBar } from "../shared/components/TopBar";
import { TabBar } from "../shared/components/TabBar";

export function App() {
  const activeOverlay = useDispatchStore((state) => state.activeOverlay);
  const bootStatus = useDispatchStore((state) => state.bootStatus);
  const bootError = useDispatchStore((state) => state.bootError);
  const closeOverlay = useDispatchStore((state) => state.closeOverlay);
  const health = useDispatchStore((state) => state.health);
  const setBootLoading = useDispatchStore((state) => state.setBootLoading);
  const setBootError = useDispatchStore((state) => state.setBootError);
  const setHealth = useDispatchStore((state) => state.setHealth);
  const hasBootstrapped = useRef(false);
  const overlayRef = useRef<HTMLElement | null>(null);
  const overlayCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlayOpenerRef = useRef<HTMLElement | null>(null);
  const overlayWasOpenRef = useRef(false);

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

  useEffect(() => {
    if (!activeOverlay) {
      if (overlayWasOpenRef.current) {
        overlayOpenerRef.current?.focus();
        overlayOpenerRef.current = null;
        overlayWasOpenRef.current = false;
      }

      return;
    }

    if (!overlayWasOpenRef.current) {
      overlayOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      overlayWasOpenRef.current = true;
    }

    const dialog = overlayRef.current;
    const focusTarget = overlayCloseButtonRef.current ?? dialog;
    focusTarget?.focus();

    const getFocusableElements = () => {
      if (!dialog) {
        return [];
      }

      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOverlay();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const isFocusInsideDialog = activeElement ? dialog?.contains(activeElement) : false;

      if (event.shiftKey) {
        if (!isFocusInsideDialog || activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }

        return;
      }

      if (!isFocusInsideDialog || activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeOverlay, closeOverlay]);

  const overlayTitle = activeOverlay === "settings" ? "Settings" : "Tasks";
  const overlayDescription = activeOverlay === "settings"
    ? "The shell keeps settings ephemeral for now, so the panel mounts only while the gear is open."
    : "Tasks stay out of the persistent tab host and mount only while this overlay is visible.";

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-4 sm:px-5 sm:py-5">
        <section className="dispatch-panel flex min-h-[calc(100vh-2rem)] flex-1 flex-col overflow-hidden rounded-[26px]">
          <div className="p-3 sm:p-4">
            <TopBar
              bootStatus={bootStatus}
              bootError={bootError}
              health={health}
            />
          </div>

          <TabBar />

          <main className="flex-1 overflow-auto px-4 py-4 sm:px-5 sm:py-5">
            {bootError ? (
              <div className="dispatch-alert mb-4 rounded-xl px-4 py-3 text-sm">
                {bootError}
              </div>
            ) : null}

            <TabHost />
          </main>
        </section>
      </div>

      {activeOverlay ? (
        <div
          className="fixed inset-0 z-50 bg-black/60 px-4 py-4 backdrop-blur-sm sm:px-5 sm:py-5"
          onClick={closeOverlay}
        >
          <div className="mx-auto flex h-full w-full max-w-[1600px] items-start justify-end">
            <section
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-label={overlayTitle}
              tabIndex={-1}
              className="dispatch-panel flex h-full max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[24px]"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-start justify-between gap-4 border-b border-white/6 px-5 py-4 sm:px-6">
                <div>
                  <p className="dispatch-kicker text-[0.68rem] font-semibold uppercase tracking-[0.24em]">
                    Overlay
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                    {overlayTitle}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">
                    {overlayDescription}
                  </p>
                </div>

                <button
                  ref={overlayCloseButtonRef}
                  type="button"
                  className="dispatch-icon-button flex h-10 w-10 items-center justify-center rounded-xl"
                  aria-label={`Close ${overlayTitle}`}
                  onClick={closeOverlay}
                >
                  <X size={16} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5 sm:py-5">
                <ErrorBoundary>
                  {activeOverlay === "settings" ? (
                    <SettingsPlaceholder
                      bootStatus={bootStatus}
                      bootError={bootError}
                      health={health}
                    />
                  ) : (
                    <TasksPlaceholder />
                  )}
                </ErrorBoundary>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
