import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "../shared/api/apiError";
import { authApi } from "../features/auth/api";
import type { AuthenticatedUser, MeResponse } from "../features/auth/types";

type AuthContextValue = {
  user: AuthenticatedUser | null;
  permissions: string[];
  loading: boolean;
  bootstrapMessage: string;
  login: (username: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshIdentity: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapMessage, setBootstrapMessage] = useState("");

  useEffect(() => {
    let active = true;
    void authApi.currentIdentity()
      .then(async (identity) => {
        if (identity) await authApi.refreshCsrfToken();
        if (active) {
          setUser(identity?.user ?? null);
          setPermissions(identity?.permissions ?? []);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          if (active) {
            setUser(null);
            setPermissions([]);
          }
          return;
        }
        if (active) {
          setUser(null);
          setPermissions([]);
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
    const identity: MeResponse = await authApi.login(username, password);
    setBootstrapMessage("");
    setUser(identity.user);
    setPermissions(identity.permissions);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setPermissions([]);
  }, []);

  const refreshIdentity = useCallback(async () => {
    const identity = await authApi.currentIdentity();
    setUser(identity?.user ?? null);
    setPermissions(identity?.permissions ?? []);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await authApi.changePassword(currentPassword, newPassword);
    await refreshIdentity();
  }, [refreshIdentity]);

  const value = useMemo(
    () => ({ user, permissions, loading, bootstrapMessage, login, changePassword, refreshIdentity, logout }),
    [user, permissions, loading, bootstrapMessage, login, changePassword, refreshIdentity, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de AuthProvider.");
  return context;
}
