import {
  Activity,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

import type { HealthResponse } from "../tauri/health";
import type { BootStatus } from "../../store/uiSlice";

type TopBarProps = {
  bootStatus: BootStatus;
  bootError: string | null;
  health: HealthResponse | null;
};

export function TopBar({ bootStatus, bootError, health }: TopBarProps) {
  const statusLabel = health
    ? `${health.appName} ${health.appVersion}`
    : bootStatus === "error"
      ? "Tauri bridge unavailable"
      : "Starting Rust runtime";

  return (
    <header className="dispatch-panel rounded-[28px] px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <div className="dispatch-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]">
            <Activity size={14} />
            Dispatch
          </div>

          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.75rem]">
              Desktop command center scaffold
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/65 sm:text-[0.96rem]">
              React, Zustand, Tauri, and the Rust invoke boundary are wired
              together with the canonical repo structure from the roadmap.
            </p>
          </div>
        </div>

        <div className="dispatch-chip inline-flex items-center gap-3 self-start rounded-2xl px-4 py-3 text-sm">
          <span
            className="dispatch-status-dot h-2.5 w-2.5 rounded-full"
            data-state={bootStatus}
          />

          <div className="flex flex-col">
            <span className="font-medium text-white">{statusLabel}</span>
            <span className="text-xs text-white/55">
              {bootError ? bootError : health ? "Health command reachable" : "Waiting for health response"}
            </span>
          </div>

          {bootStatus === "ready" ? (
            <ShieldCheck
              size={16}
              className="text-emerald-300"
            />
          ) : bootStatus === "error" ? (
            <AlertTriangle
              size={16}
              className="text-rose-300"
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
