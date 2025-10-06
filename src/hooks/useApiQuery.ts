import { useCallback } from "react";
import { useQuery, UseQueryOptions, UseQueryResult } from "../queryClient";
import { ApiError } from "../api/client";
import { useToast } from "../context/ToastContext";

type QueryKey = readonly unknown[];

type ExtendedOptions<TData> = Omit<UseQueryOptions<TData>, "queryKey" | "queryFn"> & {
  errorMessage: string;
};

export function useApiQuery<TData>(
  queryKey: QueryKey,
  queryFn: () => Promise<TData>,
  { errorMessage, ...options }: ExtendedOptions<TData>
): UseQueryResult<TData> {
  const toast = useToast();

  const onError = useCallback(
    (error: unknown) => {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(0, error instanceof Error ? error.message : "Unknown error");
      toast.push({
        title: errorMessage,
        message: apiError.message,
        requestId: apiError.requestId,
        variant: "error",
      });
    },
    [errorMessage, toast]
  );

  return useQuery({
    queryKey,
    queryFn,
    onError,
    ...options,
  });
}
