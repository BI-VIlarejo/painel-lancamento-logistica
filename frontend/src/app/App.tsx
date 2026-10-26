import styles from "./App.module.css";
import commonStyles from "../shared/styles/common.module.css";
import { cx } from "../shared/styles/classNames";
import { useEffect } from "react";
import { AppShell } from "./layout/AppShell";
import { navigate, usePathname } from "./router";
import { AuthProvider, useAuth } from "./providers";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { DeliveryHistoryPage } from "../features/deliveries/pages/DeliveryHistoryPage";
import { DeliveryLaunchPage } from "../features/deliveries/pages/DeliveryLaunchPage";
import { ManagementDashboardPage } from "../features/analytics/pages/ManagementDashboardPage";
import { RegistriesPage } from "../features/administration/pages/RegistriesPage";
import { ChangePasswordPage } from "../features/auth/pages/ChangePasswordPage";
import { ResetPasswordPage } from "../features/auth/pages/ResetPasswordPage";
import { FeedbackPage } from "../features/feedback/pages/FeedbackPage";
import { AuditPage } from "../features/audit/pages/AuditPage";

function PortalApp() {
  const { user, permissions, loading, bootstrapMessage, login, changePassword, resetPassword, logout } = useAuth();
  const path = usePathname();
  const canView = permissions.includes("ENTREGAS_DIARIAS:VER");
  const canCreate = permissions.includes("ENTREGAS_DIARIAS:CRIAR") && canView;
  const canEditDraft = permissions.includes("ENTREGAS_DIARIAS:EDITAR_RASCUNHO");
  const canCorrect = permissions.includes("ENTREGAS_DIARIAS:CORRIGIR");
  const canCancelDelivery = permissions.includes("ENTREGAS_DIARIAS:CANCELAR");
  const canViewDashboard = permissions.includes("PAINEL_GERENCIAL:ACESSAR");
  const canAccessFeedback = permissions.includes("FEEDBACK_CLIENTES:ACESSAR");
  const canManageCatalogs = permissions.includes("CADASTROS:ADMINISTRAR");
  const canManageAccess = permissions.includes("CONTROLE_ACESSO:ADMINISTRAR");
  const canViewAudit = permissions.includes("AUDITORIA:VER");
  const editMatch = path.match(/^\/entregas\/([0-9a-f-]{36})$/i);
  const knownPath = ["/", "/login", "/entregas", "/historico", "/feedback", "/painel", "/cadastros", "/auditoria", "/trocar-senha", "/redefinir-senha"].includes(path) || Boolean(editMatch);
  const defaultPath = canCreate ? "/entregas" : canView ? "/historico" : canAccessFeedback ? "/feedback" : canViewDashboard ? "/painel" : canManageAccess || canManageCatalogs ? "/cadastros" : canViewAudit ? "/auditoria" : "/entregas";

  useEffect(() => {
    if (!loading && user && path === "/redefinir-senha") {
      navigate(defaultPath);
    } else if (!loading && user && !knownPath) {
      navigate(defaultPath);
    } else if (!loading && user && (path === "/" || path === "/login")) {
      navigate(defaultPath);
    }
  }, [loading, path, knownPath, defaultPath, user]);

  if (loading) {
    return <div className={cx(styles, commonStyles, "app-loading")}><div className={cx(styles, commonStyles, "loading-brand")}>V</div><span className={cx(styles, commonStyles, "spinner spinner-green")} /><p>Preparando seu espaço de trabalho...</p></div>;
  }

  if (!user && path === "/redefinir-senha") {
    return <ResetPasswordPage onResetPassword={resetPassword} onBack={() => navigate("/login")} />;
  }

  if (!user) {
    return <LoginPage onLogin={async (username, password) => {
      await login(username, password);
      navigate("/");
    }} onResetPassword={() => navigate("/redefinir-senha")} bootstrapMessage={bootstrapMessage} />;
  }

  const currentPath = ["/historico", "/feedback", "/painel", "/cadastros", "/auditoria", "/trocar-senha"].includes(path) ? path : "/entregas";
  return (
    <AppShell
      user={user}
      permissions={permissions}
      path={currentPath}
      onNavigate={navigate}
      onSignOut={() => { void logout().catch(() => undefined).finally(() => navigate("/login")); }}
    >
      {path === "/trocar-senha"
        ? <ChangePasswordPage onChangePassword={changePassword} onCancel={() => navigate(defaultPath)} />
        : path === "/painel" && canViewDashboard
        ? <ManagementDashboardPage />
        : path === "/auditoria" && canViewAudit
        ? <AuditPage />
        : path === "/feedback" && canAccessFeedback
        ? <FeedbackPage permissions={permissions} />
        : path === "/cadastros" && (canManageCatalogs || canManageAccess)
        ? <RegistriesPage permissions={permissions} currentUserId={user.id_usuario} />
        : path === "/historico" && canView
        ? <DeliveryHistoryPage onNavigate={navigate} canCreate={canCreate} canEditDraft={canEditDraft} canCorrect={canCorrect} canCancel={canCancelDelivery} currentUserId={user.id_usuario} />
        : (path === "/entregas" && canCreate) || (editMatch && canEditDraft && canView)
          ? <DeliveryLaunchPage onNavigate={navigate} responsibleName={user.nome_completo} canLaunch={canCreate} canManageCatalogs={canManageCatalogs} editId={editMatch?.[1]} />
          : <div className={cx(styles, commonStyles, "access-denied-card")}><div className={cx(styles, commonStyles, "empty-state-icon")}>⌑</div><h1>Acesso não disponível</h1><p>Seu perfil não tem permissão para abrir esta área. Se precisar, peça à pessoa administradora para revisar seus acessos.</p>{canView && currentPath !== "/historico" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/historico")}>Ir para o histórico</button>}{canCreate && currentPath !== "/entregas" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/entregas")}>Novo lançamento</button>}{canAccessFeedback && currentPath !== "/feedback" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/feedback")}>Reclamações e elogios</button>}{canViewDashboard && currentPath !== "/painel" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/painel")}>Abrir painel gerencial</button>}{canViewAudit && currentPath !== "/auditoria" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/auditoria")}>Abrir auditoria</button>}</div>}
    </AppShell>
  );
}

export function App() {
  return <AuthProvider><PortalApp /></AuthProvider>;
}
