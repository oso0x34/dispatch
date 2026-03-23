import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  LoaderCircle,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";

import {
  deleteAgentProfile,
  listAgentProfiles,
  saveAgentProfile,
  type AgentArgRecord,
  type AgentEnvValueRecord,
  type AgentProfileRecord,
} from "../../shared/lib/tauri";

type RegistryStatus = "idle" | "loading" | "ready" | "error";
type RegistryAction = "idle" | "saving" | "deleting";
type AgentArgKind = AgentArgRecord["kind"];
type AgentEnvKind = AgentEnvValueRecord["kind"];

type AgentArgDraft = {
  kind: AgentArgKind;
  value: string;
};

type AgentEnvDraft = {
  envKey: string;
  sourceKind: AgentEnvKind;
  sourceValue: string;
};

type AgentProfileDraft = {
  id: string;
  name: string;
  program: string;
  args: AgentArgDraft[];
  env: AgentEnvDraft[];
};

const argOptions: Array<{
  value: AgentArgKind;
  label: string;
  needsValue: boolean;
}> = [
  { value: "literal", label: "Literal", needsValue: true },
  { value: "prompt", label: "Prompt", needsValue: false },
  { value: "optional_prompt", label: "Optional prompt", needsValue: false },
  { value: "project_path", label: "Project path", needsValue: false },
  { value: "task_title", label: "Task title", needsValue: false },
  { value: "task_body", label: "Task body", needsValue: false },
];

const envSourceOptions: Array<{
  value: AgentEnvKind;
  label: string;
  valueLabel: string;
}> = [
  { value: "inherit", label: "Inherit", valueLabel: "Source env key" },
  { value: "secret", label: "Secret", valueLabel: "Secret key" },
  { value: "literal", label: "Literal", valueLabel: "Literal value" },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Agent registry failed to load.";
}

function createEmptyDraft(): AgentProfileDraft {
  return {
    id: "",
    name: "",
    program: "codex",
    args: [
      {
        kind: "prompt",
        value: "",
      },
    ],
    env: [],
  };
}

function buildArgDraft(argument: AgentArgRecord): AgentArgDraft {
  return argument.kind === "literal"
    ? {
      kind: "literal",
      value: argument.value,
    }
    : {
      kind: argument.kind,
      value: "",
    };
}

function buildEnvDrafts(env: Record<string, AgentEnvValueRecord>): AgentEnvDraft[] {
  return Object.entries(env)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([envKey, value]) => ({
      envKey,
      sourceKind: value.kind,
      sourceValue: value.kind === "literal" ? value.value : value.key,
    }));
}

function buildDraft(profile: AgentProfileRecord): AgentProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    program: profile.program,
    args: profile.args.length > 0
      ? profile.args.map((argument) => buildArgDraft(argument))
      : createEmptyDraft().args,
    env: buildEnvDrafts(profile.env),
  };
}

function serializeArgs(args: AgentArgDraft[]): AgentArgRecord[] {
  return args.map((argument) => {
    if (argument.kind === "literal") {
      return {
        kind: "literal",
        value: argument.value,
      };
    }

    return {
      kind: argument.kind,
    };
  });
}

function serializeEnv(envRows: AgentEnvDraft[]) {
  return envRows.reduce<Record<string, AgentEnvValueRecord>>((env, row) => {
    const envKey = row.envKey.trim();
    const sourceValue = row.sourceValue.trim();

    if (row.sourceKind === "literal") {
      env[envKey] = {
        kind: "literal",
        value: sourceValue,
      };
      return env;
    }

    env[envKey] = {
      kind: row.sourceKind,
      key: sourceValue,
    };
    return env;
  }, {});
}

function describeArgs(profile: AgentProfileRecord) {
  if (profile.args.length === 0) {
    return "No args";
  }

  return profile.args
    .map((argument) => {
      if (argument.kind === "literal") {
        return argument.value;
      }

      return `{${argument.kind}}`;
    })
    .join(" ");
}

function describeEnv(profile: AgentProfileRecord) {
  return Object.keys(profile.env).length;
}

