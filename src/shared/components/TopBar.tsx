import {
  Activity,
  Command,
  Settings2,
} from "lucide-react";

import { useDispatchStore } from "../../app/providers";
import { ProjectSwitcher } from "../../features/projects/ProjectSwitcher";
import { tabDefinitions } from "../../store/uiSlice";
import { appHotkeys } from "../hooks/useAppHotkeys";

export function TopBar() {
  const activeOverlay = useDispatchStore((state) => state.activeOverlay);
  const activeTab = useDispatchStore((state) => state.activeTab);
  const browserEnabled = useDispatchStore((state) => state.browserEnabled);
  const commandPaletteOpen = useDispatchStore((state) => state.commandPaletteOpen);
  const setActiveTab = useDispatchStore((state) => state.setActiveTab);
  const toggleOverlay = useDispatchStore((state) => state.toggleOverlay);
  const toggleCommandPalette = useDispatchStore((state) => state.toggleCommandPalette);

  return (
    <header className="dispatch-shell-bar">
      <div className="flex min-h-[50px] items-center gap-4 px-3 py-2.5">
        <div className="dispatch-shell-brand flex min-w-0 items-center gap-2.5 pr-1">
          <div className="dispatch-brand-mark flex h-[18px] w-[18px] items-center justify-center rounded-md">
            <Activity size={11} />
          </div>
          <div className="dispatch-shell-brand-copy min-w-0">
            <p className="dispatch-text-primary truncate text-[0.58rem] font-semibold uppercase tracking-[0.24em] leading-[1.08]">
              Dispatch
            </p>
            <p className="dispatch-text-subtle truncate text-[0.56rem] uppercase tracking-[0.16em] leading-[1.12]">
              Workspace
            </p>
          </div>
        </div>

        <ProjectSwitcher />

        <nav
          className="dispatch-shell-tabs min-w-0 flex-1"
          aria-label="Primary navigation"
        >
          {tabDefinitions.map((tab) => {
            const isBrowserTab = tab.id === "browser";
            const isDisabled = isBrowserTab && !browserEnabled;

            return (
              <button
                key={tab.id}
                type="button"
                className="dispatch-shell-tab"
                data-active={activeTab === tab.id}
                data-disabled={isDisabled ? "true" : undefined}
                disabled={isDisabled}
                title={isDisabled ? "Browser preview unavailable in this runtime" : tab.label}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
              >
                <span className="truncate">{tab.label}</span>

                {isDisabled ? (
                  <span className="dispatch-shell-tab-pill">
                    Preview
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="dispatch-icon-button flex h-[26px] w-[26px] items-center justify-center rounded-md"
            data-active={commandPaletteOpen}
            aria-label="Open command palette"
            aria-expanded={commandPaletteOpen}
            aria-haspopup="dialog"
            title={`Command palette (${appHotkeys.commandPaletteShortcut})`}
            onClick={toggleCommandPalette}
          >
            <Command size={13} />
          </button>

          <button
            type="button"
            className="dispatch-icon-button flex h-[26px] w-[26px] items-center justify-center rounded-md"
            data-active={activeOverlay === "settings"}
            aria-label="Open settings"
            aria-expanded={activeOverlay === "settings"}
            aria-haspopup="dialog"
            onClick={() => toggleOverlay("settings")}
          >
            <Settings2 size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}
