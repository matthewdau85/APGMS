import { QueryClient, useQuery } from "@tanstack/react-query";

type CapabilityStatus = "online" | "degraded" | "offline";

export interface CapabilityDescriptor {
  id: string;
  name: string;
  status: CapabilityStatus;
  summary: string;
}

export interface ConsoleMode {
  label: string;
  tone: "operational" | "maintenance" | "emergency";
  description: string;
}

export interface KillSwitchState {
  active: boolean;
  message?: string;
  activatedAt?: string;
}

export interface ConsoleData {
  mode: ConsoleMode;
  killSwitch: KillSwitchState;
  capabilityMatrix: CapabilityDescriptor[];
  lastUpdated: string;
}

export const queryClient = new QueryClient();

async function fetchConsoleData(): Promise<ConsoleData> {
  // In lieu of a live backend, mock the values with a short async boundary so
  // React Query behaves as it would with a remote request.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    mode: {
      label: "Operations",
      tone: "operational",
      description: "Live production data with automatic safeguards enabled.",
    },
    killSwitch: {
      active: false,
      message: undefined,
      activatedAt: undefined,
    },
    capabilityMatrix: [
      {
        id: "alerts",
        name: "Alerting",
        status: "online",
        summary: "Pipeline and escalation policies are functioning normally.",
      },
      {
        id: "reporting",
        name: "Reporting",
        status: "degraded",
        summary: "Scheduled exports are delayed ~15 minutes while caches warm.",
      },
      {
        id: "workflows",
        name: "Workflows",
        status: "online",
        summary: "Automation rules are executing across all tenants.",
      },
      {
        id: "integrations",
        name: "Integrations",
        status: "offline",
        summary: "Third-party CRM syncs are paused pending credential rotation.",
      },
    ],
    lastUpdated: new Date().toISOString(),
  };
}

export function useConsoleData() {
  return useQuery({
    queryKey: ["console", "status"],
    queryFn: fetchConsoleData,
    staleTime: 30_000,
  });
}
