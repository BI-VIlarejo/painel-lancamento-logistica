import { formatMoney, formatShortDate } from "../format";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type {
  FreightPaymentResponsibleSummary,
  FreightPaymentTransportType,
} from "../types";
import styles from "../pages/AggregatePaymentsPage.module.css";

type Props = {
  responsible: FreightPaymentResponsibleSummary;
  transportType: FreightPaymentTransportType;
  fromDate: string;
  toDate: string;
  onClose: () => void;
  onCopyText: (text: string, label: string) => void;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildWhatsappSummary(
  responsible: FreightPaymentResponsibleSummary,
  transportType: FreightPaymentTransportType,
  fromDate: string,
  toDate: string,
): string {
  const readyFreights = responsible.fretes.filter((item) => item.pronto_para_pagamento);
  const lines = [
    `*FECHAMENTO DE FRETES — ${transportType === "AGREGADO" ? "AGREGADO" : "TRANSPORTADORA"}*`,
    `Responsável: *${responsible.nome_transportador}*`,
    `Período: ${formatShortDate(fromDate)} a ${formatShortDate(toDate)} (${responsible.quantidade_dias} ${responsible.quantidade_dias === 1 ? "dia" : "dias"})`,
    "",
  ];
  if (readyFreights.length > 0) {
    lines.push("*Fretes:*");
    for (const freight of readyFreights) {
      const avariaNote = Number(freight.valor_avaria) > 0
        ? ` (avaria -${formatMoney(freight.valor_avaria)})`
        : "";
      lines.push(
        `• ${formatShortDate(freight.data_servico)} — ${freight.rota_cidade || "Sem rota"}: ${formatMoney(freight.valor_frete_pago)}${avariaNote}`,
      );
    }
    lines.push("");
  }
  if (responsible.ajustes.length > 0) {
    lines.push("*Vales / Ajustes:*");
    for (const adj of responsible.ajustes) {
      const sign = adj.natureza === "DESCONTO" ? "-" : "+";
      lines.push(`• ${formatShortDate(adj.data_referencia)} — ${adj.descricao}: ${sign}${formatMoney(adj.valor)}`);
    }
    lines.push("");
  }
  lines.push(`Frete bruto: ${formatMoney(responsible.valor_frete_bruto)}`);
  if (Number(responsible.valor_avarias) > 0) {
    lines.push(`Avarias: -${formatMoney(responsible.valor_avarias)}`);
  }
  if (Number(responsible.valor_ajustes_liquido) !== 0) {
    lines.push(`Vales / Ajustes: ${formatMoney(responsible.valor_ajustes_liquido)}`);
  }
  lines.push(`*Total líquido: ${formatMoney(responsible.valor_liquido_total)}*`);
  if (Number(responsible.valor_pago) > 0) {
    lines.push(`Já pago: ${formatMoney(responsible.valor_pago)}`);
  }
  if (Number(responsible.valor_em_aberto) > 0) {
    lines.push(`Saldo a pagar: ${formatMoney(responsible.valor_em_aberto)}`);
  }
  if (responsible.ultimo_pagamento?.nf_numero) {
    lines.push(`NF: ${responsible.ultimo_pagamento.nf_numero}`);
  }
  if (responsible.chave_pix) {
    lines.push(`PIX cadastrado: ${responsible.chave_pix}`);
  }
  return lines.join("\n");
}

function printReceiptDocument(
  responsible: FreightPaymentResponsibleSummary,
  transportType: FreightPaymentTransportType,
  fromDate: string,
  toDate: string,
): void {
  const readyFreights = responsible.fretes.filter((item) => item.pronto_para_pagamento);
  const freightRows = readyFreights
    .map(
      (f) => `<tr>
        <td>${escapeHtml(formatShortDate(f.data_servico))}</td>
        <td>${escapeHtml(f.rota_cidade || "—")}${f.nome_motorista_transportadora ? ` · ${escapeHtml(f.nome_motorista_transportadora)}` : ""}</td>
        <td class="r">${escapeHtml(formatMoney(f.valor_frete_bruto))}</td>
        <td class="r">${escapeHtml(formatMoney(f.valor_avaria))}</td>
        <td class="r"><b>${escapeHtml(formatMoney(f.valor_frete_pago))}</b></td>
      </tr>`,
    )
    .join("");
  const adjRows = responsible.ajustes
    .map(
      (a) => `<tr>
        <td>${escapeHtml(formatShortDate(a.data_referencia))}</td>
        <td>${escapeHtml(a.descricao)}${a.observacao ? ` (${escapeHtml(a.observacao)})` : ""}</td>
        <td class="r">${a.natureza === "ACRESCIMO" ? escapeHtml(formatMoney(a.valor)) : ""}</td>
        <td class="r">${a.natureza === "DESCONTO" ? escapeHtml(formatMoney(a.valor)) : ""}</td>
        <td class="r"><b>${a.natureza === "DESCONTO" ? "-" : "+"}${escapeHtml(formatMoney(a.valor))}</b></td>
      </tr>`,
    )
    .join("");

  const statusText = responsible.status_pagamento === "PAGO"
    ? `PAGO em ${formatShortDate(responsible.data_pagamento_mais_recente)}`
    : responsible.status_pagamento === "SOLICITADO"
      ? "SOLICITADO AO FINANCEIRO"
      : responsible.status_pagamento === "PARCIAL"
        ? `PARCIAL (Pago ${formatMoney(responsible.valor_pago)} · Em aberto ${formatMoney(responsible.valor_em_aberto)})`
        : "EM ABERTO";

  const html = `<!doctype html>
  <html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo — ${escapeHtml(responsible.nome_transportador)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 11px; margin: 0; }
    .box { border: 1.5px solid #203351; border-radius: 6px; padding: 16px 18px; }
    .top { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #203351; padding-bottom: 10px; margin-bottom: 12px; }
    .top h1 { margin: 0; font-size: 15px; color: #203351; }
    .top small { color: #475569; display: block; margin-top: 2px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px; margin-bottom: 12px; }
    .grid span { display: block; font-size: 9px; text-transform: uppercase; color: #64748b; }
    .grid b { font-size: 11px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; }
    th { background: #203351; color: #fff; text-align: left; font-size: 10px; }
    .r { text-align: right; white-space: nowrap; }
    tfoot td { background: #f1f5f9; font-weight: bold; }
    .total-row td { background: #e2e8f0; font-size: 12px; }
    .decl { font-size: 10px; color: #334155; margin: 14px 0 26px; line-height: 1.5; }
    .sig { display: grid; grid-template-columns: 1fr 2fr; gap: 32px; margin-top: 24px; text-align: center; }
    .sig div { border-top: 1px solid #475569; padding-top: 4px; font-size: 9px; color: #475569; }
  </style></head><body>
  <div class="box">
    <div class="top">
      <div><h1>DEMONSTRATIVO / RECIBO DE PAGAMENTO DE FRETES</h1><small>Vilarejo Logística — Setor de Transporte (${transportType === "AGREGADO" ? "Agregado" : "Transportadora independente"})</small></div>
      <div style="text-align:right"><b>${escapeHtml(formatShortDate(fromDate))} a ${escapeHtml(formatShortDate(toDate))}</b><small>${escapeHtml(statusText)}</small></div>
    </div>
    <div class="grid">
      <div><span>Responsável</span><b>${escapeHtml(responsible.nome_transportador)}</b></div>
      <div><span>CPF / CNPJ</span><b>${escapeHtml(responsible.documento_fiscal || "—")}</b></div>
      <div><span>Chave PIX / Conta</span><b>${escapeHtml(responsible.chave_pix || "—")}</b></div>
      <div><span>Fretes / Dias</span><b>${readyFreights.length} frete(s) · ${responsible.quantidade_dias} dia(s)</b></div>
      <div><span>Nota Fiscal</span><b>${escapeHtml(responsible.ultimo_pagamento?.nf_numero || (responsible.exige_nota_fiscal ? "Pendente" : "Dispensada"))}</b></div>
      <div><span>Emitido em</span><b>${escapeHtml(new Date().toLocaleDateString("pt-BR"))}</b></div>
    </div>
    <table>
      <thead><tr><th style="width:14%">Data</th><th>Serviço / Rota / Ajuste</th><th class="r" style="width:16%">Bruto / Acrésc.</th><th class="r" style="width:16%">Avaria / Desc.</th><th class="r" style="width:18%">Líquido</th></tr></thead>
      <tbody>${freightRows}${adjRows}</tbody>
      <tfoot>
        <tr><td colspan="2" class="r">Subtotais de fretes e ajustes</td><td class="r">${escapeHtml(formatMoney(responsible.valor_frete_bruto))}</td><td class="r">${escapeHtml(formatMoney(responsible.valor_avarias))}</td><td class="r">${escapeHtml(formatMoney(responsible.valor_liquido_total))}</td></tr>
        <tr class="total-row"><td colspan="4" class="r">VALOR LÍQUIDO TOTAL DO PERÍODO</td><td class="r">${escapeHtml(formatMoney(responsible.valor_liquido_total))}</td></tr>
      </tfoot>
    </table>
    <div class="decl">Declaro conferência dos serviços de frete, descontos de avaria e ajustes discriminados neste demonstrativo referente ao período de <b>${escapeHtml(formatShortDate(fromDate))}</b> a <b>${escapeHtml(formatShortDate(toDate))}</b>${responsible.ultimo_pagamento?.nf_numero ? `, vinculado à Nota Fiscal nº <b>${escapeHtml(responsible.ultimo_pagamento.nf_numero)}</b>` : ""}.</div>
    <div class="sig"><div>DATA</div><div>ASSINATURA DO RESPONSÁVEL (${escapeHtml(responsible.nome_transportador)})</div></div>
  </div></body></html>`;

  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 1500);
    }, 150);
  } else {
    frame.remove();
  }
}

