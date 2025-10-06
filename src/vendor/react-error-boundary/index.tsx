import React, { Component, PropsWithChildren, ReactNode } from "react";

export interface FallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  FallbackComponent?: React.ComponentType<FallbackProps>;
  fallback?: ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
  onReset?: () => void;
  resetKeys?: ReadonlyArray<unknown>;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function arrayChanged(a: ReadonlyArray<unknown> | undefined, b: ReadonlyArray<unknown> | undefined) {
  if (a === b) return false;
  if (!a || !b) return true;
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && arrayChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    const { fallback, FallbackComponent, children } = this.props;

    if (error) {
      if (React.isValidElement(fallback)) {
        return fallback;
      }

      if (FallbackComponent) {
        return <FallbackComponent error={error} resetErrorBoundary={this.resetErrorBoundary} />;
      }

      return null;
    }

    return children ?? null;
  }
}

export function withErrorBoundary<P>(
  ComponentToWrap: React.ComponentType<P>,
  errorBoundaryProps: Omit<ErrorBoundaryProps, "children">
) {
  return function ErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <ComponentToWrap {...props} />
      </ErrorBoundary>
    );
  };
}

export function useErrorHandler(initialError?: unknown): never | ((error: unknown) => void) {
  const [error, setError] = React.useState<unknown>(initialError);

  if (error != null) {
    throw error;
  }

  return setError;
}

export function useErrorBoundary() {
  const boundaryRef = React.useRef<{ reset: () => void } | null>(null);

  const reset = React.useCallback(() => {
    boundaryRef.current?.reset();
  }, []);

  const ErrorBoundaryWithRef = React.useCallback(
    ({ children, ...props }: PropsWithChildren<Omit<ErrorBoundaryProps, "children">>) => (
      <InternalErrorBoundary ref={boundaryRef} {...props}>
        {children}
      </InternalErrorBoundary>
    ),
    []
  );

  return { ErrorBoundary: ErrorBoundaryWithRef, reset } as const;
}

interface InternalErrorBoundaryHandle {
  reset: () => void;
}

const InternalErrorBoundary = React.forwardRef<InternalErrorBoundaryHandle, ErrorBoundaryProps>(
  (props, ref) => {
    const { children, ...rest } = props;
    const boundaryRef = React.useRef<ErrorBoundary>(null);

    React.useImperativeHandle(ref, () => ({
      reset: () => boundaryRef.current?.resetErrorBoundary(),
    }));

    return (
      <ErrorBoundary ref={boundaryRef} {...rest}>
        {children}
      </ErrorBoundary>
    );
  }
);

InternalErrorBoundary.displayName = "InternalErrorBoundary";
