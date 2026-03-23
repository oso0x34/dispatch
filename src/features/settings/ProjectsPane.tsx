import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  FolderPlus,
  FolderTree,
  LoaderCircle,
  Trash2,
} from "lucide-react";

import { useDispatchStore } from "../../app/providers";
import { AddProjectDialog } from "../projects/AddProjectDialog";

export function ProjectsPane() {
  const projects = useDispatchStore((state) => state.projects);
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const projectStatus = useDispatchStore((state) => state.projectStatus);
  const projectAction = useDispatchStore((state) => state.projectAction);
  const pendingProjectId = useDispatchStore((state) => state.pendingProjectId);
  const projectError = useDispatchStore((state) => state.projectError);
  const initializeProjects = useDispatchStore((state) => state.initializeProjects);
  const selectProject = useDispatchStore((state) => state.selectProject);
  const removeProject = useDispatchStore((state) => state.removeProject);
  const clearProjectError = useDispatchStore((state) => state.clearProjectError);
  const [dialogOpen, setDialogOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (projectStatus !== "idle") {
      return;
    }

    void initializeProjects();
  }, [initializeProjects, projectStatus]);

  const isLoading = projectStatus === "loading";
  const isMutating = projectAction !== "idle";
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  return (
    <>
      <section
        data-testid="projects-pane"
        className="dispatch-surface rounded-[1.25rem] p-4 sm:p-5"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--surface-elevated) 90%, transparent) 0%, color-mix(in srgb, var(--surface-base) 96%, transparent) 100%)",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="dispatch-text-muted text-[0.66rem] font-semibold uppercase tracking-[0.2em]">
              Projects
            </p>
            <h3
              className="dispatch-heading mt-2 text-lg font-semibold"
              style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
            >
              Registered workspaces
            </h3>
            <p className="dispatch-text-secondary mt-2 text-sm leading-6">
              Manage project roots. The active project is used for agent launches and workspace scoping.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[0.7rem]">
              <span className="dispatch-text-muted rounded-full border border-[var(--surface-border-soft)] px-2.5 py-1 font-medium uppercase tracking-[0.18em]">
                {projects.length} total
              </span>
              <span className="dispatch-text-muted rounded-full border border-[var(--surface-border-soft)] px-2.5 py-1 font-medium uppercase tracking-[0.18em]">
                {activeProject ? `Active: ${activeProject.name}` : "No active project"}
              </span>
            </div>
          </div>

          <button
            ref={addButtonRef}
            type="button"
            className="dispatch-action-button inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[0.8rem] font-medium"
            onClick={() => {
              clearProjectError();
              setDialogOpen(true);
            }}
          >
            <FolderPlus size={14} />
            <span>Add project</span>
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_70%,transparent)] px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="dispatch-text-muted text-[0.66rem] font-semibold uppercase tracking-[0.18em]">
                Workspace routing
              </p>
              <p className="dispatch-text-primary mt-1 text-sm font-medium">
                {activeProject ? "Project scope is assigned" : "No project selected"}
              </p>
            </div>
            <p className="dispatch-text-secondary max-w-md text-sm leading-6">
              Keep only the workspaces you actually switch between. The active one controls agent launches and file scoping.
            </p>
          </div>
        </div>

        {projectError ? (
          <div className="dispatch-alert mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
            {projectError}
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-4 flex items-center gap-3 px-1 py-2 text-sm">
            <LoaderCircle size={15} className="animate-spin text-accent-blue" />
            <span className="dispatch-text-secondary text-[0.8rem]">Loading projects...</span>
          </div>
        ) : null}

        {!isLoading && projects.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_72%,transparent)] px-4 py-4">
            <p className="dispatch-text-primary text-sm font-medium">
              No projects registered yet.
            </p>
            <p className="dispatch-text-secondary mt-1 text-[0.8rem] leading-6">
              Add a project root to make Dispatch project-aware.
            </p>
          </div>
        ) : null}

        {!isLoading && projects.length > 0 ? (
          <div className="mt-4 space-y-2.5">
            {projects.map((project) => {
              const isActive = project.id === activeProjectId;
              const isPending = pendingProjectId === project.id;
              const statusLabel = isPending && projectAction === "switching"
                ? "Switching..."
                : isPending && projectAction === "deleting"
                  ? "Removing..."
                  : isActive
                    ? "Active project"
                    : "Inactive";

              return (
                <div
                  key={project.id}
                  className="dispatch-project-row flex items-center justify-between gap-3 rounded-2xl border px-3 py-3"
                  style={{
                    borderColor: isActive
                      ? "color-mix(in srgb, var(--accent-green) 40%, var(--surface-border-soft))"
                      : "var(--surface-border-soft)",
                    background: isActive
                      ? "linear-gradient(135deg, color-mix(in srgb, var(--accent-green) 12%, var(--surface-raised)) 0%, color-mix(in srgb, var(--surface-base) 82%, transparent) 100%)"
                      : "color-mix(in srgb, var(--surface-base) 74%, transparent)",
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
                      style={{
                        borderColor: isActive
                          ? "color-mix(in srgb, var(--accent-green) 40%, var(--surface-border-soft))"
                          : "var(--surface-border-soft)",
                        background: "color-mix(in srgb, var(--surface-raised) 82%, transparent)",
                      }}
                    >
                      {isActive ? (
                        <Check size={14} className="text-accent-green" />
                      ) : (
                        <FolderTree size={14} className="dispatch-text-muted" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="dispatch-text-primary truncate text-sm font-medium">
                        {project.name}
                      </p>
                      <p className="dispatch-text-tertiary mt-0.5 truncate text-xs">
                        {statusLabel}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {isActive ? (
                      <span className="dispatch-text-muted rounded-full border border-[var(--surface-border-soft)] px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-[0.16em]">
                        Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="dispatch-control inline-flex h-8 items-center rounded-xl px-3 text-xs font-medium disabled:opacity-60"
                        disabled={isMutating}
                        onClick={() => {
                          clearProjectError();
                          void selectProject(project.id);
                        }}
                      >
                        Activate
                      </button>
                    )}

                    <button
                      type="button"
                      className="dispatch-icon-button inline-flex h-8 w-8 items-center justify-center rounded-xl disabled:opacity-60"
                      aria-label={`Remove ${project.name}`}
                      disabled={isMutating}
                      onClick={() => {
                        clearProjectError();
                        void removeProject(project.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <AddProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        returnFocusRef={addButtonRef}
      />
    </>
  );
}
