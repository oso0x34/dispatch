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
      className="dispatch-overlay-backdrop fixed inset-0 z-[60] px-4 py-4 backdrop-blur-sm sm:px-5 sm:py-5"
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
          className="dispatch-panel w-full max-w-xl rounded-[24px] px-5 py-5 sm:px-6 sm:py-6"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="dispatch-kicker text-[0.68rem] font-semibold uppercase tracking-[0.24em]">
                Projects
              </p>
              <h2
                id={titleId}
                className="dispatch-heading mt-2 text-2xl font-semibold tracking-tight"
              >
                Add project
              </h2>
              <p
                id={descriptionId}
                className="dispatch-text-secondary mt-2 text-sm leading-6"
              >
                Register an existing workspace directory. Dispatch stores the canonical root in
                Rust and keeps only the active project ID in settings.
              </p>
            </div>

            <button
              ref={closeButtonRef}
              type="button"
              className="dispatch-icon-button flex h-10 w-10 items-center justify-center rounded-xl"
              aria-label="Close add project dialog"
              onClick={handleRequestClose}
              disabled={isSubmitting}
            >
              <X size={16} />
            </button>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label
              className="block"
              htmlFor={nameInputId}
            >
              <span className="dispatch-field-label mb-2 block text-sm font-medium">
                Project name
              </span>
              <input
                ref={nameInputRef}
                id={nameInputId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="dispatch-input w-full rounded-xl px-4 py-3"
                placeholder="Dispatch Workspace"
                autoComplete="off"
                required
              />
            </label>

            <label
              className="block"
              htmlFor={rootPathInputId}
            >
              <span className="dispatch-field-label mb-2 block text-sm font-medium">
                Root path
              </span>
              <input
                id={rootPathInputId}
                value={rootPath}
                onChange={(event) => setRootPath(event.target.value)}
                className="dispatch-input w-full rounded-xl px-4 py-3"
                placeholder="/home/oso0x/projects/workspace"
                autoComplete="off"
                required
              />
            </label>

            {errorMessage ? (
              <div
                className="dispatch-alert rounded-xl px-4 py-3 text-sm"
                role="alert"
              >
                {errorMessage}
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="dispatch-control rounded-xl px-4 py-3 text-sm font-medium"
                onClick={handleRequestClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="dispatch-action-button inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium"
                disabled={isSubmitting}
              >
                <FolderPlus size={16} />
                <span>{isSubmitting ? "Adding project..." : "Add project"}</span>
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
