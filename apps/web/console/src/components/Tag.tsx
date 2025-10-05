import clsx from "clsx";
import { ReactNode } from "react";

type TagTone = "default" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<TagTone, string> = {
  default: "bg-slate-100 text-slate-800 ring-slate-200",
  success: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-100 text-amber-800 ring-amber-200",
  danger: "bg-rose-100 text-rose-800 ring-rose-200",
  info: "bg-blue-100 text-blue-800 ring-blue-200",
};

export interface TagProps {
  tone?: TagTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Tag({ tone = "default", children, className, title }: TagProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        toneClasses[tone],
        className,
      )}
      role="status"
      aria-label={typeof children === "string" ? children : title}
      title={title}
    >
      {children}
    </span>
  );
}
