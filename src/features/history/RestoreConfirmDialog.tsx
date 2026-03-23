import {
  AlertTriangle,
  LoaderCircle,
} from "lucide-react";

type RestoreConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function RestoreConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  isSubmitting,
  onConfirm,
  onCancel,
}: RestoreConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="dispatch-overlay-backdrop fixed inset-0 z-30 flex items-center justify-center px-4"
      onMouseDown={(event) => {
        // Close when clicking backdrop, but not during submission
        if (event.target === event.currentTarget && !isSubmitting) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dispatch-panel w-full max-w-lg rounded-[1.35rem] border border-[rgba(251,191,36,0.16)] bg-[linear-gradient(180deg,rgba(24,17,13,0.96),rgba(12,13,18,0.98))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="flex gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 shadow-[0_10px_24px_rgba(248,113,113,0.14)]">
            <AlertTriangle size={18} className="text-rose-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
              Restore confirmation
            </p>
            <h3 className="dispatch-text-primary mt-2 text-[0.98rem] font-semibold leading-tight">
              {title}
            </h3>
            <p className="dispatch-text-secondary mt-3 text-[0.78rem] leading-6">
              {description}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-[1rem] border border-[rgba(251,191,36,0.16)] bg-[linear-gradient(180deg,rgba(251,191,36,0.09),rgba(251,191,36,0.04))] px-4 py-3">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[rgba(255,233,187,0.82)]">
            Confirm checkpoint
          </p>
          <p className="dispatch-text-secondary mt-2 text-[0.74rem] leading-6">
            This action applies immediately to your current workspace state. Use it only when you want to roll back to the selected history snapshot.
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            className="dispatch-icon-button rounded-[0.8rem] px-3.5 py-2 text-xs font-medium"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            className="dispatch-danger-button inline-flex items-center justify-center gap-1.5 rounded-[0.8rem] px-3.5 py-2 text-xs font-medium"
            onClick={onConfirm}
          >
            {isSubmitting ? <LoaderCircle className="animate-spin" size={12} /> : null}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
