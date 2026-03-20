import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function TasksPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Tasks"
      title="Kanban state comes later, but the surface is already part of the shell."
      description="Zustand is bootstrapped for UI state only. Durable task data remains a future Rust-owned concern once SQLite bootstrap is introduced."
    />
  );
}
