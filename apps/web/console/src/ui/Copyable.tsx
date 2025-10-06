import { Check, Copy } from "lucide-react";
import React from "react";
import { cn } from "./utils";

interface CopyableProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  label?: string;
}

export function Copyable({ value, label, className, ...props }: CopyableProps) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy", error);
    }
  }, [value]);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm",
        className,
      )}
      {...props}
    >
      <div className="truncate">
        {label ? <span className="mr-2 font-medium text-muted-foreground">{label}</span> : null}
        <code className="truncate font-mono text-foreground">{value}</code>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition hover:text-foreground focus-visible:ring"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        <span className="sr-only">Copy {label ?? "value"}</span>
      </button>
    </div>
  );
}
