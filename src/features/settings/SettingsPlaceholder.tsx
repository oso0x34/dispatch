import type { HealthResponse } from "../../shared/tauri/health";
import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";
import type { BootStatus } from "../../store/uiSlice";

type SettingsPlaceholderProps = {
  bootStatus: BootStatus;
  bootError: string | null;
  health: HealthResponse | null;
};

const settingsSections = [
  {
    title: "OpenClaw connection",
    description: "Gateway, auth, and connection health land here once the optional orchestrator path is wired.",
  },
  {
    title: "Projects",
    description: "Registered project roots and the active project switcher become persistent in the next shell-adjacent tickets.",
  },
  {
    title: "Terminal",
    description: "Font, shell path, and PTY preferences stay Rust-owned but surface through this panel later on.",
  },
  {
    title: "Notifications",
    description: "Desktop notification preferences and per-event toggles remain deferred until the system integration lane.",
  },
] as const;

export function SettingsPlaceholder({
  bootStatus,
  bootError,
  health,
}: SettingsPlaceholderProps) {
  const runtimeCopy = bootError
    ? bootError
    : health
      ? `${health.appName} ${health.appVersion}`
      : "Waiting for the initial health response.";

  return (
    <div className="space-y-4">
      <PlaceholderSurface
        eyebrow="Settings"
        title="System controls stay close to the shell, but they do not persist in memory while closed."
        description="This placeholder establishes the right overlay behavior now so the real settings panes can mount cleanly later without joining the lazy tab host."
      />

      <section className="dispatch-surface rounded-[20px] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="dispatch-kicker text-[0.66rem] font-semibold uppercase tracking-[0.24em]">
              Runtime
            </p>
            <h3 className="dispatch-heading mt-2 text-base font-semibold">Shell health</h3>
          </div>

          <span className="dispatch-chip dispatch-text-strong rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-[0.2em]">
            {bootStatus}
          </span>
        </div>

        <p className="dispatch-text-secondary mt-3 text-sm leading-6">{runtimeCopy}</p>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        {settingsSections.map((section) => (
          <section
            key={section.title}
            className="dispatch-surface rounded-[20px] p-4"
          >
            <h3 className="dispatch-heading text-sm font-semibold">{section.title}</h3>
            <p className="dispatch-text-secondary mt-2 text-sm leading-6">
              {section.description}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
