import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function TasksPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Tasks"
      title="Tasks stays an overlay for now, so it mounts fresh each time it opens."
      description="The board and task detail flows land later, but this ticket locks in the intended shell behavior: overlays are ephemeral while heavier tabs persist after first open."
    />
  );
}
