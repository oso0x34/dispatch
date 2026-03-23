import type { StateCreator } from "zustand";

export const EXPERIMENTAL_BROWSER_TAB_LABEL = "Browser";
export const EXPERIMENTAL_BROWSER_POLICY_NOTE =
  "Post-v1 only. Preview is limited to http://localhost:* and http://127.0.0.1:*.";

export type BrowserTargetValidation = {
  allowed: boolean;
  normalizedUrl: string | null;
  reason: string | null;
};

export type BrowserSlice = {
  browserEnabled: boolean;
  browserPolicyNote: string;
  browserAddressDraft: string;
  browserCurrentUrl: string | null;
  browserPendingUrl: string | null;
  browserStatus: "idle" | "checking" | "loading" | "ready" | "error";
  browserError: string | null;
  browserHistory: string[];
  browserHistoryIndex: number;
  browserNavigationNonce: number;
  setBrowserEnabled: (enabled: boolean) => void;
  setBrowserAddressDraft: (value: string) => void;
  clearBrowserError: () => void;
  navigateBrowser: (target?: string) => BrowserTargetValidation;
  beginBrowserNavigation: (
    target: string,
    options?: {
      mode?: "new" | "history" | "reload";
      historyIndex?: number | null;
    },
  ) => void;
  completeBrowserNavigation: (target: string) => void;
  failBrowserNavigation: (reason: string) => void;
  validateBrowserTarget: (value: string) => BrowserTargetValidation;
};

type BrowserNavigationMode = "new" | "history" | "reload";

type BrowserNavigationState = {
  pendingMode: BrowserNavigationMode | null;
  pendingHistoryIndex: number | null;
};

function buildRejectedTarget(reason: string): BrowserTargetValidation {
  return {
    allowed: false,
    normalizedUrl: null,
    reason,
  };
}

export function validateExperimentalBrowserTarget(value: string): BrowserTargetValidation {
  const candidate = value.trim();

  if (!candidate) {
    return buildRejectedTarget("Enter a localhost URL.");
  }

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return buildRejectedTarget("Enter a valid http://localhost URL.");
  }

  if (parsed.protocol !== "http:") {
    return buildRejectedTarget("Only http://localhost previews are allowed.");
  }

  if (parsed.username || parsed.password) {
    return buildRejectedTarget("Embedded credentials are not allowed in browser previews.");
  }

  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return buildRejectedTarget("Browser preview is limited to localhost and 127.0.0.1.");
  }

  return {
    allowed: true,
    normalizedUrl: parsed.toString(),
    reason: null,
  };
}

export const createBrowserSlice: StateCreator<BrowserSlice, [], [], BrowserSlice> = (set) => ({
  browserEnabled: false,
  browserPolicyNote: EXPERIMENTAL_BROWSER_POLICY_NOTE,
  browserAddressDraft: "http://localhost:3000",
  browserCurrentUrl: null,
  browserPendingUrl: null,
  browserStatus: "idle",
  browserError: null,
  browserHistory: [],
  browserHistoryIndex: -1,
  browserNavigationNonce: 0,
  pendingMode: null,
  pendingHistoryIndex: null,
  setBrowserEnabled: (enabled) => {
    set({
      browserEnabled: enabled,
    });
  },
  setBrowserAddressDraft: (value) => {
    set({
      browserAddressDraft: value,
    });
  },
  clearBrowserError: () => {
    set((state) => ({
      browserError: null,
      browserStatus: state.browserPendingUrl
        ? "loading"
        : state.browserCurrentUrl
          ? "ready"
          : "idle",
    }));
  },
  navigateBrowser: (target) => {
    const validation = validateExperimentalBrowserTarget(target ?? "");

    if (!validation.allowed) {
      set({
        browserStatus: "error",
        browserError: validation.reason,
      });
      return validation;
    }

    set({
      browserAddressDraft: validation.normalizedUrl ?? target ?? "",
      browserStatus: "checking",
      browserError: null,
    });

    return validation;
  },
  beginBrowserNavigation: (target, options) => {
    set((state) => ({
      browserAddressDraft: target,
      browserPendingUrl: target,
      browserStatus: "loading",
      browserError: null,
      browserNavigationNonce: state.browserNavigationNonce + 1,
      pendingMode: options?.mode ?? "new",
      pendingHistoryIndex: options?.historyIndex ?? null,
    } as Partial<BrowserSlice & BrowserNavigationState>));
  },
  completeBrowserNavigation: (target) => {
    set((state) => {
      const extendedState = state as BrowserSlice & BrowserNavigationState;
      const mode = extendedState.pendingMode ?? "new";
      const pendingHistoryIndex = extendedState.pendingHistoryIndex;
      let nextHistory = state.browserHistory;
      let nextHistoryIndex = state.browserHistoryIndex;

      if (mode === "history" && pendingHistoryIndex !== null) {
        nextHistoryIndex = pendingHistoryIndex;
      } else if (mode === "reload") {
        if (nextHistory.length === 0) {
          nextHistory = [target];
          nextHistoryIndex = 0;
        }
      } else if (state.browserHistory[state.browserHistoryIndex] !== target) {
        nextHistory = state.browserHistory.slice(0, state.browserHistoryIndex + 1);
        nextHistory.push(target);
        nextHistoryIndex = nextHistory.length - 1;
      }

      return {
        browserAddressDraft: target,
        browserCurrentUrl: target,
        browserPendingUrl: null,
        browserStatus: "ready",
        browserError: null,
        browserHistory: nextHistory,
        browserHistoryIndex: nextHistoryIndex,
        pendingMode: null,
        pendingHistoryIndex: null,
      } as Partial<BrowserSlice & BrowserNavigationState>;
    });
  },
  failBrowserNavigation: (reason) => {
    set({
      browserPendingUrl: null,
      browserStatus: "error",
      browserError: reason,
      pendingMode: null,
      pendingHistoryIndex: null,
    } as Partial<BrowserSlice & BrowserNavigationState>);
  },
  validateBrowserTarget: (value) => validateExperimentalBrowserTarget(value),
} as BrowserSlice & BrowserNavigationState);
