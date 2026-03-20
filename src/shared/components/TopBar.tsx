import {
  Activity,
  AlertTriangle,
  ChevronsUpDown,
  FolderTree,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import type { HealthResponse } from "../tauri/health";
import { useDispatchStore } from "../../app/providers";
import type { BootStatus } from "../../store/uiSlice";

type TopBarProps = {
  bootStatus: BootStatus;
  bootError: string | null;
  health: HealthResponse | null;
};

export function TopBar({ bootStatus, bootError, health }: TopBarProps) {
  const activeOverlay = useDispatchStore((state) => state.activeOverlay);
  const toggleOverlay = useDispatchStore((state) => state.toggleOverlay);
  const statusLabel = bootStatus === "ready"
    ? "Rust runtime ready"
    : bootStatus === "error"
      ? "Tauri bridge unavailable"
      : "Starting Rust runtime";
  const statusDetail = bootError
    ? bootError
    : health
      ? `${health.appName} ${health.appVersion}`
      : "Waiting for health response";

  return (
    <header className="dispatch-panel rounded-[22px] px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <div className="dispatch-brand-mark flex h-11 w-11 items-center justify-center rounded-xl">
              <Activity size={18} />
            </div>

            <div className="min-w-0">
              <p className="dispatch-kicker text-[0.7rem] font-semibold uppercase tracking-[0.24em]">
                Dispatch
              </p>
              <h1 className="mt-1 text-lg font-semibold tracking-tight text-white sm:text-[1.15rem]">
                Desktop command center
              </h1>
            </div>
          </div>

          <button
            type="button"
            aria-disabled="true"
            disabled
            className="dispatch-control flex min-w-[15rem] items-center justify-between gap-3 rounded-xl px-4 py-3 text-left disabled:cursor-default disabled:opacity-75"
          >
            <div className="flex items-center gap-3">
              <FolderTree
                size={16}
                className="text-accent-blue"
              />

              <div className="min-w-0">
                <p className="dispatch-kicker text-[0.66rem] font-semibold uppercase tracking-[0.24em]">
                  Project
                </p>
                <p className="truncate text-sm font-medium text-white">TX Flows</p>
              </div>
            </div>

            <ChevronsUpDown
              size={14}
              className="text-white/45"
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="dispatch-chip inline-flex items-center gap-3 rounded-xl px-4 py-3 text-sm">
            <span
              className="dispatch-status-dot h-2.5 w-2.5 rounded-full"
              data-state={bootStatus}
            />

            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-white">{statusLabel}</span>
              <span className="truncate text-xs text-white/48">{statusDetail}</span>
            </div>

            {bootStatus === "ready" ? (
              <ShieldCheck
                size={16}
                className="text-accent-green"
              />
            ) : bootStatus === "error" ? (
              <AlertTriangle
                size={16}
                className="text-accent-error"
              />
            ) : null}
          </div>

          <button
            type="button"
            className="dispatch-icon-button flex h-11 w-11 items-center justify-center rounded-xl"
            data-active={activeOverlay === "settings"}
            aria-label="Open settings"
            aria-expanded={activeOverlay === "settings"}
            aria-haspopup="dialog"
            onClick={() => toggleOverlay("settings")}
          >
            <Settings2 size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
