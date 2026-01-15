'use client';

import { ApolloProvider } from '@apollo/client';
import { apolloClient } from './apollo-client';
import { AuthProvider } from '@/contexts/AuthContext';

export function ApolloWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ApolloProvider client={apolloClient}>
      <AuthProvider>{children}</AuthProvider>
    </ApolloProvider>
  );
}
