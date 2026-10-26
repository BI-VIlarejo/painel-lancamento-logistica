import { apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { cachedRequest } from "../../shared/api/requestCache";
import { demoAdministrationApi } from "./demoApi";
import type { LocalityCatalogItem, SectorCatalogItem } from "../deliveries/types";
import type {
  LocalityAdminItem,
  LocalityCreateInput,
  LocalityUpdateInput,
  PersonAdminItem,
  Profile,
  ProfilePermission,
  ReasonAdminItem,
  UserAccessGrant,
  UserAccount,
  UserAccountCreated,
  UserScopeGrantInput,
} from "./types";

export const administrationApi = {
  localities: () => isDemoMode ? demoAdministrationApi.localities() : cachedRequest("admin/localities", () => apiRequest<LocalityAdminItem[]>("/cadastros/localidades")),
  createLocality: (payload: LocalityCreateInput) => isDemoMode
    ? demoAdministrationApi.createLocality(payload)
    : apiRequest<LocalityAdminItem>("/cadastros/localidades", { method: "POST", body: payload }),
  updateLocality: (id: number, payload: LocalityUpdateInput) => isDemoMode
    ? demoAdministrationApi.updateLocality(id, payload)
    : apiRequest<LocalityAdminItem>(`/cadastros/localidades/${id}`, { method: "PUT", body: payload }),
  setLocalityActive: (id: number, ativo: boolean) => isDemoMode
    ? demoAdministrationApi.setLocalityActive(id, ativo)
    : apiRequest<LocalityAdminItem>(`/cadastros/localidades/${id}`, { method: "PATCH", body: { ativo } }),
  people: () => isDemoMode ? demoAdministrationApi.people() : cachedRequest("admin/people", () => apiRequest<PersonAdminItem[]>("/cadastros/pessoas")),
  createPerson: (payload: { codigo_pessoa?: string; nome_exibicao: string; tipo_funcao: "MOTORISTA" | "AJUDANTE"; sistema_origem?: string; codigo_pessoa_origem?: string }) => isDemoMode
    ? demoAdministrationApi.createPerson({ ...payload, codigo_pessoa: payload.codigo_pessoa ?? crypto.randomUUID(), sistema_origem: payload.sistema_origem ?? null, codigo_pessoa_origem: payload.codigo_pessoa_origem ?? null })
    : apiRequest<PersonAdminItem>("/cadastros/pessoas", { method: "POST", body: payload }),
  deactivatePerson: (id: number) => isDemoMode
    ? demoAdministrationApi.deactivatePerson(id)
    : apiRequest<PersonAdminItem>(`/cadastros/pessoas/${id}`, { method: "PATCH", body: { ativo: false } }),
  reasons: () => isDemoMode ? demoAdministrationApi.reasons() : cachedRequest("admin/reasons", () => apiRequest<ReasonAdminItem[]>("/cadastros/motivos")),
  createReason: (payload: { codigo_motivo?: string; descricao_motivo: string }) => isDemoMode
    ? demoAdministrationApi.createReason(payload)
    : apiRequest<ReasonAdminItem>("/cadastros/motivos", { method: "POST", body: payload }),
  deactivateReason: (id: number) => isDemoMode
    ? demoAdministrationApi.deactivateReason(id)
    : apiRequest<ReasonAdminItem>(`/cadastros/motivos/${id}`, { method: "PATCH", body: { ativo: false } }),
  users: async (search = "", includeInactive = true): Promise<UserAccount[]> => {
    if (isDemoMode) return demoAdministrationApi.users(search, includeInactive);
    return cachedRequest(`admin/users:${search}:${includeInactive}`, async () => {
      const params = new URLSearchParams({ incluir_inativos: String(includeInactive), limit: "500" });
      if (search) params.set("busca", search);
      const page = await apiRequest<{ items: UserAccount[] }>(`/access/users?${params.toString()}`);
      return page.items;
    });
  },
  createUser: (payload: { username: string; nome_completo: string; acesso_inicial: UserScopeGrantInput }) => isDemoMode
    ? demoAdministrationApi.createUser(payload)
    : apiRequest<UserAccountCreated>("/access/users", { method: "POST", body: payload }),
  resetUserTemporaryPassword: (id: number) => isDemoMode
    ? demoAdministrationApi.resetUserTemporaryPassword(id)
    : apiRequest<UserAccountCreated>(`/access/users/${id}/temporary-password`, { method: "POST" }),
  updateUserIdentity: (id: number, payload: { username: string; nome_completo: string }) => isDemoMode
    ? demoAdministrationApi.updateUserIdentity(id, payload)
    : apiRequest<UserAccount>(`/access/users/${id}/identity`, { method: "PATCH", body: payload }),
  setUserActive: (id: number, ativo: boolean, motivo?: string) => isDemoMode
    ? demoAdministrationApi.setUserActive(id, ativo)
    : apiRequest<UserAccount>(`/access/users/${id}`, { method: "PATCH", body: { ativo, ...(motivo ? { motivo } : {}) } }),
  profiles: () => isDemoMode ? demoAdministrationApi.profiles() : cachedRequest("admin/profiles", () => apiRequest<Profile[]>("/access/profiles")),
  profilePermissions: (id: number) => isDemoMode ? demoAdministrationApi.profilePermissions(id) : cachedRequest(`admin/profile-permissions:${id}`, () => apiRequest<ProfilePermission[]>(`/access/profiles/${id}/permissions`)),
  sectors: () => isDemoMode ? demoAdministrationApi.sectors() : cachedRequest("admin/sectors", () => apiRequest<{ items: SectorCatalogItem[] }>("/setores?limit=500").then((page) => page.items)),
  scopeOptions: () => isDemoMode
    ? demoAdministrationApi.scopeOptions()
    : cachedRequest("admin/scope-options", () => apiRequest<{ setores: SectorCatalogItem[]; localidades: LocalityCatalogItem[] }>("/access/scope-options")),
  userGrants: (id: number) => isDemoMode ? demoAdministrationApi.userGrants(id) : cachedRequest(`admin/user-grants:${id}`, () => apiRequest<UserAccessGrant[]>(`/access/users/${id}/scopes`)),
  createGrant: (id: number, payload: UserScopeGrantInput) => isDemoMode
    ? demoAdministrationApi.createGrant(id, payload)
    : apiRequest<UserAccessGrant>(`/access/users/${id}/scopes`, { method: "POST", body: payload }),
  revokeGrant: (id: number, grantId: number, motivo: string) => isDemoMode
    ? demoAdministrationApi.revokeGrant(grantId)
    : apiRequest<void>(`/access/users/${id}/scopes/${grantId}`, { method: "DELETE", body: { motivo } }),
};
