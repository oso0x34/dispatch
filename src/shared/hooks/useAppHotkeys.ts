import { useEffect } from "react";
import {
  register as registerGlobalShortcut,
  unregister as unregisterGlobalShortcut,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";

import { useDispatchStore } from "../../app/providers";
import { showMainWindow } from "../lib/tauri";

const COMMAND_PALETTE_SHORTCUT = "CommandOrControl+K";
export const GLOBAL_REVEAL_SHORTCUT = "CommandOrControl+Shift+D";
const REVEAL_SHORTCUT_CLEANUP_DELAY_MS = 10;

let revealShortcutRefCount = 0;
let revealShortcutCleanupTimer: number | null = null;
let revealShortcutRegistered = false;
let revealShortcutRegistration: Promise<void> | null = null;
let revealShortcutHandler: (() => void | Promise<void>) | null = null;
let revealShortcutLeaseActive = false;

function isToggleCommandPaletteEvent(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey)
    && !event.altKey
    && !event.shiftKey
    && event.key.toLowerCase() === "k";
}

async function ensureRevealShortcutRegistered() {
  if (revealShortcutLeaseActive) {
    if (revealShortcutRegistration) {
      await revealShortcutRegistration;
    }

    return;
  }

  revealShortcutLeaseActive = true;

  if (!revealShortcutRegistration) {
    revealShortcutRegistration = registerGlobalShortcut(
      GLOBAL_REVEAL_SHORTCUT,
      (event: ShortcutEvent) => {
        if (event.state !== "Pressed") {
          return;
        }

        void revealShortcutHandler?.();
      },
    )
      .then(() => {
        revealShortcutRegistered = true;
      })
      .catch((error) => {
        revealShortcutLeaseActive = false;
        throw error;
      })
      .finally(() => {
        revealShortcutRegistration = null;
      });
  }

  await revealShortcutRegistration;
}

function scheduleRevealShortcutCleanup() {
  if (typeof window === "undefined") {
    return;
  }

  if (revealShortcutCleanupTimer !== null) {
    window.clearTimeout(revealShortcutCleanupTimer);
  }

  revealShortcutCleanupTimer = window.setTimeout(() => {
    revealShortcutCleanupTimer = null;

    void (async () => {
      if (revealShortcutRefCount > 0) {
        return;
      }

      if (revealShortcutRegistration) {
        try {
          await revealShortcutRegistration;
        } catch {
          revealShortcutRegistered = false;
          revealShortcutLeaseActive = false;
          return;
        }
      }

      if (revealShortcutRefCount > 0 || !revealShortcutRegistered) {
        revealShortcutLeaseActive = false;
        return;
      }

      try {
        await unregisterGlobalShortcut(GLOBAL_REVEAL_SHORTCUT);
      } finally {
        revealShortcutRegistered = false;
        revealShortcutLeaseActive = false;
      }
    })();
  }, REVEAL_SHORTCUT_CLEANUP_DELAY_MS);
}

export function useAppHotkeys() {
  const toggleCommandPalette = useDispatchStore((state) => state.toggleCommandPalette);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (!isToggleCommandPaletteEvent(event)) {
        return;
      }

      event.preventDefault();
      toggleCommandPalette();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleCommandPalette]);

  useEffect(() => {
    revealShortcutHandler = async () => {
      await showMainWindow();
    };
    revealShortcutRefCount += 1;

    if (revealShortcutCleanupTimer !== null) {
      window.clearTimeout(revealShortcutCleanupTimer);
      revealShortcutCleanupTimer = null;
    }

    void ensureRevealShortcutRegistered().catch(() => {
      revealShortcutRegistered = false;
    });

    return () => {
      revealShortcutRefCount = Math.max(0, revealShortcutRefCount - 1);

      if (revealShortcutRefCount === 0) {
        revealShortcutHandler = null;
        scheduleRevealShortcutCleanup();
      }
    };
  }, []);
}

export const appHotkeys = {
  commandPaletteShortcut: COMMAND_PALETTE_SHORTCUT,
  globalRevealShortcut: GLOBAL_REVEAL_SHORTCUT,
};
