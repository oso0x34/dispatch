import {
  describe,
  expect,
  it,
} from "vitest";

import { createDispatchStore } from "../../../store";
import {
  EXPERIMENTAL_BROWSER_POLICY_NOTE,
  validateExperimentalBrowserTarget,
} from "./browserSlice";

describe("browserSlice", () => {
  it("keeps the experimental browser disabled by default", () => {
    const store = createDispatchStore();

    expect(store.getState().browserEnabled).toBe(false);
    expect(store.getState().browserPolicyNote).toBe(EXPERIMENTAL_BROWSER_POLICY_NOTE);
  });

  it("allows localhost and loopback http preview targets", () => {
    expect(validateExperimentalBrowserTarget("http://localhost:4173")).toEqual({
      allowed: true,
      normalizedUrl: "http://localhost:4173/",
      reason: null,
    });

    expect(validateExperimentalBrowserTarget("http://127.0.0.1:3000/health")).toEqual({
      allowed: true,
      normalizedUrl: "http://127.0.0.1:3000/health",
      reason: null,
    });
  });

  it("keeps browser navigation pending until the localhost target is confirmed reachable", () => {
    const store = createDispatchStore();
    const validation = store.getState().navigateBrowser("http://localhost:4173");

    expect(validation).toEqual({
      allowed: true,
      normalizedUrl: "http://localhost:4173/",
      reason: null,
    });
    expect(store.getState().browserStatus).toBe("checking");
    expect(store.getState().browserCurrentUrl).toBeNull();
    expect(store.getState().browserPendingUrl).toBeNull();

    store.getState().beginBrowserNavigation(validation.normalizedUrl ?? "");

    expect(store.getState().browserStatus).toBe("loading");
    expect(store.getState().browserPendingUrl).toBe("http://localhost:4173/");

    store.getState().completeBrowserNavigation(validation.normalizedUrl ?? "");

    expect(store.getState().browserStatus).toBe("ready");
    expect(store.getState().browserCurrentUrl).toBe("http://localhost:4173/");
    expect(store.getState().browserHistory).toEqual(["http://localhost:4173/"]);
    expect(store.getState().browserHistoryIndex).toBe(0);

    store.getState().failBrowserNavigation("target down");

    expect(store.getState().browserStatus).toBe("error");
    expect(store.getState().browserError).toBe("target down");
    expect(store.getState().browserPendingUrl).toBeNull();
  });

  it("tracks local browser history for new, history, and reload navigations", () => {
    const store = createDispatchStore();

    const first = store.getState().navigateBrowser("http://localhost:3000");
    store.getState().beginBrowserNavigation(first.normalizedUrl ?? "");
    store.getState().completeBrowserNavigation(first.normalizedUrl ?? "");

    const second = store.getState().navigateBrowser("http://localhost:4173");
    store.getState().beginBrowserNavigation(second.normalizedUrl ?? "");
    store.getState().completeBrowserNavigation(second.normalizedUrl ?? "");

    expect(store.getState().browserHistory).toEqual([
      "http://localhost:3000/",
      "http://localhost:4173/",
    ]);
    expect(store.getState().browserHistoryIndex).toBe(1);

    store.getState().beginBrowserNavigation("http://localhost:3000/", {
      mode: "history",
      historyIndex: 0,
    });
    store.getState().completeBrowserNavigation("http://localhost:3000/");

    expect(store.getState().browserHistory).toEqual([
      "http://localhost:3000/",
      "http://localhost:4173/",
    ]);
    expect(store.getState().browserHistoryIndex).toBe(0);

    store.getState().beginBrowserNavigation("http://localhost:3000/", {
      mode: "reload",
    });
    store.getState().completeBrowserNavigation("http://localhost:3000/");

    expect(store.getState().browserHistory).toEqual([
      "http://localhost:3000/",
      "http://localhost:4173/",
    ]);
    expect(store.getState().browserHistoryIndex).toBe(0);
  });

  it("rejects non-http, external, and malformed targets", () => {
    expect(validateExperimentalBrowserTarget("https://localhost:4173")).toEqual({
      allowed: false,
      normalizedUrl: null,
      reason: "Only http://localhost previews are allowed.",
    });

    expect(validateExperimentalBrowserTarget("http://example.com")).toEqual({
      allowed: false,
      normalizedUrl: null,
      reason: "Browser preview is limited to localhost and 127.0.0.1.",
    });

    expect(validateExperimentalBrowserTarget("not-a-url")).toEqual({
      allowed: false,
      normalizedUrl: null,
      reason: "Enter a valid http://localhost URL.",
    });

    expect(validateExperimentalBrowserTarget("http://user:pass@localhost:4173")).toEqual({
      allowed: false,
      normalizedUrl: null,
      reason: "Embedded credentials are not allowed in browser previews.",
    });
  });
});
