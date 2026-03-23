import {
  useRef,
  useState,
} from "react";
import {
  Brain,
  LoaderCircle,
  Plus,
  Power,
  Send,
} from "lucide-react";

import type { ChatModelOption } from "./store/chatSlice";

type ReasoningLevel = "off" | "low" | "medium" | "high";

const REASONING_OPTIONS: { value: ReasoningLevel; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// Always show reasoning — it's a prompt-level preference, not model-gated
function supportsReasoning(): boolean {
  return true;
}

type ChatInputProps = {
  draft: string;
  selectedModelId: string;
  modelOptions: ChatModelOption[];
  projectLabel: string;
  modelStatus: "idle" | "loading" | "ready" | "error";
  isSending: boolean;
  openClawConnected: boolean;
  isTogglingConnection: boolean;
  onDraftChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSubmit: () => void;
  onCreateTask: () => void;
  onToggleOpenClaw: () => void;
};

export function ChatInput({
  draft,
  selectedModelId,
  modelOptions,
  projectLabel,
  modelStatus,
  isSending,
  openClawConnected,
  isTogglingConnection,
  onDraftChange,
  onModelChange,
  onSubmit,
  onCreateTask,
  onToggleOpenClaw,
}: ChatInputProps) {
  const canSubmit = draft.trim().length > 0 && !isSending;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("off");
  const showReasoning = supportsReasoning();

  return (
    <form
      className="border-t border-[var(--surface-border-soft)] bg-[linear-gradient(180deg,rgba(10,13,19,0.96),rgba(9,11,16,0.98))] px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-3 rounded-[1.15rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[0.72rem] font-medium transition ${
                openClawConnected
                  ? "border border-[rgba(34,197,94,0.24)] bg-[rgba(34,197,94,0.08)] text-[rgba(187,247,208,0.92)] hover:bg-[rgba(34,197,94,0.14)]"
                  : "dispatch-control text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
              onClick={onToggleOpenClaw}
              disabled={isTogglingConnection}
              title={openClawConnected ? "Click to disconnect" : "Click to connect"}
            >
              {isTogglingConnection ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <Power size={12} />
              )}
              <span
                className={`inline-block h-[0.4rem] w-[0.4rem] rounded-full ${
                  openClawConnected ? "bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.5)]" : "bg-[rgba(255,255,255,0.2)]"
                }`}
              />
              <span>{openClawConnected ? "Connected" : "Off"}</span>
            </button>

            <label className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.18)] px-3 text-[0.68rem] text-[var(--text-muted)]">
              <span className="uppercase tracking-[0.22em] text-[var(--text-subtle)]">Model</span>
              <select
                aria-label="Model selector"
                value={selectedModelId}
                onChange={(event) => onModelChange(event.target.value)}
                className="bg-transparent text-[var(--text-primary)] outline-none"
              >
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {showReasoning ? (
              <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.18)] px-3">
                <Brain size={12} className="dispatch-text-subtle" />
                <select
                  aria-label="Reasoning level"
                  value={reasoningLevel}
                  onChange={(event) => setReasoningLevel(event.target.value as ReasoningLevel)}
                  className="bg-transparent text-[0.68rem] text-[var(--text-primary)] outline-none"
                >
                  {REASONING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <button
              type="button"
              className="dispatch-icon-button inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.72rem]"
              onClick={onCreateTask}
            >
              <Plus size={12} />
              <span>Create task</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-[0.68rem] text-[var(--text-subtle)]">
            <span className="hidden sm:inline">In {projectLabel}</span>
            <span className="rounded-full border border-[var(--surface-border-soft)] bg-[rgba(0,0,0,0.18)] px-2 py-1">
              {canSubmit ? "Ready to send" : "Draft required"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Ask Orchestrate anything about this project..."
            className="dispatch-input h-10 min-w-0 flex-1 rounded-[0.85rem] px-3 text-[0.84rem]"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />

          <button
            type="submit"
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-[0.85rem] px-4 text-[0.8rem] font-semibold transition ${
              canSubmit
                ? "dispatch-action-button"
                : "border border-[var(--surface-border-soft)] bg-[var(--surface-control)] text-[var(--text-muted)] opacity-40"
            }`}
            disabled={!canSubmit}
            aria-label={isSending ? "Sending" : "Send message"}
          >
            {isSending ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            <span>{isSending ? "Sending" : "Send"}</span>
          </button>
        </div>

        <p className="text-[0.66rem] text-[var(--text-subtle)]">
          Voice input is intentionally post-v1, so this composer stays text-first.
        </p>
      </div>
    </form>
  );
}
