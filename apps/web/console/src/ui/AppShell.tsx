import React from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  AppWindow,
  BadgeCheck,
  BookOpen,
  CircleGauge,
  CreditCard,
  LifeBuoy,
  Menu,
  Search,
  ShieldCheck,
  Sun,
  Moon,
  Wallet,
} from "lucide-react";
import { Button } from "./Button";
import { Drawer, DrawerContent } from "./Drawer";
import { useTheme } from "./theme";
import { CommandPalette, type CommandItem } from "./CommandPalette";
import { cn } from "./utils";

export interface AppShellNavItem extends CommandItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const navItems: AppShellNavItem[] = [
  { label: "BAS", description: "Business activity statements", to: "/bas", icon: BadgeCheck },
  { label: "Dashboard", description: "Operational overview", to: "/", icon: CircleGauge },
  { label: "Recon", description: "Reconciliation workbench", to: "/recon", icon: ShieldCheck },
  { label: "Evidence", description: "Supporting documents", to: "/evidence", icon: Wallet },
  { label: "Payments", description: "Payment tracking", to: "/payments", icon: CreditCard },
  { label: "Settings", description: "Configuration and preferences", to: "/settings", icon: AppWindow },
  { label: "Help", description: "Guides and documentation", to: "/help", icon: BookOpen },
  { label: "Admin", description: "Operations toolkit", to: "/admin", icon: LifeBuoy },
];

export function useNavItems() {
  return navItems;
}

export function AppShell() {
  const [isDrawerOpen, setDrawerOpen] = React.useState(false);
  const [isCommandOpen, setCommandOpen] = React.useState(false);
  const { mode, resolved, toggle, setMode } = useTheme();
  const routerState = useRouterState();

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [routerState.location.href]);

  const themeLabel = mode === "system" ? `System (${resolved})` : mode;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="hidden w-64 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 items-center gap-3 border-b px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <CircleGauge className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              APGMS Console
            </p>
            <p className="text-base font-semibold">Operations Studio</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <NavLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="border-t px-4 py-4 text-xs text-muted-foreground">
          <p className="font-medium uppercase tracking-wide">Theme</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant={mode === "light" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("light")}
            >
              Light
            </Button>
            <Button
              variant={mode === "dark" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("dark")}
            >
              Dark
            </Button>
            <Button
              variant={mode === "system" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("system")}
            >
              System
            </Button>
          </div>
          <p className="mt-4 text-muted-foreground">Resolved: {themeLabel}</p>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-16 items-center gap-3 px-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">Open navigation</span>
            </Button>
            <div className="hidden items-center gap-3 lg:flex">
              <BadgeCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <div className="leading-tight">
                <p className="text-sm font-semibold">APGMS Console</p>
                <p className="text-xs text-muted-foreground">Operational analytics and workflows</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                className="hidden h-10 min-w-[240px] items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-left text-sm text-muted-foreground transition hover:text-foreground focus-visible:ring sm:flex"
              >
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Search the console...
                </span>
                <kbd className="ml-auto rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  ⌘K
                </kbd>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden"
                onClick={() => setCommandOpen(true)}
              >
                <Search className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Open command palette</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={toggle}>
                {resolved === "dark" ? (
                  <Sun className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Moon className="h-5 w-5" aria-hidden="true" />
                )}
                <span className="sr-only">Toggle theme</span>
              </Button>
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-gradient-to-br from-primary/80 to-primary"
                role="img"
                aria-label="Current user avatar"
              >
                <span className="text-sm font-semibold text-primary-foreground">AD</span>
              </div>
            </div>
          </div>
        </header>
        <main id="main" className="flex-1 space-y-6 px-4 pb-10 pt-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <Drawer open={isDrawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <div className="flex h-16 items-center gap-3 border-b px-4">
            <CircleGauge className="h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">APGMS Console</p>
              <p className="text-base font-semibold">Operations Studio</p>
            </div>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {navItems.map((item) => (
              <NavLink key={item.to} item={item} />
            ))}
          </nav>
        </DrawerContent>
      </Drawer>
      <CommandPalette open={isCommandOpen} onOpenChange={setCommandOpen} items={navItems} />
    </div>
  );
}

function NavLink({ item }: { item: AppShellNavItem }) {
  const routerState = useRouterState();
  const isActive = routerState.location.pathname === item.to;
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:ring",
        isActive
          ? "bg-primary/10 text-primary shadow-inner"
          : "text-sidebar-foreground/80 hover:bg-sidebar/60",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}
