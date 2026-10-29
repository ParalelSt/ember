'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/** One more try for a query that failed, unless the server refused it (a
 *  4xx, carried as `status` by lib/api): asked again a second later it says
 *  the same, and a rate-limited one (429) only meets the limit again. */
export function queryRetry(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return failureCount < 1;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: queryRetry,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
