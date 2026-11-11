/** Rascunhos ficam apenas nesta aba e separados por usuário e formulário. */
export function readSessionDraft<T>(key: string): T | null {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

export function writeSessionDraft(key: string, value: unknown): void {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento indisponível */ }
}

export function clearSessionDraft(key: string): void {
  try { window.sessionStorage.removeItem(key); } catch { /* armazenamento indisponível */ }
}
