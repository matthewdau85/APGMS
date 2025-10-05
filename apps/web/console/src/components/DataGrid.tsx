import clsx from "clsx";
import { ReactNode } from "react";

type Alignment = "left" | "center" | "right";

export interface DataGridColumn<T> {
  key: string;
  header: ReactNode;
  render?: (item: T) => ReactNode;
  align?: Alignment;
  className?: string;
  headerClassName?: string;
  cellLabel?: (item: T) => string;
}

export interface DataGridProps<T> {
  data: T[];
  columns: Array<DataGridColumn<T>>;
  getRowId: (item: T) => string;
  caption?: string;
  footer?: ReactNode;
  emptyState?: ReactNode;
  onRowClick?: (item: T) => void;
}

export function DataGrid<T>({
  data,
  columns,
  getRowId,
  caption,
  footer,
  emptyState,
  onRowClick,
}: DataGridProps<T>) {
  const showEmptyState = data.length === 0 && emptyState;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200" role="grid">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={clsx(
                  "px-4 py-3 text-left text-sm font-semibold text-slate-700",
                  column.align === "center" && "text-center",
                  column.align === "right" && "text-right",
                  column.headerClassName,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white" role="rowgroup">
          {data.map((item) => {
            const id = getRowId(item);
            return (
              <tr
                key={id}
                className={clsx(
                  "transition hover:bg-slate-50 focus-within:bg-slate-100",
                  onRowClick && "cursor-pointer",
                )}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => onRowClick?.(item)}
                onKeyDown={(event) => {
                  if (!onRowClick) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(item);
                  }
                }}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={clsx(
                      "whitespace-nowrap px-4 py-3 text-sm text-slate-700",
                      column.align === "center" && "text-center",
                      column.align === "right" && "text-right",
                      column.className,
                    )}
                    aria-label={column.cellLabel?.(item)}
                  >
                    {column.render ? column.render(item) : (item as Record<string, unknown>)[column.key]}
                  </td>
                ))}
              </tr>
            );
          })}
          {showEmptyState && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-slate-600">
                {emptyState}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {footer && <div className="border-t border-slate-200 bg-slate-50 p-3">{footer}</div>}
    </div>
  );
}
