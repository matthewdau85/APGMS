import React from "react";
import { cn } from "./utils";

export function Form({ className, ...props }: React.FormHTMLAttributes<HTMLFormElement>) {
  return <form className={cn("space-y-6", className)} {...props} />;
}

export function FormField({
  label,
  description,
  error,
  className,
  children,
  id,
}: {
  label: string;
  description?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function FormActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-3", className)} {...props} />
  );
}
