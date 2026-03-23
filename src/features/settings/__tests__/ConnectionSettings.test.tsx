// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ConnectionSettings } from "../ConnectionSettings";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function buildStatus(state: "connected" | "disconnected") {
  return {
    state,
    gatewayUrl: state === "connected" ? "ws://127.0.0.1:7331" : null,
    connectedAt: state === "connected" ? 1_767_300_000 : null,
    lastError: null,
    protocolVersion: state === "connected" ? 3 : null,
    serverVersion: state === "connected" ? "mock-gateway" : null,
    tickIntervalMs: state === "connected" ? 250 : null,
    availableMethods: [],
    availableEvents: [],
    helloSnapshot: null,
    statusDetails: null,
    healthDetails: null,
    presenceDetails: null,
    lastEventAt: null,
    lastEventSeq: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  vi.useRealTimers();
});

describe("ConnectionSettings", () => {
  it("clears a transient polling error after a successful status refresh", async () => {
    const statusResponses: Array<ReturnType<typeof buildStatus> | Error> = [
      buildStatus("disconnected"),
      new Error("gateway temporarily unavailable"),
      buildStatus("connected"),
    ];

    invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "get_setting":
          return null;
        case "get_openclaw_status": {
          const next = statusResponses.shift();

          if (next instanceof Error) {
            throw next;
          }

          return next ?? buildStatus("connected");
        }
        case "set_setting":
          return {
            key: String(args?.key ?? ""),
            value: args?.value ?? null,
            updatedAt: 101,
          };
        default:
          throw new Error(`Unexpected Tauri invoke: ${command}`);
      }
    });

    render(<ConnectionSettings />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Disconnected")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(screen.getByRole("alert").textContent).toContain("gateway temporarily unavailable");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Connected")).toBeTruthy();
  });
});
