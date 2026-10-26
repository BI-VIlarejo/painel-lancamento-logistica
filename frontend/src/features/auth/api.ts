import { apiRequest, clearCsrfToken, isDemoMode, setCsrfToken } from "../../shared/api/apiClient";
import { demoApi } from "../deliveries/demoApi";
import type { LoginResponse, MeResponse, SessionBootstrapResponse } from "./types";

export const authApi = {
  async restoreSession(): Promise<SessionBootstrapResponse | null> {
    if (isDemoMode) {
      if (!(await demoApi.currentUser())) return null;
      return { ...await demoApi.identity(), csrf_token: "" };
    }
    const session = await apiRequest<SessionBootstrapResponse>("/auth/session");
    setCsrfToken(session.csrf_token);
    return session;
  },

  async currentIdentity(): Promise<MeResponse | null> {
    if (isDemoMode) {
      if (!(await demoApi.currentUser())) return null;
      return demoApi.identity();
    }
    return apiRequest<MeResponse>("/me");
  },

  async login(username: string, password: string): Promise<MeResponse> {
    if (isDemoMode) {
      await demoApi.login();
      return demoApi.identity();
    }
    const identity = await apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: { username, password },
    });
    setCsrfToken(identity.csrf_token);
    return identity;
  },

  async refreshCsrfToken(): Promise<void> {
    if (isDemoMode) return;
    const response = await apiRequest<{ csrf_token: string }>("/auth/csrf");
    setCsrfToken(response.csrf_token);
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (isDemoMode) return;
    await apiRequest<void>("/auth/change-password", {
      method: "POST",
      body: { senha_atual: currentPassword, nova_senha: newPassword },
    });
  },

  async resetPassword(name: string, username: string, newPassword: string): Promise<void> {
    if (isDemoMode) return;
    await apiRequest<void>("/auth/reset-password", {
      method: "POST",
      body: { nome_completo: name, username, nova_senha: newPassword },
    });
  },

  async logout(): Promise<void> {
    if (isDemoMode) {
      await demoApi.logout();
      return;
    }
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
    } finally {
      clearCsrfToken();
    }
  },
};
