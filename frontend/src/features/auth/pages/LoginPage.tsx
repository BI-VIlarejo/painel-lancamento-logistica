import styles from "./LoginPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { useState } from "react";
import type { FormEvent } from "react";
import { isDemoMode } from "../../../shared/api/apiClient";
import { messageFromApiError } from "../../../shared/api/apiError";
import { BrandMark } from "../../../shared/components/BrandMark";

type LoginPageProps = {
  onLogin: (username: string, password: string) => Promise<void>;
  onResetPassword?: () => void;
  bootstrapMessage?: string;
};

export function LoginPage({ onLogin, onResetPassword, bootstrapMessage = "" }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onLogin(username, password);
    } catch (loginError) {
      setError(messageFromApiError(loginError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={cx(styles, commonStyles, "login-layout")}>
      <section className={cx(styles, commonStyles, "login-story")} aria-label="Portal de Logística Vilarejo">
        <div className={cx(styles, commonStyles, "login-story-top")}>
          <BrandMark light />
          <span className={cx(styles, commonStyles, "login-story-tag")}>OPERAÇÃO CONECTADA</span>
        </div>

        <div className={cx(styles, commonStyles, "login-story-copy")}>
          <p className={cx(styles, commonStyles, "eyebrow eyebrow-light")}>PORTAL DE LOGÍSTICA</p>
          <h1>O dia a dia da operação, em um só lugar.</h1>
          <p className={cx(styles, commonStyles, "login-story-description")}>
            Registre entregas com clareza, acompanhe cada lançamento e mantenha a equipe alinhada.
          </p>
        </div>

        <div className={cx(styles, commonStyles, "route-art")} aria-hidden="true">
          <div className={cx(styles, commonStyles, "route-art-glow")} />
          <svg viewBox="0 0 540 280" fill="none">
            <path d="M34 201C112 201 106 106 197 106C281 106 271 226 357 226C421 226 406 79 507 79" stroke="rgba(255,255,255,.38)" strokeWidth="2" strokeDasharray="5 9" />
            <path d="M34 201C112 201 106 106 197 106C281 106 271 226 357 226C421 226 406 79 507 79" stroke="url(#route)" strokeWidth="5" strokeLinecap="round" />
            <circle cx="34" cy="201" r="9" fill="#F2C775" stroke="#FBF8EF" strokeWidth="5" />
            <circle cx="197" cy="106" r="9" fill="#F2C775" stroke="#FBF8EF" strokeWidth="5" />
            <circle cx="357" cy="226" r="9" fill="#F2C775" stroke="#FBF8EF" strokeWidth="5" />
            <circle cx="507" cy="79" r="9" fill="#F2C775" stroke="#FBF8EF" strokeWidth="5" />
            <path d="M268 42l20 20-20 20-20-20 20-20Z" fill="rgba(255,255,255,.12)" />
            <path d="M441 157l13 13-13 13-13-13 13-13Z" fill="rgba(255,255,255,.1)" />
            <defs>
              <linearGradient id="route" x1="34" y1="201" x2="507" y2="79" gradientUnits="userSpaceOnUse">
                <stop stopColor="#F2C775" />
                <stop offset="1" stopColor="#F8E5B9" />
              </linearGradient>
            </defs>
          </svg>
          <div className={cx(styles, commonStyles, "route-art-label route-label-start")}><span /> Saída</div>
          <div className={cx(styles, commonStyles, "route-art-label route-label-end")}><span /> Entrega</div>
          <div className={cx(styles, commonStyles, "route-truck")} aria-hidden="true">↗</div>
        </div>

        <div className={cx(styles, commonStyles, "login-story-footer")}>
          <span>Organização que move a operação.</span>
          <span>© Vilarejo Acabamentos</span>
        </div>
      </section>

      <section className={cx(styles, commonStyles, "login-panel")}>
        <div className={cx(styles, commonStyles, "login-panel-inner")}>
          <div className={cx(styles, commonStyles, "mobile-brand")}><BrandMark /></div>
          <div className={cx(styles, commonStyles, "login-heading")}>
            <p className={cx(styles, commonStyles, "eyebrow")}>BEM-VINDA(O)</p>
            <h2>Acesse o portal</h2>
            <p>Entre com sua conta corporativa para continuar.</p>
          </div>

          {bootstrapMessage && <div className={cx(styles, commonStyles, "notice notice-warning")} role="status">{bootstrapMessage}</div>}
          {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{error}</div>}

          {isDemoMode ? (
            <div className={cx(styles, commonStyles, "demo-access-card")}>
              <div className={cx(styles, commonStyles, "demo-access-icon")} aria-hidden="true">✓</div>
              <div>
                <strong>Prévia interativa</strong>
                <p>Entre no ambiente demonstrativo para explorar o formulário e o histórico.</p>
              </div>
              <button
                className={cx(styles, commonStyles, "button button-primary button-full")}
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void onLogin("demonstracao", "").catch((loginError: unknown) => setError(messageFromApiError(loginError))).finally(() => setBusy(false));
                }}
              >
                {busy ? <><span className={cx(styles, commonStyles, "spinner")} /> Abrindo prévia...</> : <>Entrar na demonstração <span aria-hidden="true">→</span></>}
              </button>
              <p className={cx(styles, commonStyles, "demo-note")}><span className={cx(styles, commonStyles, "demo-note-dot")} /> Dados fictícios salvos apenas neste navegador.</p>
            </div>
          ) : (
            <form className={cx(styles, commonStyles, "login-form")} onSubmit={submit}>
              <label className={cx(styles, commonStyles, "field-label")} htmlFor="username">Usuário</label>
              <div className={cx(styles, commonStyles, "input-with-icon")}>
                <span className={cx(styles, commonStyles, "field-icon")} aria-hidden="true">◎</span>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder="Seu usuário"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  maxLength={80}
                />
              </div>

              <div className={cx(styles, commonStyles, "field-label-row")}>
                <label className={cx(styles, commonStyles, "field-label")} htmlFor="password">Senha</label>
                <span className={cx(styles, commonStyles, "field-hint")}>Acesso seguro</span>
              </div>
              <div className={cx(styles, commonStyles, "input-with-icon")}>
                <span className={cx(styles, commonStyles, "field-icon")} aria-hidden="true">⌑</span>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Sua senha"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  maxLength={1024}
                />
              </div>
              <button className={cx(styles, commonStyles, "button button-primary button-full login-submit")} type="submit" disabled={busy}>
                {busy ? <><span className={cx(styles, commonStyles, "spinner")} /> Entrando...</> : <>Entrar <span aria-hidden="true">→</span></>}
              </button>
              <p className={cx(styles, commonStyles, "login-security")}><span aria-hidden="true">◈</span> Sua sessão é protegida e não fica salva neste navegador.</p>
              {onResetPassword && <a className={cx(styles, commonStyles, "login-reset-link")} href="/redefinir-senha" onClick={(event) => { event.preventDefault(); onResetPassword(); }}>Esqueci minha senha</a>}
            </form>
          )}

          <div className={cx(styles, commonStyles, "login-help")}>
            <span className={cx(styles, commonStyles, "help-mark")}>i</span>
            <p>Precisa de acesso? Fale com a pessoa administradora do seu setor.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
