import {
  Component,
  Fragment,
  type ErrorInfo,
  type ReactNode,
} from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  surfaceName?: string;
};

type ErrorBoundaryState = {
  errorMessage: string | null;
  retryCount: number;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    errorMessage: null,
    retryCount: 0,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      errorMessage: toErrorMessage(error),
      retryCount: 0,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `Dispatch surface error${this.props.surfaceName ? ` (${this.props.surfaceName})` : ""}`,
      error,
      errorInfo,
    );
  }

  public render() {
    if (this.state.errorMessage) {
      const surfaceName = this.props.surfaceName ?? "surface";

      return (
        <section className="dispatch-surface rounded-[24px] p-6 sm:p-7">
          <p className="dispatch-eyebrow text-xs font-semibold uppercase tracking-[0.28em]">
            Surface Failure
          </p>

          <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-tight sm:text-[2rem]">
            {surfaceName} hit a recoverable error.
          </h2>

          <p className="mt-4 max-w-2xl text-sm leading-7 sm:text-[0.95rem]">
            The rest of the Dispatch shell is still running. Retry this surface to remount it
            without tearing down the full app.
          </p>

          <div className="dispatch-alert mt-5 rounded-2xl px-4 py-3 text-sm">
            {this.state.errorMessage}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="dispatch-control rounded-xl px-4 py-2 text-sm font-medium"
              onClick={this.handleRetry}
            >
              Retry Surface
            </button>
          </div>
        </section>
      );
    }

    return <Fragment key={this.state.retryCount}>{this.props.children}</Fragment>;
  }

  private handleRetry = () => {
    this.setState((current) => ({
      errorMessage: null,
      retryCount: current.retryCount + 1,
    }));
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
    && error.message.trim().length > 0
  ) {
    return error.message;
  }

  return "Dispatch hit an unexpected surface error.";
}
