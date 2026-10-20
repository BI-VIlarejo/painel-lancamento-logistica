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
import { FeedbackPage } from "../features/feedback/pages/FeedbackPage";

function PortalApp() {
  const { user, permissions, loading, bootstrapMessage, login, changePassword, logout } = useAuth();
  const path = usePathname();
  const canView = permissions.includes("ENTREGAS_DIARIAS:VER");
  const canCreate = permissions.includes("ENTREGAS_DIARIAS:CRIAR") && canView;
  const canEditDraft = permissions.includes("ENTREGAS_DIARIAS:EDITAR_RASCUNHO");
  const canViewDashboard = permissions.includes("PAINEL_GERENCIAL:ACESSAR");
  const canAccessFeedback = permissions.includes("FEEDBACK_CLIENTES:ACESSAR");
  const canManageCatalogs = permissions.includes("CADASTROS:ADMINISTRAR");
  const canManageAccess = permissions.includes("CONTROLE_ACESSO:ADMINISTRAR");
  const editMatch = path.match(/^\/entregas\/([0-9a-f-]{36})$/i);
  const knownPath = ["/", "/login", "/entregas", "/historico", "/feedback", "/painel", "/cadastros", "/trocar-senha"].includes(path) || Boolean(editMatch);
  const defaultPath = canCreate ? "/entregas" : canView ? "/historico" : canAccessFeedback ? "/feedback" : canViewDashboard ? "/painel" : canManageAccess || canManageCatalogs ? "/cadastros" : "/entregas";

  useEffect(() => {
    if (!loading && user?.troca_senha_obrigatoria && path !== "/trocar-senha") {
      navigate("/trocar-senha");
    } else if (!loading && user && !user.troca_senha_obrigatoria && path === "/trocar-senha") {
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

  if (!user) {
    return <LoginPage onLogin={async (username, password) => {
      await login(username, password);
      navigate("/");
    }} bootstrapMessage={bootstrapMessage} />;
  }

  if (user.troca_senha_obrigatoria) {
    return <ChangePasswordPage onChangePassword={changePassword} />;
  }

  const currentPath = ["/historico", "/feedback", "/painel", "/cadastros"].includes(path) ? path : "/entregas";
  return (
    <AppShell
      user={user}
      permissions={permissions}
      path={currentPath}
      onNavigate={navigate}
      onSignOut={() => { void logout().catch(() => undefined).finally(() => navigate("/login")); }}
    >
      {path === "/painel" && canViewDashboard
        ? <ManagementDashboardPage />
        : path === "/feedback" && canAccessFeedback
        ? <FeedbackPage permissions={permissions} />
        : path === "/cadastros" && (canManageCatalogs || canManageAccess)
        ? <RegistriesPage permissions={permissions} currentUserId={user.id_usuario} />
        : path === "/historico" && canView
        ? <DeliveryHistoryPage onNavigate={navigate} canCreate={canCreate} canEditDraft={canEditDraft} currentUserId={user.id_usuario} />
        : (path === "/entregas" && canCreate) || (editMatch && canEditDraft && canView)
          ? <DeliveryLaunchPage onNavigate={navigate} responsibleName={user.nome_completo} canLaunch={canCreate} editId={editMatch?.[1]} />
          : <div className={cx(styles, commonStyles, "access-denied-card")}><div className={cx(styles, commonStyles, "empty-state-icon")}>⌑</div><h1>Acesso não disponível</h1><p>Seu perfil não tem permissão para abrir esta área. Se precisar, peça à pessoa administradora para revisar seus acessos.</p>{canView && currentPath !== "/historico" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/historico")}>Ir para o histórico</button>}{canCreate && currentPath !== "/entregas" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/entregas")}>Novo lançamento</button>}{canAccessFeedback && currentPath !== "/feedback" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/feedback")}>Reclamações e elogios</button>}{canViewDashboard && currentPath !== "/painel" && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => navigate("/painel")}>Abrir painel gerencial</button>}</div>}
    </AppShell>
  );
}

export function App() {
  return <AuthProvider><PortalApp /></AuthProvider>;
}
