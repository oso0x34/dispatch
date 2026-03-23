import { useDispatchStore } from "../../app/providers";
import { TerminalPanel } from "./TerminalPanel";

type AgentsTabProps = {
  active?: boolean;
};

export function AgentsTab({ active = true }: AgentsTabProps) {
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);

  return (
    <div className="flex h-full flex-col">
      <TerminalPanel projectId={activeProjectId} active={active} />
    </div>
  );
}
