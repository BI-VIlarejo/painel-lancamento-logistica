import type { LocalityCatalogItem, SectorCatalogItem } from "../deliveries/types";
import { demoUser } from "../deliveries/demoApi";
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

const today = () => {
  const date = new Date();
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
};
const now = () => new Date().toISOString();
const nextEffectiveDate = (start: string, end?: string | null) => {
  const next = new Date(start + "T12:00:00");
  next.setDate(next.getDate() + 1);
  const afterStart = next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0") + "-" + String(next.getDate()).padStart(2, "0");
  return [today(), afterStart, end ?? today()].sort().at(-1)!;
};
let nextId = 100;
let localities: LocalityAdminItem[] = [
  { id_localidade: 11, codigo_localidade: "MAC", nome_localidade: "Macaé", tipo_localidade: "LOJA", cidade: "Macaé", uf: "RJ", ativo: true },
  { id_localidade: 12, codigo_localidade: "CBF", nome_localidade: "Cabo Frio", tipo_localidade: "LOJA", cidade: "Cabo Frio", uf: "RJ", ativo: true },
  { id_localidade: 13, codigo_localidade: "CPS", nome_localidade: "Campos dos Goytacazes", tipo_localidade: "LOJA", cidade: "Campos dos Goytacazes", uf: "RJ", ativo: true },
  { id_localidade: 14, codigo_localidade: "CD", nome_localidade: "Centro de Distribuição", tipo_localidade: "CD", cidade: "Macaé", uf: "RJ", ativo: true },
];
let people: PersonAdminItem[] = [
  { id_pessoa: 21, codigo_pessoa: "demo-driver-1", nome_exibicao: "Rafael Martins", tipo_funcao: "MOTORISTA", tipo_transporte_entrega: "PROPRIA", ativo: true, vigente_desde: "2025-01-01", vigente_ate: null, sistema_origem: null, codigo_pessoa_origem: null },
  { id_pessoa: 22, codigo_pessoa: "demo-driver-2", nome_exibicao: "Joana Costa", tipo_funcao: "MOTORISTA", tipo_transporte_entrega: "TERCEIRIZADA", ativo: true, vigente_desde: "2025-01-01", vigente_ate: null, sistema_origem: null, codigo_pessoa_origem: null },
  { id_pessoa: 31, codigo_pessoa: "demo-helper-1", nome_exibicao: "Marina Alves", tipo_funcao: "AJUDANTE", tipo_transporte_entrega: "PROPRIA", ativo: true, vigente_desde: "2025-01-01", vigente_ate: null, sistema_origem: null, codigo_pessoa_origem: null },
  { id_pessoa: 32, codigo_pessoa: "demo-helper-2", nome_exibicao: "Pedro Lima", tipo_funcao: "AJUDANTE", tipo_transporte_entrega: "TERCEIRIZADA", ativo: true, vigente_desde: "2025-01-01", vigente_ate: null, sistema_origem: null, codigo_pessoa_origem: null },
];
let reasons: ReasonAdminItem[] = [
  { id_motivo_nao_entrega: 41, codigo_motivo: "CLIENTE_AUSENTE", descricao_motivo: "Cliente ausente", grupo_motivo: "LOJA", ativo: true, vigente_desde: "2025-01-01", vigente_ate: null },
  { id_motivo_nao_entrega: 42, codigo_motivo: "ENDERECO_INCORRETO", descricao_motivo: "Endereço incorreto", grupo_motivo: "LOJA", ativo: true, vigente_desde: "2025-01-01", vigente_ate: null },
  { id_motivo_nao_entrega: 43, codigo_motivo: "AVARIA", descricao_motivo: "Produto avariado", grupo_motivo: "TRANSPORTE_PROPRIO", ativo: true, vigente_desde: "2025-01-01", vigente_ate: null },
];
let users: UserAccount[] = [
  { id_usuario: demoUser.id_usuario, username: demoUser.username, nome_completo: demoUser.nome_completo, ativo: true, troca_senha_obrigatoria: false, criado_em: now(), ultimo_login_em: now() },
  { id_usuario: 8, username: "marcos.silva", nome_completo: "Marcos Silva", ativo: true, troca_senha_obrigatoria: false, criado_em: now(), ultimo_login_em: null },
];
let grants: UserAccessGrant[] = [
  { id_usuario_escopo: 1, id_usuario: 8, id_perfil: 2, codigo_perfil: "OPERADOR", nome_perfil: "Operação", id_escopo: 1, codigo_escopo: "SETOR:1", tipo_escopo: "SETOR", id_setor: 1, id_localidade: null, ativo: true, vigente_desde: now(), vigente_ate: null, concedido_por: demoUser.id_usuario, concedido_em: now() },
];
const profiles: Profile[] = [
  { id_perfil: 1, codigo: "DEV", nome: "Desenvolvimento", ativo: true },
  { id_perfil: 2, codigo: "OPERADOR", nome: "Operação", ativo: true },
  { id_perfil: 3, codigo: "GESTOR", nome: "Gestão", ativo: true },
  { id_perfil: 4, codigo: "DIRETORIA", nome: "Diretoria", ativo: true },
  { id_perfil: 5, codigo: "CADASTRADOR", nome: "Cadastros operacionais", ativo: true },
];
const sectors: SectorCatalogItem[] = [{ id_setor: 1, codigo: "SUPORTE", nome: "Suporte" }];

