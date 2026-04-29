'use client';

import { ApolloProvider as BaseApolloProvider } from '@apollo/client/react';
import { getApolloClient } from './apollo-client';

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  const client = getApolloClient();
  return (
    <BaseApolloProvider client={client}>
      {children}
    </BaseApolloProvider>
  );
}
