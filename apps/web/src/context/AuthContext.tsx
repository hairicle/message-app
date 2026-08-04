'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as authApi from '../lib/api/auth';
import { getAuthToken, getDeviceId, setAuthToken, setDeviceId } from '../lib/api/client';
import type { User } from '@messenger/shared';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  deviceId: string | null;
  loading: boolean;
  login: (email: string, password: string, deviceName: string) => Promise<{ requiresTotp: true; totpToken: string } | void>;
  completeTotpLogin: (totpToken: string, code: string, deviceName: string) => Promise<void>;
  logout: () => void;
  updateUser: (fields: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [deviceId, setDeviceIdState] = useState<string | null>(getDeviceId());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    authApi
      .getMe()
      .then(({ user }) => setUser(user))
      .catch(() => {
        setAuthToken(null);
        setDeviceId(null);
        setToken(null);
        setDeviceIdState(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = useCallback(async (email: string, password: string, deviceName: string) => {
    const result = await authApi.login(email, password, deviceName);
    if (!('token' in result)) {
      return { requiresTotp: true as const, totpToken: result.totpToken };
    }
    setAuthToken(result.token);
    setDeviceId(result.deviceId);
    setToken(result.token);
    setDeviceIdState(result.deviceId);
    setUser(result.user);
  }, []);

  const completeTotpLogin = useCallback(async (totpToken: string, code: string, deviceName: string) => {
    const result = await authApi.completeTotpLogin(totpToken, code, deviceName);
    setAuthToken(result.token);
    setDeviceId(result.deviceId);
    setToken(result.token);
    setDeviceIdState(result.deviceId);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setDeviceId(null);
    setToken(null);
    setDeviceIdState(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((fields: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...fields } : prev));
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, deviceId, loading, login, completeTotpLogin, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
