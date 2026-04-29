import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/graphql',
        destination: process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:4000/graphql',
      },
    ];
  },
};

export default nextConfig;
