import React from "react";
import { ErrorBoundary, FallbackProps } from "react-error-boundary";

type AppErrorBoundaryProps = React.PropsWithChildren<{
  heading?: string;
}>;

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div
      role="alert"
      style={{
        margin: "2rem auto",
        maxWidth: 480,
        borderRadius: 12,
        padding: "1.5rem",
        background: "#fff1f2",
        color: "#9f1239",
        boxShadow: "0 20px 45px rgba(15, 23, 42, 0.12)",
      }}
    >
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        Something went wrong
      </h2>
      <p style={{ fontSize: "0.95rem", lineHeight: 1.5, marginBottom: "1rem" }}>
        We hit an unexpected error while rendering the application. You can try to recover by reloading the page.
      </p>
      <pre
        style={{
          background: "#fff",
          padding: "0.75rem",
          borderRadius: 8,
          fontSize: "0.8rem",
          overflowX: "auto",
          marginBottom: "1rem",
          color: "#881337",
        }}
      >
        {error.message}
      </pre>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          type="button"
          onClick={resetErrorBoundary}
          style={{
            background: "#be123c",
            color: "#fff",
            border: "none",
            padding: "0.6rem 1.25rem",
            borderRadius: 9999,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: "transparent",
            color: "#be123c",
            border: "1px solid #be123c",
            padding: "0.6rem 1.25rem",
            borderRadius: 9999,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

export function AppErrorBoundary({ children }: AppErrorBoundaryProps) {
  return <ErrorBoundary FallbackComponent={ErrorFallback}>{children}</ErrorBoundary>;
}
