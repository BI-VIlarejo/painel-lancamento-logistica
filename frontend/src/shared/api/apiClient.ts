import { errorFromResponse } from "./apiError";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const apiBaseUrl = configuredBaseUrl || (import.meta.env.DEV ? "/api/v1" : "");

export const isDemoMode =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEMO_MODE === "true" &&
  !configuredBaseUrl;

let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function clearCsrfToken(): void {
  csrfToken = "";
}

type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  idempotencyKey?: string;
};

const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error("Configure VITE_API_BASE_URL para conectar o Portal à API.");
  }

  const { body, idempotencyKey, ...requestOptions } = options;
  const method = (requestOptions.method ?? "GET").toUpperCase();
  const headers = new Headers(requestOptions.headers);
  headers.set("Accept", "application/json");
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  if (writeMethods.has(method) && csrfToken && !path.endsWith("/auth/login")) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
      ...requestOptions,
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestOptions.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("A solicitação demorou demais. Verifique a conexão e tente novamente.");
    }
    throw new Error("Não foi possível conectar à API. Confira se o backend está disponível.");
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 401) clearCsrfToken();
    throw errorFromResponse(response.status, payload);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
