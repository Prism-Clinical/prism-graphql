import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { readFileSync } from 'fs';
import { parse } from 'graphql';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { resolvers } from './resolvers';
import { DataSourceContext, AuthenticatedUser } from './types/DataSourceContext';
import { verifyAccessToken } from './services/token.service';
import { getAdminUserById, getProviderUserById, getInstitutionById } from './services/database';

const PORT = process.env.PORT || 4012;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'healthcare',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
});

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
});

async function getUserFromToken(token: string): Promise<AuthenticatedUser | undefined> {
  const payload = verifyAccessToken(token);
  if (!payload) return undefined;

  if (payload.userType === 'ADMIN') {
    const user = await getAdminUserById(pool, payload.userId);
    if (!user) return undefined;

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      userType: 'ADMIN',
      roles: [user.role],
      status: user.status,
      emailVerified: user.email_verified,
    };
  } else {
    const user = await getProviderUserById(pool, payload.userId);
    if (!user) return undefined;

    const institution = user.institution_id
      ? await getInstitutionById(pool, user.institution_id)
      : null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      userType: 'PROVIDER',
      roles: [user.role],
      institutionId: institution?.id,
      providerId: user.id,
      status: user.status,
      emailVerified: user.email_verified,
    };
  }
}

async function startServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy' });
  });

  app.get('/.well-known/apollo/server-health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'pass' });
  });

  const typeDefs = parse(readFileSync('./schema.graphql', 'utf-8'));

  const server = new ApolloServer<DataSourceContext>({
    schema: buildSubgraphSchema({ typeDefs, resolvers }),
    introspection: true,
  });

  await server.start();

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req }): Promise<DataSourceContext> => {
        const authHeader = req.headers.authorization;
        let user: AuthenticatedUser | undefined;

        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          user = await getUserFromToken(token);
        }

        return {
          pool,
          redis,
          user,
        };
      },
    })
  );

  app.listen(PORT, () => {
    console.log(`Auth Service running at http://localhost:${PORT}/graphql`);
    console.log(`Health check at http://localhost:${PORT}/health`);
  });
}

startServer().catch(console.error);
