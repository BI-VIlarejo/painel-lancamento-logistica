import { useState } from "react";
import type { FormEvent } from "react";
import { formatMoney, formatShortDate, localDateValue } from "../format";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type {
  FreightPaymentAdjustmentCreateInput,
  FreightPaymentInvoiceUpdateInput,
  FreightPaymentResponsibleSummary,
  FreightPaymentSettlementSummary,
  FreightPaymentTransportType,
  PaymentAdjustmentCategory,
  PaymentAdjustmentNature,
  PaymentInstallmentFrequency,
} from "../types";
import styles from "../pages/AggregatePaymentsPage.module.css";

type SettleDialogProps = {
  action: "SOLICITAR" | "MARCAR_PAGO";
  targets: FreightPaymentResponsibleSummary[];
  fromDate: string;
  toDate: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (data: {
    data_pagamento: string | null;
    observacao: string | null;
    nf_numero: string | null;
    nf_data: string | null;
    nf_recebida: boolean;
  }) => void;
};

export function SettlePaymentDialog({
  action,
  targets,
  fromDate,
  toDate,
  saving,
  error,
  onClose,
  onConfirm,
}: SettleDialogProps) {
  const singleTarget = targets.length === 1 ? targets[0] : null;
  const [payDate, setPayDate] = useState(localDateValue());
  const [note, setNote] = useState(singleTarget?.ultimo_pagamento?.observacao ?? "");
  const [nfNumber, setNfNumber] = useState(singleTarget?.ultimo_pagamento?.nf_numero ?? "");
  const [nfDate, setNfDate] = useState(singleTarget?.ultimo_pagamento?.nf_data ?? "");
  const [nfReceived, setNfReceived] = useState(
    Boolean(singleTarget?.ultimo_pagamento?.nf_recebida),
  );

  const totalPendingValue = targets.reduce(
    (sum, item) =>
      sum
      + Number(item.valor_em_aberto)
      + (action === "MARCAR_PAGO" ? Number(item.valor_solicitado) : 0),
    0,
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConfirm({
      data_pagamento: action === "MARCAR_PAGO" ? payDate : null,
      observacao: note.trim() || null,
      nf_numero: nfNumber.trim() || null,
      nf_data: nfDate || null,
      nf_recebida: nfReceived || Boolean(nfNumber.trim()),
    });
  };

  return (
    <div
      className={cx(styles, commonStyles, "dialog-backdrop")}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className={cx(styles, commonStyles, "detail-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settle-dialog-title"
      >
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div>
            <p className={cx(styles, commonStyles, "eyebrow")}>
              {action === "MARCAR_PAGO" ? "CONFIRMAR PAGAMENTO" : "SOLICITAR AO FINANCEIRO"}
            </p>
            <h2 id="settle-dialog-title">
              {singleTarget
                ? singleTarget.nome_transportador
                : `${targets.length} responsáveis selecionados`}
            </h2>
          </div>
          <button
            type="button"
            className={cx(styles, commonStyles, "icon-button", "dialog-close")}
            aria-label="Fechar"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={cx(styles, "dialog-body", "modal-form-stack")}>
            <div className={cx(styles, "confirm-summary-box")}>
              <div>
                <span>Período</span>
                <strong>
                  {formatShortDate(fromDate)} a {formatShortDate(toDate)}
                </strong>
              </div>
              <div>
                <span>Valor a registrar</span>
                <strong>{formatMoney(totalPendingValue)}</strong>
              </div>
            </div>

            {action === "MARCAR_PAGO" && (
              <label className={cx(styles, commonStyles, "filter-control")}>
                Data efetiva do pagamento
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(event) => setPayDate(event.target.value)}
                />
              </label>
            )}

            {singleTarget?.exige_nota_fiscal && (
              <div className={cx(styles, "form-two-cols")}>
                <label className={cx(styles, commonStyles, "filter-control")}>
                  Número da NF (opcional)
                  <input
                    type="text"
                    maxLength={60}
                    placeholder="Ex.: 001245"
                    value={nfNumber}
                    onChange={(event) => {
                      setNfNumber(event.target.value);
                      if (event.target.value.trim()) setNfReceived(true);
                    }}
                  />
                </label>
                <label className={cx(styles, commonStyles, "filter-control")}>
                  Data da NF
                  <input
                    type="date"
                    value={nfDate}
                    onChange={(event) => setNfDate(event.target.value)}
                  />
                </label>
                <label className={cx(styles, "checkbox-inline", "full-span")}>
                  <input
                    type="checkbox"
                    checked={nfReceived}
                    onChange={(event) => setNfReceived(event.target.checked)}
                  />
                  Nota fiscal já recebida
                </label>
              </div>
            )}

            <label className={cx(styles, commonStyles, "filter-control")}>
              Observação (opcional)
              <input
                type="text"
                maxLength={500}
                placeholder="Ex.: PIX realizado, lote semana 47..."
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>

            {error && (
              <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">
                {error}
              </div>
            )}
          </div>

          <div className={cx(styles, commonStyles, "dialog-footer")}>
            <span>Os fretes vinculados ficam protegidos contra pagamento duplicado.</span>
            <div className={cx(styles, commonStyles, "dialog-actions")}>
              <button
                type="button"
                className={cx(styles, commonStyles, "button button-secondary")}
                disabled={saving}
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={cx(styles, commonStyles, "button button-primary")}
                disabled={saving}
              >
                {saving
                  ? "Registrando..."
                  : action === "MARCAR_PAGO"
                    ? "Confirmar pagamento"
                    : "Registrar solicitação"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

type InvoiceDialogProps = {
  settlement: FreightPaymentSettlementSummary;
  saving: boolean;
  error: string;
  onClose: () => void;
  onCopyChargeMessage: (settlement: FreightPaymentSettlementSummary) => void;
  onSave: (payload: FreightPaymentInvoiceUpdateInput) => void;
};

export function InvoiceDialog({
  settlement,
  saving,
  error,
  onClose,
  onCopyChargeMessage,
  onSave,
}: InvoiceDialogProps) {
  const [nfNumber, setNfNumber] = useState(settlement.nf_numero ?? "");
  const [nfDate, setNfDate] = useState(settlement.nf_data ?? "");
  const [nfReceived, setNfReceived] = useState(settlement.nf_recebida);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({
      nf_numero: nfNumber.trim() || null,
      nf_data: nfDate || null,
      nf_recebida: nfReceived,
    });
  };

  return (
    <div
      className={cx(styles, commonStyles, "dialog-backdrop")}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className={cx(styles, commonStyles, "detail-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-dialog-title"
      >
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div>
            <p className={cx(styles, commonStyles, "eyebrow")}>CONTROLE DE NOTA FISCAL</p>
            <h2 id="invoice-dialog-title">{settlement.nome_transportador}</h2>
          </div>
          <button
            type="button"
            className={cx(styles, commonStyles, "icon-button", "dialog-close")}
            aria-label="Fechar"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={cx(styles, "dialog-body", "modal-form-stack")}>
            <div className={cx(styles, "form-two-cols")}>
              <label className={cx(styles, commonStyles, "filter-control")}>
                Número da NF
                <input
                  type="text"
                  maxLength={60}
                  value={nfNumber}
                  onChange={(event) => {
                    setNfNumber(event.target.value);
                    if (event.target.value.trim()) setNfReceived(true);
                  }}
                  placeholder="Ex.: 001245"
                />
              </label>
              <label className={cx(styles, commonStyles, "filter-control")}>
                Data de emissão da NF
                <input
                  type="date"
                  value={nfDate}
                  onChange={(event) => setNfDate(event.target.value)}
                />
              </label>
            </div>
            <label className={cx(styles, commonStyles, "filter-control")}>
              Situação da NF
              <select
                value={nfReceived ? "1" : "0"}
                onChange={(event) => setNfReceived(event.target.value === "1")}
              >
                <option value="1">NF recebida</option>
                <option value="0">NF ainda pendente</option>
              </select>
            </label>
            {error && (
              <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">
                {error}
              </div>
            )}
          </div>

          <div className={cx(styles, commonStyles, "dialog-footer")}>
            <button
              type="button"
              className={cx(styles, commonStyles, "button button-secondary")}
              disabled={saving}
              onClick={() => onCopyChargeMessage(settlement)}
            >
              Copiar cobrança (WhatsApp)
            </button>
            <div className={cx(styles, commonStyles, "dialog-actions")}>
              <button
                type="button"
                className={cx(styles, commonStyles, "button button-secondary")}
                disabled={saving}
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={cx(styles, commonStyles, "button button-primary")}
                disabled={saving}
              >
                {saving ? "Salvando..." : "Salvar NF"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

type ReverseDialogProps = {
  settlement: FreightPaymentSettlementSummary;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
};

export function ReverseSettlementDialog({
  settlement,
  saving,
  error,
  onClose,
  onConfirm,
}: ReverseDialogProps) {
  const [reason, setReason] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConfirm(reason.trim());
  };

  return (
    <div
      className={cx(styles, commonStyles, "dialog-backdrop")}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className={cx(styles, commonStyles, "detail-dialog")}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reverse-dialog-title"
      >
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div>
            <p className={cx(styles, commonStyles, "eyebrow")}>ESTORNAR FECHAMENTO</p>
            <h2 id="reverse-dialog-title">{settlement.nome_transportador}</h2>
          </div>
          <button
            type="button"
            className={cx(styles, commonStyles, "icon-button", "dialog-close")}
            aria-label="Fechar"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={cx(styles, "dialog-body", "modal-form-stack")}>
            <div className={cx(styles, commonStyles, "notice notice-warning")}>
              Este fechamento ({formatMoney(settlement.valor_liquido_registrado)}) ficará registrado
              como <strong>Estornado</strong> no histórico, e os {settlement.quantidade_fretes}{" "}
              frete(s) e ajustes vinculados voltarão para <strong>Em aberto</strong>.
            </div>
            <label className={cx(styles, commonStyles, "filter-control")}>
              Motivo do estorno
              <input
                type="text"
                required
                minLength={3}
                maxLength={500}
                placeholder="Ex.: Frete corrigido após fechamento"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error && (
              <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">
                {error}
              </div>
            )}
          </div>
          <div className={cx(styles, commonStyles, "dialog-footer")}>
            <span />
            <div className={cx(styles, commonStyles, "dialog-actions")}>
              <button
                type="button"
                className={cx(styles, commonStyles, "button button-secondary")}
                disabled={saving}
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={cx(styles, commonStyles, "button", "button-danger-solid")}
                disabled={saving || reason.trim().length < 3}
              >
                {saving ? "Estornando..." : "Confirmar estorno"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

type AdjustmentDialogProps = {
  transportType: FreightPaymentTransportType;
  responsibleOptions: string[];
  defaultResponsible: string;
  defaultDate: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: FreightPaymentAdjustmentCreateInput) => void;
};

const CATEGORY_DEFAULTS: Record<
  PaymentAdjustmentCategory,
  { nature: PaymentAdjustmentNature; label: string; desc: string }
> = {
  VALE: { nature: "DESCONTO", label: "Vale / Adiantamento (desconta)", desc: "Vale" },
  ADIANTAMENTO: { nature: "DESCONTO", label: "Adiantamento de frete (desconta)", desc: "Adiantamento" },
  DESCONTO: { nature: "DESCONTO", label: "Outro desconto", desc: "Desconto avulso" },
  BONUS: { nature: "ACRESCIMO", label: "Bônus / Premiação (soma)", desc: "Bônus" },
  PEDAGIO: { nature: "ACRESCIMO", label: "Reembolso / Pedágio / Diária (soma)", desc: "Reembolso / Pedágio" },
  OUTRO: { nature: "ACRESCIMO", label: "Outro acréscimo (soma)", desc: "Acréscimo avulso" },
};

export function NewAdjustmentDialog({
  transportType,
  responsibleOptions,
  defaultResponsible,
  defaultDate,
  saving,
  error,
  onClose,
  onSave,
}: AdjustmentDialogProps) {
  const [responsibleName, setResponsibleName] = useState(defaultResponsible);
  const [category, setCategory] = useState<PaymentAdjustmentCategory>("VALE");
  const [nature, setNature] = useState<PaymentAdjustmentNature>("DESCONTO");
  const [description, setDescription] = useState(CATEGORY_DEFAULTS.VALE.desc);
  const [amount, setAmount] = useState("");
  const [refDate, setRefDate] = useState(defaultDate || localDateValue());
  const [installments, setInstallments] = useState(1);
  const [frequency, setFrequency] = useState<PaymentInstallmentFrequency>("SEMANAL");
  const [note, setNote] = useState("");

  const parsedValue = Number(amount.replace(/\./g, "").replace(",", "."));
  const perPart = Number.isFinite(parsedValue) && parsedValue > 0 && installments > 1
    ? parsedValue / installments
    : null;

  const handleCategoryChange = (next: PaymentAdjustmentCategory) => {
    setCategory(next);
    setNature(CATEGORY_DEFAULTS[next].nature);
    setDescription(CATEGORY_DEFAULTS[next].desc);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) return;
    onSave({
      tipo_transporte: transportType,
      nome_transportador: responsibleName.trim(),
      data_referencia: refDate,
      natureza: nature,
      categoria: category,
      descricao: description.trim(),
      valor: parsedValue.toFixed(2),
      parcelas: installments,
      periodicidade: frequency,
      observacao: note.trim() || null,
    });
  };

  return (
    <div
      className={cx(styles, commonStyles, "dialog-backdrop")}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className={cx(styles, commonStyles, "detail-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="adjustment-dialog-title"
      >
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div>
            <p className={cx(styles, commonStyles, "eyebrow")}>VALES E AJUSTES FINANCEIROS</p>
            <h2 id="adjustment-dialog-title">Novo lançamento extra</h2>
          </div>
          <button
            type="button"
            className={cx(styles, commonStyles, "icon-button", "dialog-close")}
            aria-label="Fechar"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={cx(styles, "dialog-body", "modal-form-stack")}>
            <label className={cx(styles, commonStyles, "filter-control")}>
              {transportType === "AGREGADO" ? "Agregado" : "Transportadora"}
              <input
                type="text"
                list="payment-responsible-suggestions"
                required
                maxLength={160}
                placeholder="Escolha ou digite o nome exato"
                value={responsibleName}
                onChange={(event) => setResponsibleName(event.target.value)}
              />
              <datalist id="payment-responsible-suggestions">
                {responsibleOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>

            <div className={cx(styles, "form-two-cols")}>
              <label className={cx(styles, commonStyles, "filter-control")}>
                Tipo de lançamento
                <select
                  value={category}
                  onChange={(event) =>
                    handleCategoryChange(event.target.value as PaymentAdjustmentCategory)
                  }
                >
                  {(Object.keys(CATEGORY_DEFAULTS) as PaymentAdjustmentCategory[]).map((key) => (
                    <option key={key} value={key}>
                      {CATEGORY_DEFAULTS[key].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={cx(styles, commonStyles, "filter-control")}>
                Efeito no pagamento
                <select
                  value={nature}
                  onChange={(event) => setNature(event.target.value as PaymentAdjustmentNature)}
                >
                  <option value="DESCONTO">Desconta do pagamento</option>
                  <option value="ACRESCIMO">Soma no pagamento</option>
                </select>
              </label>
            </div>

            <div className={cx(styles, "form-two-cols")}>
              <label className={cx(styles, commonStyles, "filter-control")}>
                Descrição no extrato
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={200}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className={cx(styles, commonStyles, "filter-control")}>
                Valor total (R$)
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="Ex.: 250,00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
            </div>

            <div className={cx(styles, "form-three-cols")}>
              <label className={cx(styles, commonStyles, "filter-control")}>
                Data de referência
                <input
                  type="date"
                  required
                  value={refDate}
                  onChange={(event) => setRefDate(event.target.value)}
                />
              </label>

              <label className={cx(styles, commonStyles, "filter-control")}>
                Parcelas
                <select
                  value={installments}
                  onChange={(event) => setInstallments(Number(event.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((count) => (
                    <option key={count} value={count}>
                      {count === 1 ? "À vista (1x)" : `${count}x`}
                    </option>
                  ))}
                </select>
              </label>

              <label className={cx(styles, commonStyles, "filter-control")}>
                Intervalo
                <select
                  value={frequency}
                  disabled={installments === 1}
                  onChange={(event) =>
                    setFrequency(event.target.value as PaymentInstallmentFrequency)
                  }
                >
                  <option value="SEMANAL">Semanal (+7 dias)</option>
                  <option value="MENSAL">Mensal (+1 mês)</option>
                </select>
              </label>
            </div>

            {perPart !== null && (
              <div className={cx(styles, commonStyles, "notice notice-info")}>
                Serão geradas <strong>{installments} parcelas</strong> de aprox.{" "}
                <strong>{formatMoney(perPart)}</strong> ({frequency === "SEMANAL" ? "a cada 7 dias" : "todo mês"}) a partir de {formatShortDate(refDate)}.
              </div>
            )}

            <label className={cx(styles, commonStyles, "filter-control")}>
              Observação (opcional)
              <input
                type="text"
                maxLength={500}
                placeholder="Ex.: Combustível adiantado na terça"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>

            {error && (
              <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">
                {error}
              </div>
            )}
          </div>

          <div className={cx(styles, commonStyles, "dialog-footer")}>
            <span>O valor entra automaticamente no fechamento do período correspondente.</span>
            <div className={cx(styles, commonStyles, "dialog-actions")}>
              <button
                type="button"
                className={cx(styles, commonStyles, "button button-secondary")}
                disabled={saving}
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className={cx(styles, commonStyles, "button button-primary")}
                disabled={saving || !responsibleName.trim() || !Number.isFinite(parsedValue) || parsedValue <= 0}
              >
                {saving ? "Salvando..." : "Salvar lançamento"}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
