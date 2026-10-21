import type { AuditEventPage, AuditFilters } from "./types";

export const demoAuditApi = {
  async list(filters: AuditFilters = {}): Promise<AuditEventPage> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    return { items: [], total: 0, limit, offset };
  },
};
