import { ApolloClient, InMemoryCache, HttpLink, from } from '@apollo/client/core';
import { ErrorLink } from '@apollo/client/link/error';
import { CombinedGraphQLErrors } from '@apollo/client/errors';

const httpLink = new HttpLink({
  uri: typeof window !== 'undefined'
    ? '/graphql'
    : (process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:4000/graphql'),
});

const errorLink = new ErrorLink(({ error }) => {
  if (CombinedGraphQLErrors.is(error)) {
    error.errors.forEach((graphqlError) => {
      console.error(
        `[GraphQL error]: ${graphqlError.message}`,
        graphqlError.locations,
        graphqlError.path
      );
    });
  } else {
    console.error(`[Network error]: ${error}`);
  }
});

let apolloClient: ApolloClient | null = null;

function createApolloClient(): ApolloClient {
  return new ApolloClient({
    ssrMode: typeof window === 'undefined',
    link: from([errorLink, httpLink]),
    cache: new InMemoryCache({
      typePolicies: {
        Pathway: {
          keyFields: ['id'],
        },
      },
    }),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
        errorPolicy: 'all',
      },
      query: {
        fetchPolicy: 'cache-first',
        errorPolicy: 'all',
      },
      mutate: {
        errorPolicy: 'all',
      },
    },
  });
}

export function getApolloClient(): ApolloClient {
  if (typeof window === 'undefined') {
    return createApolloClient();
  }
  if (!apolloClient) {
    apolloClient = createApolloClient();
  }
  return apolloClient;
}
