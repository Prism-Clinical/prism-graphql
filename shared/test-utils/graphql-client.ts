/**
 * GraphQL Test Client
 *
 * Utility for making GraphQL requests in integration tests.
 */

export interface GraphQLError {
  message: string;
  path?: string[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: GraphQLError[];
}

export interface GraphQLClientConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface GraphQLClient {
  request<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<T>>;
  query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T>;
  mutate<T = unknown>(
    mutation: string,
    variables?: Record<string, unknown>
  ): Promise<T>;
  healthCheck(): Promise<boolean>;
  getSchemaTypes(): Promise<string[]>;
}

/**
 * Creates a GraphQL client for testing
 */
export function createGraphQLClient(config: GraphQLClientConfig): GraphQLClient {
  const { url, headers = {} } = config;

  async function request<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async function query<T = unknown>(
    queryStr: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const result = await request<T>(queryStr, variables);

    if (result.errors && result.errors.length > 0) {
      const errorMessages = result.errors.map((e: GraphQLError) => e.message).join(', ');
      throw new Error(`GraphQL errors: ${errorMessages}`);
    }

    if (!result.data) {
      throw new Error('No data returned from GraphQL query');
    }

    return result.data;
  }

  async function mutate<T = unknown>(
    mutation: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    return query<T>(mutation, variables);
  }

  async function healthCheck(): Promise<boolean> {
    try {
      const result = await request<{ __typename: string }>('{ __typename }');
      return result.data?.__typename === 'Query';
    } catch {
      return false;
    }
  }

  async function getSchemaTypes(): Promise<string[]> {
    const result = await query<{
      __schema: { types: Array<{ name: string }> };
    }>('{ __schema { types { name } } }');

    return result.__schema.types.map((t: { name: string }) => t.name);
  }

  return {
    request,
    query,
    mutate,
    healthCheck,
    getSchemaTypes,
  };
}

// Default service URLs
export const SERVICE_URLS = {
  GATEWAY: process.env.TEST_GATEWAY_URL || 'http://localhost:4000',
  PATIENTS: process.env.TEST_PATIENTS_URL || 'http://localhost:4002',
  PROVIDERS: process.env.TEST_PROVIDERS_URL || 'http://localhost:4003',
  RECOMMENDATIONS: process.env.TEST_RECOMMENDATIONS_URL || 'http://localhost:4001',
  RECOMMENDATION_ITEMS: process.env.TEST_RECOMMENDATION_ITEMS_URL || 'http://localhost:4004',
  INSTITUTIONS: process.env.TEST_INSTITUTIONS_URL || 'http://localhost:4005',
  EPIC_API: process.env.TEST_EPIC_API_URL || 'http://localhost:4006',
  // CISS Services
  TRANSCRIPTION: process.env.TEST_TRANSCRIPTION_URL || 'http://localhost:4007',
  RAG: process.env.TEST_RAG_URL || 'http://localhost:4008',
  SAFETY: process.env.TEST_SAFETY_URL || 'http://localhost:4009',
  CAREPLAN: process.env.TEST_CAREPLAN_URL || 'http://localhost:4010',
};

// Pre-configured clients
export const gatewayClient = createGraphQLClient({ url: SERVICE_URLS.GATEWAY });
export const transcriptionClient = createGraphQLClient({ url: SERVICE_URLS.TRANSCRIPTION });
export const ragClient = createGraphQLClient({ url: SERVICE_URLS.RAG });
export const safetyClient = createGraphQLClient({ url: SERVICE_URLS.SAFETY });
export const careplanClient = createGraphQLClient({ url: SERVICE_URLS.CAREPLAN });
