import { Pool } from 'pg';
import { Redis } from 'ioredis';

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  userType: 'ADMIN' | 'PROVIDER';
  roles: string[];
  institutionId?: string;
  providerId?: string;
  status: string;
  emailVerified: boolean;
}

export interface DataSourceContext {
  pool: Pool;
  redis: Redis;
  user?: AuthenticatedUser;
}
