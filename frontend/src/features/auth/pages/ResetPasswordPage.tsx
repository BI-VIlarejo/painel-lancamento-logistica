import { useState } from "react";
import type { FormEvent } from "react";
import styles from "./ChangePasswordPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { BrandMark } from "../../../shared/components/BrandMark";
import { messageFromApiError } from "../../../shared/api/apiError";

type ResetPasswordPageProps = {
  onResetPassword: (name: string, username: string, nextPassword: string) => Promise<void>;
  onBack: () => void;
};

export function ResetPasswordPage({ onResetPassword, onBack }: ResetPasswordPageProps) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
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
    void onResetPassword(name.trim(), username.trim(), next)
      .then(() => setComplete(true))
      .catch((resetError: unknown) => setError(messageFromApiError(resetError)))
      .finally(() => setBusy(false));
  };

  return (
    <main className={cx(styles, commonStyles, "password-page")}>
      <section className={cx(styles, commonStyles, "password-card")}>
        <div className={cx(styles, commonStyles, "password-brand")}><BrandMark /></div>
        <span className={cx(styles, commonStyles, "password-icon")} aria-hidden="true">⌑</span>
        <p className={cx(styles, commonStyles, "eyebrow")}>RECUPERAÇÃO DE ACESSO</p>
        <h1>Redefinir senha</h1>
        {complete ? (
          <>
            <div className={cx(styles, commonStyles, "notice notice-success")} role="status">
              Se o nome e o usuário corresponderem a uma conta ativa, a senha foi atualizada. Tente entrar com a nova senha.
            </div>
            <button className={cx(styles, commonStyles, "button button-primary button-full")} type="button" onClick={onBack}>Voltar ao login</button>
          </>
        ) : (
          <>
            <p className={cx(styles, commonStyles, "password-lead")}>Informe seu nome completo e usuário cadastrados para escolher uma nova senha.</p>
            {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{error}</div>}
            <form onSubmit={submit} className={cx(styles, commonStyles, "password-form")}>
              <label htmlFor="reset-name">Nome completo</label>
              <input id="reset-name" autoComplete="name" type="text" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} />
              <label htmlFor="reset-username">Usuário</label>
              <input id="reset-username" autoComplete="username" type="text" value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={80} />
              <label htmlFor="reset-new-password">Nova senha</label>
              <input id="reset-new-password" autoComplete="new-password" type="password" value={next} onChange={(event) => setNext(event.target.value)} required minLength={6} maxLength={1024} />
              <p className={cx(styles, commonStyles, "password-hint")}>Use pelo menos 6 caracteres.</p>
              <label htmlFor="reset-confirm-password">Confirme a nova senha</label>
              <input id="reset-confirm-password" autoComplete="new-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={1024} />
              <button className={cx(styles, commonStyles, "button button-primary button-full")} type="submit" disabled={busy}>
                {busy ? <><span className={cx(styles, commonStyles, "spinner")} /> Salvando senha...</> : "Redefinir senha"}
              </button>
            </form>
            <button className={cx(styles, commonStyles, "button button-secondary button-full password-back-button")} type="button" onClick={onBack}>Voltar ao login</button>
          </>
        )}
      </section>
    </main>
  );
}
