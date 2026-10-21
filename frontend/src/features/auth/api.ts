import { apiRequest, clearCsrfToken, isDemoMode, setCsrfToken } from "../../shared/api/apiClient";
import { demoApi } from "../deliveries/demoApi";
import type { LoginResponse, MeResponse } from "./types";

export const authApi = {
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
    const response = await apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: { username, password },
    });
    setCsrfToken(response.csrf_token);
    return apiRequest<MeResponse>("/me");
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