const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 90));
const newDemoCredential = () => {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String((random[0] ?? 0) % 1_000_000).padStart(6, "0");
};
const generatedCode = (prefix: string, label: string, taken: string[], maxLength: number) => {
  const slug = label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "ITEM";
  const base = `${prefix}_${slug}`.slice(0, maxLength).replace(/_+$/g, "");
  let candidate = base;
  let suffix = 2;
  while (taken.includes(candidate)) {
    const tail = `_${suffix++}`;
    candidate = `${base.slice(0, maxLength - tail.length).replace(/_+$/g, "")}${tail}`;
  }
  return candidate;
};
const demoScopeCode = (input: UserScopeGrantInput) => {
  if (input.tipo_escopo === "GLOBAL") return "GLOBAL";
  if (input.tipo_escopo === "SETOR") return `SETOR:${input.id_setor}`;
  if (input.tipo_escopo === "LOCALIDADE") return `LOCALIDADE:${input.id_localidade}`;
  return `SETOR_LOCALIDADE:${input.id_setor}:${input.id_localidade}`;
};
const validateProfileScope = (profile: Profile, input: UserScopeGrantInput) => {
  if (["DEV", "CADASTRADOR"].includes(profile.codigo) && input.tipo_escopo !== "GLOBAL") {
    throw new Error(`O perfil ${profile.codigo === "DEV" ? "DEV" : "Cadastros operacionais"} exige escopo global.`);
  }
};

