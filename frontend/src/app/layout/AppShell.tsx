import styles from "./AppShell.module.css";
import commonStyles from "../../shared/styles/common.module.css";
import { cx } from "../../shared/styles/classNames";
import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { isDemoMode } from "../../shared/api/apiClient";
import { BrandMark } from "../../shared/components/BrandMark";
import type { AuthenticatedUser } from "../../features/auth/types";

type AppShellProps = {
  user: AuthenticatedUser;
  permissions: string[];
  path: string;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
  children: ReactNode;
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function AppShell({ user, permissions, path, onNavigate, onSignOut, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeSection = path === "/painel" ? "indicators" : path === "/cadastros" || path === "/auditoria" ? "administration" : path === "/feedback" ? "relationships" : path === "/trocar-senha" ? "account" : "operation";
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => ({
    operation: path !== "/painel",
    relationships: path === "/feedback",
    indicators: path === "/painel",
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
  const sections = [
    {
      id: "operation",
      label: "Operação",
      groupLabel: "Entregas",
      visible: canCreate || canView,
      items: [
        {
          path: "/entregas",
          label: "Lançar Entrega",
          visible: canCreate,
          icon: <svg viewBox="0 0 24 24"><path d="M4 5.5h16M4 12h16M4 18.5h10" /></svg>,
        },
        {
          path: "/historico",
          label: "Histórico de Entregas",
          visible: canView,
          icon: <svg viewBox="0 0 24 24"><path d="M4.5 7.5A8 8 0 1 1 4 13M4 4v4h4M12 7v5l3 2" /></svg>,
        },
      ],
    },
    {
      id: "relationships",
      label: "Relacionamento",
      visible: canAccessFeedback,
      items: [
        {
          path: "/feedback",
          label: "Reclamações e elogios",
          visible: canAccessFeedback,
          icon: <svg viewBox="0 0 24 24"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" /><path d="M8 10h8M8 13.5h5" /></svg>,
        },
      ],
    },
    {
      id: "indicators",
      label: "Indicadores",
      visible: canViewDashboard,
      items: [
        {
          path: "/painel",
          label: "Painel Gerencial",
          visible: canViewDashboard,
          icon: <svg viewBox="0 0 24 24"><path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-7" /><path d="M16 6h3v3" /></svg>,
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
          label: "Cadastros e acessos",
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
  ].filter((section) => section.visible);

  useEffect(() => {
    setExpandedSections((current) => ({ ...current, [activeSection]: true }));
  }, [activeSection]);

  const navigate = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    event.preventDefault();
    setMenuOpen(false);
    onNavigate(target);
  };
  const pageTitle = path === "/painel"
    ? "Painel gerencial"
    : path === "/cadastros"
      ? "Cadastros e acessos"
    : path === "/feedback"
      ? "Reclamações e elogios"
    : path === "/auditoria"
      ? "Auditoria"
    : path === "/trocar-senha"
      ? "Minha senha"
    : path === "/historico"
      ? "Histórico de entregas"
      : "Lançar entrega";
  const pageSection = path === "/painel" ? "Indicadores" : path === "/cadastros" || path === "/auditoria" ? "Administração" : path === "/feedback" ? "Relacionamento" : path === "/trocar-senha" ? "Conta" : "Entregas";

  return (
    <div className={cx(styles, commonStyles, "app-layout")}>
      <aside className={cx(styles, commonStyles, `app-sidebar${menuOpen ? " app-sidebar-open" : ""}`)}>
        <div className={cx(styles, commonStyles, "sidebar-brand")}><BrandMark light /></div>
        <div className={cx(styles, commonStyles, "sidebar-rule")} />
        <div className={cx(styles, commonStyles, "sidebar-navigation")}>
          <p className={cx(styles, commonStyles, "sidebar-caption")}>MENU PRINCIPAL</p>
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
                    {"groupLabel" in section && <div className={cx(styles, commonStyles, "nav-subgroup-label")}>{section.groupLabel}</div>}
                    {section.items.filter((item) => item.visible).map((item) => {
                      const active = path === item.path;
                      return (
                        <a
                          className={cx(styles, commonStyles, `nav-link nav-link-nested${active ? " nav-link-active" : ""}`)}
                          href={item.path}
                          key={item.path}
                          aria-current={active ? "page" : undefined}
                          onClick={(event) => navigate(event, item.path)}
                        >
                          <span className={cx(styles, commonStyles, "nav-icon")} aria-hidden="true">{item.icon}</span>
                          <span>{item.label}</span>
                          <span className={cx(styles, commonStyles, "nav-active-mark")} />
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        <div className={cx(styles, commonStyles, "sidebar-support")}>
          <div className={cx(styles, commonStyles, "support-orbit")}><span>?</span></div>
          <div><strong>Precisa de ajuda?</strong><span>Fale com a liderança do setor.</span></div>
        </div>
        <div className={cx(styles, commonStyles, "sidebar-user")}>
          <span className={cx(styles, commonStyles, "user-avatar")}>{initials(user.nome_completo)}</span>
          <div className={cx(styles, commonStyles, "sidebar-user-info")}><strong>{user.nome_completo}</strong><span>Portal de Logística</span></div>
          <button className={cx(styles, commonStyles, "sign-out-button")} type="button" aria-label="Sair do portal" title="Sair" onClick={onSignOut}><svg viewBox="0 0 24 24"><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" /></svg></button>
        </div>
      </aside>

      <button className={cx(styles, commonStyles, `sidebar-scrim${menuOpen ? " sidebar-scrim-visible" : ""}`)} aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />

      <div className={cx(styles, commonStyles, "workspace")}>
        <header className={cx(styles, commonStyles, "topbar")}>
          <button className={cx(styles, commonStyles, "mobile-menu-button")} type="button" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}><span /><span /><span /></button>
          <div className={cx(styles, commonStyles, "topbar-context")}><span className={cx(styles, commonStyles, "topbar-context-mark")} /> <span>{pageSection}</span><span className={cx(styles, commonStyles, "topbar-context-slash")}>/</span><strong>{pageTitle}</strong></div>
          <div className={cx(styles, commonStyles, "topbar-actions")}>
            {isDemoMode && <span className={cx(styles, commonStyles, "environment-badge")}><i /> DEMONSTRAÇÃO</span>}
            <div className={cx(styles, commonStyles, "topbar-user")}><span className={cx(styles, commonStyles, "topbar-avatar")}>{initials(user.nome_completo)}</span><span>{user.nome_completo.split(" ")[0]}</span></div>
          </div>
        </header>
        <main className={cx(styles, commonStyles, "workspace-content")}>{children}</main>
        <footer className={cx(styles, commonStyles, "workspace-footer")}><span>VILAREJO ACABAMENTOS <i /> PORTAL DE LOGÍSTICA</span><span>Dados de operação tratados com responsabilidade.</span></footer>
      </div>
    </div>
  );
}
