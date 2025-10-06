import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, type BasMessage, type SettingsPayload, type Connection, type ConnectionStartResponse, type ConnectionStart } from "./client";
import { pushToast } from "../components/toast/store";

export const queryKeys = {
  dashboard: ["dashboard", "summary"] as const,
  transactions: (filters?: { q?: string; source?: string }) => ["transactions", filters ?? {}] as const,
  atoStatus: ["ato", "status"] as const,
  basPreview: ["bas", "preview"] as const,
  settings: ["settings"] as const,
  connections: ["connections"] as const,
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => apiClient.getDashboardSummary(),
  });
}

export function useTransactions(filters?: { q?: string; source?: string }) {
  return useQuery({
    queryKey: queryKeys.transactions(filters),
    queryFn: () => apiClient.getTransactions(filters),
  });
}

export function useAtoStatus() {
  return useQuery({
    queryKey: queryKeys.atoStatus,
    queryFn: () => apiClient.getAtoStatus(),
  });
}

export function useBasPreview() {
  return useQuery({
    queryKey: queryKeys.basPreview,
    queryFn: () => apiClient.getBasPreview(),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => apiClient.getSettings(),
  });
}

export function useConnections() {
  return useQuery({
    queryKey: queryKeys.connections,
    queryFn: () => apiClient.listConnections(),
  });
}

export function useSaveSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SettingsPayload) => apiClient.saveSettings(payload),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings });
      const previous = queryClient.getQueryData<SettingsPayload>(queryKeys.settings);
      queryClient.setQueryData(queryKeys.settings, payload);
      return { previous };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.settings, context.previous);
      }
    },
    onSuccess: response => {
      queryClient.setQueryData(queryKeys.settings, response.settings);
      pushToast({
        intent: "success",
        title: "Settings updated",
        description: "Retention and masking preferences saved.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

export function useValidateBasMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.validateBas(),
    onSuccess: (response: BasMessage) => {
      pushToast({
        intent: "success",
        title: "BAS validated",
        description: response.message,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.basPreview });
    },
  });
}

export function useLodgeBasMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.lodgeBas(),
    onSuccess: (response: BasMessage) => {
      pushToast({
        intent: "success",
        title: "BAS lodged",
        description: response.message,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.basPreview });
    },
  });
}

export function useStartConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConnectionStart) => apiClient.startConnection(payload),
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey: queryKeys.connections });
      const previous = queryClient.getQueryData<Connection[]>(queryKeys.connections);
      if (previous) {
        const optimistic: Connection = {
          id: Date.now() * -1,
          provider: payload.provider,
          type: payload.type,
          status: "pending",
        };
        queryClient.setQueryData(queryKeys.connections, [...previous, optimistic]);
        return { previous };
      }
      return { previous };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.connections, context.previous);
      }
    },
    onSuccess: (response: ConnectionStartResponse, variables) => {
      pushToast({
        intent: "info",
        title: "Connection started",
        description: `Follow the redirect to finish connecting ${variables.provider}.`,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      if (typeof window !== "undefined") {
        window.open(response.url, "_blank", "noopener,noreferrer");
      }
    },
  });
}

export function useDeleteConnectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connId: number) => apiClient.deleteConnection(connId),
    onMutate: async connId => {
      await queryClient.cancelQueries({ queryKey: queryKeys.connections });
      const previous = queryClient.getQueryData<Connection[]>(queryKeys.connections);
      if (previous) {
        queryClient.setQueryData(
          queryKeys.connections,
          previous.filter(connection => connection.id !== connId)
        );
      }
      return { previous };
    },
    onError: (_error, _connId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.connections, context.previous);
      }
    },
    onSuccess: () => {
      pushToast({
        intent: "success",
        title: "Connection removed",
        description: "The provider was disconnected.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    },
  });
}
