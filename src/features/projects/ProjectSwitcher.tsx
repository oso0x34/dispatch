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
      ? "Loading..."
      : "No project selected";

  const openAddDialog = () => {
    clearProjectError();
    setMenuOpen(false);
    setDialogOpen(true);
  };

  return (
    <>
      <div
        ref={switcherRef}
        className="dispatch-project-switcher relative min-w-0"
      >
        <div className="dispatch-project-switcher-label px-0.5 pb-1">
          <span className="dispatch-text-subtle text-[0.54rem] font-semibold uppercase tracking-[0.24em]">
            Project
          </span>
        </div>

        <button
          ref={triggerRef}
          type="button"
          className="dispatch-control dispatch-project-switcher-button flex h-[30px] min-w-[8.5rem] max-w-[11.5rem] items-center justify-between gap-2 rounded-lg px-2.5 text-left transition"
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
          <span className="dispatch-text-primary min-w-0 truncate text-[0.78rem] font-medium">
            {title}
          </span>

          <ChevronsUpDown
            size={11}
            className="dispatch-text-subtle shrink-0"
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
            className="dispatch-menu absolute left-0 top-[calc(100%+0.5rem)] z-40 w-[min(23rem,calc(100vw-2rem))] rounded-xl p-2.5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 px-1 pb-2.5">
              <div className="min-w-0">
                <span className="dispatch-text-secondary block text-[0.64rem] font-semibold uppercase tracking-[0.22em]">
                  Projects
                </span>
                <span className="dispatch-text-subtle mt-0.5 block text-[0.68rem]">
                  Switch workspace context
                </span>
              </div>

              <button
                type="button"
                data-popup-autofocus={projects.length === 0 ? "true" : undefined}
                className="dispatch-action-button inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.7rem] font-medium"
                onClick={openAddDialog}
              >
                <FolderPlus size={12} />
                <span>Add project</span>
              </button>
            </div>

            {projectError ? (
              <div
                className="dispatch-alert mb-2 rounded-md px-3 py-2 text-[0.75rem]"
                role="alert"
              >
                {projectError}
              </div>
            ) : null}

            {projects.length === 0 ? (
              <div className="px-1 py-3">
                <p className="dispatch-text-muted text-center text-[0.75rem]">
                  No projects registered yet.
                </p>
              </div>
            ) : (
              <div className="flex max-h-64 flex-col gap-0.5 overflow-auto">
                {projects.map((project) => {
                  const isActive = project.id === activeProjectId;
                  const isPending = pendingProjectId === project.id;
                  const buttonLabel = isActive
                    ? `${project.name}, active project`
                    : `Switch to ${project.name}`;

                  return (
                    <div
                      key={project.id}
                      className="dispatch-project-row flex items-center gap-1 rounded-md px-0.5"
                      data-active={isActive ? "true" : undefined}
                    >
                      <button
                        type="button"
                        className="dispatch-tree-item flex min-w-0 flex-1 items-center gap-2 text-left"
                        aria-label={buttonLabel}
                        data-project-option="true"
                        data-active={isActive ? "true" : "false"}
                        disabled={isMutating}
                        onClick={() => {
                          setMenuOpen(false);
                          void selectProject(project.id);
                        }}
                      >
                        {isActive ? (
                          <Check size={12} className="shrink-0 text-accent-blue" />
                        ) : (
                          <span className="inline-block w-3" />
                        )}

                        <span className="min-w-0 truncate text-[0.76rem]">
                          {isPending && projectAction === "switching"
                            ? `${project.name} (switching...)`
                            : project.name}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="dispatch-icon-button flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition hover:opacity-100"
                        style={{ opacity: undefined }}
                        aria-label={`Remove ${project.name}`}
                        disabled={isMutating}
                        onClick={() => void removeProject(project.id)}
                        onFocus={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onBlur={(e) => { e.currentTarget.style.opacity = ""; }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = ""; }}
                      >
                        <Trash2 size={11} />
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
