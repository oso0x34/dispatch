import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function ProjectsPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Projects"
      title="The shell now opens on a real project surface instead of the bootstrap marketing scaffold."
      description="Project registration is still static in this phase, but the workspace frame, top bar, and runtime status lane are now in place so project CRUD can attach without reshaping the app shell."
    />
  );
}
