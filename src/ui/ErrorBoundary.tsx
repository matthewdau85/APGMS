import { ReactNode } from "react";
import { ErrorBoundary as EB } from "react-error-boundary";

export function ErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <EB
      FallbackComponent={({ error }) => (
        <div style={{ padding: 12, background: "#fee2e2" }}>
          Error: {String(error?.message || error)}
        </div>
      )}
    >
      {children}
    </EB>
  );
}
