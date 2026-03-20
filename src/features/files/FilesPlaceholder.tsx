import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function FilesPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Files"
      title="Files joins the persistent lazy host so future tree state survives tab switches."
      description="The browser-side shell still exposes no raw filesystem access. Rust remains the owner once the safe project-scoped file APIs arrive."
    />
  );
}
