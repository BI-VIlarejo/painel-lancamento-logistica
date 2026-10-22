import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import styles from "./RegistriesPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { isDemoMode } from "../../../shared/api/apiClient";
import { messageFromApiError } from "../../../shared/api/apiError";
import { administrationApi } from "../api";
import type { LocalityAdminItem, PersonAdminItem, Profile, ProfilePermission, ReasonAdminItem, UserAccessGrant, UserAccount, UserScopeGrantInput } from "../types";
import type { LocalityCatalogItem, SectorCatalogItem } from "../../deliveries/types";

type Props = { permissions: string[]; currentUserId: number };
type MainTab = "operation" | "users";
type CatalogTab = "stores" | "people" | "reasons";
type StatusFilter = "ACTIVE" | "INACTIVE" | "ALL";
type Dialog = { kind: "localities" | "people" | "reasons"; item?: LocalityAdminItem | PersonAdminItem | ReasonAdminItem };
type StatusTarget = { kind: "locality" | "person" | "reason" | "user" | "grant"; id: number; label: string; active: boolean; userId?: number };
type ScopeOptions = { setores: SectorCatalogItem[]; localidades: LocalityCatalogItem[] };
type GrantFormState = { id_perfil: string; tipo_escopo: UserAccessGrant["tipo_escopo"] | ""; id_setor: string; id_localidade: string };

const emptyGrantForm = (): GrantFormState => ({ id_perfil: "", tipo_escopo: "", id_setor: "", id_localidade: "" });
const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value.slice(0, 10) + "T12:00:00");
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};
const parseApiDateTime = (value: string) => {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  return new Date(hasTimezone ? value : value + "Z");
};
const formatDateTime = (value?: string | null) => {
  if (!value) return "Nunca acessou";
  const date = parseApiDateTime(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};
const getGrantStatus = (grant: UserAccessGrant) => {
  if (!grant.ativo) return { active: false, label: "Revogado", tone: "inactive" as const };
  const now = new Date();
  const start = parseApiDateTime(grant.vigente_desde);
  if (!Number.isNaN(start.getTime()) && start > now) {
    return { active: false, label: "Agendado", tone: "scheduled" as const };
  }
  const end = grant.vigente_ate ? parseApiDateTime(grant.vigente_ate) : null;
  if (end && !Number.isNaN(end.getTime()) && end <= now) {
    return { active: false, label: "Vencido", tone: "expired" as const };
  }
  return { active: true, label: "Ativo", tone: "active" as const };
};
const isPerson = (item: unknown): item is PersonAdminItem => Boolean(item && typeof item === "object" && "id_pessoa" in item);
const isReason = (item: unknown): item is ReasonAdminItem => Boolean(item && typeof item === "object" && "id_motivo_nao_entrega" in item);
const isLocality = (item: unknown): item is LocalityAdminItem => Boolean(item && typeof item === "object" && "id_localidade" in item);

function StatusPill({ active, pending, label, tone }: { active: boolean; pending?: boolean; label?: string; tone?: "active" | "inactive" | "scheduled" | "expired" }) {
  const statusTone = tone ?? (pending ? "pending" : active ? "active" : "inactive");
  const statusLabel = label ?? (!active ? "Inativo" : pending ? "Troca de senha pendente" : "Ativo");
  return <span className={cx(styles, commonStyles, "status-pill status-" + statusTone)}><i />{statusLabel}</span>;
}
function StatusFilters({ value, onChange }: { value: StatusFilter; onChange: (value: StatusFilter) => void }) {
  return <div className={cx(styles, commonStyles, "status-filters")} role="group" aria-label="Filtrar por situação">
    <button type="button" className={cx(styles, commonStyles, value === "ACTIVE" ? "filter-active" : "")} onClick={() => onChange("ACTIVE")}>Ativos</button>
    <button type="button" className={cx(styles, commonStyles, value === "INACTIVE" ? "filter-active" : "")} onClick={() => onChange("INACTIVE")}>Inativos</button>
    <button type="button" className={cx(styles, commonStyles, value === "ALL" ? "filter-active" : "")} onClick={() => onChange("ALL")}>Todos</button>
  </div>;
}
function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className={cx(styles, commonStyles, "empty-state")}><span aria-hidden="true">⌕</span><h3>{title}</h3><p>{description}</p></div>;
}
function ModalHeader({ eyebrow, title, onClose, id }: { eyebrow: string; title: string; onClose: () => void; id: string }) {
  return <div className={cx(styles, commonStyles, "modal-header")}><div><p className={cx(styles, commonStyles, "section-kicker")}>{eyebrow}</p><h2 id={id}>{title}</h2></div><button className={cx(styles, commonStyles, "close-button")} type="button" aria-label="Fechar" onClick={onClose}>×</button></div>;
}

