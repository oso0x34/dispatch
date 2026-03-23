// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { FilePreview } from "../FilePreview";
import type { ProjectFilePreviewRecord } from "../../../shared/lib/tauri";

const openPathMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: openPathMock,
}));

function buildPreview(overrides?: Partial<ProjectFilePreviewRecord>): ProjectFilePreviewRecord {
  return {
    path: "README.md",
    absolutePath: "/tmp/dispatch/README.md",
    name: "README.md",
    format: "markdown",
    content: "# Dispatch\n\nPreview body",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  openPathMock.mockReset();
});

describe("FilePreview", () => {
  it("opens the selected file through the opener plugin", async () => {
    openPathMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <FilePreview
        previewStatus="ready"
        previewError={null}
        filePreview={buildPreview()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open in editor" }));

    await waitFor(() => {
      expect(openPathMock).toHaveBeenCalledWith("/tmp/dispatch/README.md");
    });
  });

  it("surfaces opener failures without dropping the preview", async () => {
    openPathMock.mockRejectedValue(new Error("opener unavailable"));
    const user = userEvent.setup();

    render(
      <FilePreview
        previewStatus="ready"
        previewError={null}
        filePreview={buildPreview({
          path: "docs/guide.md",
          absolutePath: "/tmp/dispatch/docs/guide.md",
          name: "guide.md",
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open in editor" }));

    await waitFor(() => {
      expect(screen.getByText("opener unavailable")).toBeTruthy();
    });
    expect(screen.getByText("guide.md")).toBeTruthy();
  });
});
