import React from "react";
import { cn } from "./utils";

export function Spinner({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex h-5 w-5 animate-spin items-center justify-center rounded-full border-2 border-muted-foreground/40 border-t-primary",
        className,
      )}
      role="status"
      aria-live="polite"
      {...props}
    >
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-md bg-muted/80 bg-[linear-gradient(110deg,rgba(255,255,255,0),rgba(255,255,255,0.6),rgba(255,255,255,0))] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}
