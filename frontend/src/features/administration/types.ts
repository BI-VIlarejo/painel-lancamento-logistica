export type LocalityAdminItem = {
  id_localidade: number;
  codigo_localidade: string;
  nome_localidade: string;
  tipo_localidade: string;
  ativo: boolean;
};

export type PersonAdminItem = {
  id_pessoa: number;
  codigo_pessoa: string;
  nome_exibicao: string;
  tipo_funcao: "MOTORISTA" | "AJUDANTE";
  ativo: boolean;
  vigente_desde: string;
  vigente_ate: string | null;
  sistema_origem: string | null;
  codigo_pessoa_origem: string | null;
};

export type ReasonAdminItem = {
  id_motivo_nao_entrega: number;
  codigo_motivo: string;
  descricao_motivo: string;
  ativo: boolean;
  vigente_desde: string;
  vigente_ate: string | null;
};

export type UserAccount = {
  id_usuario: number;
  username: string;
  nome_completo: string;
  ativo: boolean;
  troca_senha_obrigatoria: boolean | null;
  criado_em: string;
  ultimo_login_em: string | null;
};

export type UserAccountCreated = UserAccount & {
  senha_inicial: string;
  acesso_inicial?: UserAccessGrant | null;
};

export type UserAccountPage = {
  items: UserAccount[];
  total: number;
  limit: number;
  offset: number;
};

export type Profile = {
  id_perfil: number;
  codigo: string;
  nome: string;
  ativo: boolean;
};

export type ProfilePermission = {
  id_permissao: number;
  id_recurso: number;
  codigo_recurso: string;
  codigo: string;
  acao: string;
  descricao: string;
  ativo: boolean;
};

export type UserAccessGrant = {
  id_usuario_escopo: number;
  id_usuario: number;
  id_perfil: number;
  codigo_perfil: string;
  nome_perfil: string;
  id_escopo: number;
  codigo_escopo: string;
  tipo_escopo: "GLOBAL" | "SETOR" | "LOCALIDADE" | "SETOR_LOCALIDADE";
  id_setor: number | null;
  id_localidade: number | null;
  ativo: boolean;
  vigente_desde: string;
  vigente_ate: string | null;
  concedido_por: number;
  concedido_em: string;
};

export type UserScopeGrantInput = {
  id_perfil: number;
  tipo_escopo: UserAccessGrant["tipo_escopo"];
  id_setor: number | null;
  id_localidade: number | null;
};
