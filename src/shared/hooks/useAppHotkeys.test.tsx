// @vitest-environment jsdom

import { StrictMode, useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  beforeEach,
  vi,
} from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const registerMock = vi.hoisted(() => vi.fn());
const unregisterMock = vi.hoisted(() => vi.fn());
const shortcutState = vi.hoisted(() => ({
  handler: null as null | ((event: { shortcut: string; id: number; state: "Pressed" | "Released" }) => void),
}));

let useAppHotkeysImpl: typeof import("./useAppHotkeys").useAppHotkeys;
let globalRevealShortcut = "CommandOrControl+Shift+D";
let AppProvidersImpl: typeof import("../../app/providers").AppProviders;
let useDispatchStoreImpl: typeof import("../../app/providers").useDispatchStore;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

function HotkeysHarness() {
  useAppHotkeysImpl();
  const commandPaletteOpen = useDispatchStoreImpl((state) => state.commandPaletteOpen);

  return (
    <div data-testid="palette-state">
      {commandPaletteOpen ? "open" : "closed"}
    </div>
  );
}

function renderHarness(options?: { strictMode?: boolean }) {
  const strictMode = options?.strictMode ?? false;

  return render(
    strictMode ? (
      <StrictMode>
        <AppProvidersImpl>
          <HotkeysHarness />
        </AppProvidersImpl>
      </StrictMode>
    ) : (
      <AppProvidersImpl>
        <HotkeysHarness />
      </AppProvidersImpl>
    ),
  );
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));

  invokeMock.mockReset();
  registerMock.mockReset();
  unregisterMock.mockReset();
  shortcutState.handler = null;
});

beforeEach(async () => {
  vi.resetModules();

  const providersModule = await import("../../app/providers");
  AppProvidersImpl = providersModule.AppProviders;
  useDispatchStoreImpl = providersModule.useDispatchStore;

  const shortcutModuleUrl = await import.meta.resolve("@tauri-apps/plugin-global-shortcut");
  vi.doMock(shortcutModuleUrl, () => ({
    register: async (_shortcuts: string | string[], handler: typeof shortcutState.handler) => {
      shortcutState.handler = handler ?? null;
      registerMock(_shortcuts, handler);
    },
    unregister: async (shortcuts: string | string[]) => {
      unregisterMock(shortcuts);
    },
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(),
  }));

  const module = await import("./useAppHotkeys");
  useAppHotkeysImpl = module.useAppHotkeys;
  globalRevealShortcut = module.GLOBAL_REVEAL_SHORTCUT;
});

describe("useAppHotkeys", () => {
  it("toggles the command palette with Cmd/Ctrl+K", async () => {
    renderHarness();

    expect(screen.getByTestId("palette-state").textContent).toBe("closed");

    fireEvent.keyDown(window, {
      key: "k",
      metaKey: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("palette-state").textContent).toBe("open");
    });

    fireEvent.keyDown(window, {
      key: "k",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("palette-state").textContent).toBe("closed");
    });
  });

  it("registers the global shortcut once under StrictMode and unregisters once on final unmount", async () => {
    const { unmount } = renderHarness({ strictMode: true });

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledTimes(1);
    });

    expect(registerMock).toHaveBeenCalledWith(globalRevealShortcut, expect.any(Function));

    unmount();

    await waitFor(() => {
      expect(unregisterMock).toHaveBeenCalledTimes(1);
    });
  });

  it("reveals the main window when the registered shortcut is pressed", async () => {
    renderHarness();

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledTimes(1);
    });

    expect(shortcutState.handler).toBeTypeOf("function");

    shortcutState.handler?.({
      shortcut: globalRevealShortcut,
      id: 1,
      state: "Pressed",
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("show_main_window", undefined);
    });
  });
});
