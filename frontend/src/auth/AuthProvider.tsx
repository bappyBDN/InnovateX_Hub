import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearToken, getToken, setServerOffsetMs, setToken } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import i18n from '@/i18n';
import type { Me } from './types';

interface AuthContextValue {
  me: Me | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: unknown;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => void;
  refetchMe: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface LoginResponse {
  access_token: string;
  token_type: string;
  user: unknown;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => getToken());

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<Me>('/me'),
    enabled: !!token,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const me = meQuery.data;
    if (!me) return;
    const t = Date.parse(me.server_time);
    if (!Number.isNaN(t)) setServerOffsetMs(t - Date.now());
  }, [meQuery.data]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<LoginResponse>('/auth/login', { email, password }, { noAuthRedirect: true });
      setToken(res.access_token);
      setTokenState(res.access_token);
      qc.clear();
      const me = await qc.fetchQuery({ queryKey: queryKeys.me, queryFn: () => api.get<Me>('/me') });
      if (me.locale && !localStorage.getItem('ix.lang')) void i18n.changeLanguage(me.locale);
      return me;
    },
    [qc],
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    qc.clear(); // clear all caches on sign-out (spec §13.4)
  }, [qc]);

  const value = useMemo<AuthContextValue>(
    () => ({
      me: token ? meQuery.data : undefined,
      isAuthenticated: !!token && !!meQuery.data,
      isLoading: !!token && meQuery.isLoading,
      error: meQuery.error,
      login,
      logout,
      refetchMe: () => void meQuery.refetch(),
    }),
    [token, meQuery.data, meQuery.isLoading, meQuery.error, meQuery.refetch, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** `const { data: me } = useMe()` — same shape as a query result. */
export function useMe(): { data: Me | undefined; isLoading: boolean } {
  const { me, isLoading } = useAuth();
  return { data: me, isLoading };
}
