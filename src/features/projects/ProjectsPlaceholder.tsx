import { useMemo } from "react";

import { useDispatchStore } from "../../app/providers";
import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function ProjectsPlaceholder() {
  const projects = useDispatchStore((state) => state.projects);
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const title = activeProject
    ? `${activeProject.name} is the active workspace.`
    : "Register a project from the top bar to make Dispatch project-aware.";
  const description = activeProject
    ? "Use the switcher above to change or remove projects. Dispatch restores the active project from settings on app load so the rest of the shell can stay scoped."
    : "The top-bar project switcher now lists registered workspaces, opens the add-project dialog, and persists the active project ID in settings for the next launch.";

  return (
    <PlaceholderSurface
      eyebrow="Projects"
      title={title}
      description={description}
    />
  );
}
