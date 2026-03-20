import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function ProjectsPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Projects"
      title="Dispatch boots into a real workspace shell."
      description="The initial scaffold is wired to a typed Rust health command and a shared provider/store boundary so project registration can land without changing the app entry points."
    />
  );
}