export const demoAdministrationApi = {
  async localities() { await pause(); return [...localities]; },
  async createLocality(input: LocalityCreateInput) {
    await pause();
    const code = input.codigo_localidade.trim().toUpperCase();
    const duplicate = localities.some((item) => item.codigo_localidade.toUpperCase() === code
      || (item.nome_localidade.toLocaleLowerCase("pt-BR") === input.nome_localidade.trim().toLocaleLowerCase("pt-BR")
        && item.cidade?.toLocaleLowerCase("pt-BR") === input.cidade.trim().toLocaleLowerCase("pt-BR")
        && item.uf?.toUpperCase() === input.uf.toUpperCase()));
    if (duplicate) throw new Error("Já existe uma localidade com esse código ou nome, cidade e UF.");
    const item: LocalityAdminItem = { ...input, codigo_localidade: code, id_localidade: nextId++, ativo: true };
    localities = [...localities, item];
    return item;
  },
  async updateLocality(id: number, input: LocalityUpdateInput) {
    await pause();
    const current = localities.find((item) => item.id_localidade === id);
    if (!current) throw new Error("Localidade não encontrada.");
    const duplicate = localities.some((item) => item.id_localidade !== id
      && item.nome_localidade.toLocaleLowerCase("pt-BR") === input.nome_localidade.trim().toLocaleLowerCase("pt-BR")
      && item.cidade?.toLocaleLowerCase("pt-BR") === input.cidade.trim().toLocaleLowerCase("pt-BR")
      && item.uf?.toUpperCase() === input.uf.toUpperCase());
    if (duplicate) throw new Error("Já existe uma localidade com esse nome, cidade e UF.");
    const updated = { ...current, ...input };
    localities = localities.map((item) => item.id_localidade === id ? updated : item);
    return updated;
  },
  async setLocalityActive(id: number, ativo: boolean) {
    await pause();
    const current = localities.find((item) => item.id_localidade === id);
    if (!current) throw new Error("Localidade não encontrada.");
    if (current.ativo === ativo) throw new Error("A localidade já está nessa situação.");
    if (ativo && (!current.cidade || !current.uf)) throw new Error("Informe cidade e UF antes de ativar a localidade.");
    const updated = { ...current, ativo };
    localities = localities.map((item) => item.id_localidade === id ? updated : item);
    return updated;
  },
  async people() { await pause(); return [...people]; },
  async createPerson(input: Omit<PersonAdminItem, "id_pessoa" | "ativo" | "vigente_desde" | "vigente_ate">) {
    await pause();
    const previous = people.filter((item) => item.codigo_pessoa === input.codigo_pessoa).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0];
    const systemToday = today();
    const vigente_desde = previous ? nextEffectiveDate(previous.vigente_desde, previous.vigente_ate) : systemToday;
    if (previous) people = people.map((item) => item.id_pessoa === previous.id_pessoa ? { ...item, ativo: vigente_desde > systemToday, vigente_ate: vigente_desde } : item);
    const item: PersonAdminItem = { ...input, id_pessoa: nextId++, ativo: true, vigente_desde, vigente_ate: null };
    people = [...people, item];
    return item;
  },
  async updatePerson(id: number, input: Pick<PersonAdminItem, "nome_exibicao" | "tipo_funcao" | "tipo_transporte_entrega">) {
    await pause();
    const current = people.find((item) => item.id_pessoa === id);
    if (!current) throw new Error("Pessoa não encontrada.");
    const updated = { ...current, ...input };
    people = people.map((item) => item.id_pessoa === id ? updated : item);
    return updated;
  },
  async deactivatePerson(id: number) { await pause(); people = people.map((item) => item.id_pessoa === id ? { ...item, ativo: false, vigente_ate: nextEffectiveDate(item.vigente_desde) } : item); },
  async reasons() { await pause(); return [...reasons]; },
  async createReason(input: Omit<ReasonAdminItem, "id_motivo_nao_entrega" | "ativo" | "vigente_desde" | "vigente_ate" | "codigo_motivo"> & { codigo_motivo?: string }) {
    await pause();
    const codigo_motivo = input.codigo_motivo ?? generatedCode("MOTIVO", input.descricao_motivo, reasons.map((item) => item.codigo_motivo), 40);
    const previous = reasons.filter((item) => item.codigo_motivo === codigo_motivo).sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0];
    const systemToday = today();
    const vigente_desde = previous ? nextEffectiveDate(previous.vigente_desde, previous.vigente_ate) : systemToday;
    if (previous) reasons = reasons.map((item) => item.id_motivo_nao_entrega === previous.id_motivo_nao_entrega ? { ...item, ativo: vigente_desde > systemToday, vigente_ate: vigente_desde } : item);
    const item: ReasonAdminItem = { ...input, codigo_motivo, id_motivo_nao_entrega: nextId++, ativo: true, vigente_desde, vigente_ate: null };
    reasons = [...reasons, item];
    return item;
  },
  async updateReason(id: number, input: Pick<ReasonAdminItem, "descricao_motivo" | "grupo_motivo">) {
    await pause();
    const current = reasons.find((item) => item.id_motivo_nao_entrega === id);
    if (!current) throw new Error("Motivo não encontrado.");
    const updated = { ...current, ...input };
    reasons = reasons.map((item) => item.id_motivo_nao_entrega === id ? updated : item);
    return updated;
  },
  async deactivateReason(id: number) { await pause(); reasons = reasons.map((item) => item.id_motivo_nao_entrega === id ? { ...item, ativo: false, vigente_ate: nextEffectiveDate(item.vigente_desde) } : item); },
  async users(search = "", includeInactive = true) {
    await pause();
    const query = search.trim().toLowerCase();
    return users.filter((user) => (includeInactive || user.ativo) && (!query || `${user.nome_completo} ${user.username}`.toLowerCase().includes(query)));
  },
  async createUser(input: { username: string; nome_completo: string; acesso_inicial: UserScopeGrantInput }): Promise<UserAccountCreated> {
    await pause();
    if (users.some((user) => user.username === input.username)) throw new Error("Esse usuário já existe.");
    const profile = profiles.find((item) => item.id_perfil === input.acesso_inicial.id_perfil && item.ativo);
    if (!profile) throw new Error("Selecione um perfil ativo.");
    validateProfileScope(profile, input.acesso_inicial);
    const user: UserAccount = { username: input.username, nome_completo: input.nome_completo, id_usuario: nextId++, ativo: true, troca_senha_obrigatoria: false, criado_em: now(), ultimo_login_em: null };
    const senha_inicial = newDemoCredential();
    const acesso_inicial: UserAccessGrant = {
      ...input.acesso_inicial,
      id_usuario: user.id_usuario,
      id_usuario_escopo: nextId++,
      id_escopo: nextId++,
      codigo_escopo: demoScopeCode(input.acesso_inicial),
      codigo_perfil: profile.codigo,
      nome_perfil: profile.nome,
      ativo: true,
      vigente_desde: now(),
      vigente_ate: null,
      concedido_por: demoUser.id_usuario,
      concedido_em: now(),
    };
    users = [...users, user];
    grants = [...grants, acesso_inicial];
    return { ...user, senha_inicial, acesso_inicial };
  },
  async resetUserTemporaryPassword(id: number): Promise<UserAccountCreated> {
    await pause();
    const user = users.find((item) => item.id_usuario === id);
    if (!user) throw new Error("Conta não encontrada.");
    if (!user.ativo) throw new Error("Ative a conta antes de gerar uma nova senha.");
    if (user.id_usuario === demoUser.id_usuario) throw new Error("Use a troca de senha da própria conta.");
    users = users.map((item) => item.id_usuario === id ? { ...item, troca_senha_obrigatoria: false } : item);
    return { ...user, troca_senha_obrigatoria: false, senha_inicial: newDemoCredential() };
  },
  async updateUserIdentity(id: number, input: { username: string; nome_completo: string }): Promise<UserAccount> {
    await pause();
    const user = users.find((item) => item.id_usuario === id);
    if (!user) throw new Error("Conta não encontrada.");
    const username = input.username.trim().toLowerCase();
    const nome_completo = input.nome_completo.trim().replace(/\s+/g, " ");
    if (!/^[a-z0-9._-]{1,80}$/.test(username)) throw new Error("Use letras sem acento, números, ponto, hífen ou _ no usuário.");
    if (!nome_completo) throw new Error("O nome completo é obrigatório.");
    if (users.some((item) => item.id_usuario !== id && item.username.toLowerCase() === username)) {
      throw new Error("Esse nome de usuário já está em uso.");
    }
    const updated = { ...user, username, nome_completo };
    users = users.map((item) => item.id_usuario === id ? updated : item);
    return updated;
  },
  async setUserActive(id: number, ativo: boolean) { await pause(); users = users.map((user) => user.id_usuario === id ? { ...user, ativo } : user); },
  async profiles() { await pause(); return profiles.filter((profile) => profile.ativo); },
  async profilePermissions(id: number): Promise<ProfilePermission[]> {
    await pause();
    const profile = profiles.find((item) => item.id_perfil === id);
    const codes = profile?.codigo === "DEV"
      ? ["CONTROLE_ACESSO:ADMINISTRAR", "CADASTROS:ADMINISTRAR", "ENTREGAS_DIARIAS:VER", "ENTREGAS_DIARIAS:CRIAR", "ENTREGAS_DIARIAS:EDITAR_RASCUNHO", "ENTREGAS_DIARIAS:CORRIGIR", "ENTREGAS_DIARIAS:CANCELAR", "FEEDBACK_CLIENTES:ACESSAR", "FEEDBACK_CLIENTES:VER", "FEEDBACK_CLIENTES:CRIAR", "FEEDBACK_CLIENTES:EXPORTAR", "PAINEL_GERENCIAL:ACESSAR", "AUDITORIA:VER"]
      : profile?.codigo === "CADASTRADOR"
        ? ["CADASTROS:ADMINISTRAR"]
      : profile?.codigo === "GESTOR"
        ? ["CONTROLE_ACESSO:ADMINISTRAR", "CADASTROS:ADMINISTRAR", "ENTREGAS_DIARIAS:VER", "ENTREGAS_DIARIAS:CRIAR", "ENTREGAS_DIARIAS:EDITAR_RASCUNHO", "ENTREGAS_DIARIAS:CORRIGIR", "ENTREGAS_DIARIAS:CANCELAR", "FEEDBACK_CLIENTES:ACESSAR", "FEEDBACK_CLIENTES:VER", "FEEDBACK_CLIENTES:CRIAR", "FEEDBACK_CLIENTES:EXPORTAR", "PAINEL_GERENCIAL:ACESSAR", "AUDITORIA:VER"]
        : profile?.codigo === "DIRETORIA"
          ? ["CONTROLE_ACESSO:ADMINISTRAR", "CADASTROS:ADMINISTRAR", "ENTREGAS_DIARIAS:VER", "ENTREGAS_DIARIAS:CRIAR", "ENTREGAS_DIARIAS:EDITAR_RASCUNHO", "ENTREGAS_DIARIAS:CORRIGIR", "ENTREGAS_DIARIAS:CANCELAR", "FEEDBACK_CLIENTES:ACESSAR", "FEEDBACK_CLIENTES:VER", "FEEDBACK_CLIENTES:CRIAR", "FEEDBACK_CLIENTES:EXPORTAR", "PAINEL_GERENCIAL:ACESSAR", "AUDITORIA:VER"]
          : ["CADASTROS:ADMINISTRAR", "ENTREGAS_DIARIAS:VER", "ENTREGAS_DIARIAS:CRIAR", "ENTREGAS_DIARIAS:EDITAR_RASCUNHO", "FEEDBACK_CLIENTES:ACESSAR", "FEEDBACK_CLIENTES:VER", "FEEDBACK_CLIENTES:CRIAR", "FEEDBACK_CLIENTES:EXPORTAR"];
    return codes.map((code, index) => {
      const parts = code.split(":");
      return { id_permissao: index + 1, id_recurso: index + 1, codigo_recurso: parts[0], codigo: code, acao: parts[1], descricao: parts[1].replaceAll("_", " ").toLocaleLowerCase("pt-BR"), ativo: true };
    });
  },
  async sectors() { await pause(); return sectors; },
  async scopeOptions() {
    await pause();
    return {
      setores: sectors,
      localidades: localities.filter((item) => item.ativo).map(({ id_localidade, codigo_localidade, nome_localidade, tipo_localidade }) => ({ id_localidade, codigo_localidade, nome_localidade, tipo_localidade } satisfies LocalityCatalogItem)),
    };
  },
  async userGrants(id: number) { await pause(); return grants.filter((grant) => grant.id_usuario === id); },
  async createGrant(id: number, input: UserScopeGrantInput) {
    await pause();
    const profile = profiles.find((item) => item.id_perfil === input.id_perfil);
    if (!profile) throw new Error("Selecione um perfil ativo.");
    validateProfileScope(profile, input);
    const grant: UserAccessGrant = { ...input, vigente_desde: now(), vigente_ate: null, id_usuario: id, id_usuario_escopo: nextId++, codigo_perfil: profile.codigo, nome_perfil: profile.nome, id_escopo: nextId++, codigo_escopo: demoScopeCode(input), ativo: true, concedido_por: demoUser.id_usuario, concedido_em: now() };
    grants = [...grants, grant]; return grant;
  },
  async revokeGrant(id: number) { await pause(); grants = grants.filter((grant) => grant.id_usuario_escopo !== id); },
};
