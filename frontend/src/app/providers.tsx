import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "../shared/api/apiError";
import { clearRequestCache } from "../shared/api/requestCache";
import { authApi } from "../features/auth/api";
import type { AccessScope, AuthenticatedUser, MeResponse } from "../features/auth/types";

type AuthContextValue = {
  user: AuthenticatedUser | null;
  permissions: string[];
  scopes: AccessScope[];
  loading: boolean;
  bootstrapMessage: string;
  login: (username: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  resetPassword: (name: string, username: string, newPassword: string) => Promise<void>;
  refreshIdentity: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [scopes, setScopes] = useState<AccessScope[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapMessage, setBootstrapMessage] = useState("");

  useEffect(() => {
    let active = true;
    void authApi.restoreSession()
      .then((identity) => {
        if (active) {
          setUser(identity?.user ?? null);
          setPermissions(identity?.permissions ?? []);
          setScopes(identity?.scopes ?? []);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          if (active) {
            setUser(null);
            setPermissions([]);
            setScopes([]);
          }
          return;
        }
        if (active) {
          setUser(null);
          setPermissions([]);
          setScopes([]);
          setBootstrapMessage(error instanceof Error ? error.message : "Não foi possível conectar ao Portal.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    clearRequestCache();
    const identity: MeResponse = await authApi.login(username, password);
    setBootstrapMessage("");
    setUser(identity.user);
    setPermissions(identity.permissions);
    setScopes(identity.scopes);
  }, []);

  const logout = useCallback(async () => {
    clearRequestCache();
    await authApi.logout();
    setUser(null);
    setPermissions([]);
    setScopes([]);
  }, []);

  const refreshIdentity = useCallback(async () => {
    clearRequestCache();
    const identity = await authApi.currentIdentity();
    setUser(identity?.user ?? null);
    setPermissions(identity?.permissions ?? []);
    setScopes(identity?.scopes ?? []);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await authApi.changePassword(currentPassword, newPassword);
    await refreshIdentity();
  }, [refreshIdentity]);

  const resetPassword = useCallback(async (name: string, username: string, newPassword: string) => {
    await authApi.resetPassword(name, username, newPassword);
  }, []);

  const value = useMemo(
    () => ({ user, permissions, scopes, loading, bootstrapMessage, login, changePassword, resetPassword, refreshIdentity, logout }),
    [user, permissions, scopes, loading, bootstrapMessage, login, changePassword, resetPassword, refreshIdentity, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de AuthProvider.");
  return context;
}
