import * as React from "react";

export interface FallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

export interface ErrorBoundaryProps {
  children?: React.ReactNode;
  FallbackComponent?: React.ComponentType<FallbackProps>;
  fallback?: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
  onReset?: () => void;
  resetKeys?: ReadonlyArray<unknown>;
}

export declare class ErrorBoundary extends React.Component<ErrorBoundaryProps> {}

export declare function withErrorBoundary<P>(
  component: React.ComponentType<P>,
  props: Omit<ErrorBoundaryProps, "children">
): React.ComponentType<P>;

export declare function useErrorHandler(initialError?: unknown): never | ((error: unknown) => void);

export declare function useErrorBoundary(): {
  ErrorBoundary: React.ComponentType<React.PropsWithChildren<Omit<ErrorBoundaryProps, "children">>>;
  reset: () => void;
};
