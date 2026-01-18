import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { generateToken, hashToken } from '../utils/validation';
import { createRefreshToken, getRefreshToken, revokeRefreshToken, revokeAllUserRefreshTokens } from './database';

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

export interface TokenPayload {
  userId: string;
  email: string;
  userType: 'ADMIN' | 'PROVIDER';
  roles: string[];
  institutionId?: string;
  providerId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

export async function generateTokenPair(pool: Pool, payload: TokenPayload): Promise<TokenPair> {
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateToken(64);
  const refreshTokenHash = hashToken(refreshToken);

  await createRefreshToken(pool, payload.userId, payload.userType, refreshTokenHash, REFRESH_TOKEN_EXPIRES_IN_DAYS);

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutes in seconds
  };
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

export async function refreshAccessToken(pool: Pool, refreshToken: string): Promise<TokenPair | null> {
  const refreshTokenHash = hashToken(refreshToken);
  const storedToken = await getRefreshToken(pool, refreshTokenHash);

  if (!storedToken) {
    return null;
  }

  if (new Date() > storedToken.expires_at) {
    await revokeRefreshToken(pool, refreshTokenHash);
    return null;
  }

  // Revoke the old refresh token (rotation)
  await revokeRefreshToken(pool, refreshTokenHash);

  // We need to get the user data to create a new token pair
  // This will be done in the resolver with the proper user lookup
  return null;
}

export async function revokeUserTokens(pool: Pool, userId: string, userType: 'ADMIN' | 'PROVIDER'): Promise<void> {
  await revokeAllUserRefreshTokens(pool, userId, userType);
}

export async function blacklistAccessToken(redis: Redis, token: string, expiresInSeconds: number = 900): Promise<void> {
  await redis.setex(`blacklist:${token}`, expiresInSeconds, '1');
}

export async function isAccessTokenBlacklisted(redis: Redis, token: string): Promise<boolean> {
  const result = await redis.get(`blacklist:${token}`);
  return result === '1';
}