export function AgentRegistryPane() {
  const [status, setStatus] = useState<RegistryStatus>("idle");
  const [action, setAction] = useState<RegistryAction>("idle");
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentProfileDraft>(() => createEmptyDraft());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const loadProfiles = async (preferredProfileId?: string | null) => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const nextProfiles = await listAgentProfiles();
      const resolvedSelectedId = preferredProfileId !== undefined
        ? nextProfiles.some((profile) => profile.id === preferredProfileId)
          ? preferredProfileId
          : nextProfiles[0]?.id ?? null
        : nextProfiles.some((profile) => profile.id === selectedProfileId)
          ? selectedProfileId
          : nextProfiles[0]?.id ?? null;

      setProfiles(nextProfiles);
      setSelectedProfileId(resolvedSelectedId);

      if (resolvedSelectedId) {
        const nextProfile = nextProfiles.find((profile) => profile.id === resolvedSelectedId) ?? null;
        setDraft(nextProfile ? buildDraft(nextProfile) : createEmptyDraft());
      } else {
        setDraft(createEmptyDraft());
      }

      setStatus("ready");
    } catch (error: unknown) {
      setProfiles([]);
      setSelectedProfileId(null);
      setDraft(createEmptyDraft());
      setStatus("error");
      setErrorMessage(getErrorMessage(error));
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

  const isBusy = action !== "idle";
  const isEditingExistingProfile = selectedProfileId !== null;
  const profileCount = profiles.length;

  const handleSelectProfile = (profile: AgentProfileRecord) => {
    setSelectedProfileId(profile.id);
    setDraft(buildDraft(profile));
    setErrorMessage(null);
  };

  const handleCreateProfile = () => {
    setSelectedProfileId(null);
    setDraft(createEmptyDraft());
    setErrorMessage(null);
  };

  const handleSaveProfile = async () => {
    setAction("saving");
    setErrorMessage(null);

    try {
      const saved = await saveAgentProfile({
        id: draft.id.trim(),
        name: draft.name.trim(),
        program: draft.program.trim(),
        args: serializeArgs(draft.args),
        env: serializeEnv(draft.env),
        cwd: { kind: "project_root" },
      });

      await loadProfiles(saved.id);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setAction("idle");
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfileId) {
      return;
    }

    setAction("deleting");
    setErrorMessage(null);

    try {
      await deleteAgentProfile({ profileId: selectedProfileId });
      await loadProfiles(null);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setAction("idle");
    }
  };

  return (
    <section
      data-testid="agent-registry-pane"
      className="dispatch-surface rounded-lg p-3 sm:p-4"
    >
      <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-panel)]/60 p-3 sm:p-4">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="max-w-2xl">
            <p className="dispatch-text-muted text-[0.66rem] font-semibold tracking-[0.18em] uppercase">
              Agent Registry
            </p>
            <h3 className="dispatch-heading mt-2 text-base font-semibold">Local launch profiles</h3>
            <p className="dispatch-text-secondary mt-2 text-sm leading-6">
              Manage explicit profiles that Dispatch launches through the Rust-owned registry. Auto stays available automatically.
            </p>
            <p className="dispatch-text-tertiary mt-1 text-xs leading-5">
              Dispatch ships with native Codex, Claude Code, and Gemini launch profiles. Edit them here or add more local CLI targets.
            </p>
          </div>

          <div className="grid w-full gap-2 sm:grid-cols-2 2xl:w-auto 2xl:max-w-[30rem] 2xl:grid-cols-3">
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Profiles
              </p>
              <p className="dispatch-text-primary mt-1.5 text-sm font-semibold">{profileCount}</p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                Explicit launch targets registered in Dispatch
              </p>
            </div>
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Selection
              </p>
              <p className="dispatch-text-primary mt-1.5 truncate text-sm font-semibold">
                {selectedProfile ? `Selected: ${selectedProfile.name}` : "Selected: none"}
              </p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                {selectedProfile ? selectedProfile.program : "Drafting a fresh local launcher"}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/85 px-3 py-2.5">
              <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                Runtime
              </p>
              <p className="dispatch-text-primary mt-1.5 text-sm font-semibold">
                project_root
              </p>
              <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                All profiles launch from the active project root
              </p>
            </div>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className="dispatch-alert mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="mt-4 flex items-center gap-3 px-1 py-2 text-sm">
          <LoaderCircle size={15} className="animate-spin text-accent-blue" />
          <span className="dispatch-text-secondary text-[0.8rem]">Loading profiles...</span>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 2xl:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/80 p-3">
          <button
            type="button"
            className="dispatch-action-button inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg text-[0.8rem] font-medium"
            onClick={handleCreateProfile}
            disabled={isBusy}
          >
            <Plus size={14} />
            <span>New profile</span>
          </button>

          <div className="mt-3 rounded-lg border border-dashed border-[var(--surface-border-soft)] px-2.5 py-2">
            <div className="flex items-center gap-2">
              <Sparkles size={12} className="dispatch-text-muted shrink-0" />
              <span className="dispatch-text-muted text-xs font-medium">Auto (always available)</span>
            </div>
            <p className="dispatch-text-tertiary mt-1 text-[0.72rem] leading-5">
              Fallback discovery still works even when no explicit profile is selected.
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className="dispatch-project-row block w-full rounded-lg border border-transparent px-2.5 py-2.5 text-left"
                data-active={selectedProfileId === profile.id}
                aria-pressed={selectedProfileId === profile.id}
                onClick={() => handleSelectProfile(profile)}
                disabled={isBusy}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="dispatch-text-primary truncate text-sm font-medium">
                    {profile.name}
                  </p>
                  <span className="dispatch-text-muted rounded-full border border-[var(--surface-border-soft)] px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em]">
                    {describeEnv(profile)} env
                  </span>
                </div>
                <p className="dispatch-text-tertiary mt-1 truncate text-[0.72rem] leading-5">
                  {profile.program}
                </p>
                <p className="dispatch-text-tertiary mt-0.5 truncate text-[0.72rem] leading-5">
                  {describeArgs(profile)}
                </p>
              </button>
            ))}
          </div>

          {status === "ready" && profiles.length === 0 ? (
            <p className="dispatch-text-tertiary mt-3 px-1 py-1 text-xs">
              No explicit profiles yet.
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/80 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="dispatch-text-primary text-sm font-semibold">
                {isEditingExistingProfile ? "Edit profile" : "New profile"}
              </p>
              <p className="dispatch-text-tertiary mt-1 text-[0.78rem] leading-5">
                Configure the executable, argument template, and environment mapping Dispatch will pass to Rust for launch.
              </p>
            </div>

            {isEditingExistingProfile ? (
              <button
                type="button"
                className="dispatch-icon-button inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium disabled:opacity-60"
                onClick={() => {
                  if (selectedProfile) {
                    setDraft(buildDraft(selectedProfile));
                    setErrorMessage(null);
                  }
                }}
                disabled={isBusy || !selectedProfile}
              >
                Reset
              </button>
            ) : null}
          </div>

          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="dispatch-text-secondary text-xs font-semibold">
                  Profile ID
                </span>
                <input
                  value={draft.id}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      id: event.target.value,
                    }));
                  }}
                  className="dispatch-input mt-1 h-8 w-full rounded-lg px-3 text-sm"
                  aria-label="Profile ID"
                  placeholder="codex-reviewer"
                  disabled={isBusy}
                />
              </label>

              <label className="block">
                <span className="dispatch-text-secondary text-xs font-semibold">
                  Display name
                </span>
                <input
                  value={draft.name}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }));
                  }}
                  className="dispatch-input mt-1 h-8 w-full rounded-lg px-3 text-sm"
                  aria-label="Display name"
                  placeholder="Codex Reviewer"
                  disabled={isBusy}
                />
              </label>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <label className="block">
                <span className="dispatch-text-secondary text-xs font-semibold">
                  Program
                </span>
                <input
                  value={draft.program}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      program: event.target.value,
                    }));
                  }}
                  className="dispatch-input mt-1 h-8 w-full rounded-lg px-3 text-sm"
                  aria-label="Program"
                  placeholder="codex"
                  disabled={isBusy}
                />
              </label>

              <div className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-panel)]/40 px-3 py-2.5">
                <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                  Current draft
                </p>
                <p className="dispatch-text-primary mt-1.5 truncate text-sm font-semibold">
                  {draft.name.trim() ? `Draft: ${draft.name.trim()}` : "Draft: unnamed"}
                </p>
                <p className="dispatch-text-tertiary mt-1 text-[0.73rem] leading-5">
                  {draft.id.trim() || "No profile ID yet"}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-panel)]/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="dispatch-text-secondary text-xs font-semibold">Args</p>
                  <p className="dispatch-text-tertiary mt-1 text-[0.72rem] leading-5">
                    Compose the exact CLI shape. Prompt-derived values are injected at launch time.
                  </p>
                </div>
                <button
                  type="button"
                  className="dispatch-control inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium"
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      args: [
                        ...current.args,
                        {
                          kind: "literal",
                          value: "",
                        },
                      ],
                    }));
                  }}
                  disabled={isBusy}
                >
                  <Plus size={12} />
                  <span>Add</span>
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {draft.args.map((argument, index) => {
                  const option = argOptions.find((candidate) => candidate.value === argument.kind)
                    ?? argOptions[0];

                  return (
                    <div
                      key={`arg-${index}`}
                      className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/80 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                          Arg {index + 1}
                        </p>
                        <button
                          type="button"
                          className="dispatch-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-60"
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              args: current.args.filter((_, currentIndex) => currentIndex !== index),
                            }));
                          }}
                          disabled={isBusy || draft.args.length === 1}
                          aria-label={`Remove arg ${index + 1}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                        <label className="block">
                          <span className="dispatch-text-tertiary text-[0.66rem]">Kind</span>
                          <select
                            value={argument.kind}
                            onChange={(event) => {
                              const nextKind = event.target.value as AgentArgKind;
                              setDraft((current) => ({
                                ...current,
                                args: current.args.map((currentArg, currentIndex) => currentIndex === index
                                  ? {
                                    kind: nextKind,
                                    value: nextKind === "literal" ? currentArg.value : "",
                                  }
                                  : currentArg),
                              }));
                            }}
                            className="dispatch-input mt-0.5 h-8 w-full rounded-lg px-2 text-[0.78rem]"
                            aria-label={`Arg kind ${index + 1}`}
                            disabled={isBusy}
                          >
                            {argOptions.map((candidate) => (
                              <option key={candidate.value} value={candidate.value}>
                                {candidate.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block min-w-0">
                          <span className="dispatch-text-tertiary text-[0.66rem]">Value</span>
                          <input
                            value={argument.value}
                            onChange={(event) => {
                              setDraft((current) => ({
                                ...current,
                                args: current.args.map((currentArg, currentIndex) => currentIndex === index
                                  ? {
                                    ...currentArg,
                                    value: event.target.value,
                                  }
                                  : currentArg),
                              }));
                            }}
                            className="dispatch-input mt-0.5 h-8 w-full rounded-lg px-3 text-sm"
                            aria-label={`Arg value ${index + 1}`}
                            placeholder={option.needsValue ? "value" : "(auto)"}
                            disabled={isBusy || !option.needsValue}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--surface-border-soft)] bg-[var(--surface-panel)]/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="dispatch-text-secondary text-xs font-semibold">Environment</p>
                  <p className="dispatch-text-tertiary mt-1 text-[0.72rem] leading-5">
                    Bind runtime variables to inherited env, secrets, or literal values.
                  </p>
                </div>
                <button
                  type="button"
                  className="dispatch-control inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium"
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      env: [
                        ...current.env,
                        {
                          envKey: "",
                          sourceKind: "secret",
                          sourceValue: "",
                        },
                      ],
                    }));
                  }}
                  disabled={isBusy}
                >
                  <Plus size={12} />
                  <span>Add</span>
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {draft.env.length === 0 ? (
                  <p className="dispatch-text-tertiary py-1 text-xs">
                    No env mappings. Add entries for inherited, literal, or secret-backed vars.
                  </p>
                ) : null}

                {draft.env.map((envRow, index) => {
                  const sourceOption = envSourceOptions.find((candidate) => candidate.value === envRow.sourceKind)
                    ?? envSourceOptions[0];

                  return (
                    <div
                      key={`env-${index}`}
                      className="rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-base)]/80 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="dispatch-text-muted text-[0.64rem] font-semibold uppercase tracking-[0.14em]">
                          Env {index + 1}
                        </p>
                        <button
                          type="button"
                          className="dispatch-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-60"
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              env: current.env.filter((_, currentIndex) => currentIndex !== index),
                            }));
                          }}
                          disabled={isBusy}
                          aria-label={`Remove env ${index + 1}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
                        <label className="block min-w-0">
                          <span className="dispatch-text-tertiary text-[0.66rem]">Key</span>
                          <input
                            value={envRow.envKey}
                            onChange={(event) => {
                              setDraft((current) => ({
                                ...current,
                                env: current.env.map((currentRow, currentIndex) => currentIndex === index
                                  ? {
                                    ...currentRow,
                                    envKey: event.target.value,
                                  }
                                  : currentRow),
                              }));
                            }}
                            className="dispatch-input mt-0.5 h-8 w-full rounded-lg px-3 text-sm"
                            aria-label={`Env key ${index + 1}`}
                            placeholder="OPENAI_API_KEY"
                            disabled={isBusy}
                          />
                        </label>

                        <label className="block">
                          <span className="dispatch-text-tertiary text-[0.66rem]">Source</span>
                          <select
                            value={envRow.sourceKind}
                            onChange={(event) => {
                              const nextKind = event.target.value as AgentEnvKind;
                              setDraft((current) => ({
                                ...current,
                                env: current.env.map((currentRow, currentIndex) => currentIndex === index
                                  ? {
                                    ...currentRow,
                                    sourceKind: nextKind,
                                  }
                                  : currentRow),
                              }));
                            }}
                            className="dispatch-input mt-0.5 h-8 w-full rounded-lg px-2 text-[0.78rem]"
                            aria-label={`Env source ${index + 1}`}
                            disabled={isBusy}
                          >
                            {envSourceOptions.map((candidate) => (
                              <option key={candidate.value} value={candidate.value}>
                                {candidate.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block min-w-0">
                          <span className="dispatch-text-tertiary text-[0.66rem]">{sourceOption.valueLabel}</span>
                          <input
                            value={envRow.sourceValue}
                            onChange={(event) => {
                              setDraft((current) => ({
                                ...current,
                                env: current.env.map((currentRow, currentIndex) => currentIndex === index
                                  ? {
                                    ...currentRow,
                                    sourceValue: event.target.value,
                                  }
                                  : currentRow),
                              }));
                            }}
                            className="dispatch-input mt-0.5 h-8 w-full rounded-lg px-3 text-sm"
                            aria-label={`Env source value ${index + 1}`}
                            placeholder={sourceOption.valueLabel}
                            disabled={isBusy}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--surface-border-soft)] bg-[var(--surface-panel)]/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="dispatch-text-tertiary text-xs">Working directory:</span>
                <span className="dispatch-text-muted rounded bg-[var(--surface-control)] px-1.5 py-0.5 font-mono text-xs">
                  project_root
                </span>
              </div>
              <div className="dispatch-text-tertiary text-[0.72rem] leading-5">
                {draft.args.length} args / {draft.env.length} env mappings
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                className="dispatch-action-button inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-60"
                onClick={() => {
                  void handleSaveProfile();
                }}
                disabled={isBusy}
              >
                {action === "saving" ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}
                <span>Save profile</span>
              </button>

              <button
                type="button"
                className="dispatch-icon-button inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-60"
                onClick={() => {
                  void handleDeleteProfile();
                }}
                disabled={isBusy || !isEditingExistingProfile}
              >
                {action === "deleting" ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
