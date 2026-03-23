import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import { FolderPlus, X } from "lucide-react";

import { useDispatchStore } from "../../app/providers";

type AddProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Project creation failed.";
}

export function AddProjectDialog({
  open,
  onClose,
  returnFocusRef,
}: AddProjectDialogProps) {
  const createProject = useDispatchStore((state) => state.createProject);
  const projectAction = useDispatchStore((state) => state.projectAction);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const nameInputId = useId();
  const rootPathInputId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const isSubmitting = projectAction === "creating";

  const handleRequestClose = () => {
    if (isSubmitting) {
      return;
    }

    onClose();
  };

  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      return;
    }

    setName("");
    setRootPath("");
    setErrorMessage(null);
  }, [open]);

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
    const focusTarget = nameInputRef.current ?? closeButtonRef.current ?? dialog;
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    try {
      await createProject({
        name,
        rootPath,
      });
      onClose();
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  return (
    <div
      className="dispatch-overlay-backdrop fixed inset-0 z-[60] px-3 py-3 backdrop-blur-sm sm:px-4 sm:py-4"
      onClick={handleRequestClose}
    >
      <div className="mx-auto flex h-full max-w-3xl items-center justify-center">
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={isSubmitting}
          tabIndex={-1}
          className="dispatch-panel w-full max-w-lg rounded-[1.35rem]"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--surface-elevated) 92%, transparent) 0%, color-mix(in srgb, var(--surface-base) 98%, transparent) 100%)",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative overflow-hidden px-4 pt-4 sm:px-5 sm:pt-5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-80"
              style={{
                background:
                  "radial-gradient(circle at top left, color-mix(in srgb, var(--accent-blue) 18%, transparent) 0%, transparent 58%)",
              }}
            />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="dispatch-text-muted text-[0.66rem] font-semibold uppercase tracking-[0.2em]">
                  Workspace intake
                </p>
                <h2
                  id={titleId}
                  className="dispatch-heading mt-2 text-lg font-semibold"
                  style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
                >
                  Add project
                </h2>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                className="dispatch-icon-button flex h-8 w-8 items-center justify-center rounded-xl"
                aria-label="Close add project dialog"
                onClick={handleRequestClose}
                disabled={isSubmitting}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="px-4 pt-2 sm:px-5">
            <p
              id={descriptionId}
              className="dispatch-text-secondary text-sm leading-6"
            >
              Register an existing workspace directory as a project.
            </p>
          </div>

          <div className="px-4 pt-4 pb-4 sm:px-5 sm:pb-5">
            <div className="rounded-2xl border border-[var(--surface-border-soft)] bg-[color:color-mix(in_srgb,var(--surface-base)_74%,transparent)] px-3 py-3 sm:px-4 sm:py-4">
              <div className="flex flex-wrap gap-2 text-[0.68rem]">
                <span className="dispatch-text-muted rounded-full border border-[var(--surface-border-soft)] px-2.5 py-1 font-medium uppercase tracking-[0.18em]">
                  Existing directory
                </span>
                <span className="dispatch-text-muted rounded-full border border-[var(--surface-border-soft)] px-2.5 py-1 font-medium uppercase tracking-[0.18em]">
                  Becomes active on add
                </span>
              </div>

              <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
                <label
                  className="block"
                  htmlFor={nameInputId}
                >
                  <span className="dispatch-field-label mb-1.5 block text-xs font-medium">
                    Project name
                  </span>
                  <input
                    ref={nameInputRef}
                    id={nameInputId}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="dispatch-input w-full rounded-xl px-3 py-2.5 text-sm"
                    placeholder="My Workspace"
                    autoComplete="off"
                    required
                  />
                </label>

                <label
                  className="block"
                  htmlFor={rootPathInputId}
                >
                  <span className="dispatch-field-label mb-1.5 block text-xs font-medium">
                    Root path
                  </span>
                  <input
                    id={rootPathInputId}
                    value={rootPath}
                    onChange={(event) => setRootPath(event.target.value)}
                    className="dispatch-input w-full rounded-xl px-3 py-2.5 text-sm"
                    placeholder="/home/user/projects/workspace"
                    autoComplete="off"
                    required
                  />
                </label>

                <p className="dispatch-text-tertiary text-xs leading-5">
                  Use a stable folder path so Dispatch can keep launches, browsing, and project scope aligned.
                </p>

                {errorMessage ? (
                  <p
                    className="text-accent-error text-xs"
                    role="alert"
                  >
                    {errorMessage}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    className="dispatch-control rounded-xl px-3 py-1.5 text-xs font-medium"
                    onClick={handleRequestClose}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="dispatch-action-button inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium"
                    disabled={isSubmitting || !name.trim() || !rootPath.trim()}
                  >
                    <FolderPlus size={13} />
                    <span>{isSubmitting ? "Adding..." : "Add project"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
