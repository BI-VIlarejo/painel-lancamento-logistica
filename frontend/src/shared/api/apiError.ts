export type ApiErrorPayload = {
  detail?: string | Array<{ msg?: string; loc?: Array<string | number> }>;
  message?: string;
  error?: {
    message?: string;
    details?: Array<{ message?: string; location?: Array<string | number> }>;
  };
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

function cleanValidationMessage(message: string | undefined): string {
  const trimmed = (message ?? "").trim();
  if (!trimmed) return "Confira os dados informados.";
  return trimmed.replace(/^Value error,\s*/i, "");
}

export function errorFromResponse(status: number, payload: unknown): ApiError {
  const body = payload as ApiErrorPayload | null;
  const detail = body?.detail;

  if (Array.isArray(body?.error?.details)) {
    const fieldErrors: Record<string, string> = {};
    let firstMessage = "";
    for (const issue of body.error.details) {
      const cleaned = cleanValidationMessage(issue.message);
      if (!firstMessage) firstMessage = cleaned;
      const path = (issue.location ?? []).filter((part) => part !== "body").join(".");
      if (path) fieldErrors[path] = cleaned;
    }
    return new ApiError(
      Object.values(fieldErrors)[0] ?? (firstMessage || body.error.message || "Confira os dados informados."),
      status,
      fieldErrors,
    );
  }

  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    let firstMessage = "";
    for (const issue of detail) {
      const cleaned = cleanValidationMessage(issue.msg);
      if (!firstMessage) firstMessage = cleaned;
      const path = (issue.loc ?? []).filter((part) => part !== "body").join(".");
      if (path) fieldErrors[path] = cleaned;
    }
    return new ApiError(
      Object.values(fieldErrors)[0] ?? (firstMessage || "Confira os dados informados."),
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
  const message = typeof detail === "string" ? detail : body?.error?.message ?? body?.message;
  return new ApiError(message ?? safeMessages[status] ?? "Não foi possível concluir agora.", status);
}
