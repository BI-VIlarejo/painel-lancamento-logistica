import { formatDate, formatMoney, formatNumber, formatShortDate } from "../format";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type {
  FreightPaymentResponsibleSummary,
  FreightPaymentSettlementSummary,
  FreightPaymentTransportType,
} from "../types";
import styles from "../pages/AggregatePaymentsPage.module.css";

type Props = {
  responsible: FreightPaymentResponsibleSummary;
  transportType: FreightPaymentTransportType;
  fromDate: string;
  toDate: string;
  canExport: boolean;
  canEditFreights: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onCopyText: (text: string, label: string) => void;
  onOpenReceipt: (responsible: FreightPaymentResponsibleSummary) => void;
  onOpenInvoice: (settlement: FreightPaymentSettlementSummary) => void;
  onExportSettlement: (settlement: FreightPaymentSettlementSummary) => void;
  onMarkSettlementPaid: (settlement: FreightPaymentSettlementSummary) => void;
  onUndoSettlementPaid: (settlement: FreightPaymentSettlementSummary) => void;
  onReverseSettlement: (settlement: FreightPaymentSettlementSummary) => void;
};

const ADJUSTMENT_CATEGORY_LABELS: Record<string, string> = {
  VALE: "Vale",
  ADIANTAMENTO: "Adiantamento",
  BONUS: "Bônus",
  PEDAGIO: "Pedágio",
  DESCONTO: "Desconto",
  OUTRO: "Outro",
};

function freightStatusLabel(
  pronto: boolean,
  state: string,
  payDate: string | null,
): { label: string; tone: string } {
  if (!pronto) return { label: "Pendência", tone: "pill-danger" };
  if (state === "PAGO") {
    return {
      label: payDate ? `Pago ${formatShortDate(payDate)}` : "Pago",
      tone: "pill-paid",
    };
  }
  if (state === "SOLICITADO") return { label: "Solicitado", tone: "pill-requested" };
  return { label: "Em aberto", tone: "pill-open" };
}

