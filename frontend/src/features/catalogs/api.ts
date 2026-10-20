import { apiRequest, isDemoMode } from "../../shared/api/apiClient";
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
    return isDemoMode ? demoApi.listSectors() : apiRequest<CatalogPage<SectorCatalogItem>>("/setores?limit=500");
  },
  async localities(): Promise<CatalogPage<LocalityCatalogItem>> {
    return isDemoMode ? demoApi.listLocalities() : apiRequest<CatalogPage<LocalityCatalogItem>>("/localidades?limit=500");
  },
  async people(role?: "MOTORISTA" | "AJUDANTE"): Promise<CatalogPage<PersonCatalogItem>> {
    if (isDemoMode) return demoApi.listPeople(role);
    const params = new URLSearchParams({ limit: "500" });
    if (role) params.set("tipo_funcao", role);
    return apiRequest<CatalogPage<PersonCatalogItem>>(`/pessoas?${params.toString()}`);
  },
  async reasons(): Promise<CatalogPage<NonDeliveryReasonCatalogItem>> {
    return isDemoMode ? demoApi.listReasons() : apiRequest<CatalogPage<NonDeliveryReasonCatalogItem>>("/motivos?limit=500");
  },
};
