'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

export const queryKeys = {
  me: ['auth', 'me'] as const,
  professionals: ['professionals'] as const,
  professional: (id: string) => ['professionals', id] as const,
  slots: (id: string, excludeSessionId?: string) =>
    excludeSessionId
      ? (['slots', id, { excludeSessionId }] as const)
      : (['slots', id] as const),
  sessions: ['sessions'] as const,
  availability: ['availability', 'me'] as const,
  notifications: ['notifications'] as const,
};

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: false,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
