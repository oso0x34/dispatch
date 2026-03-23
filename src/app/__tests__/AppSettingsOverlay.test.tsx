// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { App } from "../App";
import { AppProviders } from "../providers";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function installBackendState() {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "health":
        return {
          status: "ok",
          appName: "Dispatch",
          appVersion: "0.1.0",
          bootedAtUnix: 1_767_300_000,
          logDirectory: "/tmp/dispatch/logs",
          activeLogPath: "/tmp/dispatch/logs/dispatch.log",
          sessionLogsDirectory: "/tmp/dispatch/logs/sessions",
          staleSessionsAbandonedAtBoot: 0,
        };
      case "list_projects":
        return [];
      case "get_setting":
        return {
          key: String(args?.key ?? ""),
          value: null,
          updatedAt: 100,
        };
      case "get_openclaw_status":
        return {
          state: "disconnected",
          gatewayUrl: null,
          connectedAt: null,
          lastError: null,
          protocolVersion: null,
          serverVersion: null,
          tickIntervalMs: null,
          availableMethods: [],
          availableEvents: [],
          helloSnapshot: null,
          statusDetails: null,
          healthDetails: null,
          presenceDetails: null,
          lastEventAt: null,
          lastEventSeq: null,
        };
      default:
        throw new Error(`Unexpected Tauri invoke: ${command}`);
    }
  });
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("App settings overlay", () => {
  it("keeps tab focus inside the visible settings pane controls", async () => {
    installBackendState();
    const user = userEvent.setup();

    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );

    await user.click(await screen.findByRole("button", { name: "Open settings" }));
    const overlay = await screen.findByRole("dialog", { name: "Settings" });
    const connectButton = await screen.findByRole("button", { name: "Connect" });

    connectButton.focus();
    expect(document.activeElement).toBe(connectButton);

    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close Settings" }));
    expect(overlay.contains(document.activeElement)).toBe(true);
  });
});
