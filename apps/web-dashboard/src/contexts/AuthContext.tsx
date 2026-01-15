'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useMutation, useLazyQuery } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { LOGIN, LOGOUT, REFRESH_TOKEN, PROVIDER_SIGNUP } from '@/lib/graphql/mutations/auth';
import { ME } from '@/lib/graphql/queries/auth';

interface User {
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

interface SignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  npi: string;
  institutionCode: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, redirectTo?: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ACCESS_TOKEN_KEY = 'prism_access_token';
const REFRESH_TOKEN_KEY = 'prism_refresh_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setCookie(name: string, value: string, days: number = 7): void {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  // Also set cookies for middleware SSR auth checks
  setCookie(ACCESS_TOKEN_KEY, accessToken, 1); // 1 day for access token
  setCookie(REFRESH_TOKEN_KEY, refreshToken, 7); // 7 days for refresh token
}

function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  // Also clear cookies
  deleteCookie(ACCESS_TOKEN_KEY);
  deleteCookie(REFRESH_TOKEN_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const [loginMutation] = useMutation(LOGIN);
  const [signupMutation] = useMutation(PROVIDER_SIGNUP);
  const [logoutMutation] = useMutation(LOGOUT);
  const [refreshTokenMutation] = useMutation(REFRESH_TOKEN);
  const [getMe] = useLazyQuery(ME, {
    fetchPolicy: 'network-only',
  });

  const refreshAuth = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const { data } = await refreshTokenMutation({
        variables: { input: { refreshToken } },
      });

      if (data?.refreshToken) {
        setTokens(data.refreshToken.accessToken, data.refreshToken.refreshToken);
        setUser(data.refreshToken.user);
      } else {
        clearTokens();
        setUser(null);
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
      clearTokens();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [refreshTokenMutation]);

  const checkAuth = useCallback(async () => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      await refreshAuth();
      return;
    }

    try {
      const { data } = await getMe();
      if (data?.me) {
        setUser(data.me);
      } else {
        await refreshAuth();
      }
    } catch (error) {
      console.error('Failed to get current user:', error);
      await refreshAuth();
    } finally {
      setIsLoading(false);
    }
  }, [getMe, refreshAuth]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email: string, password: string, redirectTo?: string) => {
    const { data } = await loginMutation({
      variables: {
        input: {
          email,
          password,
          userType: 'PROVIDER',
        },
      },
    });

    if (data?.login) {
      setTokens(data.login.accessToken, data.login.refreshToken);
      setUser(data.login.user);
      router.push(redirectTo || '/dashboard');
    }
  };

  const signup = async (input: SignupInput): Promise<{ success: boolean; message: string }> => {
    const { data } = await signupMutation({
      variables: {
        input: {
          email: input.email,
          password: input.password,
          firstName: input.firstName,
          lastName: input.lastName,
          npi: input.npi,
          institutionCode: input.institutionCode,
          role: input.role,
        },
      },
    });

    if (data?.providerSignup) {
      return data.providerSignup;
    }
    return { success: false, message: 'Signup failed' };
  };

  const logout = async () => {
    try {
      await logoutMutation();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearTokens();
      setUser(null);
      router.push('/login');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
