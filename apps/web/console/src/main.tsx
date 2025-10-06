import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import {
  RouterProvider,
  RootRoute,
  Route,
  createRouter,
} from "@tanstack/react-router";
import { RouterDevtools } from "@tanstack/router-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, AppShell } from "./ui";
import {
  AdminPage,
  BasPage,
  DashboardPage,
  EvidencePage,
  HelpPage,
  PaymentsPage,
  ReconPage,
  SettingsPage,
} from "./pages";

const queryClient = new QueryClient();

const rootRoute = new RootRoute({
  component: RootLayout,
});

const dashboardRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const basRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "bas",
  component: BasPage,
});

const reconRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "recon",
  component: ReconPage,
});

const evidenceRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "evidence",
  component: EvidencePage,
});

const paymentsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "payments",
  component: PaymentsPage,
});

const settingsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsPage,
});

const helpRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "help",
  component: HelpPage,
});

const adminRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "admin",
  component: AdminPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  basRoute,
  reconRoute,
  evidenceRoute,
  paymentsRoute,
  settingsRoute,
  helpRoute,
  adminRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppShell />
        {import.meta.env.DEV ? <RouterDevtools position="bottom-right" /> : null}
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />);