export function RegistriesPage({ permissions, currentUserId }: Props) {
  const canManageCatalogs = permissions.includes("CADASTROS:ADMINISTRAR");
  const canManageAccess = permissions.includes("CONTROLE_ACESSO:ADMINISTRAR");
  const administrationTitle = canManageCatalogs && canManageAccess
    ? "Cadastros e acessos"
    : canManageCatalogs
      ? "Cadastros operacionais"
      : "Usuários e acessos";
  const administrationDescription = canManageCatalogs && canManageAccess
    ? "Mantenha os dados da operação e administre quem pode acessar cada parte do portal."
    : canManageCatalogs
      ? "Mantenha os cadastros compartilhados de lojas, equipe e motivos de ocorrência."
      : "Consulte contas e mantenha os perfis e escopos de acesso ao portal.";
  const [mainTab, setMainTab] = useState<MainTab>(canManageCatalogs ? "operation" : "users");
  const [catalogTab, setCatalogTab] = useState<CatalogTab>("stores");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [accountError, setAccountError] = useState("");
  const [localities, setLocalities] = useState<LocalityAdminItem[]>([]);
  const [people, setPeople] = useState<PersonAdminItem[]>([]);
  const [reasons, setReasons] = useState<ReasonAdminItem[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilePermissions, setProfilePermissions] = useState<ProfilePermission[]>([]);
  const [scopeOptions, setScopeOptions] = useState<ScopeOptions>({ setores: [], localidades: [] });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [accountDialog, setAccountDialog] = useState(false);
  const [initialCredential, setInitialCredential] = useState<{ name: string; username: string; password: string; purpose: "created" | "reset"; access?: UserAccessGrant } | null>(null);
  const [credentialCopied, setCredentialCopied] = useState(false);
  const [credentialCopyError, setCredentialCopyError] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const [userGrants, setUserGrants] = useState<UserAccessGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [grantForm, setGrantForm] = useState<GrantFormState>(emptyGrantForm);
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [passwordResetTarget, setPasswordResetTarget] = useState<UserAccount | null>(null);
  const [passwordResetError, setPasswordResetError] = useState("");
  const [statusReason, setStatusReason] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const errors: string[] = [];
    if (canManageCatalogs) {
      try {
        const result = await Promise.all([administrationApi.localities(), administrationApi.people(), administrationApi.reasons()]);
        setLocalities(result[0]); setPeople(result[1]); setReasons(result[2]);
      } catch (error) { errors.push(messageFromApiError(error)); }
    }
    if (canManageAccess) {
      try {
        const result = await Promise.all([administrationApi.users("", true), administrationApi.profiles(), administrationApi.scopeOptions()]);
        setUsers(result[0]); setProfiles(result[1]); setScopeOptions(result[2]);
      } catch (error) { errors.push(messageFromApiError(error)); }
    }
    setLoadError(errors.join(" "));
    setLoading(false);
  }, [canManageAccess, canManageCatalogs]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if ((!selectedUser && !accountDialog) || !grantForm.id_perfil) {
      setProfilePermissions([]);
      return;
    }
    let active = true;
    void administrationApi.profilePermissions(Number(grantForm.id_perfil))
      .then((rows) => { if (active) setProfilePermissions(rows); })
      .catch((error: unknown) => { if (active) setLoadError(messageFromApiError(error)); });
    return () => { active = false; };
  }, [accountDialog, grantForm.id_perfil, selectedUser]);

  const counts = useMemo(() => ({
    stores: localities.filter((item) => item.ativo).length,
    people: people.filter((item) => item.ativo).length,
    reasons: reasons.filter((item) => item.ativo).length,
    users: users.filter((item) => item.ativo).length,
  }), [localities, people, reasons, users]);
  const catalogRows = useMemo(() => {
    const rows = catalogTab === "stores"
      ? localities.map((item) => ({
        id: item.id_localidade,
        primary: item.nome_localidade,
        secondary: [item.cidade || "Cidade não informada", item.uf || "UF não informada"].join(" / "),
        detail: item.tipo_localidade === "CD" ? "Centro de distribuição" : item.tipo_localidade === "OUTRO" ? "Outro" : item.tipo_localidade === "LOJA" ? "Loja" : `Tipo: ${item.tipo_localidade}`,
        active: item.ativo,
        item,
      }))
      : catalogTab === "people"
        ? people.map((item) => ({ id: item.id_pessoa, primary: item.nome_exibicao, secondary: item.tipo_funcao === "MOTORISTA" ? "Motorista" : "Ajudante", detail: "Vigente desde " + formatDate(item.vigente_desde), active: item.ativo, item }))
        : reasons.map((item) => ({ id: item.id_motivo_nao_entrega, primary: item.descricao_motivo, secondary: "Vigente desde " + formatDate(item.vigente_desde), detail: "", active: item.ativo, item }));
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((row) => statusFilter === "ALL" || (statusFilter === "ACTIVE" ? row.active : !row.active))
      .filter((row) => !needle || (row.primary + " " + row.secondary + " " + row.detail + " " + (isLocality(row.item) ? row.item.codigo_localidade : "")).toLocaleLowerCase("pt-BR").includes(needle));
  }, [catalogTab, localities, people, query, reasons, statusFilter]);
  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return users.filter((user) => (statusFilter === "ALL" || (statusFilter === "ACTIVE" ? user.ativo : !user.ativo))
      && (!needle || (user.nome_completo + " " + user.username).toLocaleLowerCase("pt-BR").includes(needle)));
  }, [query, statusFilter, users]);

  const setField = (field: string, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const openCatalog = (kind: Dialog["kind"], item?: Dialog["item"]) => {
    setNotice(""); setDialog({ kind, item });
    if (kind === "localities") {
      const locality = isLocality(item) ? item : undefined;
      setForm({
        codigoLocalidade: locality?.codigo_localidade ?? "",
        nomeLocalidade: locality?.nome_localidade ?? "",
        tipoLocalidade: locality?.tipo_localidade ?? "LOJA",
        cidade: locality?.cidade ?? "",
        uf: locality?.uf ?? "",
      });
    } else if (kind === "people") {
      const person = isPerson(item) ? item : undefined;
      setForm({ nome: person?.nome_exibicao ?? "", funcao: person?.tipo_funcao ?? "MOTORISTA", codigoPessoa: person?.codigo_pessoa ?? "" });
    } else {
      const reason = isReason(item) ? item : undefined;
      setForm({ codigo: reason?.codigo_motivo ?? "", descricao: reason?.descricao_motivo ?? "" });
    }
  };
  const closeCatalog = () => { setDialog(null); setForm({}); };

  const saveCatalog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;
    setSaving(true); setLoadError("");
    if (dialog.kind === "localities") {
      const operation = dialog.item && isLocality(dialog.item)
        ? administrationApi.updateLocality(dialog.item.id_localidade, {
          nome_localidade: form.nomeLocalidade.trim(),
          tipo_localidade: form.tipoLocalidade,
          cidade: form.cidade.trim(),
          uf: form.uf.trim().toUpperCase(),
        })
        : administrationApi.createLocality({
          codigo_localidade: form.codigoLocalidade.trim().toUpperCase(),
          nome_localidade: form.nomeLocalidade.trim(),
          tipo_localidade: form.tipoLocalidade as "LOJA" | "CD" | "OUTRO",
          cidade: form.cidade.trim(),
          uf: form.uf.trim().toUpperCase(),
        });
      void operation.then(() => {
        setNotice(dialog.item ? "Localidade atualizada." : "Localidade cadastrada.");
        closeCatalog();
        return refresh();
      }).catch((error: unknown) => setLoadError(messageFromApiError(error))).finally(() => setSaving(false));
      return;
    }

    const operation = dialog.kind === "people"
      ? administrationApi.createPerson({
        ...(form.codigoPessoa ? { codigo_pessoa: form.codigoPessoa } : {}),
        nome_exibicao: form.nome.trim(),
        tipo_funcao: form.funcao as "MOTORISTA" | "AJUDANTE",
      })
      : administrationApi.createReason({
        ...(form.codigo ? { codigo_motivo: form.codigo } : {}),
        descricao_motivo: form.descricao.trim(),
      });
    void operation.then((created) => {
      setNotice(`${dialog.item ? "Nova versão criada" : "Cadastro criado"}. Vigência a partir de ${formatDate(created.vigente_desde)}; histórico anterior preservado.`);
      closeCatalog();
      return refresh();
    }).catch((error: unknown) => setLoadError(messageFromApiError(error))).finally(() => setSaving(false));
  };

  const openAccount = () => { setForm({ username: "", nome: "" }); setGrantForm(emptyGrantForm()); setAccountDialog(true); setAccountError(""); setNotice(""); setLoadError(""); };
  const closeAccount = () => { setAccountDialog(false); setGrantForm(emptyGrantForm()); };
  const saveAccount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!grantForm.id_perfil || !grantForm.tipo_escopo) {
      setAccountError("Escolha o perfil e o escopo inicial do usuário.");
      return;
    }
    const initialAccess: UserScopeGrantInput = {
      id_perfil: Number(grantForm.id_perfil),
      tipo_escopo: grantForm.tipo_escopo,
      id_setor: grantForm.tipo_escopo === "SETOR" || grantForm.tipo_escopo === "SETOR_LOCALIDADE" ? Number(grantForm.id_setor) : null,
      id_localidade: grantForm.tipo_escopo === "LOCALIDADE" || grantForm.tipo_escopo === "SETOR_LOCALIDADE" ? Number(grantForm.id_localidade) : null,
    };
    setSaving(true); setAccountError("");
    void administrationApi.createUser({ username: form.username.trim().toLowerCase(), nome_completo: form.nome.trim(), acesso_inicial: initialAccess })
      .then((created) => {
        setInitialCredential({ name: created.nome_completo, username: created.username, password: created.senha_inicial, purpose: "created", access: created.acesso_inicial ?? undefined });
        setCredentialCopied(false); setCredentialCopyError("");
        closeAccount(); setForm({});
        return refresh();
      }).catch((error: unknown) => setAccountError(messageFromApiError(error))).finally(() => setSaving(false));
  };
  const copyInitialCredential = async () => {
    if (!initialCredential) return;
    try {
      await navigator.clipboard.writeText(`Usuário: ${initialCredential.username}\nSenha: ${initialCredential.password}`);
      setCredentialCopied(true); setCredentialCopyError("");
    } catch {
      setCredentialCopyError("Não foi possível copiar automaticamente. Selecione a senha e copie manualmente.");
    }
  };
  const confirmPasswordReset = () => {
    if (!passwordResetTarget) return;
    setSaving(true); setPasswordResetError("");
    void administrationApi.resetUserTemporaryPassword(passwordResetTarget.id_usuario)
      .then((created) => {
        setUsers((current) => current.map((user) => user.id_usuario === created.id_usuario ? { ...user, troca_senha_obrigatoria: false } : user));
        setSelectedUser(null); setPasswordResetTarget(null);
        setInitialCredential({ name: created.nome_completo, username: created.username, password: created.senha_inicial, purpose: "reset" });
        setCredentialCopied(false); setCredentialCopyError("");
        return refresh();
      }).catch((error: unknown) => setPasswordResetError(messageFromApiError(error))).finally(() => setSaving(false));
  };

  const openUserAccess = (user: UserAccount) => {
    setSelectedUser(user); setUserGrants([]); setProfilePermissions([]); setShowGrantForm(false); setLoadError("");
    setGrantForm(emptyGrantForm());
    setGrantsLoading(true);
    void administrationApi.userGrants(user.id_usuario).then(setUserGrants)
      .catch((error: unknown) => setLoadError(messageFromApiError(error))).finally(() => setGrantsLoading(false));
  };
  const saveGrant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser || !grantForm.id_perfil || !grantForm.tipo_escopo) return;
    const type = grantForm.tipo_escopo;
    const idSetor = type === "SETOR" || type === "SETOR_LOCALIDADE" ? Number(grantForm.id_setor) : null;
    const idLocalidade = type === "LOCALIDADE" || type === "SETOR_LOCALIDADE" ? Number(grantForm.id_localidade) : null;
    setSaving(true); setLoadError("");
    void administrationApi.createGrant(selectedUser.id_usuario, {
      id_perfil: Number(grantForm.id_perfil), tipo_escopo: type, id_setor: idSetor, id_localidade: idLocalidade,
    }).then(() => {
      setNotice("Acesso adicionado para " + selectedUser.nome_completo + ".");
      setShowGrantForm(false);
      setGrantForm(emptyGrantForm());
      return administrationApi.userGrants(selectedUser.id_usuario).then(setUserGrants);
    }).catch((error: unknown) => setLoadError(messageFromApiError(error))).finally(() => setSaving(false));
  };

  const applyStatusChange = () => {
    if (!statusTarget) return;
    setSaving(true); setLoadError("");
    const task = statusTarget.kind === "locality"
      ? administrationApi.setLocalityActive(statusTarget.id, !statusTarget.active)
      : statusTarget.kind === "person"
      ? administrationApi.deactivatePerson(statusTarget.id)
      : statusTarget.kind === "reason"
        ? administrationApi.deactivateReason(statusTarget.id)
        : statusTarget.kind === "user"
          ? administrationApi.setUserActive(statusTarget.id, !statusTarget.active, statusReason.trim())
          : statusTarget.userId
            ? administrationApi.revokeGrant(statusTarget.userId, statusTarget.id, statusReason.trim())
            : Promise.reject(new Error("Concessão não encontrada."));
    void task.then(() => {
      const subject = statusTarget.kind === "user" ? "Conta" : statusTarget.kind === "locality" ? "Localidade" : "Cadastro";
      setNotice(statusTarget.kind === "grant" ? "Acesso revogado." : statusTarget.active ? subject + " desativada." : subject + " reativada.");
      if (statusTarget.kind === "grant" && selectedUser) return administrationApi.userGrants(selectedUser.id_usuario).then(setUserGrants);
      return refresh();
    }).then(() => { setStatusTarget(null); setStatusReason(""); })
      .catch((error: unknown) => setLoadError(messageFromApiError(error))).finally(() => setSaving(false));
  };

  const scopeLabel = (grant: UserAccessGrant) => {
    if (grant.tipo_escopo === "GLOBAL") return "Todas as áreas";
    const sector = scopeOptions.setores.find((item) => item.id_setor === grant.id_setor)?.nome
      ?? (grant.id_setor ? "Setor " + grant.id_setor : undefined);
    const locality = localities.find((item) => item.id_localidade === grant.id_localidade)?.nome_localidade
      ?? scopeOptions.localidades.find((item) => item.id_localidade === grant.id_localidade)?.nome_localidade
      ?? (grant.id_localidade ? "Loja " + grant.id_localidade : undefined);
    if (grant.tipo_escopo === "SETOR") return sector ?? ("Setor " + grant.id_setor);
    if (grant.tipo_escopo === "LOCALIDADE") return locality ?? ("Loja " + grant.id_localidade);
    return [sector, locality].filter(Boolean).join(" · ") || "Escopo não disponível";
  };
  const selectedGrantProfile = profiles.find((profile) => profile.id_perfil === Number(grantForm.id_perfil));
  const updateGrantProfile = (id: string) => {
    const profile = profiles.find((item) => item.id_perfil === Number(id));
    const requiresGlobalScope = profile?.codigo === "DEV" || profile?.codigo === "CADASTRADOR";
    setGrantForm((current) => ({
      ...current,
      id_perfil: id,
      tipo_escopo: requiresGlobalScope ? "GLOBAL" : current.tipo_escopo,
      id_setor: requiresGlobalScope ? "" : current.id_setor,
      id_localidade: requiresGlobalScope ? "" : current.id_localidade,
    }));
  };
  const showUsers = mainTab === "users" && canManageAccess;
  const catalogTitle = catalogTab === "stores" ? "Lojas e filiais" : catalogTab === "people" ? "Motoristas e ajudantes" : "Motivos de não entrega";
  const catalogWord = catalogTab === "stores" ? "localidade" : catalogTab === "people" ? "pessoa" : "motivo";
  const statusSubject = statusTarget?.kind === "user" ? "conta" : statusTarget?.kind === "locality" ? "localidade" : statusTarget?.kind === "person" ? "pessoa" : "motivo";
  const statusTitle = statusTarget?.kind === "grant"
    ? "Revogar acesso"
    : statusTarget?.active
      ? "Desativar " + statusSubject
      : "Reativar " + statusSubject;
  const statusDescription = statusTarget?.kind === "grant"
    ? "A concessão do perfil " + statusTarget.label + " deixará de valer. O histórico será preservado."
    : statusTarget?.active
      ? statusTarget.label + " deixará de aparecer nas novas operações. Os registros históricos continuam preservados."
      : statusTarget?.kind === "user"
        ? "A conta de " + statusTarget.label + " voltará a permitir acesso com as concessões já cadastradas."
        : "Este cadastro voltará a aparecer nas novas operações.";
  const statusActionLabel = statusTarget?.kind === "grant"
    ? "Revogar acesso"
    : statusTarget?.active
      ? "Confirmar desativação"
      : "Reativar " + statusSubject;
  const accessFields = <>
    <label>Perfil de acesso<select required value={grantForm.id_perfil} onChange={(event) => updateGrantProfile(event.target.value)}><option value="" disabled>Selecione um perfil</option>{profiles.map((profile) => <option key={profile.id_perfil} value={profile.id_perfil}>{profile.nome}</option>)}</select></label>
    {grantForm.id_perfil && <div className={cx(styles, commonStyles, "permission-preview")}><strong>Permissões deste perfil</strong>{profilePermissions.length ? <ul>{profilePermissions.map((permission) => <li key={permission.id_permissao}><span>{permission.descricao}</span><code>{permission.codigo}</code></li>)}</ul> : <p>Este perfil não tem permissões ativas cadastradas.</p>}</div>}
    <label>Onde vale esse acesso?<select required value={grantForm.tipo_escopo} disabled={selectedGrantProfile?.codigo === "DEV" || selectedGrantProfile?.codigo === "CADASTRADOR"} onChange={(event) => setGrantForm((current) => ({ ...current, tipo_escopo: event.target.value as GrantFormState["tipo_escopo"], id_setor: "", id_localidade: "" }))}><option value="" disabled>Selecione um escopo</option><option value="GLOBAL">Todas as áreas</option><option value="SETOR">Um setor</option><option value="LOCALIDADE">Uma loja</option><option value="SETOR_LOCALIDADE">Um setor e uma loja</option></select></label>
    {(grantForm.tipo_escopo === "SETOR" || grantForm.tipo_escopo === "SETOR_LOCALIDADE") && <label>Setor<select required value={grantForm.id_setor} onChange={(event) => setGrantForm((current) => ({ ...current, id_setor: event.target.value }))}><option value="" disabled>Selecione o setor</option>{scopeOptions.setores.map((sector) => <option key={sector.id_setor} value={sector.id_setor}>{sector.nome}</option>)}</select></label>}
    {(grantForm.tipo_escopo === "LOCALIDADE" || grantForm.tipo_escopo === "SETOR_LOCALIDADE") && <label>Loja<select required value={grantForm.id_localidade} onChange={(event) => setGrantForm((current) => ({ ...current, id_localidade: event.target.value }))}><option value="" disabled>Selecione a loja</option>{scopeOptions.localidades.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>}
    {selectedGrantProfile?.codigo === "DEV" && <p className={cx(styles, commonStyles, "form-guidance")}>O perfil de desenvolvimento exige acesso global.</p>}
    {selectedGrantProfile?.codigo === "OPERADOR" && <p className={cx(styles, commonStyles, "form-guidance")}>Operação pode manter a lista compartilhada inteira de lojas, equipe e motivos. O escopo escolhido continua limitando Entregas e feedback.</p>}
    {selectedGrantProfile?.codigo === "CADASTRADOR" && <p className={cx(styles, commonStyles, "form-guidance")}>Este perfil administra somente os catálogos operacionais compartilhados. Ele exige escopo global e não concede acesso a usuários e permissões.</p>}
  </>;

  return <div className={cx(styles, commonStyles, "registries-page")}>
    <header className={cx(styles, commonStyles, "registry-heading")}><div><p className={cx(styles, commonStyles, "eyebrow")}>ADMINISTRAÇÃO DO PORTAL</p><h1>{administrationTitle}</h1><p className={cx(styles, commonStyles, "page-lead")}>{administrationDescription}</p></div>{isDemoMode && <span className={cx(styles, commonStyles, "demo-indicator")}><i /> Prévia interativa</span>}</header>

    {canManageCatalogs && <section className={cx(styles, commonStyles, "overview-strip")} aria-label="Resumo dos cadastros">
      <div><span className={cx(styles, commonStyles, "overview-symbol")}>⌂</span><span>Lojas ativas</span><strong>{counts.stores}</strong></div><div><span className={cx(styles, commonStyles, "overview-symbol")}>◎</span><span>Pessoas operacionais</span><strong>{counts.people}</strong></div><div><span className={cx(styles, commonStyles, "overview-symbol")}>≋</span><span>Motivos ativos</span><strong>{counts.reasons}</strong></div>{canManageAccess && <div><span className={cx(styles, commonStyles, "overview-symbol")}>♙</span><span>Contas ativas</span><strong>{counts.users}</strong></div>}
    </section>}
    {canManageCatalogs && canManageAccess && <nav className={cx(styles, commonStyles, "main-tabs")} aria-label="Áreas de administração">
      <button type="button" className={cx(styles, commonStyles, "main-tab" + (mainTab === "operation" ? " main-tab-active" : ""))} onClick={() => { setMainTab("operation"); setQuery(""); setStatusFilter("ACTIVE"); }}><span>01</span>Dados operacionais</button>
      <button type="button" className={cx(styles, commonStyles, "main-tab" + (mainTab === "users" ? " main-tab-active" : ""))} onClick={() => { setMainTab("users"); setQuery(""); setStatusFilter("ACTIVE"); }}><span>02</span>Usuários e acessos</button>
    </nav>}
    {loadError && <div className={cx(styles, commonStyles, "notice notice-error page-alert")} role="alert">{loadError}<button type="button" onClick={() => void refresh()}>Tentar novamente</button></div>}
    {notice && <div className={cx(styles, commonStyles, "notice notice-success page-alert")} role="status"><span>✓</span>{notice}<button type="button" aria-label="Fechar mensagem" onClick={() => setNotice("")}>×</button></div>}

    {loading ? <div className={cx(styles, commonStyles, "registry-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Carregando cadastros...</div>
      : !canManageCatalogs && !canManageAccess ? <EmptyState title="Sem acesso à administração" description="Peça à pessoa administradora para conceder a permissão de cadastros ou de controle de acesso." />
        : showUsers ? <>
          <section className={cx(styles, commonStyles, "section-intro")}><div><p className={cx(styles, commonStyles, "section-kicker")}>PESSOAS DO PORTAL</p><h2>Usuários e acessos</h2><p>Contas são criadas pela administração. O perfil define as ações disponíveis; o escopo limita em quais setores ou lojas elas valem.</p></div><div className={cx(styles, commonStyles, "access-note")}><span aria-hidden="true">i</span><p>Uma pessoa pode ter mais de um acesso. Por exemplo: perfil de Gestão e perfil de Operação, cada um no escopo necessário.</p></div></section>
          <section className={cx(styles, commonStyles, "registry-panel")}><div className={cx(styles, commonStyles, "panel-toolbar")}><div><h3>Contas de funcionários</h3><span>{visibleUsers.length} exibida{visibleUsers.length === 1 ? "" : "s"}</span></div><button className={cx(styles, commonStyles, "button button-primary add-button")} type="button" onClick={openAccount}><span>＋</span>Nova conta</button></div>
            <div className={cx(styles, commonStyles, "list-controls")}><label className={cx(styles, commonStyles, "search-box")}><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou usuário" aria-label="Buscar usuários" /></label><StatusFilters value={statusFilter} onChange={setStatusFilter} /></div>
            {visibleUsers.length === 0 ? <EmptyState title="Nenhuma conta encontrada" description={users.length ? "Altere a busca ou o filtro de situação." : "Crie a primeira conta já definindo o perfil e onde o acesso vale."} /> : <div className={cx(styles, commonStyles, "table-scroll")}><table className={cx(styles, commonStyles, "registry-table user-table")}><thead><tr><th>Funcionário</th><th>Usuário</th><th>Situação</th><th>Último acesso</th><th aria-label="Ações" /></tr></thead><tbody>
              {visibleUsers.map((user) => <tr key={user.id_usuario}><td><strong>{user.nome_completo}</strong>{user.id_usuario === currentUserId && <small className={cx(styles, commonStyles, "self-tag")}>Você</small>}</td><td><span className={cx(styles, commonStyles, "username-cell")}>{user.username}</span></td><td><StatusPill active={user.ativo} /></td><td><span className={cx(styles, commonStyles, "last-login")}>{formatDateTime(user.ultimo_login_em)}</span></td><td><div className={cx(styles, commonStyles, "row-actions")}><button className={cx(styles, commonStyles, "table-action")} type="button" onClick={() => openUserAccess(user)}>Acessos <span aria-hidden="true">↗</span></button>{user.id_usuario !== currentUserId && <button className={cx(styles, commonStyles, "table-action" + (user.ativo ? " action-danger" : ""))} type="button" onClick={() => { setStatusReason(""); setStatusTarget({ kind: "user", id: user.id_usuario, label: user.nome_completo, active: user.ativo }); }}>{user.ativo ? "Desativar" : "Ativar"}</button>}</div></td></tr>)}
            </tbody></table></div>}
            <div className={cx(styles, commonStyles, "panel-footnote")}><span aria-hidden="true">⌑</span><p>Ao desativar uma conta, as sessões abertas são encerradas. O histórico e as concessões anteriores ficam preservados.</p></div>
          </section>
        </> : <>
          <section className={cx(styles, commonStyles, "section-intro")}><div><p className={cx(styles, commonStyles, "section-kicker")}>BASE DA OPERAÇÃO</p><h2>Cadastros operacionais</h2><p>Cadastre e mantenha as localidades do portal, a equipe e os motivos de ocorrência.</p></div><div className={cx(styles, commonStyles, "access-note catalog-note")}><span aria-hidden="true">i</span><p>Motoristas, ajudantes e motivos preservam versões. Alterações criam uma nova vigência; registros usados não são apagados.</p></div></section>
          <div className={cx(styles, commonStyles, "catalog-workspace")}><nav className={cx(styles, commonStyles, "catalog-nav")} aria-label="Tipo de cadastro"><p>CATÁLOGOS</p>
            <button type="button" className={cx(styles, commonStyles, "catalog-nav-item" + (catalogTab === "stores" ? " catalog-nav-active" : ""))} onClick={() => { setCatalogTab("stores"); setQuery(""); }}><span className={cx(styles, commonStyles, "catalog-nav-icon")}>⌂</span><span>Lojas<small>{counts.stores} ativas</small></span><b>›</b></button>
            <button type="button" className={cx(styles, commonStyles, "catalog-nav-item" + (catalogTab === "people" ? " catalog-nav-active" : ""))} onClick={() => { setCatalogTab("people"); setQuery(""); }}><span className={cx(styles, commonStyles, "catalog-nav-icon")}>◎</span><span>Equipe<small>{counts.people} pessoas ativas</small></span><b>›</b></button>
            <button type="button" className={cx(styles, commonStyles, "catalog-nav-item" + (catalogTab === "reasons" ? " catalog-nav-active" : ""))} onClick={() => { setCatalogTab("reasons"); setQuery(""); }}><span className={cx(styles, commonStyles, "catalog-nav-icon")}>≋</span><span>Motivos de ocorrência<small>{counts.reasons} ativos</small></span><b>›</b></button>
            <div className={cx(styles, commonStyles, "catalog-nav-help")}><strong>Uma base confiável</strong><p>Os formulários usam apenas cadastros ativos e válidos na data do lançamento.</p></div>
          </nav>
          <section className={cx(styles, commonStyles, "registry-panel catalog-panel")}>
            <div className={cx(styles, commonStyles, "panel-toolbar")}>
              <div><span className={cx(styles, commonStyles, "panel-eyebrow")}>CATÁLOGO OPERACIONAL</span><h3>{catalogTitle}</h3><span>{catalogRows.length} registro{catalogRows.length === 1 ? "" : "s"} na lista</span></div>
              <button className={cx(styles, commonStyles, "button button-primary add-button")} type="button" onClick={() => openCatalog(catalogTab === "stores" ? "localities" : catalogTab)}><span>＋</span>{catalogTab === "stores" ? "Cadastrar loja" : catalogTab === "people" ? "Cadastrar pessoa" : "Cadastrar motivo"}</button>
            </div>
            <div className={cx(styles, commonStyles, "list-controls")}><label className={cx(styles, commonStyles, "search-box")}><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={catalogTab === "stores" ? "Buscar por loja, código ou cidade" : catalogTab === "people" ? "Buscar por nome ou função" : "Buscar pela descrição do motivo"} aria-label="Buscar cadastros" /></label><StatusFilters value={statusFilter} onChange={setStatusFilter} /></div>
            {catalogRows.length === 0 ? <EmptyState title={"Nenhum " + catalogWord + " encontrado"} description={query ? "Altere a busca ou o filtro de situação." : catalogTab === "stores" ? "Não há localidades cadastradas no portal." : "Cadastre o primeiro registro desta lista."} /> : <div className={cx(styles, commonStyles, "table-scroll")}><table className={cx(styles, commonStyles, "registry-table catalog-table")}><thead><tr><th>{catalogTab === "stores" ? "Loja / filial" : catalogTab === "people" ? "Pessoa" : "Motivo"}</th><th>{catalogTab === "stores" ? "Cidade / UF" : catalogTab === "people" ? "Função" : "Vigência"}</th>{catalogTab === "stores" && <th>Tipo</th>}{catalogTab === "people" && <th>Vigência</th>}<th>Situação</th><th aria-label="Ações" /></tr></thead><tbody>
              {catalogRows.map((row) => <tr key={catalogTab + "-" + row.id}>
                <td><strong>{row.primary}</strong>{catalogTab === "stores" && isLocality(row.item) && <small>{row.item.codigo_localidade}</small>}</td>
                <td><span className={cx(styles, commonStyles, "role-cell")}>{row.secondary}</span></td>
                {catalogTab === "stores" && <td><span className={cx(styles, commonStyles, "detail-cell")}>{row.detail}</span></td>}
                {catalogTab === "people" && <td><span className={cx(styles, commonStyles, "detail-cell")}>{row.detail}</span></td>}
                <td><StatusPill active={row.active} /></td>
                <td><div className={cx(styles, commonStyles, "row-actions")}>
                  {catalogTab === "stores" && isLocality(row.item) && <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={() => openCatalog("localities", row.item)}>Editar</button>}
                  {catalogTab === "people" && isPerson(row.item) && <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={() => openCatalog("people", row.item)}>Nova versão</button>}
                  {catalogTab === "reasons" && isReason(row.item) && <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={() => openCatalog("reasons", row.item)}>Nova versão</button>}
                  {catalogTab === "stores" && isLocality(row.item) && <button className={cx(styles, commonStyles, "table-action" + (row.active ? " action-danger" : ""))} type="button" onClick={() => { setStatusReason(""); setStatusTarget({ kind: "locality", id: row.id, label: row.primary, active: row.active }); }}>{row.active ? "Desativar" : "Ativar"}</button>}
                  {row.active && catalogTab !== "stores" && <button className={cx(styles, commonStyles, "table-action action-danger")} type="button" onClick={() => { setStatusReason(""); setStatusTarget({ kind: catalogTab === "people" ? "person" : "reason", id: row.id, label: row.primary, active: true }); }}>Desativar</button>}
                </div></td>
              </tr>)}
            </tbody></table></div>}
            {catalogTab === "stores" && <div className={cx(styles, commonStyles, "panel-footnote")}><span aria-hidden="true">⌑</span><p>As localidades desta tela são mantidas no catálogo do portal.</p></div>}
          </section></div>
        </>}

    {dialog && <div className={cx(styles, commonStyles, "modal-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeCatalog(); }}><section className={cx(styles, commonStyles, "modal-card")} role="dialog" aria-modal="true" aria-labelledby="catalog-dialog-title">
      <ModalHeader eyebrow={dialog.kind === "localities" ? dialog.item ? "EDITAR LOCALIDADE" : "NOVA LOCALIDADE" : dialog.item ? "NOVA VERSÃO" : "NOVO CADASTRO"} title={dialog.kind === "localities" ? dialog.item ? "Editar loja ou filial" : "Cadastrar loja ou filial" : dialog.item ? "Atualizar " + catalogWord : "Cadastrar " + catalogWord} onClose={closeCatalog} id="catalog-dialog-title" />
      <form onSubmit={saveCatalog} className={cx(styles, commonStyles, "modal-form")}>
        {dialog.kind === "localities" ? <>
          <label>Código interno<input autoFocus={!dialog.item} value={form.codigoLocalidade ?? ""} onChange={(event) => setField("codigoLocalidade", event.target.value.toUpperCase())} required maxLength={60} pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,59}" readOnly={Boolean(dialog.item)} placeholder="Ex.: MACAE_01" /><small>Use letras sem acento, números, hífen ou _. O código não pode ser alterado depois do cadastro.</small></label>
          <label>Nome da loja ou filial<input autoFocus={Boolean(dialog.item)} value={form.nomeLocalidade ?? ""} onChange={(event) => setField("nomeLocalidade", event.target.value)} required maxLength={160} placeholder="Nome para exibição" /></label>
          <div className={cx(styles, commonStyles, "form-grid-two")}>
            <label>Cidade<input value={form.cidade ?? ""} onChange={(event) => setField("cidade", event.target.value)} required maxLength={120} autoComplete="address-level2" /></label>
            <label>UF<input value={form.uf ?? ""} onChange={(event) => setField("uf", event.target.value.toUpperCase())} required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" autoComplete="address-level1" placeholder="Ex.: RJ" /></label>
          </div>
          <label>Tipo de localidade<select value={form.tipoLocalidade ?? "LOJA"} onChange={(event) => setField("tipoLocalidade", event.target.value)} required>{form.tipoLocalidade && !["LOJA", "CD", "OUTRO"].includes(form.tipoLocalidade) && <option value={form.tipoLocalidade}>Tipo atual: {form.tipoLocalidade}</option>}<option value="LOJA">Loja</option><option value="CD">Centro de distribuição</option><option value="OUTRO">Outro</option></select></label>
          <p className={cx(styles, commonStyles, "form-guidance")}>A edição preserva lançamentos existentes. Desativar uma localidade remove-a das novas operações sem apagar seu histórico.</p>
        </> : dialog.kind === "people" ? <><label>Nome para exibição<input autoFocus value={form.nome ?? ""} onChange={(event) => setField("nome", event.target.value)} required maxLength={160} placeholder="Nome e sobrenome" /></label><label>Função<select value={form.funcao ?? "MOTORISTA"} onChange={(event) => setField("funcao", event.target.value)}><option value="MOTORISTA">Motorista</option><option value="AJUDANTE">Ajudante</option></select></label><p className={cx(styles, commonStyles, "form-guidance")}>O sistema define a vigência automaticamente. A versão anterior será preservada no histórico.</p></>
            : <><label>Descrição do motivo<input autoFocus value={form.descricao ?? ""} onChange={(event) => setField("descricao", event.target.value)} required maxLength={160} placeholder="Ex.: Cliente ausente" /></label><p className={cx(styles, commonStyles, "form-guidance")}>O sistema define a vigência automaticamente. Alterações mantêm o histórico e a identificação interna.</p></>}
        <div className={cx(styles, commonStyles, "modal-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={closeCatalog} disabled={saving}>Cancelar</button><button className={cx(styles, commonStyles, "button button-primary")} type="submit" disabled={saving}>{saving ? "Salvando..." : dialog.kind === "localities" ? dialog.item ? "Salvar alterações" : "Cadastrar loja" : dialog.item ? "Salvar nova versão" : "Cadastrar"}</button></div>
      </form>
    </section></div>}

    {accountDialog && <div className={cx(styles, commonStyles, "modal-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeAccount(); }}><section className={cx(styles, commonStyles, "modal-card account-modal")} role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
      <ModalHeader eyebrow="CONTA INTERNA" title="Cadastrar funcionário" onClose={closeAccount} id="account-dialog-title" />
      <form onSubmit={saveAccount} className={cx(styles, commonStyles, "modal-form")}><label>Nome completo<input autoFocus value={form.nome ?? ""} onChange={(event) => setField("nome", event.target.value)} required maxLength={160} autoComplete="name" /></label><label>Nome de usuário<input value={form.username ?? ""} onChange={(event) => setField("username", event.target.value.toLowerCase().replace(/\s/g, ""))} required maxLength={80} autoComplete="username" placeholder="Ex.: nome.sobrenome" /><small>Use letras sem acento, números, ponto, hífen ou sublinhado.</small></label><h3 className={cx(styles, commonStyles, "account-access-heading")}>Acesso inicial</h3>{accessFields}{accountError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{accountError}</div>}<div className={cx(styles, commonStyles, "first-access-note")}><span aria-hidden="true">↗</span><p>A conta será criada com este perfil e escopo. A senha inicial de seis dígitos será exibida uma única vez. A pessoa pode usá-la sem troca obrigatória e alterar a senha depois, na área Minha senha.</p></div><div className={cx(styles, commonStyles, "modal-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={closeAccount} disabled={saving}>Cancelar</button><button className={cx(styles, commonStyles, "button button-primary")} type="submit" disabled={saving || !profiles.length}>{saving ? "Criando..." : "Criar conta e acesso"}</button></div></form>
    </section></div>}

    {initialCredential && <div className={cx(styles, commonStyles, "modal-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setInitialCredential(null); setCredentialCopyError(""); } }}><section className={cx(styles, commonStyles, "modal-card credential-card")} role="dialog" aria-modal="true" aria-labelledby="credential-dialog-title">
      <ModalHeader eyebrow={initialCredential.purpose === "created" ? "ACESSO CRIADO" : "SENHA REDEFINIDA"} title="Senha de acesso" onClose={() => { setInitialCredential(null); setCredentialCopyError(""); }} id="credential-dialog-title" />
      <div className={cx(styles, commonStyles, "credential-content")}>
        <p>{initialCredential.purpose === "created" ? "A conta de " : "A senha da conta de "}<strong>{initialCredential.name}</strong>{initialCredential.purpose === "created" ? " foi criada com o usuário " : " foi redefinida. Usuário: "}<strong>{initialCredential.username}</strong>.</p>
        {initialCredential.access && <p className={cx(styles, commonStyles, "credential-access")}>Acesso inicial: <strong>{initialCredential.access.nome_perfil}</strong> · {scopeLabel(initialCredential.access)}.</p>}
        <label className={cx(styles, commonStyles, "credential-label")} htmlFor="initial-password">Senha de seis dígitos</label>
        <input id="initial-password" className={cx(styles, commonStyles, "credential-value")} type="text" readOnly value={initialCredential.password} onFocus={(event) => event.currentTarget.select()} aria-describedby="credential-help" />
        <p id="credential-help" className={cx(styles, commonStyles, "credential-help")}>Copie o usuário e a senha e envie por um canal privado. A senha não poderá ser consultada novamente. Se for esquecida, a pessoa pode redefini-la na tela de login informando nome e usuário, ou você pode gerar outra senha para ela.</p>
        {credentialCopyError && <p className={cx(styles, commonStyles, "credential-copy-error")} role="alert">{credentialCopyError}</p>}
        <div className={cx(styles, commonStyles, "credential-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { setInitialCredential(null); setCredentialCopyError(""); }}>Fechar</button><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => void copyInitialCredential()}>{credentialCopied ? "Acesso copiado" : "Copiar acesso"}</button></div>
      </div>
    </section></div>}

    {passwordResetTarget && <div className={cx(styles, commonStyles, "modal-backdrop status-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setPasswordResetTarget(null); }}><section className={cx(styles, commonStyles, "modal-card status-dialog")} role="alertdialog" aria-modal="true" aria-labelledby="reset-password-title"><span className={cx(styles, commonStyles, "status-warning-mark")} aria-hidden="true">!</span><h2 id="reset-password-title">Gerar nova senha?</h2><p>A senha atual de <strong>{passwordResetTarget.nome_completo}</strong> deixará de funcionar e as sessões abertas serão encerradas. A nova senha de seis dígitos será mostrada uma vez e poderá ser usada sem troca obrigatória.</p>{passwordResetError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{passwordResetError}</div>}<div className={cx(styles, commonStyles, "modal-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { setPasswordResetTarget(null); setPasswordResetError(""); }} disabled={saving}>Cancelar</button><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={confirmPasswordReset} disabled={saving}>{saving ? "Gerando..." : "Gerar nova senha"}</button></div></section></div>}

    {selectedUser && <div className={cx(styles, commonStyles, "drawer-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedUser(null); }}><aside className={cx(styles, commonStyles, "access-drawer")} role="dialog" aria-modal="true" aria-labelledby="access-drawer-title">
      <div className={cx(styles, commonStyles, "drawer-header")}><div><p className={cx(styles, commonStyles, "section-kicker")}>GERENCIAR ACESSOS</p><h2 id="access-drawer-title">{selectedUser.nome_completo}</h2><span>@{selectedUser.username}</span></div><button className={cx(styles, commonStyles, "close-button")} type="button" aria-label="Fechar" onClick={() => setSelectedUser(null)}>×</button></div>
      <div className={cx(styles, commonStyles, "drawer-explainer")}><span>i</span><p>O <strong>perfil</strong> define as ações. O <strong>escopo</strong> limita onde elas valem. Adicione mais de uma concessão se a função exigir.</p></div>
      <button className={cx(styles, commonStyles, "table-action password-reset-action")} type="button" disabled={!selectedUser.ativo || selectedUser.id_usuario === currentUserId} title={selectedUser.id_usuario === currentUserId ? "Use a opção de troca de senha da própria conta." : !selectedUser.ativo ? "Ative a conta antes de redefinir a senha." : undefined} onClick={() => { setPasswordResetError(""); setPasswordResetTarget(selectedUser); }}>Gerar nova senha</button><p className={cx(styles, commonStyles, "password-reset-help")}>Se a pessoa não conseguir redefinir pelo login, gere uma senha de acesso nova. A senha anterior não pode ser consultada.</p>
      <div className={cx(styles, commonStyles, "grant-section-heading")}><div><h3>Perfis e escopos</h3><span>{userGrants.length} concessão{userGrants.length === 1 ? "" : "ões"}</span></div><button className={cx(styles, commonStyles, "button button-secondary compact-button")} type="button" disabled={!selectedUser.ativo} title={!selectedUser.ativo ? "Ative a conta antes de conceder acesso." : undefined} onClick={() => setShowGrantForm((value) => !value)}>{showGrantForm ? "Fechar" : "＋ Adicionar acesso"}</button></div>
      {grantsLoading ? <div className={cx(styles, commonStyles, "drawer-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Carregando acessos...</div>
        : userGrants.length ? <div className={cx(styles, commonStyles, "grant-list")}>{userGrants.map((grant) => { const grantStatus = getGrantStatus(grant); return <article className={cx(styles, commonStyles, "grant-card")} key={grant.id_usuario_escopo}><div className={cx(styles, commonStyles, "grant-card-top")}><div className={cx(styles, commonStyles, "grant-profile-icon")}>P</div><div><strong>{grant.nome_perfil}</strong><small>{grant.codigo_perfil}</small></div><StatusPill active={grantStatus.active} label={grantStatus.label} tone={grantStatus.tone} /></div><p className={cx(styles, commonStyles, "grant-scope")}>{scopeLabel(grant)}</p><div className={cx(styles, commonStyles, "grant-dates")}><span>Desde {formatDate(grant.vigente_desde)}</span></div>{grant.ativo && grantStatus.tone !== "expired" && <button className={cx(styles, commonStyles, "table-action action-danger grant-revoke")} type="button" onClick={() => { setStatusReason(""); setStatusTarget({ kind: "grant", id: grant.id_usuario_escopo, userId: selectedUser.id_usuario, label: grant.nome_perfil, active: true }); }}>Revogar este acesso</button>}</article>; })}</div>
          : <EmptyState title="Nenhum acesso concedido" description="A conta existe, mas ainda não consegue acessar os módulos do portal." />}
      {showGrantForm && <form className={cx(styles, commonStyles, "grant-form")} onSubmit={saveGrant}><h3>Nova concessão</h3>{accessFields}<p className={cx(styles, commonStyles, "form-guidance")}>O acesso começa imediatamente e pode ser revogado pela administração quando necessário.</p><button className={cx(styles, commonStyles, "button button-primary button-full")} type="submit" disabled={saving || !profiles.length}>{saving ? "Concedendo..." : "Conceder acesso"}</button></form>}
    </aside></div>}

    {statusTarget && <div className={cx(styles, commonStyles, "modal-backdrop status-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setStatusTarget(null); }}><section className={cx(styles, commonStyles, "modal-card status-dialog")} role="alertdialog" aria-modal="true" aria-labelledby="status-dialog-title"><span className={cx(styles, commonStyles, "status-warning-mark")} aria-hidden="true">!</span><h2 id="status-dialog-title">{statusTitle}</h2><p>{statusDescription}</p>
      {((statusTarget.kind === "user" && statusTarget.active) || statusTarget.kind === "grant") && <label className={cx(styles, commonStyles, "reason-label")}>Motivo da alteração<textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} required maxLength={500} rows={3} placeholder="Registre brevemente o motivo" /></label>}
      <div className={cx(styles, commonStyles, "modal-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setStatusTarget(null)} disabled={saving}>Cancelar</button><button className={cx(styles, commonStyles, statusTarget.active ? "button button-danger" : "button button-primary")} type="button" onClick={applyStatusChange} disabled={saving || (((statusTarget.kind === "user" && statusTarget.active) || statusTarget.kind === "grant") && !statusReason.trim())}>{saving ? "Salvando..." : statusActionLabel}</button></div>
    </section></div>}
  </div>;
}
