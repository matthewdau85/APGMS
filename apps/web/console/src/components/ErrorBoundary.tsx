import React from "react";

interface ErrorBoundaryProps {
  onReset?: () => void;
  fallback: (args: { error: Error; resetErrorBoundary: () => void }) => React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Global error boundary captured an error", error, info);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, resetErrorBoundary: this.reset });
    }
    return this.props.children;
  }
}
