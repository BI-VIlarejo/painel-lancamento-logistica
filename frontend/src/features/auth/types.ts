export type AuthenticatedUser = {
  id_usuario: number;
  username: string;
  nome_completo: string;
  troca_senha_obrigatoria?: boolean | null;
};

export type AccessScope = {
  id_escopo: number;
  codigo_escopo: string;
  tipo_escopo: string;
  id_setor: number | null;
  id_localidade: number | null;
  id_perfil: number;
  codigo_perfil: string;
  permissions: string[];
};

export type MeResponse = {
  user: AuthenticatedUser;
  permissions: string[];
  scopes: AccessScope[];
};

export type LoginResponse = {
  user: AuthenticatedUser;
  csrf_token: string;
};
