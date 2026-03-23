// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { DispatchModal } from "../DispatchModal";
import type { OpenClawConnectionStatusRecord } from "../../../shared/lib/tauri";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const registryEntries = [
  {
    id: "auto",
    name: "Auto",
    selectionMode: "auto",
  },
  {
    id: "codex",
    name: "Codex",
    selectionMode: "profile",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    selectionMode: "profile",
  },
];

function renderDispatchModal(overrides?: Partial<ComponentProps<typeof DispatchModal>>) {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onDispatch = vi.fn().mockResolvedValue(undefined);

  render(
    <DispatchModal
      open
      projectId="project-alpha"
      projectName="Dispatch Workspace"
      openClawStatus={null}
      isSubmitting={false}
      onClose={onClose}
      onDispatch={onDispatch}
      {...overrides}
    />,
  );

  return {
    user,
    onClose,
    onDispatch,
  };
}

function connectedOpenClawStatus(): OpenClawConnectionStatusRecord {
  return {
    state: "connected",
    gatewayUrl: "ws://127.0.0.1:7331",
    connectedAt: 1_763_372_400,
    lastError: null,
    protocolVersion: 3,
    serverVersion: "mock-gateway",
    tickIntervalMs: 250,
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

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe("DispatchModal", () => {
  it("loads registry entries, defaults to Auto, and dispatches locally with the selected profile", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_agent_registry_entries") {
        return registryEntries;
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const { user, onClose, onDispatch } = renderDispatchModal();

    const agentSelect = await screen.findByLabelText("Agent");
    const promptField = screen.getByLabelText("Prompt (optional)");

    expect((agentSelect as HTMLSelectElement).value).toBe("auto");

    await user.selectOptions(agentSelect, "codex");
    await user.type(promptField, "Continue from DISPATCH-019.");
    await user.click(screen.getByRole("button", { name: "Open in Terminal" }));

    await waitFor(() => {
      expect(onDispatch).toHaveBeenCalledWith({
        profileId: "codex",
        prompt: "Continue from DISPATCH-019.",
        route: "local",
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("enables VICAM dispatch only when OpenClaw is connected and Auto stays selected", async () => {
    invokeMock.mockResolvedValue(registryEntries);

    const { user, onDispatch } = renderDispatchModal({
      openClawStatus: connectedOpenClawStatus(),
    });

    await screen.findByLabelText("Agent");
    const vicamButton = screen.getByRole("button", { name: "Dispatch via VICAM orchestration" });
    expect(vicamButton.hasAttribute("disabled")).toBe(false);

    await user.type(screen.getByLabelText("Prompt (optional)"), "Route through OpenClaw.");
    await user.click(vicamButton);

    await waitFor(() => {
      expect(onDispatch).toHaveBeenCalledWith({
        profileId: "auto",
        prompt: "Route through OpenClaw.",
        route: "vicam",
      });
    });
  });

  it("surfaces a validation error when no project is selected", async () => {
    invokeMock.mockResolvedValue(registryEntries);

    const { user, onDispatch, onClose } = renderDispatchModal({
      projectId: null,
      projectName: null,
    });

    await screen.findByLabelText("Agent");
    await user.click(screen.getByRole("button", { name: "Open in Terminal" }));

    expect(onDispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Select a project before dispatching.",
    );
  });
});
