import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function ChatPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Chat"
      title="Chat stays dormant until the backend session and cache layers land."
      description="This surface is part of the base workspace now so later tickets can wire message state into the same provider and Rust command boundary."
    />
  );
}
