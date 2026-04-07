import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[400px] w-full flex-col items-center justify-center rounded-lg border border-red-100 bg-red-50 p-8 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle size={32} />
          </div>
          <h2 className="mb-2 text-xl font-bold text-slate-800">Something went wrong</h2>
          <p className="mb-6 max-w-md text-sm text-slate-600">
            An error occurred while rendering this component. This usually happens due to missing data or a temporary connection issue.
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => (window.location.href = "/")}
              className="border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              Go to Home
            </Button>
            <Button
              onClick={this.handleReset}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <div className="mt-8 w-full max-w-2xl overflow-auto rounded border border-red-200 bg-white p-4 text-left text-xs text-red-500 font-mono">
              {this.state.error.toString()}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
