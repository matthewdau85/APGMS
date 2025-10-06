import React from "react";
import { cn } from "./utils";

interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "info" | "success" | "warning" | "error";
}

const toneStyles: Record<NonNullable<BannerProps["tone"]>, string> = {
  info: "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
  success:
    "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
  warning:
    "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
  error: "bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200",
};

export function Banner({ tone = "info", className, children, ...props }: BannerProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-transparent px-4 py-3 text-sm",
        toneStyles[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