export function PaymentReceiptModal({
  responsible,
  transportType,
  fromDate,
  toDate,
  onClose,
  onCopyText,
}: Props) {
  const readyFreights = responsible.fretes.filter((item) => item.pronto_para_pagamento);
  const whatsappText = buildWhatsappSummary(responsible, transportType, fromDate, toDate);

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
        aria-labelledby="receipt-dialog-title"
      >
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div>
            <p className={cx(styles, commonStyles, "eyebrow")}>EXTRATO E RECIBO INDIVIDUAL</p>
            <h2 id="receipt-dialog-title">
              {responsible.nome_transportador}{" "}
              <span>
                · {formatShortDate(fromDate)} a {formatShortDate(toDate)}
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
          <div className={cx(styles, "receipt-preview")}>
            <div className={cx(styles, "receipt-header")}>
              <div>
                <strong>Demonstrativo de pagamento de fretes</strong>
                <small>
                  {transportType === "AGREGADO" ? "Agregado" : "Transportadora independente"} ·{" "}
                  {readyFreights.length} frete(s) · {responsible.quantidade_dias}{" "}
                  {responsible.quantidade_dias === 1 ? "dia" : "dias"}
                </small>
              </div>
              <strong className={cx(styles, "receipt-total")}>
                {formatMoney(responsible.valor_liquido_total)}
              </strong>
            </div>

            <div className={cx(styles, "receipt-info-grid")}>
              <div>
                <span>CPF / CNPJ</span>
                <strong>{responsible.documento_fiscal || "—"}</strong>
              </div>
              <div>
                <span>PIX / Conta</span>
                <strong>{responsible.chave_pix || "—"}</strong>
              </div>
              <div>
                <span>Nota Fiscal</span>
                <strong>
                  {responsible.ultimo_pagamento?.nf_numero ||
                    (responsible.exige_nota_fiscal ? "Pendente" : "Dispensada")}
                </strong>
              </div>
            </div>

            <table className={cx(styles, commonStyles, "data-table", "detail-freights-table")}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Rota / lançamento</th>
                  <th>Bruto / Acrésc.</th>
                  <th>Avaria / Desc.</th>
                  <th>Líquido</th>
                </tr>
              </thead>
              <tbody>
                {readyFreights.map((f) => (
                  <tr key={f.codigo_frete}>
                    <td>{formatShortDate(f.data_servico)}</td>
                    <td>
                      <strong>{f.rota_cidade || "—"}</strong>
                      {f.nome_motorista_transportadora && (
                        <small>{f.nome_motorista_transportadora}</small>
                      )}
                    </td>
                    <td>{formatMoney(f.valor_frete_bruto)}</td>
                    <td>{formatMoney(f.valor_avaria)}</td>
                    <td>
                      <strong>{formatMoney(f.valor_frete_pago)}</strong>
                    </td>
                  </tr>
                ))}
                {responsible.ajustes.map((a) => (
                  <tr key={a.codigo_ajuste}>
                    <td>{formatShortDate(a.data_referencia)}</td>
                    <td>
                      <strong>{a.descricao}</strong>
                      {a.observacao && <small>{a.observacao}</small>}
                    </td>
                    <td>{a.natureza === "ACRESCIMO" ? formatMoney(a.valor) : "—"}</td>
                    <td>{a.natureza === "DESCONTO" ? formatMoney(a.valor) : "—"}</td>
                    <td>
                      <strong>
                        {a.natureza === "DESCONTO" ? "-" : "+"}
                        {formatMoney(a.valor)}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={cx(styles, commonStyles, "dialog-footer")}>
          <span>Use “Imprimir / Salvar PDF” para gerar o recibo em A4 com espaço para assinatura.</span>
          <div className={cx(styles, commonStyles, "dialog-actions")}>
            <button
              type="button"
              className={cx(styles, commonStyles, "button button-secondary")}
              onClick={() => onCopyText(whatsappText, "Resumo para WhatsApp")}
            >
              Copiar p/ WhatsApp
            </button>
            <button
              type="button"
              className={cx(styles, commonStyles, "button button-primary")}
              onClick={() => printReceiptDocument(responsible, transportType, fromDate, toDate)}
            >
              Imprimir / Salvar PDF
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
