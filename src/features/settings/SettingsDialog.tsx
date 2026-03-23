import {
  useMemo,
  useState,
} from "react";

import { useDispatchStore } from "../../app/providers";
import type { HealthResponse } from "../../shared/tauri/health";
import type { BootStatus } from "../../store/uiSlice";
import { AgentRegistryPane } from "./AgentRegistryPane";
import { ConnectionSettings } from "./ConnectionSettings";
import { ProjectsPane } from "./ProjectsPane";
import { SecretsPane } from "./SecretsPane";

type SettingsDialogProps = {
  bootStatus: BootStatus;
  bootError: string | null;
  health: HealthResponse | null;
};

type SettingsPaneId = "connection" | "projects" | "secrets" | "agents" | "about";

const settingsPanes: Array<{
  id: SettingsPaneId;
  label: string;
}> = [
  { id: "connection", label: "Connection" },
  { id: "projects", label: "Projects" },
  { id: "secrets", label: "Secrets" },
  { id: "agents", label: "Agent Registry" },
  { id: "about", label: "About" },
];

function formatBootedAt(bootedAtUnix: number | null | undefined) {
  if (!bootedAtUnix) {
    return "Unavailable";
  }

  return new Date(bootedAtUnix * 1_000).toLocaleString();
}

function renderDiagnosticsValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }

  return String(value);
}

