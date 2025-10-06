import { Copy } from "lucide-react";
import React from "react";
import { cn } from "./utils";

interface CodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language = "", className, ...props }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy code", error);
    }
  }, [code]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={copy}
        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md bg-background/80 text-muted-foreground shadow-sm transition hover:text-foreground focus-visible:ring"
      >
        <Copy className="h-4 w-4" />
        <span className="sr-only">Copy code</span>
      </button>
      <pre
        className={cn(
          "overflow-x-auto rounded-lg border bg-sidebar/40 p-4 font-mono text-sm leading-relaxed",
          className,
        )}
        {...props}
      >
        <code className="block">
          {language ? <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">{language}</span> : null}
          {code}
        </code>
      </pre>
      {copied ? (
        <span className="absolute right-4 top-14 rounded-md bg-emerald-500 px-2 py-1 text-xs font-medium text-white shadow">
          Copied!
        </span>
      ) : null}
    </div>
  );
}
