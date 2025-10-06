import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import React from "react";
import { useNavigate } from "@tanstack/react-router";

export interface CommandItem {
  label: string;
  description?: string;
  to: string;
  shortcut?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
}

export function CommandPalette({ open, onOpenChange, items }: CommandPaletteProps) {
  const navigate = useNavigate();

  const onSelect = React.useCallback(
    (to: string) => {
      onOpenChange(false);
      navigate({ to });
    },
    [navigate, onOpenChange],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-28 z-50 w-full max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border bg-background shadow-xl">
          <Command className="flex max-h-[70vh] flex-col gap-2">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Command.Input
                autoFocus
                placeholder="Search destinations, actions, or records..."
                className="h-10 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <Command.List className="overflow-y-auto px-2 pb-4">
              <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
                No results found.
              </Command.Empty>
              <Command.Group heading="Navigation" className="space-y-1">
                {items.map((item) => (
                  <Command.Item
                    key={item.to}
                    className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-muted/60"
                    onSelect={() => onSelect(item.to)}
                  >
                    <div>
                      <div className="font-medium text-foreground">{item.label}</div>
                      {item.description ? (
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      ) : null}
                    </div>
                    {item.shortcut ? (
                      <kbd className="rounded border bg-muted px-2 py-1 text-[10px] uppercase text-muted-foreground">
                        {item.shortcut}
                      </kbd>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