export function SettingsDialog({
  bootStatus,
  bootError,
  health,
}: SettingsDialogProps) {
  const projects = useDispatchStore((state) => state.projects);
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const [activePane, setActivePane] = useState<SettingsPaneId>("connection");
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  return (
    <div
      data-testid="settings-dialog"
      className="grid h-full gap-4 p-3 sm:p-4"
      style={{ gridTemplateColumns: "15rem minmax(0, 1fr)" }}
    >
      <nav
        className="dispatch-surface relative flex flex-col overflow-y-auto rounded-[1.25rem] p-3"
        aria-label="Settings panes"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--surface-elevated) 86%, transparent) 0%, color-mix(in srgb, var(--surface-base) 92%, transparent) 100%)",
          boxShadow: "inset 0 1px 0 color-mix(in srgb, white 6%, transparent)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 top-3 h-24 rounded-2xl opacity-80"
          style={{
            background:
              "radial-gradient(circle at top left, color-mix(in srgb, var(--accent-blue) 22%, transparent) 0%, transparent 62%)",
          }}
        />

        <div className="relative rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-raised)_78%,transparent)] px-3 py-3">
          <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.22em]">
            Settings
          </p>
          <h2
            className="dispatch-heading mt-2 text-sm font-semibold"
            style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
          >
            Control Room
          </h2>
          <p className="dispatch-text-secondary mt-2 text-xs leading-5">
            {bootStatus === "error"
              ? "Boot diagnostics need attention."
              : activeProject?.name
                ? `Scoped to ${activeProject.name}.`
                : "No project is currently active."}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[0.68rem]">
            <span className="dispatch-text-muted rounded-full border border-[var(--surface-border-soft)] px-2 py-1 font-medium uppercase tracking-[0.18em]">
              {bootStatus}
            </span>
            <span className="dispatch-text-tertiary truncate">
              {activeProject?.name ?? "Workspace unassigned"}
            </span>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {settingsPanes.map((pane, index) => {
            const isActive = activePane === pane.id;

            return (
              <button
                key={pane.id}
                type="button"
                className="group block w-full rounded-2xl border px-3 py-2.5 text-left transition"
                data-active={isActive}
                aria-pressed={isActive}
                aria-label={pane.label}
                onClick={() => setActivePane(pane.id)}
                style={{
                  borderColor: isActive
                    ? "color-mix(in srgb, var(--accent-blue) 46%, var(--surface-border-soft))"
                    : "var(--surface-border-soft)",
                  background: isActive
                    ? "linear-gradient(135deg, color-mix(in srgb, var(--accent-blue) 16%, var(--surface-raised)) 0%, color-mix(in srgb, var(--surface-elevated) 88%, transparent) 100%)"
                    : "color-mix(in srgb, var(--surface-base) 68%, transparent)",
                  boxShadow: isActive
                    ? "0 12px 32px color-mix(in srgb, black 22%, transparent)"
                    : "none",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="dispatch-text-primary text-sm font-medium">{pane.label}</p>
                    <p
                      aria-hidden="true"
                      className="dispatch-text-tertiary mt-1 text-[0.68rem] uppercase tracking-[0.18em]"
                    >
                      Panel {String(index + 1).padStart(2, "0")}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-[0.68rem] font-medium uppercase tracking-[0.18em]"
                    style={{
                      color: isActive ? "var(--accent-blue)" : "var(--text-tertiary)",
                    }}
                  >
                    {isActive ? "Open" : "View"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-h-0 min-w-0 overflow-y-auto">
        <div className="mb-3 rounded-[1.25rem] border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_82%,transparent)] px-4 py-3">
          <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.22em]">
            {settingsPanes.find((pane) => pane.id === activePane)?.label ?? "Settings"}
          </p>
          <p className="dispatch-text-secondary mt-1 text-sm leading-6">
            Configuration, workspace scope, and runtime details in one place.
          </p>
        </div>

        <div
          aria-hidden={activePane !== "connection"}
          style={{ display: activePane === "connection" ? "block" : "none" }}
        >
          <ConnectionSettings active={activePane === "connection"} />
        </div>
        <div
          aria-hidden={activePane !== "projects"}
          style={{ display: activePane === "projects" ? "block" : "none" }}
        >
          <ProjectsPane />
        </div>
        <div
          aria-hidden={activePane !== "secrets"}
          style={{ display: activePane === "secrets" ? "block" : "none" }}
        >
          <SecretsPane />
        </div>
        <div
          aria-hidden={activePane !== "agents"}
          style={{ display: activePane === "agents" ? "block" : "none" }}
        >
          <AgentRegistryPane />
        </div>
        <div
          aria-hidden={activePane !== "about"}
          style={{ display: activePane === "about" ? "block" : "none" }}
        >
          <section
            data-testid="settings-about-pane"
            className="dispatch-surface rounded-[1.25rem] p-4 sm:p-5"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--surface-elevated) 88%, transparent) 0%, color-mix(in srgb, var(--surface-base) 94%, transparent) 100%)",
            }}
          >
            <p className="dispatch-text-muted text-[0.66rem] font-semibold uppercase tracking-[0.18em]">
              About
            </p>
            <h3
              className="dispatch-heading mt-2 text-lg font-semibold"
              style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
            >
              Runtime diagnostics
            </h3>
            <p className="dispatch-text-secondary mt-2 text-sm leading-6">
              Values from the Tauri boot path. Log locations and stale-session recovery are visible without opening the filesystem.
            </p>

            {bootError ? (
              <div className="dispatch-alert mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
                {bootError}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_72%,transparent)] px-3 py-3">
                <p className="dispatch-text-secondary text-[0.68rem] font-semibold uppercase tracking-[0.18em]">App version</p>
                <p className="dispatch-text-primary mt-1.5 text-sm">
                  {health ? `${health.appName} ${health.appVersion}` : "Unavailable"}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_72%,transparent)] px-3 py-3">
                <p className="dispatch-text-secondary text-[0.68rem] font-semibold uppercase tracking-[0.18em]">Booted at</p>
                <p className="dispatch-text-primary mt-1.5 text-sm">
                  {formatBootedAt(health?.bootedAtUnix)}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_72%,transparent)] px-3 py-3">
                <p className="dispatch-text-secondary text-[0.68rem] font-semibold uppercase tracking-[0.18em]">Log directory</p>
                <p className="dispatch-text-primary mt-1.5 break-all text-sm">
                  {renderDiagnosticsValue(health?.logDirectory)}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_72%,transparent)] px-3 py-3">
                <p className="dispatch-text-secondary text-[0.68rem] font-semibold uppercase tracking-[0.18em]">Active log file</p>
                <p className="dispatch-text-primary mt-1.5 break-all text-sm">
                  {renderDiagnosticsValue(health?.activeLogPath)}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_72%,transparent)] px-3 py-3">
                <p className="dispatch-text-secondary text-[0.68rem] font-semibold uppercase tracking-[0.18em]">Session logs</p>
                <p className="dispatch-text-primary mt-1.5 break-all text-sm">
                  {renderDiagnosticsValue(health?.sessionLogsDirectory)}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_72%,transparent)] px-3 py-3">
                <p className="dispatch-text-secondary text-[0.68rem] font-semibold uppercase tracking-[0.18em]">Stale sessions at boot</p>
                <p className="dispatch-text-primary mt-1.5 text-sm">
                  {renderDiagnosticsValue(health?.staleSessionsAbandonedAtBoot)}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
