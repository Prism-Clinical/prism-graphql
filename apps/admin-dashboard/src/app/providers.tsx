'use client';

import { ApolloProvider } from '@/lib/apollo-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ApolloProvider>
      {children}
    </ApolloProvider>
  );
}
