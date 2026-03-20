import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function AgentsPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Agents"
      title="Agents is now a lazy surface that only mounts after first open."
      description="That keeps the shell light on boot while preserving future terminal state once this tab has been visited, matching the roadmap rule for heavier workspaces."
    />
  );
}
