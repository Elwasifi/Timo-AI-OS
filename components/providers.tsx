'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initToolEngine } from '@/lib/tools/init';
import { AuthGate } from '@/components/auth/auth-gate';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, staleTime: 30000 },
        },
      })
  );

  useEffect(() => {
    initToolEngine();
  }, []);

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={200}>
        <AuthGate>{children}</AuthGate>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
