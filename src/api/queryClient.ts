import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { pushToast } from "../components/toast/store";
import { ApiError } from "./client";

const DEFAULT_STALE_TIME = 60 * 1000;
const DEFAULT_RETRY = 2;

const handleError = (error: unknown) => {
  let description = "Something went wrong";
  let requestId: string | undefined;

  if (error instanceof ApiError) {
    description = error.message || description;
    requestId = error.requestId;
  } else if (error instanceof Error) {
    description = error.message || description;
  }

  pushToast({
    title: "Request failed",
    description,
    intent: "error",
    requestId,
  });
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME,
      retry: DEFAULT_RETRY,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
});
