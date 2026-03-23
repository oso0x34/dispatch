// @vitest-environment jsdom

import { useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AppProviders, useDispatchStore } from "../../../app/providers";
import { BrowserTab } from "../BrowserTab";

const fetchMock = vi.hoisted(() => vi.fn());

function BrowserHarness({ enabled = true }: { enabled?: boolean }) {
  const setBrowserEnabled = useDispatchStore((state) => state.setBrowserEnabled);

  useEffect(() => {
    setBrowserEnabled(enabled);
  }, [enabled, setBrowserEnabled]);

  return <BrowserTab />;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderBrowserTab(enabled = true) {
  const user = userEvent.setup();

  render(
    <AppProviders>
      <BrowserHarness enabled={enabled} />
    </AppProviders>,
  );

  return { user };
}

describe("BrowserTab", () => {
  it("shows the enabled browser surface and loads an allowed localhost preview", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
    });

    const { user } = renderBrowserTab();

    expect(await screen.findByText("Experimental localhost preview")).toBeTruthy();
    const addressInput = (await screen.findByLabelText("Browser preview URL")) as HTMLInputElement;
    expect(addressInput.value).toBe("http://localhost:3000");

    await user.click(screen.getByRole("button", { name: "Load preview" }));

    const preview = screen.getByTitle("Localhost browser preview");
    fireEvent.load(preview);

    expect(preview).toBeTruthy();
    expect(preview.getAttribute("src")).toBe("http://localhost:3000/");
  });

  it("rejects blocked targets with clear feedback and keeps the iframe empty", async () => {
    const { user } = renderBrowserTab();

    const addressInput = (await screen.findByLabelText("Browser preview URL")) as HTMLInputElement;

    await user.clear(addressInput);
    await user.type(addressInput, "http://example.com");
    await user.click(screen.getByRole("button", { name: "Load preview" }));

    expect(screen.getByText("Browser preview is limited to localhost and 127.0.0.1.")).toBeTruthy();
    expect(screen.queryByTitle("Localhost browser preview")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports when the localhost target is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { user } = renderBrowserTab();

    const addressInput = (await screen.findByLabelText("Browser preview URL")) as HTMLInputElement;

    await user.clear(addressInput);
    await user.type(addressInput, "http://localhost:4173");
    await user.click(screen.getByRole("button", { name: "Load preview" }));

    expect(await screen.findByText("Dispatch could not reach that localhost app. Make sure it is running and accepting connections.")).toBeTruthy();
    expect(screen.queryByTitle("Localhost browser preview")).toBeNull();
  });

  it("tracks local preview history through the address bar controls", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const { user } = renderBrowserTab();
    const addressInput = (await screen.findByLabelText("Browser preview URL")) as HTMLInputElement;

    await user.click(screen.getByRole("button", { name: "Load preview" }));
    fireEvent.load(screen.getByTitle("Localhost browser preview"));
    expect(screen.getByTitle("Localhost browser preview").getAttribute("src")).toBe("http://localhost:3000/");

    await user.clear(addressInput);
    await user.type(addressInput, "http://localhost:4173");
    await user.click(screen.getByRole("button", { name: "Load preview" }));

    fireEvent.load(screen.getByTitle("Localhost browser preview"));
    expect(screen.getByTitle("Localhost browser preview").getAttribute("src")).toBe("http://localhost:4173/");

    await user.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.load(screen.getByTitle("Localhost browser preview"));
    expect(screen.getByTitle("Localhost browser preview").getAttribute("src")).toBe("http://localhost:3000/");

    await user.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.load(screen.getByTitle("Localhost browser preview"));
    expect(screen.getByTitle("Localhost browser preview").getAttribute("src")).toBe("http://localhost:4173/");
  });
});
