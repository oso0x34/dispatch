import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  errorMessage: string | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    errorMessage: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      errorMessage: error.message,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Dispatch surface error", error, errorInfo);
  }

  public render() {
    if (this.state.errorMessage) {
      return (
        <div className="dispatch-alert rounded-2xl px-4 py-3 text-sm">
          {this.state.errorMessage}
        </div>
      );
    }

    return this.props.children;
  }
}
