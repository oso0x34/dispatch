import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function FilesPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Files"
      title="Filesystem access remains Rust-owned."
      description="The scaffold reserves the Files surface without exposing direct browser-side filesystem APIs, matching the locked runtime-boundary ADR."
    />
  );
}
