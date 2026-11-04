import styles from "./AppShell.module.css";
import commonStyles from "../../shared/styles/common.module.css";
import { cx } from "../../shared/styles/classNames";
import { Fragment, useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { isDemoMode } from "../../shared/api/apiClient";
import { BrandMark } from "../../shared/components/BrandMark";
import { catalogsApi } from "../../features/catalogs/api";
import type { AccessScope, AuthenticatedUser } from "../../features/auth/types";
import type { SectorCatalogItem } from "../../features/deliveries/types";

type AppShellProps = {
  user: AuthenticatedUser;
  permissions: string[];
  scopes: AccessScope[];
  path: string;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
  children: ReactNode;
};

type AppNavItem = { path: string; label: string; visible: boolean; icon: ReactNode; groupLabel?: string };
type AppNavSection = { id: string; label: string; visible: boolean; items: AppNavItem[]; sectorCode?: string };
const sectorCatalogPermissionCodes = [
  "ENTREGAS_DIARIAS:VER",
  "FEEDBACK_CLIENTES:ACESSAR",
  "PAINEL_GERENCIAL:ACESSAR",
  "FRETES:VER",
  "FRETES:CRIAR",
  "AGREGADOS:VER",
];
const supportSectorPermissionCodes = [
  "ENTREGAS_DIARIAS:VER",
  "ENTREGAS_DIARIAS:CRIAR",
  "FEEDBACK_CLIENTES:ACESSAR",
  "PAINEL_GERENCIAL:ACESSAR",
];
const transportSectorPermissionCodes = ["FRETES:VER", "FRETES:CRIAR", "AGREGADOS:VER"];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function AppShell({ user, permissions, scopes, path, onNavigate, onSignOut, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sectorFilterExpanded, setSectorFilterExpanded] = useState(false);
  const [sectorCatalog, setSectorCatalog] = useState<SectorCatalogItem[]>([]);
  const [selectedSectorCodes, setSelectedSectorCodes] = useState<string[] | null>(null);
  const scopedSectorIds = [...new Set(scopes.flatMap((scope) => scope.id_setor === null ? [] : [scope.id_setor]))];
  const activeSection = path.startsWith("/fretes") ? "transport" : path === "/cadastros" || path === "/auditoria" ? "administration" : path === "/trocar-senha" ? "account" : "support";
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => ({
    support: !path.startsWith("/fretes") && path !== "/cadastros" && path !== "/auditoria" && path !== "/trocar-senha",
    transport: path.startsWith("/fretes"),
    administration: path === "/cadastros" || path === "/auditoria",
    account: path === "/trocar-senha",
  }));
  const canView = permissions.includes("ENTREGAS_DIARIAS:VER");
  const canCreate = permissions.includes("ENTREGAS_DIARIAS:CRIAR") && canView;
  const canAccessFeedback = permissions.includes("FEEDBACK_CLIENTES:ACESSAR");
  const canViewDashboard = permissions.includes("PAINEL_GERENCIAL:ACESSAR");
  const canManageCatalogs = permissions.includes("CADASTROS:ADMINISTRAR");
  const canManageAccess = permissions.includes("CONTROLE_ACESSO:ADMINISTRAR");
  const canViewAudit = permissions.includes("AUDITORIA:VER");
  const canViewFreights = permissions.includes("FRETES:VER");
  const canCreateFreights = permissions.includes("FRETES:CRIAR");
  const canViewAggregatePayments = permissions.includes("AGREGADOS:VER");
  const supportSectorId = sectorCatalog.find((sector) => sector.codigo === "SUPORTE")?.id_setor;
  const transportSectorId = sectorCatalog.find((sector) => sector.codigo === "TRANSPORTE")?.id_setor;
  const hasScopedSectorPermission = (sectorId: number | undefined, requiredPermissions: string[]) => {
    if (isDemoMode) return requiredPermissions.some((permission) => permissions.includes(permission));
    if (sectorId === undefined) return false;
    return scopes.some((scope) => {
      if (!requiredPermissions.some((permission) => scope.permissions.includes(permission))) return false;
      if (scope.tipo_escopo === "GLOBAL") return true;
      if (scope.id_setor !== null) return scope.id_setor === sectorId;
      return scope.tipo_escopo === "LOCALIDADE" && sectorCatalog.length === 1 && sectorCatalog[0].id_setor === sectorId;
    });
  };
  const supportFolderVisible = (canCreate || canView || canAccessFeedback || canViewDashboard)
    && hasScopedSectorPermission(supportSectorId, supportSectorPermissionCodes);
  const transportFolderVisible = (canCreateFreights || canViewFreights || canViewAggregatePayments)
    && hasScopedSectorPermission(transportSectorId, transportSectorPermissionCodes);
  const sectorFilterOptions = [
    { code: "SUPORTE", label: "Suporte", visible: supportFolderVisible },
    { code: "TRANSPORTE", label: "Transporte", visible: transportFolderVisible },
  ].filter((option) => option.visible);
  const canFilterSectors = scopes.some((scope) => ["DIRETORIA", "DEV"].includes(scope.codigo_perfil))
    && sectorFilterOptions.length > 1;
  const activeSectorCodes = selectedSectorCodes ?? sectorFilterOptions.map((option) => option.code);
  const toggleSectorFilter = (sectorCode: string) => {
    setSelectedSectorCodes((current) => {
      const selected = current ?? sectorFilterOptions.map((option) => option.code);
      return selected.includes(sectorCode)
        ? selected.filter((code) => code !== sectorCode)
        : [...selected, sectorCode];
    });
  };
  const showAllSectors = () => setSelectedSectorCodes(sectorFilterOptions.map((option) => option.code));
  const administrationTitle = canManageCatalogs && canManageAccess
    ? "Cadastros e acessos"
    : canManageCatalogs
      ? "Cadastros operacionais"
      : "Usuários e acessos";
  const visibleSectorLabels = [supportFolderVisible ? "Suporte" : null, transportFolderVisible ? "Transporte" : null].filter((label): label is string => label !== null);
  const sectorLabel = visibleSectorLabels.length > 1
    ? "Vários setores"
    : visibleSectorLabels[0]
      ?? (scopedSectorIds.length > 1
        ? "Vários setores"
        : scopedSectorIds.length === 1
          ? sectorCatalog.find((sector) => sector.id_setor === scopedSectorIds[0])?.nome ?? `Setor ${scopedSectorIds[0]}`
          : sectorCatalog.length === 1
            ? sectorCatalog[0].nome
            : isDemoMode
              ? "Suporte"
              : null);
  const sections: AppNavSection[] = [
    {
      id: "support",
      label: "Suporte",
      visible: supportFolderVisible,
      sectorCode: "SUPORTE",
      items: [
        {
          groupLabel: "Operação",
          path: "/entregas",
          label: "Lançar Entrega",
          visible: canCreate && hasScopedSectorPermission(supportSectorId, ["ENTREGAS_DIARIAS:CRIAR"]),
          icon: <svg viewBox="0 0 24 24"><path d="M4 5.5h16M4 12h16M4 18.5h10" /></svg>,
        },
        {
          groupLabel: "Operação",
          path: "/historico",
          label: "Histórico de Entregas",
          visible: canView && hasScopedSectorPermission(supportSectorId, ["ENTREGAS_DIARIAS:VER"]),
          icon: <svg viewBox="0 0 24 24"><path d="M4.5 7.5A8 8 0 1 1 4 13M4 4v4h4M12 7v5l3 2" /></svg>,
        },
        {
          groupLabel: "Relacionamento",
          path: "/feedback",
          label: "Reclamações e elogios",
          visible: canAccessFeedback && hasScopedSectorPermission(supportSectorId, ["FEEDBACK_CLIENTES:ACESSAR"]),
          icon: <svg viewBox="0 0 24 24"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" /><path d="M8 10h8M8 13.5h5" /></svg>,
        },
        {
          groupLabel: "Indicadores",
          path: "/painel",
          label: "Painel Gerencial",
          visible: canViewDashboard && hasScopedSectorPermission(supportSectorId, ["PAINEL_GERENCIAL:ACESSAR"]),
          icon: <svg viewBox="0 0 24 24"><path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-7" /><path d="M16 6h3v3" /></svg>,
        },
        {
          groupLabel: "Indicadores",
          path: "/indicadores/pessoas",
          label: "Indicadores por pessoa",
          visible: canViewDashboard && hasScopedSectorPermission(supportSectorId, ["PAINEL_GERENCIAL:ACESSAR"]),
          icon: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3.5 19v-1.3A4.7 4.7 0 0 1 8.2 13h1.6a4.7 4.7 0 0 1 4.7 4.7V19M16 5.5a3 3 0 0 1 0 5.8M17 13h.5a3.7 3.7 0 0 1 3.7 3.7V19" /></svg>,
        },
      ],
    },
    {
      id: "transport",
      label: "Transporte",
      visible: transportFolderVisible,
      sectorCode: "TRANSPORTE",
      items: [
        {
          groupLabel: "Fretes",
          path: "/fretes",
          label: "Lançar frete",
          visible: canCreateFreights && hasScopedSectorPermission(transportSectorId, ["FRETES:CRIAR"]),
          icon: <svg viewBox="0 0 24 24"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" /><circle cx="7" cy="18" r="1.7" /><circle cx="18" cy="18" r="1.7" /><path d="M7 4v6M4 7h6" /></svg>,
        },
        {
          groupLabel: "Fretes",
          path: "/fretes/historico",
          label: "Histórico de fretes",
          visible: canViewFreights && hasScopedSectorPermission(transportSectorId, ["FRETES:VER"]),
          icon: <svg viewBox="0 0 24 24"><path d="M4.5 7.5A8 8 0 1 1 4 13M4 4v4h4M12 7v5l3 2" /></svg>,
        },
        {
          groupLabel: "Pagamentos",
          path: "/fretes/pagamentos",
          label: "Pagamentos de transporte",
          visible: canViewAggregatePayments && hasScopedSectorPermission(transportSectorId, ["AGREGADOS:VER"]),
          icon: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>,
        },
      ],
    },
    {
      id: "administration",
      label: "Administração",
      visible: canManageCatalogs || canManageAccess || canViewAudit,
      items: [
        {
          path: "/cadastros",
          label: administrationTitle,
          visible: canManageCatalogs || canManageAccess,
          icon: <svg viewBox="0 0 24 24"><path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9" /><circle cx="18" cy="17.5" r="2.5" /></svg>,
        },
        {
          path: "/auditoria",
          label: "Auditoria",
          visible: canViewAudit,
          icon: <svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.2 4.2M8.5 10.8h4.6M10.8 8.5v4.6" /></svg>,
        },
      ],
    },
    {
      id: "account",
      label: "Conta",
      visible: true,
      items: [
        {
          path: "/trocar-senha",
          label: "Minha senha",
          visible: true,
          icon: <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></svg>,
        },
      ],
    },
  ].filter((section) => section.visible && (!canFilterSectors || !section.sectorCode || activeSectorCodes.includes(section.sectorCode)));

  useEffect(() => {
    setExpandedSections((current) => ({ ...current, [activeSection]: true }));
  }, [activeSection]);

  useEffect(() => {
    let active = true;
    const canReadSectorCatalog = isDemoMode || scopes.some((scope) =>
      sectorCatalogPermissionCodes.some((permission) => scope.permissions.includes(permission)),
    );
    if (!canReadSectorCatalog) {
      setSectorCatalog([]);
      return () => { active = false; };
    }
    void catalogsApi.sectors()
      .then((page) => { if (active) setSectorCatalog(page.items); })
      .catch(() => { if (active) setSectorCatalog([]); });
    return () => { active = false; };
  }, [scopes]);

  const navigate = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    event.preventDefault();
    setMenuOpen(false);
    onNavigate(target);
  };
  const pageTitle = path === "/indicadores/pessoas"
    ? "Indicadores por pessoa"
    : path === "/painel"
    ? "Painel gerencial"
    : path === "/cadastros"
      ? administrationTitle
    : path === "/feedback"
      ? "Reclamações e elogios"
    : path === "/auditoria"
      ? "Auditoria"
    : path === "/trocar-senha"
      ? "Minha senha"
    : path === "/fretes"
      ? "Lançar frete"
    : path === "/fretes/historico"
      ? "Histórico de fretes"
    : path === "/fretes/pagamentos"
      ? "Pagamentos de transporte"
    : path === "/historico"
      ? "Histórico de entregas"
      : "Lançar entrega";
  const pageSection = path === "/painel" || path === "/indicadores/pessoas" ? "Indicadores" : path === "/cadastros" || path === "/auditoria" ? "Administração" : path === "/feedback" ? "Relacionamento" : path === "/trocar-senha" ? "Conta" : path.startsWith("/fretes") ? "Fretes" : "Entregas";

  return (
    <div className={cx(styles, commonStyles, `app-layout${sidebarCollapsed ? " app-layout-sidebar-collapsed" : ""}`)}>
      <aside id="portal-sidebar" className={cx(styles, commonStyles, `app-sidebar${menuOpen ? " app-sidebar-open" : ""}${sidebarCollapsed ? " app-sidebar-collapsed" : ""}`)}>
        <div className={cx(styles, commonStyles, "sidebar-brand")}>
          <BrandMark light />
          <button className={cx(styles, commonStyles, "sidebar-collapse-button")} type="button" aria-label="Recolher menu lateral" aria-controls="portal-sidebar" aria-expanded={!sidebarCollapsed} title="Recolher menu lateral" onClick={() => setSidebarCollapsed(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9 5v14m7-7h-5m0 0 2.5-2.5M11 12l2.5 2.5" /></svg>
          </button>
        </div>
        <div className={cx(styles, commonStyles, "sidebar-rule")} />
        <div className={cx(styles, commonStyles, "sidebar-navigation")}>
          <p className={cx(styles, commonStyles, "sidebar-caption")}>MENU PRINCIPAL</p>
          {canFilterSectors && <section className={cx(styles, commonStyles, "sector-filter")} aria-labelledby="sector-filter-title">
            <button className={cx(styles, commonStyles, `sector-filter-toggle${sectorFilterExpanded ? " sector-filter-toggle-expanded" : ""}`)} id="sector-filter-title" type="button" aria-expanded={sectorFilterExpanded} aria-controls="sector-filter-controls" onClick={() => setSectorFilterExpanded((expanded) => !expanded)}>
              <span className={cx(styles, commonStyles, "sector-filter-icon")} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16l-6.5 7.2v5.2l-3 1.6v-6.8L4 5Z" /></svg></span>
              <span className={cx(styles, commonStyles, "sector-filter-toggle-copy")}>
                <strong>Filtrar por setor</strong>
                <small>{activeSectorCodes.length === 0 ? "Nenhum selecionado" : sectorFilterOptions.filter((option) => activeSectorCodes.includes(option.code)).map((option) => option.label).join(" · ")}</small>
              </span>
              <span className={cx(styles, commonStyles, "sector-filter-count")}>{activeSectorCodes.length}/{sectorFilterOptions.length}</span>
              <svg className={cx(styles, commonStyles, `sector-filter-chevron${sectorFilterExpanded ? " sector-filter-chevron-open" : ""}`)} viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
            </button>
            <div className={cx(styles, commonStyles, "sector-filter-controls")} id="sector-filter-controls" hidden={!sectorFilterExpanded}>
              <div className={cx(styles, commonStyles, "sector-filter-options")} role="group" aria-label="Setores exibidos no menu">
                {sectorFilterOptions.map((option) => {
                  const checked = activeSectorCodes.includes(option.code);
                  return <label className={cx(styles, commonStyles, `sector-filter-option${checked ? " sector-filter-option-checked" : ""}`)} key={option.code}>
                    <input className={cx(styles, commonStyles, "sector-filter-checkbox")} type="checkbox" checked={checked} onChange={() => toggleSectorFilter(option.code)} />
                    <span className={cx(styles, commonStyles, `sector-filter-dot sector-filter-dot-${option.code.toLowerCase()}`)} aria-hidden="true" />
                    <span className={cx(styles, commonStyles, "sector-filter-label")}>{option.label}</span>
                    <span className={cx(styles, commonStyles, "sector-filter-state")}>{checked ? "ATIVO" : "OCULTO"}</span>
                  </label>;
                })}
              </div>
              {activeSectorCodes.length !== sectorFilterOptions.length && <button className={cx(styles, commonStyles, "sector-filter-reset")} type="button" onClick={showAllSectors}>Mostrar todos</button>}
            </div>
          </section>}
          <nav className={cx(styles, commonStyles, "primary-nav")} aria-label="Navegação principal">
            {sections.map((section) => {
              const expanded = Boolean(expandedSections[section.id]);
              const sectionActive = section.id === activeSection;
              const panelId = `nav-section-${section.id}`;

              return (
                <div className={cx(styles, commonStyles, "nav-section")} key={section.id}>
                  <button
                    className={cx(styles, commonStyles, `nav-section-toggle${sectionActive ? " nav-section-toggle-active" : ""}`)}
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setExpandedSections((current) => ({ ...current, [section.id]: !current[section.id] }))}
                  >
                    <span>{section.label}</span>
                    <svg className={cx(styles, commonStyles, `nav-section-chevron${expanded ? " nav-section-chevron-open" : ""}`)} viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
                  </button>
                  <div
                    className={cx(styles, commonStyles, "nav-section-items")}
                    id={panelId}
                    hidden={!expanded}
                  >
                    {section.items.filter((item) => item.visible).map((item, index, visibleItems) => {
                      const active = path === item.path;
                      return (
                        <Fragment key={item.path}>
                          {item.groupLabel && item.groupLabel !== visibleItems[index - 1]?.groupLabel && <div className={cx(styles, commonStyles, "nav-subgroup-label")}>{item.groupLabel}</div>}
                          <a
                            className={cx(styles, commonStyles, `nav-link nav-link-nested${active ? " nav-link-active" : ""}`)}
                            href={item.path}
                            aria-current={active ? "page" : undefined}
                            onClick={(event) => navigate(event, item.path)}
                          >
                            <span className={cx(styles, commonStyles, "nav-icon")} aria-hidden="true">{item.icon}</span>
                            <span>{item.label}</span>
                            <span className={cx(styles, commonStyles, "nav-active-mark")} />
                          </a>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        <div className={cx(styles, commonStyles, "sidebar-user")}>
          <span className={cx(styles, commonStyles, "user-avatar")}>{initials(user.nome_completo)}</span>
          <div className={cx(styles, commonStyles, "sidebar-user-info")}><strong>{user.nome_completo}</strong><span>Portal de Logística</span></div>
          <button className={cx(styles, commonStyles, "sign-out-button")} type="button" aria-label="Sair do portal" title="Sair" onClick={onSignOut}><svg viewBox="0 0 24 24"><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" /></svg></button>
        </div>
      </aside>

      {sidebarCollapsed && <button className={cx(styles, commonStyles, "sidebar-reopen-button")} type="button" aria-label="Abrir menu lateral" aria-controls="portal-sidebar" aria-expanded={false} title="Abrir menu lateral" onClick={() => setSidebarCollapsed(false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9 5v14m2-7h5m0 0-2.5-2.5M16 12l-2.5 2.5" /></svg>
      </button>}

      <button className={cx(styles, commonStyles, `sidebar-scrim${menuOpen ? " sidebar-scrim-visible" : ""}`)} aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />

      <div className={cx(styles, commonStyles, `workspace${sidebarCollapsed ? " workspace-sidebar-collapsed" : ""}`)}>
        <header className={cx(styles, commonStyles, "topbar")}>
          <button className={cx(styles, commonStyles, "mobile-menu-button")} type="button" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}><span /><span /><span /></button>
          <div className={cx(styles, commonStyles, "topbar-context")}><span className={cx(styles, commonStyles, "topbar-context-mark")} /> <span>{pageSection}</span><span className={cx(styles, commonStyles, "topbar-context-slash")}>/</span><strong>{pageTitle}</strong></div>
          <div className={cx(styles, commonStyles, "topbar-actions")}>
            {isDemoMode && <span className={cx(styles, commonStyles, "environment-badge")}><i /> DEMONSTRAÇÃO</span>}
            <div className={cx(styles, commonStyles, "topbar-user")}><span className={cx(styles, commonStyles, "topbar-avatar")}>{initials(user.nome_completo)}</span><span className={cx(styles, commonStyles, "topbar-user-name")}>{user.nome_completo.split(" ")[0]}</span>{sectorLabel && <span className={cx(styles, commonStyles, "topbar-sector")} title={`Setor: ${sectorLabel}`}>{sectorLabel}</span>}</div>
          </div>
        </header>
        <main className={cx(styles, commonStyles, `workspace-content${path.startsWith("/fretes") ? " workspace-content-wide" : ""}`)}>{children}</main>
        <footer className={cx(styles, commonStyles, "workspace-footer")}><span>VILAREJO ACABAMENTOS <i /> PORTAL DE LOGÍSTICA</span><span>Dados de operação tratados com responsabilidade.</span></footer>
      </div>
    </div>
  );
}
