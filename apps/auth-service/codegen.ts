import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: './schema.graphql',
  generates: {
    './src/__generated__/resolvers-types.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        useIndexSignature: true,
        federation: true,
        contextType: '../types/DataSourceContext#DataSourceContext',
        enumsAsTypes: true,
      },
    },
  },
};

export default config;
