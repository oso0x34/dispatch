import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronsUpDown,
  FolderPlus,
  FolderTree,
  Trash2,
} from "lucide-react";

import { useDispatchStore } from "../../app/providers";
import { AddProjectDialog } from "./AddProjectDialog";

export function ProjectSwitcher() {
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuOpenerRef = useRef<HTMLElement | null>(null);
  const menuWasOpenRef = useRef(false);
  const menuId = useId();
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const isLoading = projectStatus === "loading";
  const isMutating = projectAction !== "idle";

  useEffect(() => {
    if (projectStatus !== "idle") {
      return;
    }

    void initializeProjects();
  }, [initializeProjects, projectStatus]);

  useEffect(() => {
    if (!menuOpen) {
      if (menuWasOpenRef.current) {
        menuOpenerRef.current?.focus();
        menuOpenerRef.current = null;
        menuWasOpenRef.current = false;
      }

      return;
    }

    if (!menuWasOpenRef.current) {
      menuOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      menuWasOpenRef.current = true;
    }

    const menu = menuRef.current;
    const focusTarget = menu?.querySelector<HTMLElement>('[data-project-option][data-active="true"]')
      ?? menu?.querySelector<HTMLElement>("[data-popup-autofocus]")
      ?? menu?.querySelector<HTMLElement>("button:not([disabled])");
    focusTarget?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;

      if (target instanceof Node && switcherRef.current?.contains(target)) {
        return;
      }

      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeProjectId, menuOpen, projects]);

  const title = activeProject
    ? activeProject.name
    : isLoading
      ? "Loading projects"
      : "No project selected";
  const detail = activeProject
    ? `${projects.length} registered ${projects.length === 1 ? "project" : "projects"}`
    : projectStatus === "error"
      ? "Project registry unavailable"
      : "Register a project to enable scoped Dispatch work";

  const openAddDialog = () => {
    clearProjectError();
    setMenuOpen(false);
    setDialogOpen(true);
  };

  return (
    <>
      <div
        ref={switcherRef}
        className="relative"
      >
        <button
          ref={triggerRef}
          type="button"
          className="dispatch-control flex min-w-[16rem] items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition"
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          aria-label="Project switcher"
          aria-controls={menuId}
          onClick={() => {
            clearProjectError();
            setMenuOpen((current) => !current);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
              return;
            }

            event.preventDefault();
            clearProjectError();
            setMenuOpen(true);
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <FolderTree
              size={16}
              className="text-accent-blue"
            />

            <div className="min-w-0">
              <p className="dispatch-kicker text-[0.66rem] font-semibold uppercase tracking-[0.24em]">
                Project
              </p>
              <p className="dispatch-text-primary truncate text-sm font-medium">{title}</p>
              <p className="dispatch-text-tertiary truncate text-xs">{detail}</p>
            </div>
          </div>

          <ChevronsUpDown
            size={14}
            className="dispatch-text-tertiary shrink-0"
          />
        </button>

        {menuOpen ? (
          <div
            id={menuId}
            ref={menuRef}
            role="dialog"
            aria-modal="false"
            aria-label="Project options"
            tabIndex={-1}
            className="dispatch-menu absolute left-0 top-[calc(100%+0.75rem)] z-40 w-[min(30rem,calc(100vw-2rem))] rounded-[20px] p-3 shadow-2xl"
          >
            <div className="dispatch-divider flex items-start justify-between gap-3 border-b px-2 pb-3">
              <div>
                <p className="dispatch-kicker text-[0.65rem] font-semibold uppercase tracking-[0.24em]">
                  Workspace registry
                </p>
                <p className="dispatch-text-secondary mt-2 text-sm leading-6">
                  Project roots stay in Rust. The shell stores only the active project ID.
                </p>
              </div>

              <button
                type="button"
                data-popup-autofocus={projects.length === 0 ? "true" : undefined}
                className="dispatch-action-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium"
                onClick={openAddDialog}
              >
                <FolderPlus size={15} />
                <span>Add project</span>
              </button>
            </div>

            {projectError ? (
              <div
                className="dispatch-alert mt-3 rounded-xl px-4 py-3 text-sm"
                role="alert"
              >
                {projectError}
              </div>
            ) : null}

            {projects.length === 0 ? (
              <div className="px-2 py-5">
                <div className="dispatch-empty-state rounded-[18px] px-4 py-5">
                  <p className="dispatch-text-primary text-sm font-medium">
                    No projects registered yet.
                  </p>
                  <p className="dispatch-text-secondary mt-2 text-sm leading-6">
                    Add a project root to make the rest of Dispatch project-aware.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex max-h-80 flex-col gap-2 overflow-auto px-1">
                {projects.map((project) => {
                  const isActive = project.id === activeProjectId;
                  const isPending = pendingProjectId === project.id;
                  const buttonLabel = isActive
                    ? `${project.name}, active project`
                    : `Switch to ${project.name}`;

                  return (
                    <div
                      key={project.id}
                      className="dispatch-project-row flex items-center gap-2 rounded-[18px] px-2 py-2"
                    >
                      <button
                        type="button"
                        className="dispatch-project-option flex min-w-0 flex-1 items-center gap-3 rounded-[14px] px-3 py-3 text-left transition"
                        aria-label={buttonLabel}
                        data-project-option="true"
                        data-active={isActive ? "true" : "false"}
                        disabled={isMutating}
                        onClick={() => {
                          setMenuOpen(false);
                          void selectProject(project.id);
                        }}
                      >
                        <div className="dispatch-project-badge flex h-10 w-10 items-center justify-center rounded-xl">
                          {isActive ? <Check size={16} /> : <FolderTree size={16} />}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="dispatch-text-primary truncate text-sm font-medium">
                            {project.name}
                          </p>
                          <p className="dispatch-text-muted truncate text-xs">
                            {isPending && projectAction === "switching"
                              ? "Switching active workspace..."
                              : isActive
                                ? "Active project"
                                : "Project root managed by Rust"}
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        className="dispatch-danger-button flex h-11 w-11 items-center justify-center rounded-xl"
                        aria-label={`Remove ${project.name}`}
                        disabled={isMutating}
                        onClick={() => void removeProject(project.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <AddProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
