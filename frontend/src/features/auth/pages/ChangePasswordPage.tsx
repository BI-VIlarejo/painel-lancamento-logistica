import { useState } from "react";
import type { FormEvent } from "react";
import styles from "./ChangePasswordPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { BrandMark } from "../../../shared/components/BrandMark";
import { messageFromApiError } from "../../../shared/api/apiError";

export function ChangePasswordPage({ onChangePassword }: { onChangePassword: (current: string, next: string) => Promise<void> }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (next !== confirmation) {
      setError("A confirmação não corresponde à nova senha.");
      return;
    }
    if (next.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setBusy(true);
    void onChangePassword(current, next)
      .catch((changeError: unknown) => setError(messageFromApiError(changeError)))
      .finally(() => setBusy(false));
  };

  return (
    <main className={cx(styles, commonStyles, "password-page")}>
      <section className={cx(styles, commonStyles, "password-card")}>
        <div className={cx(styles, commonStyles, "password-brand")}><BrandMark /></div>
        <span className={cx(styles, commonStyles, "password-icon")} aria-hidden="true">⌑</span>
        <p className={cx(styles, commonStyles, "eyebrow")}>PRIMEIRO ACESSO</p>
        <h1>Defina sua senha pessoal</h1>
        <p className={cx(styles, commonStyles, "password-lead")}>A conta foi criada pela administração. Troque a senha temporária para continuar.</p>
        {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{error}</div>}
        <form onSubmit={submit} className={cx(styles, commonStyles, "password-form")}>
          <label htmlFor="current-password">Senha temporária</label>
          <input id="current-password" autoComplete="current-password" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} required maxLength={1024} />
          <label htmlFor="new-password">Nova senha</label>
          <input id="new-password" autoComplete="new-password" type="password" value={next} onChange={(event) => setNext(event.target.value)} required minLength={6} maxLength={1024} />
          <p className={cx(styles, commonStyles, "password-hint")}>Use pelo menos 6 caracteres. Não reutilize sua senha de outro sistema.</p>
          <label htmlFor="confirm-password">Confirme a nova senha</label>
          <input id="confirm-password" autoComplete="new-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={1024} />
          <button className={cx(styles, commonStyles, "button button-primary button-full")} type="submit" disabled={busy}>
            {busy ? <><span className={cx(styles, commonStyles, "spinner")} /> Salvando senha...</> : "Salvar e continuar"}
          </button>
        </form>
        <p className={cx(styles, commonStyles, "password-footer")}>Sua senha é armazenada com proteção criptográfica e nunca é exibida para a administração.</p>
      </section>
    </main>
  );
}
