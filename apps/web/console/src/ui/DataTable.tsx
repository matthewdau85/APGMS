import React from "react";
import { cn } from "./utils";

export interface DataTableColumn<T> {
  key: keyof T | string;
  header: React.ReactNode;
  accessor?: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  caption?: string;
  emptyState?: React.ReactNode;
}

export function DataTable<T>({ data, columns, caption, emptyState }: DataTableProps<T>) {
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="min-w-full divide-y divide-border">
        {caption ? <caption className="px-4 py-2 text-left text-sm text-muted-foreground">{caption}</caption> : null}
        <thead className="bg-muted/50">
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                scope="col"
                className={cn("px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground", column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60 bg-background">
          {data.map((row, idx) => (
            <tr key={idx} className="hover:bg-muted/30">
              {columns.map((column) => (
                <td key={String(column.key)} className={cn("px-4 py-3 text-sm", column.className)}>
                  {column.accessor ? column.accessor(row) : String((row as Record<string, unknown>)[column.key as string] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