export function PaymentResponsibleDetailModal({
  responsible,
  transportType,
  fromDate,
  toDate,
  canExport,
  canEditFreights,
  onClose,
  onNavigate,
  onCopyText,
  onOpenReceipt,
  onOpenInvoice,
  onExportSettlement,
  onMarkSettlementPaid,
  onUndoSettlementPaid,
  onReverseSettlement,
}: Props) {
  const typeLabel = transportType === "AGREGADO" ? "Agregado" : "Transportadora independente";

  return (
    <div
      className={cx(styles, commonStyles, "dialog-backdrop")}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={cx(styles, commonStyles, "detail-dialog", "payment-detail-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="responsible-detail-title"
      >
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div>
            <p className={cx(styles, commonStyles, "eyebrow")}>CONFERÊNCIA DE PAGAMENTO</p>
            <h2 id="responsible-detail-title">
              {responsible.nome_transportador}{" "}
              <span>
                · {typeLabel} · {formatShortDate(fromDate)} a {formatShortDate(toDate)}
              </span>
            </h2>
          </div>
          <button
            type="button"
            className={cx(styles, commonStyles, "icon-button", "dialog-close")}
            aria-label="Fechar"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className={cx(styles, "dialog-body")}>
          <div className={cx(styles, "detail-meta-bar")}>
            <div>
              <span>CPF / CNPJ</span>
              <strong>{responsible.documento_fiscal || "Não cadastrado"}</strong>
            </div>
            <div>
              <span>Chave PIX / Conta</span>
              <div className={cx(styles, "inline-copy-row")}>
                <strong>{responsible.chave_pix || "Não cadastrada"}</strong>
                {responsible.chave_pix && (
                  <button
                    type="button"
                    className={cx(styles, "mini-action")}
                    onClick={() => onCopyText(responsible.chave_pix || "", "Chave PIX")}
                  >
                    Copiar PIX
                  </button>
                )}
              </div>
            </div>
            <div>
              <span>Nota fiscal</span>
              <strong>
                {responsible.exige_nota_fiscal ? "Exige NF no fechamento" : "Dispensada"}
              </strong>
            </div>
          </div>

          {responsible.possui_alteracao && (
            <div className={cx(styles, commonStyles, "notice notice-error")}>
              <strong>Atenção — alteração após fechamento:</strong>{" "}
              {responsible.motivo_alteracao ||
                "Os valores de um ou mais fretes divergem do fechamento registrado. Confira e, se necessário, estorne para refazer."}
            </div>
          )}

          <div className={cx(styles, "detail-kpi-strip")}>
            <div>
              <span>Fretes bruto</span>
              <strong>{formatMoney(responsible.valor_frete_bruto)}</strong>
            </div>
            <div>
              <span>Avarias</span>
              <strong>-{formatMoney(responsible.valor_avarias)}</strong>
            </div>
            <div>
              <span>Vales / ajustes</span>
              <strong>{formatMoney(responsible.valor_ajustes_liquido)}</strong>
            </div>
            <div>
              <span>Total líquido</span>
              <strong>{formatMoney(responsible.valor_liquido_total)}</strong>
            </div>
            <div className={cx(styles, "kpi-paid-tint")}>
              <span>Já pago</span>
              <strong>{formatMoney(responsible.valor_pago)}</strong>
            </div>
            <div className={cx(styles, "kpi-open-tint")}>
              <span>Falta pagar</span>
              <strong>{formatMoney(responsible.valor_em_aberto)}</strong>
            </div>
          </div>

          <section className={cx(styles, "detail-section")}>
            <h3>
              Fretes no período ({responsible.fretes.length}) · {responsible.quantidade_dias}{" "}
              {responsible.quantidade_dias === 1 ? "dia" : "dias"}
            </h3>
            {responsible.fretes.length === 0 ? (
              <p className={cx(styles, "muted-note")}>
                Nenhum frete registrado neste período (apenas ajustes financeiros).
              </p>
            ) : (
              <div className={cx(styles, commonStyles, "data-table-scroll", "data-table-scroll-compact")}>
                <table className={cx(styles, commonStyles, "data-table", "detail-freights-table")}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Rota / motorista</th>
                      <th>Entregas / peso</th>
                      <th>Bruto</th>
                      <th>Avaria</th>
                      <th>Líquido</th>
                      <th>Situação</th>
                      {canEditFreights && <th aria-label="Ação" />}
                    </tr>
                  </thead>
                  <tbody>
                    {responsible.fretes.map((freight) => {
                      const badge = freightStatusLabel(
                        freight.pronto_para_pagamento,
                        freight.status_pagamento_frete,
                        freight.data_pagamento,
                      );
                      return (
                        <tr key={freight.codigo_frete}>
                          <td>{formatShortDate(freight.data_servico)}</td>
                          <td>
                            <strong>{freight.rota_cidade || "Rota não informada"}</strong>
                            {freight.nome_motorista_transportadora && (
                              <small>Motorista: {freight.nome_motorista_transportadora}</small>
                            )}
                            {freight.motivo_pendencia && (
                              <small className={cx(styles, "cell-warning")}>
                                {freight.motivo_pendencia}
                              </small>
                            )}
                          </td>
                          <td>
                            {freight.quantidade_entregas !== null
                              ? `${freight.quantidade_entregas} entr.`
                              : "—"}
                            {freight.peso_kg !== null && (
                              <small>{formatNumber(freight.peso_kg)} kg</small>
                            )}
                          </td>
                          <td>{formatMoney(freight.valor_frete_bruto)}</td>
                          <td>{formatMoney(freight.valor_avaria)}</td>
                          <td>
                            <strong>{formatMoney(freight.valor_frete_pago)}</strong>
                          </td>
                          <td>
                            <span className={cx(styles, "status-pill", badge.tone)}>
                              {badge.label}
                            </span>
                            {freight.valor_divergente && (
                              <span className={cx(styles, "status-pill", "pill-danger")}>
                                Alterado
                              </span>
                            )}
                          </td>
                          {canEditFreights && (
                            <td>
                              <button
                                type="button"
                                className={cx(styles, "mini-action")}
                                onClick={() => {
                                  onClose();
                                  onNavigate(`/fretes/${encodeURIComponent(freight.codigo_frete)}`);
                                }}
                              >
                                Abrir
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {responsible.ajustes.length > 0 && (
            <section className={cx(styles, "detail-section")}>
              <h3>Vales e ajustes no período ({responsible.ajustes.length})</h3>
              <div className={cx(styles, commonStyles, "data-table-scroll", "data-table-scroll-compact")}>
                <table className={cx(styles, commonStyles, "data-table", "detail-freights-table")}>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Tipo</th>
                      <th>Descrição</th>
                      <th>Valor</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responsible.ajustes.map((adj) => (
                      <tr key={adj.codigo_ajuste}>
                        <td>{formatShortDate(adj.data_referencia)}</td>
                        <td>
                          <span
                            className={cx(
                              styles,
                              "status-pill",
                              adj.natureza === "DESCONTO" ? "pill-danger" : "pill-paid",
                            )}
                          >
                            {ADJUSTMENT_CATEGORY_LABELS[adj.categoria] ?? adj.categoria}
                          </span>
                        </td>
                        <td>
                          <strong>{adj.descricao}</strong>
                          {adj.observacao && <small>{adj.observacao}</small>}
                        </td>
                        <td>
                          <strong>
                            {adj.natureza === "DESCONTO" ? "-" : "+"}
                            {formatMoney(adj.valor)}
                          </strong>
                        </td>
                        <td>
                          <span
                            className={cx(
                              styles,
                              "status-pill",
                              adj.status_pagamento === "PAGO"
                                ? "pill-paid"
                                : adj.status_pagamento === "SOLICITADO"
                                  ? "pill-requested"
                                  : "pill-open",
                            )}
                          >
                            {adj.status_pagamento === "PAGO"
                              ? "Pago"
                              : adj.status_pagamento === "SOLICITADO"
                                ? "Solicitado"
                                : "Em aberto"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {responsible.pagamentos.length > 0 && (
            <section className={cx(styles, "detail-section")}>
              <h3>Fechamentos vinculados ({responsible.pagamentos.length})</h3>
              <div className={cx(styles, "settlement-cards")}>
                {responsible.pagamentos.map((pag) => (
                  <article key={pag.codigo_pagamento} className={cx(styles, "settlement-card")}>
                    <div className={cx(styles, "settlement-card-top")}>
                      <div>
                        <span
                          className={cx(
                            styles,
                            "status-pill",
                            pag.status_pagamento === "PAGO"
                              ? "pill-paid"
                              : pag.status_pagamento === "SOLICITADO"
                                ? "pill-requested"
                                : "pill-muted",
                          )}
                        >
                          {pag.status_pagamento === "PAGO"
                            ? `Pago em ${formatShortDate(pag.data_pagamento)}`
                            : pag.status_pagamento === "SOLICITADO"
                              ? "Solicitado ao financeiro"
                              : "Estornado"}
                        </span>
                        {pag.exige_nota_fiscal && (
                          <span
                            className={cx(
                              styles,
                              "status-pill",
                              pag.nf_recebida ? "pill-paid" : "pill-danger",
                            )}
                          >
                            {pag.nf_recebida
                              ? `NF ${pag.nf_numero || "recebida"}`
                              : "NF pendente"}
                          </span>
                        )}
                        {pag.possui_alteracao && (
                          <span className={cx(styles, "status-pill", "pill-danger")}>
                            Alterado
                          </span>
                        )}
                      </div>
                      <strong>{formatMoney(pag.valor_liquido_registrado)}</strong>
                    </div>
                    <p className={cx(styles, "settlement-card-meta")}>
                      Período {formatShortDate(pag.data_de)} a {formatShortDate(pag.data_ate)} ·{" "}
                      {pag.quantidade_fretes} frete(s) · {pag.quantidade_dias} dia(s) · Criado por{" "}
                      {pag.criado_por_nome || "usuário"} em {formatDate(pag.criado_em)}
                      {pag.pago_por_nome ? ` · Baixado por ${pag.pago_por_nome}` : ""}
                    </p>
                    {pag.observacao && (
                      <p className={cx(styles, "settlement-card-note")}>Obs.: {pag.observacao}</p>
                    )}
                    {canExport && pag.status_pagamento !== "ESTORNADO" && (
                      <div className={cx(styles, "settlement-card-actions")}>
                        <button
                          type="button"
                          className={cx(styles, "mini-action")}
                          onClick={() => onExportSettlement(pag)}
                        >
                          XLSX do lote
                        </button>
                        <button
                          type="button"
                          className={cx(styles, "mini-action")}
                          onClick={() => onOpenInvoice(pag)}
                        >
                          Nota Fiscal
                        </button>
                        {pag.status_pagamento === "SOLICITADO" ? (
                          <button
                            type="button"
                            className={cx(styles, "mini-action", "mini-action-primary")}
                            onClick={() => onMarkSettlementPaid(pag)}
                          >
                            Marcar pago
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={cx(styles, "mini-action")}
                            onClick={() => onUndoSettlementPaid(pag)}
                          >
                            Desfazer pago
                          </button>
                        )}
                        <button
                          type="button"
                          className={cx(styles, "mini-action", "mini-action-danger")}
                          onClick={() => onReverseSettlement(pag)}
                        >
                          Estornar
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className={cx(styles, commonStyles, "dialog-footer")}>
          <span>
            {responsible.quantidade_fretes} frete(s) · {responsible.quantidade_dias} dia(s)
          </span>
          <div className={cx(styles, commonStyles, "dialog-actions")}>
            <button
              type="button"
              className={cx(styles, commonStyles, "button button-secondary")}
              onClick={() => onOpenReceipt(responsible)}
            >
              Recibo / WhatsApp
            </button>
            <button
              type="button"
              className={cx(styles, commonStyles, "button button-primary")}
              onClick={onClose}
            >
              Fechar
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
