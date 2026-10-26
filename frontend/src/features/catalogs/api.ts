import { apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { cachedRequest } from "../../shared/api/requestCache";
import { demoApi } from "../deliveries/demoApi";
import type {
  CatalogPage,
  LocalityCatalogItem,
  NonDeliveryReasonCatalogItem,
  PersonCatalogItem,
  SectorCatalogItem,
} from "../deliveries/types";

export const catalogsApi = {
  async sectors(): Promise<CatalogPage<SectorCatalogItem>> {
    return isDemoMode ? demoApi.listSectors() : cachedRequest("catalogs/sectors", () => apiRequest<CatalogPage<SectorCatalogItem>>("/setores?limit=500"));
  },
  async localities(): Promise<CatalogPage<LocalityCatalogItem>> {
    return isDemoMode ? demoApi.listLocalities() : cachedRequest("catalogs/localities", () => apiRequest<CatalogPage<LocalityCatalogItem>>("/localidades?limit=500"));
  },
  async people(role?: "MOTORISTA" | "AJUDANTE"): Promise<CatalogPage<PersonCatalogItem>> {
    const params = new URLSearchParams({ limit: "500" });
    if (role) params.set("tipo_funcao", role);
    const path = `/pessoas?${params.toString()}`;
    return isDemoMode ? demoApi.listPeople(role) : cachedRequest(`catalogs/people:${role ?? "ALL"}`, () => apiRequest<CatalogPage<PersonCatalogItem>>(path));
  },
  async reasons(): Promise<CatalogPage<NonDeliveryReasonCatalogItem>> {
    return isDemoMode ? demoApi.listReasons() : cachedRequest("catalogs/reasons", () => apiRequest<CatalogPage<NonDeliveryReasonCatalogItem>>("/motivos?limit=500"));
  },
};
