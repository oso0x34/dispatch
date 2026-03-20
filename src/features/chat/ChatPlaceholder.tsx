import { PlaceholderSurface } from "../../shared/components/PlaceholderSurface";

export function ChatPlaceholder() {
  return (
    <PlaceholderSurface
      eyebrow="Chat"
      title="Chat also uses the lazy mount-once path so later conversation state can survive revisits."
      description="The shell reserves the tab now and keeps the heavy surface out of the initial boot path until a user actually opens it."
    />
  );
}
