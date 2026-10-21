import { useState } from "react";
import type { FormEvent } from "react";
import styles from "./ChangePasswordPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { BrandMark } from "../../../shared/components/BrandMark";
import { messageFromApiError } from "../../../shared/api/apiError";

export function ChangePasswordPage({ onChangePassword, onCancel }: { onChangePassword: (current: string, next: string) => Promise<void>; onCancel: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
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
      .then(() => {
        setCurrent("");
        setNext("");
        setConfirmation("");
        setSuccess("Sua senha foi alterada.");
      })
      .catch((changeError: unknown) => setError(messageFromApiError(changeError)))
      .finally(() => setBusy(false));
  };

  return (
    <section className={cx(styles, commonStyles, "password-page password-page-embedded")}>
      <section className={cx(styles, commonStyles, "password-card")}>
        <div className={cx(styles, commonStyles, "password-brand")}><BrandMark /></div>
        <span className={cx(styles, commonStyles, "password-icon")} aria-hidden="true">⌑</span>
        <p className={cx(styles, commonStyles, "eyebrow")}>SUA CONTA</p>
        <h1>Alterar senha</h1>
        <p className={cx(styles, commonStyles, "password-lead")}>A troca é opcional. Informe sua senha atual para escolher uma nova.</p>
        {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{error}</div>}
        {success && <div className={cx(styles, commonStyles, "notice notice-success")} role="status">{success}</div>}
        <form onSubmit={submit} className={cx(styles, commonStyles, "password-form")}>
          <label htmlFor="current-password">Senha atual</label>
          <input id="current-password" autoComplete="current-password" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} required maxLength={1024} />
          <label htmlFor="new-password">Nova senha</label>
          <input id="new-password" autoComplete="new-password" type="password" value={next} onChange={(event) => setNext(event.target.value)} required minLength={6} maxLength={1024} />
          <p className={cx(styles, commonStyles, "password-hint")}>Use pelo menos 6 caracteres. Não reutilize sua senha de outro sistema.</p>
          <label htmlFor="confirm-password">Confirme a nova senha</label>
          <input id="confirm-password" autoComplete="new-password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={1024} />
          <button className={cx(styles, commonStyles, "button button-primary button-full")} type="submit" disabled={busy}>
            {busy ? <><span className={cx(styles, commonStyles, "spinner")} /> Salvando senha...</> : "Salvar nova senha"}
          </button>
        </form>
        <button className={cx(styles, commonStyles, "button button-secondary button-full password-back-button")} type="button" onClick={onCancel}>Voltar ao portal</button>
        <p className={cx(styles, commonStyles, "password-footer")}>Sua senha é armazenada com proteção criptográfica e nunca é exibida para a administração.</p>
      </section>
    </section>
  );
}
