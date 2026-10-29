import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { isDemoMode } from "../../../shared/api/apiClient";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import { freightsApi } from "../api";
import type { AggregateResponse } from "../types";
import styles from "./AggregateFormDialog.module.css";

type Props = {
  onClose: () => void;
  onCreated: (aggregate: AggregateResponse) => void;
};

/** Aplica máscara visual ao CPF sem alterar os dígitos enviados para a API. */
function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** Formulário modal para cadastrar o agregado que receberá os pagamentos. */
export function AggregateFormDialog({ onClose, onCreated }: Props) {
  const titleId = useId();
  const nameId = useId();
  const cpfId = useId();
  const cpfHelpId = useId();
  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  /** Valida os campos, salva o cadastro e avisa a página que o diálogo concluiu. */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const normalizedName = name.trim().replace(/\s+/g, " ");
    if (normalizedName.length < 2) {
      setError("Informe o nome completo do agregado.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const created = await freightsApi.createAggregate({
        nome: normalizedName,
        cpf: cpf.replace(/\D/g, "") || null,
      });
      onCreated(created);
      onClose();
    } catch (submitError: unknown) {
      setError(messageFromApiError(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cx(styles, commonStyles, "dialog-backdrop")}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className={cx(styles, "aggregate-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={cx(styles, "dialog-header")}>
          <div>
            <p className={cx(styles, "dialog-eyebrow")}>CADASTRO FINANCEIRO</p>
            <h2 id={titleId}>Novo agregado</h2>
            <p className={cx(styles, "dialog-description")}>
              Cadastre o recebedor que será associado aos lançamentos de frete.
            </p>
          </div>
          <button
            className={cx(styles, "close-button")}
            type="button"
            aria-label="Fechar cadastro"
            onClick={onClose}
            disabled={saving}
          >
            ×
          </button>
        </header>

        <form className={cx(styles, "aggregate-form")} onSubmit={submit}>
          <label className={cx(styles, "field")} htmlFor={nameId}>
            Nome completo
            <input
              id={nameId}
              name="nome"
              type="text"
              autoComplete="name"
              maxLength={160}
              minLength={2}
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Nome do agregado"
              disabled={saving}
            />
          </label>

          <label className={cx(styles, "field")} htmlFor={cpfId}>
            CPF <span className={cx(styles, "optional-label")}>Opcional</span>
            <input
              id={cpfId}
              name="cpf"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={14}
              aria-describedby={cpfHelpId}
              value={cpf}
              onChange={(event) => setCpf(formatCpf(event.target.value))}
              placeholder="000.000.000-00"
              disabled={saving}
            />
            <small id={cpfHelpId}>
              O CPF será necessário para exportar a solicitação de pagamento ao Financeiro.
            </small>
          </label>

          {error && (
            <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">
              {error}
            </div>
          )}

          {isDemoMode && (
            <p className={cx(styles, "demo-note")}>
              Na demonstração, este cadastro fica salvo somente neste navegador.
            </p>
          )}

          <footer className={cx(styles, "form-actions")}>
            <button
              className={cx(styles, commonStyles, "button button-secondary")}
              type="button"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              className={cx(styles, commonStyles, "button button-primary")}
              type="submit"
              disabled={saving || !name.trim()}
            >
              {saving ? "Salvando..." : "Cadastrar agregado"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
