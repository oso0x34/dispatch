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
      const surfaceName = this.props.surfaceName ?? "This panel";

      return (
        <section className="flex h-full items-start justify-center px-4 py-6">
          <div className="w-full max-w-sm">
            <h2 className="dispatch-text-primary text-sm font-semibold">
              {surfaceName} encountered an error
            </h2>

            <p className="dispatch-text-secondary mt-1 text-xs leading-5">
              The rest of Dispatch is still running normally.
            </p>

            <p className="dispatch-text-muted mt-2 rounded-md bg-[var(--surface-soft)] px-3 py-2 font-mono text-[0.7rem] leading-relaxed">
              {this.state.errorMessage}
            </p>

            <button
              type="button"
              className="dispatch-control mt-3 rounded-md px-3 py-1.5 text-xs font-medium"
              onClick={this.handleRetry}
            >
              Retry
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
