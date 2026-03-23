import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  LoaderCircle,
  Rocket,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";

import {
  listAgentRegistryEntries,
  type AgentRegistryEntryRecord,
  type OpenClawConnectionStatusRecord,
} from "../../shared/lib/tauri";

type DispatchRoute = "local" | "vicam";

type DispatchModalProps = {
  open: boolean;
  projectId: string | null;
  projectName: string | null;
  openClawStatus?: OpenClawConnectionStatusRecord | null;
  initialProfileId?: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onDispatch: (input: {
    profileId: string;
    prompt: string | null;
    route: DispatchRoute;
  }) => Promise<void>;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

type RegistryStatus = "idle" | "loading" | "ready" | "error";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function resolveProfileSelection(
  entries: AgentRegistryEntryRecord[],
  initialProfileId?: string | null,
) {
  const normalizedInitial = initialProfileId?.trim() ?? "";
  if (normalizedInitial && entries.some((entry) => entry.id === normalizedInitial)) {
    return normalizedInitial;
  }

  return entries.find((entry) => entry.selectionMode === "auto")?.id
    ?? entries[0]?.id
    ?? "auto";
}

export function DispatchModal({
  open,
  projectId,
  projectName,
  openClawStatus = null,
  initialProfileId = null,
  isSubmitting,
  onClose,
  onDispatch,
  returnFocusRef,
}: DispatchModalProps) {
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus>("idle");
  const [registryEntries, setRegistryEntries] = useState<AgentRegistryEntryRecord[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const titleId = useId();
  const agentFieldId = useId();
  const promptFieldId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const agentSelectRef = useRef<HTMLSelectElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const handleRequestClose = () => {
    if (isSubmitting) {
      return;
    }

    onClose();
  };

  useEffect(() => {
    if (!open) {
      setRegistryStatus("idle");
      setRegistryEntries([]);
      setSelectedProfileId(initialProfileId?.trim() || "auto");
      setPrompt("");
      setErrorMessage(null);
      return;
    }

    let active = true;

    setRegistryStatus("loading");
    setErrorMessage(null);

    void listAgentRegistryEntries()
      .then((entries) => {
        if (!active) {
          return;
        }

        setRegistryEntries(entries);
        setSelectedProfileId(resolveProfileSelection(entries, initialProfileId));
        setRegistryStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setRegistryEntries([]);
        setRegistryStatus("error");
        setErrorMessage(getErrorMessage(error, "Agent registry failed to load."));
      });

    return () => {
      active = false;
    };
  }, [initialProfileId, open]);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        const opener = openerRef.current;
        const fallback = returnFocusRef?.current ?? null;
        const focusTarget = opener?.isConnected ? opener : fallback;

        focusTarget?.focus();
        openerRef.current = null;
        wasOpenRef.current = false;
      }

      return;
    }

    if (!wasOpenRef.current) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wasOpenRef.current = true;
    }

    const dialog = dialogRef.current;
    const focusTarget = agentSelectRef.current ?? closeButtonRef.current ?? dialog;
    focusTarget?.focus();

    const getFocusableElements = () => {
      if (!dialog) {
        return [];
      }

      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSubmitting) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const isFocusInsideDialog = activeElement ? dialog?.contains(activeElement) : false;

      if (event.shiftKey) {
        if (!isFocusInsideDialog || activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }

        return;
      }

      if (!isFocusInsideDialog || activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSubmitting, onClose, open, returnFocusRef]);

  if (!open) {
    return null;
  }

  const projectContextLabel = projectName?.trim() || projectId || "No project";
  const registryReady = registryStatus === "ready";
  const openClawConnected = openClawStatus?.state === "connected";
  const selectedEntry = registryEntries.find((entry) => entry.id === selectedProfileId) ?? null;
  const autoSelected = selectedEntry?.selectionMode === "auto" || selectedProfileId === "auto";
  const vicamEnabled = registryReady && openClawConnected && autoSelected && !isSubmitting;

  const validateSharedFields = () => {
    setErrorMessage(null);

    if (!projectId) {
      setErrorMessage("Select a project before dispatching.");
      return false;
    }

    if (!selectedProfileId.trim()) {
      setErrorMessage("Choose an agent profile.");
      return false;
    }

    return true;
  };

  const submitDispatch = async (route: DispatchRoute) => {
    if (!validateSharedFields()) {
      return;
    }

    if (route === "vicam") {
      if (!openClawConnected) {
        setErrorMessage("OpenClaw must be connected for VICAM dispatch.");
        return;
      }

      if (!autoSelected) {
        setErrorMessage("Select Auto to dispatch via VICAM.");
        return;
      }

      if (!prompt.trim()) {
        setErrorMessage("Add a prompt for VICAM dispatch.");
        return;
      }
    }

    try {
      await onDispatch({
        profileId: selectedProfileId,
        prompt: prompt.trim() ? prompt : null,
        route,
      });
      onClose();
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "Dispatch failed."));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitDispatch("local");
  };

  return (
    <div
      className="dispatch-overlay-backdrop fixed inset-0 z-[70] flex items-center justify-center px-4 py-4 backdrop-blur-sm"
      onClick={handleRequestClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isSubmitting}
        tabIndex={-1}
        className="dispatch-panel w-full max-w-lg rounded-lg overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--surface-border-soft)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Rocket size={14} className="dispatch-text-secondary shrink-0" />
            <h2 id={titleId} className="dispatch-heading text-sm font-semibold">
              Send to Agent
            </h2>
            <span className="dispatch-text-subtle truncate text-[0.68rem]">
              {projectContextLabel}
            </span>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            className="dispatch-icon-button flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
            aria-label="Close dispatch modal"
            onClick={handleRequestClose}
            disabled={isSubmitting}
          >
            <X size={14} />
          </button>
        </div>

        <form className="px-4 py-3" onSubmit={handleSubmit}>
          <div className="space-y-3">
            <label className="block" htmlFor={agentFieldId}>
              <span className="dispatch-text-secondary mb-1.5 block text-[0.7rem] font-medium">
                Agent
              </span>
              <select
                ref={agentSelectRef}
                id={agentFieldId}
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                className="dispatch-input h-9 w-full rounded-md px-3 text-[0.78rem]"
                disabled={registryStatus === "loading" || isSubmitting}
              >
                {registryReady ? (
                  registryEntries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))
                ) : (
                  <option value="auto">
                    {registryStatus === "loading" ? "Loading..." : "Unavailable"}
                  </option>
                )}
              </select>
            </label>

            <label className="block" htmlFor={promptFieldId}>
              <span className="dispatch-text-secondary mb-1.5 block text-[0.7rem] font-medium">
                Prompt <span className="dispatch-text-subtle font-normal">(optional)</span>
              </span>
              <textarea
                id={promptFieldId}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="dispatch-input min-h-[5rem] w-full rounded-md px-3 py-2 text-[0.78rem] leading-5"
                placeholder="Instructions for the agent..."
                disabled={isSubmitting}
              />
            </label>
          </div>

          {errorMessage ? (
            <div className="dispatch-alert mt-3 rounded-md px-3 py-2 text-[0.75rem]" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              className="dispatch-action-button inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-4 text-[0.78rem] font-medium"
              disabled={registryStatus === "loading" || isSubmitting}
            >
              {isSubmitting ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <TerminalSquare size={14} />
              )}
              <span>{isSubmitting ? "Dispatching..." : "Open in Terminal"}</span>
            </button>

            <button
              type="button"
              className={`inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-4 text-[0.78rem] font-medium transition-colors duration-150 ${
                vicamEnabled
                  ? "border border-[rgba(139,92,246,0.3)] bg-[rgba(139,92,246,0.1)] text-[rgba(221,214,254,0.95)] hover:bg-[rgba(139,92,246,0.16)]"
                  : "dispatch-control"
              }`}
              disabled={!vicamEnabled}
              onClick={() => {
                void submitDispatch("vicam");
              }}
              aria-label="Dispatch via VICAM orchestration"
              title={!openClawConnected ? "Connect OpenClaw to enable" : !autoSelected ? "Select Auto agent" : "Dispatch via VICAM"}
            >
              {isSubmitting ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Zap size={14} />
              )}
              <span>Dispatch via VICAM</span>
            </button>
          </div>

          {!openClawConnected ? (
            <p className="dispatch-text-subtle mt-2 text-center text-[0.65rem]">
              Connect OpenClaw in Settings to enable VICAM dispatch.
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
