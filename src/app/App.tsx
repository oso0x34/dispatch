import {
  Suspense,
  lazy,
  useEffect,
  useRef,
} from "react";
import { X } from "lucide-react";

import { TabHost } from "./TabHost";
import { useDispatchStore } from "./providers";
import { ErrorBoundary } from "../shared/components/ErrorBoundary";
import { fetchHealth } from "../shared/tauri/health";
import { CommandPalette } from "../shared/components/CommandPalette";
import { TopBar } from "../shared/components/TopBar";
import { useAppHotkeys } from "../shared/hooks/useAppHotkeys";


const SettingsDialog = lazy(async () => {
  const module = await import("../features/settings/SettingsDialog");
  return { default: module.SettingsDialog };
});

function OverlayFallback() {
  return (
    <div className="dispatch-text-secondary p-4 text-sm">
      Loading settings...
    </div>
  );
}

export function App() {
  const activeOverlay = useDispatchStore((state) => state.activeOverlay);
  const bootStatus = useDispatchStore((state) => state.bootStatus);
  const bootError = useDispatchStore((state) => state.bootError);
  const closeOverlay = useDispatchStore((state) => state.closeOverlay);
  const health = useDispatchStore((state) => state.health);
  const setBootLoading = useDispatchStore((state) => state.setBootLoading);
  const setBootError = useDispatchStore((state) => state.setBootError);
  const setHealth = useDispatchStore((state) => state.setHealth);
  const setBrowserEnabled = useDispatchStore((state) => state.setBrowserEnabled);
  const hasBootstrapped = useRef(false);
  const overlayRef = useRef<HTMLElement | null>(null);
  const overlayCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlayOpenerRef = useRef<HTMLElement | null>(null);
  const overlayWasOpenRef = useRef(false);
  useAppHotkeys();

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
    setBrowserEnabled(true);
  }, [setBrowserEnabled]);

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
      ).filter((element) => {
        if (element.hasAttribute("disabled")) {
          return false;
        }

        if (element.closest('[aria-hidden="true"]')) {
          return false;
        }

        const computedStyle = window.getComputedStyle(element);
        return computedStyle.display !== "none"
          && computedStyle.visibility !== "hidden";
      });
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--app-bg)]">
      <TopBar />

      <main className="flex-1 overflow-hidden">
        {bootError ? (
          <div className="dispatch-alert px-3 py-1.5 text-[0.75rem]">
            {bootError}
          </div>
        ) : null}

        <TabHost />
      </main>

      {activeOverlay ? (
        <div
          className="dispatch-overlay-backdrop fixed inset-0 z-50 px-3 py-3 backdrop-blur-sm"
          onClick={closeOverlay}
        >
          <div className="mx-auto flex h-full w-full max-w-[1600px] items-start justify-end">
            <section
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
              tabIndex={-1}
              className="dispatch-panel flex h-full max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="dispatch-divider flex items-center justify-between border-b px-4 py-2.5">
                <h2 className="dispatch-heading text-sm font-semibold">
                  Settings
                </h2>

                <button
                  ref={overlayCloseButtonRef}
                  type="button"
                  className="dispatch-icon-button flex h-7 w-7 items-center justify-center rounded-md"
                  aria-label="Close Settings"
                  onClick={closeOverlay}
                >
                  <X size={14} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
                <ErrorBoundary surfaceName="Settings overlay">
                  <Suspense fallback={<OverlayFallback />}>
                    <SettingsDialog
                      bootStatus={bootStatus}
                      bootError={bootError}
                      health={health}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      <CommandPalette />
    </div>
  );
}
