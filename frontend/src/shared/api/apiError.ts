export type ApiErrorPayload = {
  detail?: string | Array<{ msg?: string; loc?: Array<string | number> }>;
  message?: string;
};

export class ApiError extends Error {
  status: number;
  fieldErrors: Record<string, string>;

  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function messageFromApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Não foi possível concluir agora. Tente novamente.";
}

export function errorFromResponse(status: number, payload: unknown): ApiError {
  const body = payload as ApiErrorPayload | null;
  const detail = body?.detail;

  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of detail) {
      const path = (issue.loc ?? []).filter((part) => part !== "body").join(".");
      if (path) fieldErrors[path] = issue.msg ?? "Confira este campo.";
    }
    return new ApiError(
      Object.values(fieldErrors)[0] ?? "Confira os dados informados.",
      status,
      fieldErrors,
    );
  }

  const safeMessages: Record<number, string> = {
    401: "Sua sessão expirou. Entre novamente.",
    403: "Você não tem acesso a esta ação ou localidade.",
    404: "O registro não foi encontrado.",
    409: "Este lançamento mudou em outra sessão. Atualize a página e tente novamente.",
    429: "Muitas tentativas. Aguarde um pouco e tente novamente.",
    503: "O serviço está temporariamente indisponível.",
  };
  const message = typeof detail === "string" ? detail : body?.message;
  return new ApiError(message ?? safeMessages[status] ?? "Não foi possível concluir agora.", status);
}
