import { useState } from "react";
import { useToast } from "./ToastProvider";

export interface CopyToClipboardProps {
  value: string;
  label?: string;
  className?: string;
}

export function CopyToClipboard({ value, label = "Copy", className }: CopyToClipboardProps) {
  const { pushToast } = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopied(true);
      pushToast({ title: "Copied", description: "Value copied to clipboard", tone: "success" });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      pushToast({ title: "Clipboard error", description: "Unable to copy to clipboard", tone: "danger" });
    }
  }

  return (
    <button
      type="button"
      className={
        className ??
        "inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring focus-visible:ring-blue-500/60"
      }
      onClick={handleCopy}
      aria-live="polite"
      aria-label={`Copy ${label}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
