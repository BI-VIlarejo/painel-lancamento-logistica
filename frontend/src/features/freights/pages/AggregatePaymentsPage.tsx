import { useCallback, useEffect, useMemo, useState } from "react";
import { freightsApi } from "../api";
import {
  addDaysIso,
  currentFortnightRange,
  currentMonthRange,
  formatDate,
  formatMoney,
  formatShortDate,
  previousWeekRange,
  weekRangeForDate,
} from "../format";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type {
  FreightPaymentAdjustmentCreateInput,
  FreightPaymentAdjustmentItem,
  FreightPaymentFilters,
  FreightPaymentInvoiceUpdateInput,
  FreightPaymentOptions,
  FreightPaymentReport,
  FreightPaymentResponsibleSummary,
  FreightPaymentSettlementSummary,
  FreightPaymentTransportType,
  PaymentSettlementStatus,
} from "../types";
import {
  InvoiceDialog,
  NewAdjustmentDialog,
  ReverseSettlementDialog,
  SettlePaymentDialog,
} from "../components/PaymentActionDialogs";
import { PaymentReceiptModal } from "../components/PaymentReceiptModal";
import { PaymentResponsibleDetailModal } from "../components/PaymentResponsibleDetailModal";
import styles from "./AggregatePaymentsPage.module.css";

type Props = {
  canExport: boolean;
  canViewFreights: boolean;
  canViewDashboard: boolean;
  canEditFreights: boolean;
  onNavigate: (path: string) => void;
};

type PaymentSubTab = "fechamento" | "ajustes" | "historico";
type StatusFilter = "TODOS" | "FALTA_PAGAR" | "SOLICITADO" | "PAGO" | "PENDENCIA" | "NF_PENDENTE";
type PeriodPreset = "SEMANA_ATUAL" | "SEMANA_PASSADA" | "QUINZENA" | "MES_ATUAL" | "PERSONALIZADO";

const UNIDENTIFIED = "__SEM_IDENTIFICACAO__";

const ADJUSTMENT_CATEGORY_LABELS: Record<string, string> = {
  VALE: "Vale",
  ADIANTAMENTO: "Adiantamento",
  BONUS: "Bônus",
  PEDAGIO: "Pedágio",
  DESCONTO: "Desconto",
  OUTRO: "Outro",
};

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function safeFilePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function responsibleList(
  options: FreightPaymentOptions | null,
  type: FreightPaymentTransportType,
): string[] {
  if (!options) return [];
  return type === "AGREGADO" ? options.agregados : options.transportadoras;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function statusPillInfo(item: FreightPaymentResponsibleSummary): {
  label: string;
  tone: string;
  rowClass: string;
} {
  if (item.status_pagamento === "PENDENTE_CONFERENCIA") {
    return {
      label: `Pendência (${item.quantidade_fretes_pendentes})`,
      tone: "pill-danger",
      rowClass: "row-danger",
    };
  }
  if (item.status_pagamento === "PAGO") {
    return {
      label: item.data_pagamento_mais_recente
        ? `Pago ${formatShortDate(item.data_pagamento_mais_recente)}`
        : "Pago",
      tone: "pill-paid",
      rowClass: "row-paid",
    };
  }
  if (item.status_pagamento === "SOLICITADO") {
    return {
      label: "Solicitado",
      tone: "pill-requested",
      rowClass: "row-requested",
    };
  }
  if (item.status_pagamento === "PARCIAL") {
    return {
      label: "Parcial",
      tone: "pill-partial",
      rowClass: "row-open",
    };
  }
  return {
    label: "A pagar",
    tone: "pill-open",
    rowClass: "row-open",
  };
}

/** Gestão completa de fechamento financeiro, baixas, NF, recibos e ajustes de Fretes. */
export function AggregatePaymentsPage({
  canExport,
  canViewFreights,
  canViewDashboard,
  canEditFreights,
  onNavigate,
}: Props) {
  const initialWeek = useMemo(() => weekRangeForDate(), []);
  const [activeTab, setActiveTab] = useState<PaymentSubTab>("fechamento");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("SEMANA_ATUAL");
  const [fromDate, setFromDate] = useState(initialWeek.from);
  const [toDate, setToDate] = useState(initialWeek.to);
  const [transportType, setTransportType] = useState<FreightPaymentTransportType>("AGREGADO");
  const [responsible, setResponsible] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("TODOS");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const [options, setOptions] = useState<FreightPaymentOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");

  const [report, setReport] = useState<FreightPaymentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  // Histórico de fechamentos
  const [historyStatusFilter, setHistoryStatusFilter] = useState<PaymentSettlementStatus | "TODOS">("TODOS");
  const [historyItems, setHistoryItems] = useState<FreightPaymentSettlementSummary[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  // Modais
  const [detailTarget, setDetailTarget] = useState<FreightPaymentResponsibleSummary | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<FreightPaymentResponsibleSummary | null>(null);
  const [settleModal, setSettleModal] = useState<{
    action: "SOLICITAR" | "MARCAR_PAGO";
    targets: FreightPaymentResponsibleSummary[];
  } | null>(null);
  const [invoiceTarget, setInvoiceTarget] = useState<FreightPaymentSettlementSummary | null>(null);
  const [reverseTarget, setReverseTarget] = useState<FreightPaymentSettlementSummary | null>(null);
  const [showAdjustmentDialog, setShowAdjustmentDialog] = useState(false);
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const notifyPaymentsUpdated = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} copiado para a área de transferência.`);
    } catch {
      window.prompt(`Copie o texto (${label}):`, text);
    }
  }, []);

  const copyNfChargeMessage = useCallback(
    (name: string, periodFrom: string, periodTo: string, amount: string | number) => {
      const firstName = name.split(" ")[0] || name;
      const msg = `Olá, ${firstName}! Para liberarmos o pagamento de fretes referente ao período de ${formatShortDate(periodFrom)} a ${formatShortDate(periodTo)} (${formatMoney(amount)}), por favor envie a Nota Fiscal correspondente. Obrigado!`;
      void copyToClipboard(msg, "Mensagem de cobrança de NF");
    },
    [copyToClipboard],
  );

  const applyPreset = (preset: Exclude<PeriodPreset, "PERSONALIZADO">) => {
    const range =
      preset === "SEMANA_ATUAL"
        ? weekRangeForDate()
        : preset === "SEMANA_PASSADA"
          ? previousWeekRange()
          : preset === "QUINZENA"
            ? currentFortnightRange()
            : currentMonthRange();
    setPeriodPreset(preset);
    setFromDate(range.from);
    setToDate(range.to);
    setResponsible("");
    setSelectedKeys([]);
  };

  const shiftWeek = (direction: -1 | 1) => {
    const base = weekRangeForDate(new Date(`${fromDate}T12:00:00`));
    const shiftedFrom = addDaysIso(base.from, direction * 7);
    const shiftedTo = addDaysIso(base.to, direction * 7);
    const currentWeek = weekRangeForDate();
    const prevWeek = previousWeekRange();
    setFromDate(shiftedFrom);
    setToDate(shiftedTo);
    setPeriodPreset(
      shiftedFrom === currentWeek.from && shiftedTo === currentWeek.to
        ? "SEMANA_ATUAL"
        : shiftedFrom === prevWeek.from && shiftedTo === prevWeek.to
          ? "SEMANA_PASSADA"
          : "PERSONALIZADO",
    );
    setResponsible("");
    setSelectedKeys([]);
  };

  // Carrega opções de responsáveis no período
  useEffect(() => {
    let active = true;
    if (!fromDate || !toDate || fromDate > toDate) {
      setOptions(null);
      setOptionsLoading(false);
      setOptionsError("");
      return () => {
        active = false;
      };
    }
    setOptionsLoading(true);
    setOptionsError("");
    void freightsApi
      .paymentOptions(fromDate, toDate)
      .then((result) => {
        if (!active) return;
        setOptions(result);
        setResponsible((current) => {
          if (current === UNIDENTIFIED) {
            return transportType === "AGREGADO" && result.agregados_sem_identificacao
              ? current
              : "";
          }
          return current && responsibleList(result, transportType).includes(current)
            ? current
            : "";
        });
      })
      .catch((loadError: unknown) => {
        if (active) setOptionsError(messageFromApiError(loadError));
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fromDate, toDate, transportType, reloadVersion]);

  // Carrega relatório principal (breakdown por responsável + execução + ajustes)
  useEffect(() => {
    let active = true;
    if (!fromDate || !toDate || fromDate > toDate) {
      setError(
        fromDate && toDate
          ? "A data inicial deve ser anterior à data final."
          : "Informe a data inicial e a data final.",
      );
      setLoading(false);
      setReport(null);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError("");
    const filters: FreightPaymentFilters = {
      data_de: fromDate,
      data_ate: toDate,
      tipo_transporte: transportType,
      ...(responsible === UNIDENTIFIED
        ? { sem_identificacao: true }
        : responsible
          ? { nome_transportador: responsible }
          : {}),
    };
    void freightsApi
      .paymentReport(filters)
      .then((result) => {
        if (!active) return;
        setReport(result);
        setSelectedKeys((current) => {
          const valid = new Set((result.responsaveis ?? []).map((r) => r.chave_responsavel));
          return current.filter((key) => valid.has(key));
        });
        setDetailTarget((current) =>
          current
            ? (result.responsaveis ?? []).find(
                (item) => item.chave_responsavel === current.chave_responsavel,
              ) ?? null
            : null,
        );
      })
      .catch((loadError: unknown) => {
        if (active) setError(messageFromApiError(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fromDate, toDate, transportType, responsible, reloadVersion]);

  // Carrega histórico de fechamentos quando a aba Histórico está ativa
  useEffect(() => {
    if (activeTab !== "historico") return;
    let active = true;
    setHistoryLoading(true);
    setHistoryError("");
    void freightsApi
      .listPaymentSettlements({
        tipo_transporte: transportType,
        ...(historyStatusFilter !== "TODOS" ? { status_pagamento: historyStatusFilter } : {}),
        ...(responsible && responsible !== UNIDENTIFIED ? { nome_transportador: responsible } : {}),
        incluir_estornados: true,
        limit: 100,
        offset: 0,
      })
      .then((page) => {
        if (!active) return;
        setHistoryItems(page.items);
        setHistoryTotal(page.total);
      })
      .catch((loadError: unknown) => {
        if (active) setHistoryError(messageFromApiError(loadError));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, transportType, historyStatusFilter, responsible, reloadVersion]);

  const responsaveis = useMemo(() => report?.responsaveis ?? [], [report]);
  const adjustments = useMemo(() => report?.ajustes ?? [], [report]);
  const summary = report?.resumo_execucao;

  const visibleResponsaveis = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase("pt-BR");
    return responsaveis.filter((item) => {
      if (statusFilter === "FALTA_PAGAR") {
        if (!["A_PAGAR", "PARCIAL"].includes(item.status_pagamento)) return false;
      } else if (statusFilter === "SOLICITADO") {
        if (item.status_pagamento !== "SOLICITADO") return false;
      } else if (statusFilter === "PAGO") {
        if (item.status_pagamento !== "PAGO") return false;
      } else if (statusFilter === "PENDENCIA") {
        if (item.status_pagamento !== "PENDENTE_CONFERENCIA" && !item.possui_alteracao) return false;
      } else if (statusFilter === "NF_PENDENTE") {
        if (!item.nf_pendente) return false;
      }
      if (!needle) return true;
      return `${item.nome_transportador} ${item.documento_fiscal ?? ""} ${item.chave_pix ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(needle);
    });
  }, [responsaveis, searchQuery, statusFilter]);

  const selectedResponsaveis = useMemo(
    () => responsaveis.filter((item) => selectedKeys.includes(item.chave_responsavel)),
    [responsaveis, selectedKeys],
  );
  const selectedReady = useMemo(
    () => selectedResponsaveis.filter((item) => item.quantidade_fretes_pendentes === 0),
    [selectedResponsaveis],
  );
  const selectedCanRequest = useMemo(
    () => selectedReady.filter((item) => Number(item.valor_em_aberto) !== 0 || item.quantidade_fretes_em_aberto > 0),
    [selectedReady],
  );
  const selectedCanPay = useMemo(
    () => selectedReady.filter((item) => item.status_pagamento !== "PAGO"),
    [selectedReady],
  );

  const hasPending = Boolean(report?.quantidade_pendentes);
  const canDownloadAll = Boolean(report) && canExport && !loading && !optionsLoading && !hasPending && responsaveis.length > 0;

  const toggleSelectKey = (key: string) => {
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const selectAllOpen = () => {
    const keys = visibleResponsaveis
      .filter((item) => item.quantidade_fretes_pendentes === 0 && item.status_pagamento !== "PAGO")
      .map((item) => item.chave_responsavel);
    setSelectedKeys(keys);
  };

  async function exportXlsx(override?: {
    responsaveis?: string[];
    apenasEmAberto?: boolean;
    codigoPagamento?: string;
    label?: string;
  }) {
    if (!canExport || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const filters: FreightPaymentFilters = override?.codigoPagamento
        ? {
            data_de: fromDate,
            data_ate: toDate,
            tipo_transporte: transportType,
            codigo_pagamento: override.codigoPagamento,
          }
        : {
            data_de: fromDate,
            data_ate: toDate,
            tipo_transporte: transportType,
            ...(responsible === UNIDENTIFIED
              ? { sem_identificacao: true }
              : responsible
                ? { nome_transportador: responsible }
                : {}),
            ...(override?.responsaveis?.length ? { responsaveis: override.responsaveis } : {}),
            ...(override?.apenasEmAberto ? { apenas_em_aberto: true } : {}),
          };
      const blob = await freightsApi.exportPaymentReport(filters);
      const typePart = transportType === "AGREGADO" ? "agregados" : "transportadoras";
      const suffix = override?.label
        ? safeFilePart(override.label)
        : override?.responsaveis?.length
          ? `selecionados-${override.responsaveis.length}`
          : responsible
            ? safeFilePart(responsible === UNIDENTIFIED ? "sem-identificacao" : responsible)
            : "todos";
      const filename = `solicitacao-pagamento-${typePart}-${suffix}-${compactDate(fromDate)}-${compactDate(toDate)}.xlsx`;
      triggerBlobDownload(blob, filename);
    } catch (exportFailure: unknown) {
      setExportError(messageFromApiError(exportFailure));
    } finally {
      setExporting(false);
    }
  }

  async function handleConfirmSettle(formData: {
    data_pagamento: string | null;
    observacao: string | null;
    nf_numero: string | null;
    nf_data: string | null;
    nf_recebida: boolean;
  }) {
    if (!settleModal || actionSaving) return;
    setActionSaving(true);
    setActionError("");
    try {
      const keys = settleModal.targets.map((item) => item.chave_responsavel);
      const onlyUnidentified = keys.length === 1 && keys[0] === UNIDENTIFIED;
      const result = await freightsApi.createPaymentSettlements({
        data_de: fromDate,
        data_ate: toDate,
        tipo_transporte: transportType,
        acao: settleModal.action,
        ...(onlyUnidentified ? { sem_identificacao: true } : { responsaveis: keys }),
        data_pagamento: formData.data_pagamento,
        observacao: formData.observacao,
        incluir_solicitados: true,
        nf_numero: formData.nf_numero,
        nf_data: formData.nf_data,
        nf_recebida: formData.nf_recebida,
      });
      setSettleModal(null);
      setSelectedKeys([]);
      setNotice(
        settleModal.action === "MARCAR_PAGO"
          ? `${result.length} pagamento(s) confirmado(s) como pago.`
          : `${result.length} solicitação(ões) registrada(s) para o financeiro.`,
      );
      notifyPaymentsUpdated();
    } catch (err: unknown) {
      setActionError(messageFromApiError(err));
    } finally {
      setActionSaving(false);
    }
  }

  async function handleSettlementStatusChange(
    settlement: FreightPaymentSettlementSummary,
    acao: "MARCAR_PAGO" | "DESFAZER_PAGO" | "ESTORNAR",
    motivoEstorno?: string,
  ) {
    if (actionSaving) return;
    setActionSaving(true);
    setActionError("");
    try {
      await freightsApi.updatePaymentSettlementStatus(settlement.codigo_pagamento, {
        acao,
        ...(motivoEstorno ? { motivo_estorno: motivoEstorno } : {}),
      });
      setReverseTarget(null);
      setNotice(
        acao === "MARCAR_PAGO"
          ? `Pagamento de ${settlement.nome_transportador} confirmado.`
          : acao === "DESFAZER_PAGO"
            ? `Pagamento de ${settlement.nome_transportador} voltou para Solicitado.`
            : `Fechamento de ${settlement.nome_transportador} estornado; os fretes voltaram para Em aberto.`,
      );
      notifyPaymentsUpdated();
    } catch (err: unknown) {
      const message = messageFromApiError(err);
      if (acao === "ESTORNAR") setActionError(message);
      else setExportError(message);
    } finally {
      setActionSaving(false);
    }
  }

  async function handleSaveInvoice(payload: FreightPaymentInvoiceUpdateInput) {
    if (!invoiceTarget || actionSaving) return;
    setActionSaving(true);
    setActionError("");
    try {
      await freightsApi.updatePaymentSettlementInvoice(invoiceTarget.codigo_pagamento, payload);
      setInvoiceTarget(null);
      setNotice(`Dados de nota fiscal de ${invoiceTarget.nome_transportador} atualizados.`);
      notifyPaymentsUpdated();
    } catch (err: unknown) {
      setActionError(messageFromApiError(err));
    } finally {
      setActionSaving(false);
    }
  }

  async function handleCreateAdjustment(payload: FreightPaymentAdjustmentCreateInput) {
    if (actionSaving) return;
    setActionSaving(true);
    setActionError("");
    try {
      const created = await freightsApi.createPaymentAdjustments(payload);
      setShowAdjustmentDialog(false);
      setNotice(
        created.length > 1
          ? `${created.length} parcelas registradas para ${payload.nome_transportador}.`
          : `Lançamento financeiro salvo para ${payload.nome_transportador}.`,
      );
      notifyPaymentsUpdated();
    } catch (err: unknown) {
      setActionError(messageFromApiError(err));
    } finally {
      setActionSaving(false);
    }
  }

  async function handleDeleteAdjustment(adj: FreightPaymentAdjustmentItem) {
    if (!window.confirm(`Remover "${adj.descricao}" (${formatMoney(adj.valor)}) de ${adj.nome_transportador}?`)) {
      return;
    }
    try {
      await freightsApi.deletePaymentAdjustment(adj.codigo_ajuste);
      setNotice("Lançamento financeiro removido.");
      notifyPaymentsUpdated();
    } catch (err: unknown) {
      setExportError(messageFromApiError(err));
    }
  }

  const responsibleOptions = responsibleList(options, transportType);
  const totalResp = summary?.total_responsaveis ?? responsaveis.length;
  const paidResp = summary?.responsaveis_pagos ?? 0;
  const requestedResp = summary?.responsaveis_solicitados ?? 0;
  const openResp = (summary?.responsaveis_em_aberto ?? 0) + (summary?.responsaveis_parciais ?? 0);
  const pendingResp = summary?.responsaveis_com_pendencia ?? 0;
  const nfPendingCount = summary?.nf_pendentes ?? 0;
  const paidPercent = totalResp > 0 ? Math.round((paidResp / totalResp) * 100) : 0;
  const requestedPercent = totalResp > 0 ? Math.round((requestedResp / totalResp) * 100) : 0;

  const adjustmentTotals = useMemo(() => {
    let adds = 0;
    let subs = 0;
    for (const item of adjustments) {
      const val = Number(item.valor);
      if (item.natureza === "ACRESCIMO") adds += val;
      else subs += val;
    }
    return { adds, subs, net: adds - subs };
  }, [adjustments]);

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "aggregate-payments-page")}>
      <div className={cx(styles, commonStyles, "breadcrumb")}>
        <span>Fretes</span>
        <span aria-hidden="true">/</span>
        <strong>Pagamentos</strong>
      </div>

      <header className={cx(styles, commonStyles, "page-heading-row", "aggregate-heading")}>
        <div>
          <p className={cx(styles, commonStyles, "eyebrow")}>FECHAMENTO FINANCEIRO</p>
          <h1>Pagamentos de transporte</h1>
          <p className={cx(styles, commonStyles, "page-lead")}>
            Acompanhe quem já foi pago na semana, confira fretes, controle notas fiscais, lance vales e gere a solicitação XLSX.
          </p>
        </div>
        <div className={cx(styles, "heading-actions")}>
          {canViewDashboard && canViewFreights && (
            <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/indicadores/transportes")}>
              Painel gerencial
            </button>
          )}
          {canViewFreights && (
            <button
              className={cx(styles, commonStyles, "button button-secondary")}
              type="button"
              onClick={() => onNavigate("/fretes/historico")}
            >
              Histórico de fretes
            </button>
          )}
          {canExport && (
            <button
              className={cx(styles, commonStyles, "button button-secondary")}
              type="button"
              onClick={() => {
                setActionError("");
                setShowAdjustmentDialog(true);
              }}
            >
              + Vale / Ajuste
            </button>
          )}
          {canExport && (
            <button
              className={cx(styles, commonStyles, "button button-primary")}
              type="button"
              onClick={() => {
                void exportXlsx(
                  selectedReady.length > 0
                    ? { responsaveis: selectedReady.map((item) => item.chave_responsavel) }
                    : undefined,
                );
              }}
              disabled={exporting || (selectedReady.length === 0 && !canDownloadAll)}
            >
              {exporting
                ? "Gerando XLSX..."
                : selectedReady.length > 0
                  ? `Baixar XLSX (${selectedReady.length})`
                  : "Baixar solicitação XLSX"}
            </button>
          )}
        </div>
      </header>

      <nav className={cx(styles, "subnav-bar")} aria-label="Visões do módulo de pagamentos">
        <button
          type="button"
          className={cx(styles, "subnav-tab", activeTab === "fechamento" ? "subnav-tab-active" : "")}
          onClick={() => setActiveTab("fechamento")}
        >
          Fechamento do período
          <span className={cx(styles, "subnav-count")}>{totalResp}</span>
        </button>
        <button
          type="button"
          className={cx(styles, "subnav-tab", activeTab === "ajustes" ? "subnav-tab-active" : "")}
          onClick={() => setActiveTab("ajustes")}
        >
          Vales e ajustes
          <span className={cx(styles, "subnav-count")}>{adjustments.length}</span>
        </button>
        <button
          type="button"
          className={cx(styles, "subnav-tab", activeTab === "historico" ? "subnav-tab-active" : "")}
          onClick={() => setActiveTab("historico")}
        >
          Histórico de pagamentos
          {historyTotal > 0 && <span className={cx(styles, "subnav-count")}>{historyTotal}</span>}
        </button>
      </nav>

      <section className={cx(styles, "filter-shell")} aria-label="Filtros do período e modalidade">
        <div className={cx(styles, "period-presets-row")}>
          <div className={cx(styles, "preset-group")}>
            <button
              type="button"
              className={cx(styles, "preset-btn")}
              title="Semana anterior"
              onClick={() => shiftWeek(-1)}
            >
              ◀
            </button>
            <button
              type="button"
              className={cx(styles, "preset-btn", periodPreset === "SEMANA_ATUAL" ? "preset-btn-active" : "")}
              onClick={() => applyPreset("SEMANA_ATUAL")}
            >
              Esta semana
            </button>
            <button
              type="button"
              className={cx(styles, "preset-btn", periodPreset === "SEMANA_PASSADA" ? "preset-btn-active" : "")}
              onClick={() => applyPreset("SEMANA_PASSADA")}
            >
              Semana passada
            </button>
            <button
              type="button"
              className={cx(styles, "preset-btn")}
              title="Próxima semana"
              onClick={() => shiftWeek(1)}
            >
              ▶
            </button>
            <button
              type="button"
              className={cx(styles, "preset-btn", periodPreset === "QUINZENA" ? "preset-btn-active" : "")}
              onClick={() => applyPreset("QUINZENA")}
            >
              Quinzena
            </button>
            <button
              type="button"
              className={cx(styles, "preset-btn", periodPreset === "MES_ATUAL" ? "preset-btn-active" : "")}
              onClick={() => applyPreset("MES_ATUAL")}
            >
              Mês atual
            </button>
          </div>
          <span className={cx(styles, "period-badge")}>
            {formatShortDate(fromDate)} a {formatShortDate(toDate)}
          </span>
        </div>

        <div className={cx(styles, "report-filter")}>
          <label className={cx(styles, commonStyles, "filter-control")}>
            Data inicial
            <input
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                setPeriodPreset("PERSONALIZADO");
                setResponsible("");
              }}
            />
          </label>
          <label className={cx(styles, commonStyles, "filter-control")}>
            Data final
            <input
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value);
                setPeriodPreset("PERSONALIZADO");
                setResponsible("");
              }}
            />
          </label>
          <label className={cx(styles, commonStyles, "filter-control")}>
            Modalidade
            <select
              value={transportType}
              onChange={(event) => {
                setTransportType(event.target.value as FreightPaymentTransportType);
                setResponsible("");
                setSelectedKeys([]);
              }}
            >
              <option value="AGREGADO">Agregados</option>
              <option value="TRANSPORTADORA">Transportadoras independentes</option>
            </select>
          </label>
          <label className={cx(styles, commonStyles, "filter-control")}>
            {transportType === "AGREGADO" ? "Agregado" : "Transportadora"}
            <select
              value={responsible}
              onChange={(event) => setResponsible(event.target.value)}
              disabled={optionsLoading}
            >
              <option value="">
                {transportType === "AGREGADO" ? "Todos os agregados" : "Todas as transportadoras"}
              </option>
              {transportType === "AGREGADO" && options?.agregados_sem_identificacao && (
                <option value={UNIDENTIFIED}>Sem identificação</option>
              )}
              {responsibleOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={cx(styles, commonStyles, "filter-control")}>
            Busca rápida
            <input
              type="search"
              placeholder="Nome, CPF/CNPJ ou PIX..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>
      </section>

      {notice && (
        <div className={cx(styles, commonStyles, "notice notice-success", "toast-banner")} role="status">
          <span>✓ {notice}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {optionsError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{optionsError}</div>}
      {error && (
        <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">
          <span>{error}</span>
          {fromDate && toDate && fromDate <= toDate && (
            <button
              className={cx(styles, commonStyles, "button button-secondary")}
              type="button"
              onClick={() => setReloadVersion((version) => version + 1)}
            >
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {exportError && (
        <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">
          <span>{exportError}</span>
          <button type="button" className={cx(styles, commonStyles, "button button-secondary")} onClick={() => setExportError("")}>
            Fechar
          </button>
        </div>
      )}

      {activeTab === "fechamento" && (
        <>
          {loading ? (
            <div className={cx(styles, commonStyles, "loading-card")}>
              <span className={cx(styles, commonStyles, "spinner spinner-green")} />
              Consolidando pagamentos do período...
            </div>
          ) : (
            report &&
            !error && (
              <>
                {totalResp > 0 && (
                  <section className={cx(styles, "progress-banner")} aria-label="Progresso de pagamentos do período">
                    <div className={cx(styles, "progress-banner-top")}>
                      <span>
                        Progresso do período:{" "}
                        <strong>
                          {paidResp} de {totalResp} pago(s) ({paidPercent}%)
                        </strong>
                        {requestedResp > 0 ? ` · ${requestedResp} solicitado(s) ao financeiro` : ""}
                        {openResp > 0 ? ` · ${openResp} em aberto` : ""}
                        {pendingResp > 0 ? ` · ${pendingResp} com pendência de conferência` : ""}
                      </span>
                      {nfPendingCount > 0 && (
                        <span className={cx(styles, "status-pill", "pill-danger")}>
                          {nfPendingCount} NF pendente(s)
                        </span>
                      )}
                    </div>
                    <div className={cx(styles, "progress-track")}>
                      <div className={cx(styles, "progress-fill-paid")} style={{ width: `${paidPercent}%` }} />
                      <div
                        className={cx(styles, "progress-fill-requested")}
                        style={{ width: `${Math.min(100 - paidPercent, requestedPercent)}%` }}
                      />
                    </div>
                  </section>
                )}

                <section className={cx(styles, "summary-grid")} aria-label="Indicadores financeiros do período">
                  <article className={cx(styles, "summary-card", "summary-paid")}>
                    <span>Pagos no período</span>
                    <strong>{formatMoney(summary?.valor_pago ?? 0)}</strong>
                    <small>
                      {paidResp} de {totalResp} responsável(is) quitado(s)
                    </small>
                  </article>
                  <article className={cx(styles, "summary-card", "summary-open")}>
                    <span>Falta pagar</span>
                    <strong>{formatMoney(summary?.valor_em_aberto ?? report.valor_a_pagar)}</strong>
                    <small>
                      {openResp} em aberto · {formatMoney(summary?.valor_solicitado ?? 0)} solicitado(s)
                    </small>
                  </article>
                  <article
                    className={cx(
                      styles,
                      "summary-card",
                      hasPending || (summary?.responsaveis_com_alteracao ?? 0) > 0 || nfPendingCount > 0
                        ? "summary-alert"
                        : "",
                    )}
                  >
                    <span>Alertas e pendências</span>
                    <strong>
                      {(report.quantidade_pendentes + (summary?.responsaveis_com_alteracao ?? 0) + nfPendingCount).toLocaleString("pt-BR")}
                    </strong>
                    <small>
                      {report.quantidade_pendentes} frete(s) pendente(s) · {nfPendingCount} NF(s) pendente(s)
                    </small>
                  </article>
                  <article className={cx(styles, "summary-card", "summary-payable")}>
                    <span>Total líquido do período</span>
                    <strong>{formatMoney(report.valor_a_pagar)}</strong>
                    <small>
                      Bruto {formatMoney(report.valor_frete_bruto)} · Avarias -{formatMoney(report.valor_avarias)}
                      {Number(summary?.valor_ajustes ?? 0) !== 0
                        ? ` · Ajustes ${formatMoney(summary?.valor_ajustes ?? 0)}`
                        : ""}
                    </small>
                  </article>
                </section>

                <section className={cx(styles, "report-card")} aria-label="Fechamento por responsável">
                  <header>
                    <div>
                      <h2>
                        {transportType === "AGREGADO"
                          ? "Agregados no período"
                          : "Transportadoras independentes no período"}
                      </h2>
                      <p>
                        Pendentes e em aberto ficam no topo; quem já foi pago desce para o final. Clique no nome para conferir os fretes.
                      </p>
                    </div>
                    {canExport && hasPending && selectedReady.length === 0 && (
                      <span className={cx(styles, "export-blocked")}>
                        Selecione apenas responsáveis sem pendência para exportar o XLSX parcial
                      </span>
                    )}
                  </header>

                  <div className={cx(styles, "table-toolbar")}>
                    <div className={cx(styles, "status-chip-group")} role="group" aria-label="Filtrar por situação">
                      {(
                        [
                          ["TODOS", `Todos (${responsaveis.length})`],
                          ["FALTA_PAGAR", `Falta pagar (${openResp})`],
                          ["SOLICITADO", `Solicitados (${requestedResp})`],
                          ["PAGO", `Pagos (${paidResp})`],
                          ["PENDENCIA", `Com pendência (${pendingResp + (summary?.responsaveis_com_alteracao ?? 0)})`],
                          ["NF_PENDENTE", `NF pendente (${nfPendingCount})`],
                        ] as const
                      ).map(([code, label]) => (
                        <button
                          key={code}
                          type="button"
                          className={cx(
                            styles,
                            "status-chip",
                            statusFilter === code ? "status-chip-active" : "",
                          )}
                          onClick={() => setStatusFilter(code)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {canExport && responsaveis.length > 0 && (
                      <div className={cx(styles, "preset-group")}>
                        <button type="button" className={cx(styles, "mini-action")} onClick={selectAllOpen}>
                          Selecionar a pagar
                        </button>
                        {selectedKeys.length > 0 && (
                          <button
                            type="button"
                            className={cx(styles, "mini-action")}
                            onClick={() => setSelectedKeys([])}
                          >
                            Limpar seleção
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {canExport && selectedResponsaveis.length > 0 && (
                    <div className={cx(styles, "batch-bar")}>
                      <span>
                        <strong>{selectedResponsaveis.length}</strong> selecionado(s) · Total em aberto/solicitado:{" "}
                        <strong>
                          {formatMoney(
                            selectedReady.reduce(
                              (sum, item) => sum + Number(item.valor_em_aberto) + Number(item.valor_solicitado),
                              0,
                            ),
                          )}
                        </strong>
                      </span>
                      <div className={cx(styles, "batch-bar-actions")}>
                        <button
                          type="button"
                          className={cx(styles, "mini-action")}
                          disabled={exporting || selectedReady.length === 0}
                          onClick={() =>
                            void exportXlsx({
                              responsaveis: selectedReady.map((item) => item.chave_responsavel),
                              apenasEmAberto: true,
                            })
                          }
                        >
                          Baixar XLSX (só em aberto)
                        </button>
                        <button
                          type="button"
                          className={cx(styles, "mini-action")}
                          disabled={selectedCanRequest.length === 0}
                          onClick={() => {
                            setActionError("");
                            setSettleModal({ action: "SOLICITAR", targets: selectedCanRequest });
                          }}
                        >
                          Solicitar ({selectedCanRequest.length})
                        </button>
                        <button
                          type="button"
                          className={cx(styles, "mini-action", "mini-action-primary")}
                          disabled={selectedCanPay.length === 0}
                          onClick={() => {
                            setActionError("");
                            setSettleModal({ action: "MARCAR_PAGO", targets: selectedCanPay });
                          }}
                        >
                          ✔ Marcar pagos ({selectedCanPay.length})
                        </button>
                      </div>
                    </div>
                  )}

                  {visibleResponsaveis.length === 0 ? (
                    <div className={cx(styles, "empty-report")}>
                      <span className={cx(styles, commonStyles, "empty-state-icon")}>＋</span>
                      <div>
                        <strong>Nenhum responsável neste filtro</strong>
                        <p>Altere o período, a modalidade ou o filtro de situação.</p>
                      </div>
                    </div>
                  ) : (
                    <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Pagamentos por responsável" tabIndex={0}>
                      <table className={cx(styles, commonStyles, "data-table", "report-table")}>
                        <thead>
                          <tr>
                            {canExport && <th className={cx(styles, "chk-col")} aria-label="Selecionar" />}
                            <th>Responsável / dados de pagamento</th>
                            <th className={cx(styles, "num")}>Dias / fretes</th>
                            <th className={cx(styles, "num")}>Bruto</th>
                            <th className={cx(styles, "num")}>Avarias / ajustes</th>
                            <th className={cx(styles, "num")}>Líquido</th>
                            <th>Situação / NF</th>
                            <th className={cx(styles, "num")}>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleResponsaveis.map((item) => {
                            const pill = statusPillInfo(item);
                            const isChecked = selectedKeys.includes(item.chave_responsavel);
                            const canSelect = item.quantidade_fretes_pendentes === 0;
                            const lastPayment = item.ultimo_pagamento;
                            return (
                              <tr key={item.chave_responsavel} className={cx(styles, pill.rowClass)}>
                                {canExport && (
                                  <td className={cx(styles, "chk-col")}>
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={!canSelect}
                                      title={
                                        canSelect
                                          ? `Selecionar ${item.nome_transportador}`
                                          : "Resolva as pendências deste responsável antes de selecionar"
                                      }
                                      onChange={() => toggleSelectKey(item.chave_responsavel)}
                                    />
                                  </td>
                                )}
                                <td className={cx(styles, "responsible-cell")}>
                                  <button
                                    type="button"
                                    className={cx(styles, "responsible-name-btn")}
                                    onClick={() => setDetailTarget(item)}
                                  >
                                    {item.nome_transportador}
                                  </button>
                                  <div className={cx(styles, "responsible-meta")}>
                                    <span>{item.documento_fiscal || "Sem CPF/CNPJ"}</span>
                                    {item.chave_pix && (
                                      <button
                                        type="button"
                                        className={cx(styles, "pix-copy-btn")}
                                        title={`PIX: ${item.chave_pix}`}
                                        onClick={() =>
                                          void copyToClipboard(item.chave_pix || "", `PIX de ${item.nome_transportador}`)
                                        }
                                      >
                                        Copiar PIX
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className={cx(styles, "num")}>
                                  <strong>
                                    {item.quantidade_dias} {item.quantidade_dias === 1 ? "dia" : "dias"}
                                  </strong>
                                  <span className={cx(styles, "sub-value")}>
                                    {item.quantidade_fretes} frete(s)
                                  </span>
                                </td>
                                <td className={cx(styles, "num")}>{formatMoney(item.valor_frete_bruto)}</td>
                                <td className={cx(styles, "num")}>
                                  <span>-{formatMoney(item.valor_avarias)}</span>
                                  {Number(item.valor_ajustes_liquido) !== 0 && (
                                    <span className={cx(styles, "sub-value")}>
                                      Ajustes: {formatMoney(item.valor_ajustes_liquido)}
                                    </span>
                                  )}
                                </td>
                                <td className={cx(styles, "num")}>
                                  <strong>{formatMoney(item.valor_liquido_total)}</strong>
                                  {item.status_pagamento === "PARCIAL" && (
                                    <>
                                      <span className={cx(styles, "sub-value", "sub-value-paid")}>
                                        Pago: {formatMoney(item.valor_pago)}
                                      </span>
                                      <span className={cx(styles, "sub-value", "sub-value-open")}>
                                        Falta: {formatMoney(item.valor_em_aberto)}
                                      </span>
                                    </>
                                  )}
                                </td>
                                <td>
                                  <div className={cx(styles, "pill-stack")}>
                                    <span className={cx(styles, "status-pill", pill.tone)}>
                                      {pill.label}
                                    </span>
                                    {item.possui_alteracao && (
                                      <span
                                        className={cx(styles, "status-pill", "pill-danger")}
                                        title={item.motivo_alteracao || "Alteração detectada após o fechamento"}
                                      >
                                        Alterado
                                      </span>
                                    )}
                                    {item.exige_nota_fiscal && (
                                      <span
                                        className={cx(
                                          styles,
                                          "status-pill",
                                          lastPayment?.nf_recebida ? "pill-paid" : "pill-danger",
                                        )}
                                      >
                                        {lastPayment?.nf_recebida
                                          ? `NF ${lastPayment.nf_numero || "OK"}`
                                          : "NF pendente"}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className={cx(styles, "num")}>
                                  <div className={cx(styles, "row-actions")}>
                                    <button
                                      type="button"
                                      className={cx(styles, "mini-action")}
                                      onClick={() => setDetailTarget(item)}
                                    >
                                      Fretes
                                    </button>
                                    <button
                                      type="button"
                                      className={cx(styles, "mini-action")}
                                      onClick={() => setReceiptTarget(item)}
                                    >
                                      Recibo
                                    </button>
                                    {item.nf_pendente && (
                                      <button
                                        type="button"
                                        className={cx(styles, "mini-action")}
                                        onClick={() =>
                                          copyNfChargeMessage(
                                            item.nome_transportador,
                                            fromDate,
                                            toDate,
                                            item.valor_liquido_total,
                                          )
                                        }
                                      >
                                        Cobrar NF
                                      </button>
                                    )}
                                    {canExport && lastPayment && (
                                      <button
                                        type="button"
                                        className={cx(styles, "mini-action")}
                                        onClick={() => {
                                          setActionError("");
                                          setInvoiceTarget(lastPayment);
                                        }}
                                      >
                                        NF
                                      </button>
                                    )}
                                    {canExport &&
                                      canSelect &&
                                      (item.status_pagamento === "A_PAGAR" || item.status_pagamento === "PARCIAL") && (
                                        <button
                                          type="button"
                                          className={cx(styles, "mini-action")}
                                          onClick={() => {
                                            setActionError("");
                                            setSettleModal({ action: "SOLICITAR", targets: [item] });
                                          }}
                                        >
                                          Solicitar
                                        </button>
                                      )}
                                    {canExport && canSelect && item.status_pagamento !== "PAGO" && (
                                      <button
                                        type="button"
                                        className={cx(styles, "mini-action", "mini-action-primary")}
                                        onClick={() => {
                                          setActionError("");
                                          setSettleModal({ action: "MARCAR_PAGO", targets: [item] });
                                        }}
                                      >
                                        ✔ Marcar pago
                                      </button>
                                    )}
                                    {canExport && item.status_pagamento === "PAGO" && lastPayment && (
                                      <button
                                        type="button"
                                        className={cx(styles, "mini-action")}
                                        onClick={() =>
                                          void handleSettlementStatusChange(lastPayment, "DESFAZER_PAGO")
                                        }
                                      >
                                        Desfazer pago
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <th colSpan={canExport ? 3 : 2}>
                              Total listado ({visibleResponsaveis.length} responsável(is))
                            </th>
                            <td className={cx(styles, "num")}>
                              {formatMoney(
                                visibleResponsaveis.reduce(
                                  (sum, r) => sum + Number(r.valor_frete_bruto),
                                  0,
                                ),
                              )}
                            </td>
                            <td className={cx(styles, "num")}>
                              -{formatMoney(
                                visibleResponsaveis.reduce(
                                  (sum, r) => sum + Number(r.valor_avarias),
                                  0,
                                ),
                              )}
                            </td>
                            <td className={cx(styles, "num")}>
                              {formatMoney(
                                visibleResponsaveis.reduce(
                                  (sum, r) => sum + Number(r.valor_liquido_total),
                                  0,
                                ),
                              )}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>

                {hasPending && report.pendencias && (
                  <section className={cx(styles, "pending-card")} aria-labelledby="payment-pending-heading">
                    <h2 id="payment-pending-heading">
                      Fretes que precisam de correção ({report.pendencias.length})
                    </h2>
                    <p>
                      Esses fretes bloqueiam apenas o responsável correspondente. Corrija para liberar o fechamento dele.
                    </p>
                    <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Detalhes dos fretes pendentes" tabIndex={0}>
                      <table className={cx(styles, commonStyles, "data-table", "pending-table")}>
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Responsável / rota</th>
                            <th>Motivo da pendência</th>
                            <th>Valores do frete</th>
                            {canEditFreights && <th>Ação</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {report.pendencias.map((item) => (
                            <tr key={item.codigo_frete}>
                              <td>{formatDate(item.data_servico)}</td>
                              <td>
                                <strong>{item.nome_transportador || "Sem identificação"}</strong>
                                <small>{item.rota_cidade || "Rota não informada"}</small>
                              </td>
                              <td>{item.motivo_pendencia}</td>
                              <td>
                                <small>
                                  Bruto: {item.valor_frete_bruto === null ? "Não informado" : formatMoney(item.valor_frete_bruto)}
                                </small>
                                <small>Avaria: {formatMoney(item.valor_avaria)}</small>
                                <small>
                                  Líquido: {item.valor_frete_pago === null ? "Não informado" : formatMoney(item.valor_frete_pago)}
                                </small>
                              </td>
                              {canEditFreights && (
                                <td>
                                  <button
                                    type="button"
                                    className={cx(styles, commonStyles, "button button-secondary", "warning-action")}
                                    onClick={() => onNavigate(`/fretes/${encodeURIComponent(item.codigo_frete)}`)}
                                  >
                                    Corrigir
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {Boolean(report.avisos?.length) && (
                  <section className={cx(styles, "informational-card")} aria-labelledby="payment-warning-heading">
                    <h2 id="payment-warning-heading">
                      Dados ausentes no histórico · não bloqueiam o pagamento
                    </h2>
                    <p>
                      Os valores calculados ou líquidos informados são mantidos. Os campos abaixo só serão necessários se for preciso recalcular pela tarifa.
                    </p>
                    <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Dados informativos ausentes" tabIndex={0}>
                      <table className={cx(styles, commonStyles, "data-table", "pending-table")}>
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Responsável / rota</th>
                            <th>Campos não informados</th>
                            <th>Observação</th>
                            {canEditFreights && <th>Ação</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {report.avisos?.map((item) => (
                            <tr key={item.codigo_frete}>
                              <td>{formatDate(item.data_servico)}</td>
                              <td>
                                <strong>{item.nome_transportador || "Sem identificação"}</strong>
                                <small>{item.rota_cidade || "Rota não informada"}</small>
                              </td>
                              <td>{item.campos_ausentes.join(", ")}</td>
                              <td>{item.motivo_aviso}</td>
                              {canEditFreights && (
                                <td>
                                  <button
                                    type="button"
                                    className={cx(styles, commonStyles, "button button-secondary", "warning-action")}
                                    onClick={() => onNavigate(`/fretes/${encodeURIComponent(item.codigo_frete)}`)}
                                  >
                                    Corrigir
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )
          )}
        </>
      )}

      {activeTab === "ajustes" && (
        <>
          <section className={cx(styles, "summary-grid")} aria-label="Resumo de vales e ajustes">
            <article className={cx(styles, "summary-card")}>
              <span>Lançamentos no período</span>
              <strong>{adjustments.length.toLocaleString("pt-BR")}</strong>
              <small>Entram automaticamente no fechamento</small>
            </article>
            <article className={cx(styles, "summary-card", "summary-paid")}>
              <span>Total de acréscimos</span>
              <strong>+{formatMoney(adjustmentTotals.adds)}</strong>
              <small>Bônus, pedágios e reembolsos</small>
            </article>
            <article className={cx(styles, "summary-card", "summary-alert")}>
              <span>Total de descontos</span>
              <strong>-{formatMoney(adjustmentTotals.subs)}</strong>
              <small>Vales e adiantamentos</small>
            </article>
            <article className={cx(styles, "summary-card", "summary-payable")}>
              <span>Impacto líquido</span>
              <strong>{formatMoney(adjustmentTotals.net)}</strong>
              <small>Acréscimos menos descontos</small>
            </article>
          </section>

          <section className={cx(styles, "report-card")} aria-label="Lista de vales e ajustes">
            <header>
              <div>
                <h2>Vales, adiantamentos e acréscimos do período</h2>
                <p>
                  Lançamentos parcelados entram automaticamente na semana ou mês correspondente.
                </p>
              </div>
              {canExport && (
                <button
                  type="button"
                  className={cx(styles, commonStyles, "button button-primary")}
                  onClick={() => {
                    setActionError("");
                    setShowAdjustmentDialog(true);
                  }}
                >
                  + Novo lançamento
                </button>
              )}
            </header>

            {adjustments.length === 0 ? (
              <div className={cx(styles, "empty-report")}>
                <span className={cx(styles, commonStyles, "empty-state-icon")}>＋</span>
                <div>
                  <strong>Nenhum vale ou ajuste neste período</strong>
                  <p>Clique em “+ Novo lançamento” para registrar um vale, adiantamento, bônus ou pedágio.</p>
                </div>
              </div>
            ) : (
              <div className={cx(styles, commonStyles, "data-table-scroll")} tabIndex={0}>
                <table className={cx(styles, commonStyles, "data-table", "report-table")}>
                  <thead>
                    <tr>
                      <th>Data ref.</th>
                      <th>Responsável</th>
                      <th>Tipo</th>
                      <th>Descrição</th>
                      <th className={cx(styles, "num")}>Valor</th>
                      <th>Situação</th>
                      {canExport && <th className={cx(styles, "num")}>Ação</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {adjustments.map((adj) => (
                      <tr key={adj.codigo_ajuste}>
                        <td>{formatShortDate(adj.data_referencia)}</td>
                        <td>
                          <strong>{adj.nome_transportador}</strong>
                          <span className={cx(styles, "sub-value")}>
                            Por {adj.criado_por_nome || "usuário"}
                          </span>
                        </td>
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
                        <td className={cx(styles, "num")}>
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
                        {canExport && (
                          <td className={cx(styles, "num")}>
                            <button
                              type="button"
                              className={cx(styles, "mini-action", "mini-action-danger")}
                              disabled={adj.vinculado_pagamento}
                              title={
                                adj.vinculado_pagamento
                                  ? "Estorne o fechamento vinculado antes de excluir"
                                  : "Excluir lançamento"
                              }
                              onClick={() => void handleDeleteAdjustment(adj)}
                            >
                              Excluir
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === "historico" && (
        <section className={cx(styles, "report-card")} aria-label="Histórico de fechamentos">
          <header>
            <div>
              <h2>Histórico de fechamentos e pagamentos ({historyTotal})</h2>
              <p>
                Consulte todos os lotes já solicitados, pagos ou estornados, baixe o XLSX original ou atualize a nota fiscal.
              </p>
            </div>
            <div className={cx(styles, "status-chip-group")}>
              {(
                [
                  ["TODOS", "Todos"],
                  ["PAGO", "Pagos"],
                  ["SOLICITADO", "Solicitados"],
                  ["ESTORNADO", "Estornados"],
                ] as const
              ).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  className={cx(
                    styles,
                    "status-chip",
                    historyStatusFilter === code ? "status-chip-active" : "",
                  )}
                  onClick={() => setHistoryStatusFilter(code)}
                >
                  {label}
                </button>
              ))}
            </div>
          </header>

          {historyError && (
            <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">
              {historyError}
            </div>
          )}

          {historyLoading ? (
            <div className={cx(styles, commonStyles, "loading-card")}>
              <span className={cx(styles, commonStyles, "spinner spinner-green")} />
              Carregando histórico de fechamentos...
            </div>
          ) : historyItems.length === 0 ? (
            <div className={cx(styles, "empty-report")}>
              <span className={cx(styles, commonStyles, "empty-state-icon")}>◷</span>
              <div>
                <strong>Nenhum fechamento registrado ainda</strong>
                <p>Use “Solicitar” ou “✔ Marcar pago” na aba Fechamento do período para começar o histórico.</p>
              </div>
            </div>
          ) : (
            <div className={cx(styles, commonStyles, "data-table-scroll")} tabIndex={0}>
              <table className={cx(styles, commonStyles, "data-table", "report-table")}>
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Responsável</th>
                    <th className={cx(styles, "num")}>Dias / fretes</th>
                    <th className={cx(styles, "num")}>Valor líquido</th>
                    <th>Situação / NF</th>
                    <th>Auditoria</th>
                    {canExport && <th className={cx(styles, "num")}>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {historyItems.map((pag) => (
                    <tr
                      key={pag.codigo_pagamento}
                      className={cx(
                        styles,
                        pag.status_pagamento === "PAGO"
                          ? "row-paid"
                          : pag.status_pagamento === "ESTORNADO"
                            ? ""
                            : "row-requested",
                      )}
                    >
                      <td>
                        <strong>
                          {formatShortDate(pag.data_de)} a {formatShortDate(pag.data_ate)}
                        </strong>
                        <span className={cx(styles, "sub-value")}>
                          {pag.tipo_transporte === "AGREGADO" ? "Agregado" : "Transportadora"}
                        </span>
                      </td>
                      <td>
                        <strong>{pag.nome_transportador}</strong>
                        <span className={cx(styles, "sub-value")}>
                          {pag.documento_fiscal || "Sem CPF/CNPJ"}
                        </span>
                        {pag.observacao && <small>{pag.observacao}</small>}
                        {pag.motivo_estorno && (
                          <small className={cx(styles, "cell-warning")}>
                            Estorno: {pag.motivo_estorno}
                          </small>
                        )}
                      </td>
                      <td className={cx(styles, "num")}>
                        <strong>{pag.quantidade_dias} dia(s)</strong>
                        <span className={cx(styles, "sub-value")}>
                          {pag.quantidade_fretes} frete(s)
                        </span>
                      </td>
                      <td className={cx(styles, "num")}>
                        <strong>{formatMoney(pag.valor_liquido_registrado)}</strong>
                        {Number(pag.valor_ajustes) !== 0 && (
                          <span className={cx(styles, "sub-value")}>
                            Ajustes: {formatMoney(pag.valor_ajustes)}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className={cx(styles, "pill-stack")}>
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
                              ? `Pago ${formatShortDate(pag.data_pagamento)}`
                              : pag.status_pagamento === "SOLICITADO"
                                ? "Solicitado"
                                : "Estornado"}
                          </span>
                          {pag.possui_alteracao && (
                            <span
                              className={cx(styles, "status-pill", "pill-danger")}
                              title={pag.motivo_alteracao || ""}
                            >
                              Alterado
                            </span>
                          )}
                          {pag.exige_nota_fiscal && pag.status_pagamento !== "ESTORNADO" && (
                            <span
                              className={cx(
                                styles,
                                "status-pill",
                                pag.nf_recebida ? "pill-paid" : "pill-danger",
                              )}
                            >
                              {pag.nf_recebida ? `NF ${pag.nf_numero || "OK"}` : "NF pendente"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <small>
                          Criado por {pag.criado_por_nome || "—"} em {formatDate(pag.criado_em)}
                        </small>
                        {pag.pago_por_nome && (
                          <small>Pago por {pag.pago_por_nome}</small>
                        )}
                        {pag.estornado_por_nome && (
                          <small>Estornado por {pag.estornado_por_nome}</small>
                        )}
                      </td>
                      {canExport && (
                        <td className={cx(styles, "num")}>
                          <div className={cx(styles, "row-actions")}>
                            <button
                              type="button"
                              className={cx(styles, "mini-action")}
                              onClick={() =>
                                void exportXlsx({
                                  codigoPagamento: pag.codigo_pagamento,
                                  label: pag.nome_transportador,
                                })
                              }
                            >
                              XLSX
                            </button>
                            {pag.status_pagamento !== "ESTORNADO" && (
                              <button
                                type="button"
                                className={cx(styles, "mini-action")}
                                onClick={() => {
                                  setActionError("");
                                  setInvoiceTarget(pag);
                                }}
                              >
                                NF
                              </button>
                            )}
                            {pag.status_pagamento === "SOLICITADO" && (
                              <button
                                type="button"
                                className={cx(styles, "mini-action", "mini-action-primary")}
                                onClick={() => void handleSettlementStatusChange(pag, "MARCAR_PAGO")}
                              >
                                Marcar pago
                              </button>
                            )}
                            {pag.status_pagamento === "PAGO" && (
                              <button
                                type="button"
                                className={cx(styles, "mini-action")}
                                onClick={() => void handleSettlementStatusChange(pag, "DESFAZER_PAGO")}
                              >
                                Desfazer pago
                              </button>
                            )}
                            {pag.status_pagamento !== "ESTORNADO" && (
                              <button
                                type="button"
                                className={cx(styles, "mini-action", "mini-action-danger")}
                                onClick={() => {
                                  setActionError("");
                                  setReverseTarget(pag);
                                }}
                              >
                                Estornar
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {detailTarget && (
        <PaymentResponsibleDetailModal
          responsible={detailTarget}
          transportType={transportType}
          fromDate={fromDate}
          toDate={toDate}
          canExport={canExport}
          canEditFreights={canEditFreights}
          onClose={() => setDetailTarget(null)}
          onNavigate={onNavigate}
          onCopyText={(text, label) => void copyToClipboard(text, label)}
          onOpenReceipt={(target) => {
            setDetailTarget(null);
            setReceiptTarget(target);
          }}
          onOpenInvoice={(settlement) => {
            setActionError("");
            setInvoiceTarget(settlement);
          }}
          onExportSettlement={(settlement) =>
            void exportXlsx({
              codigoPagamento: settlement.codigo_pagamento,
              label: settlement.nome_transportador,
            })
          }
          onMarkSettlementPaid={(settlement) =>
            void handleSettlementStatusChange(settlement, "MARCAR_PAGO")
          }
          onUndoSettlementPaid={(settlement) =>
            void handleSettlementStatusChange(settlement, "DESFAZER_PAGO")
          }
          onReverseSettlement={(settlement) => {
            setActionError("");
            setReverseTarget(settlement);
          }}
        />
      )}

      {receiptTarget && (
        <PaymentReceiptModal
          responsible={receiptTarget}
          transportType={transportType}
          fromDate={fromDate}
          toDate={toDate}
          onClose={() => setReceiptTarget(null)}
          onCopyText={(text, label) => void copyToClipboard(text, label)}
        />
      )}

      {settleModal && (
        <SettlePaymentDialog
          action={settleModal.action}
          targets={settleModal.targets}
          fromDate={fromDate}
          toDate={toDate}
          saving={actionSaving}
          error={actionError}
          onClose={() => setSettleModal(null)}
          onConfirm={(data) => void handleConfirmSettle(data)}
        />
      )}

      {invoiceTarget && (
        <InvoiceDialog
          settlement={invoiceTarget}
          saving={actionSaving}
          error={actionError}
          onClose={() => setInvoiceTarget(null)}
          onCopyChargeMessage={(settlement) =>
            copyNfChargeMessage(
              settlement.nome_transportador,
              settlement.data_de,
              settlement.data_ate,
              settlement.valor_liquido_registrado,
            )
          }
          onSave={(data) => void handleSaveInvoice(data)}
        />
      )}

      {reverseTarget && (
        <ReverseSettlementDialog
          settlement={reverseTarget}
          saving={actionSaving}
          error={actionError}
          onClose={() => setReverseTarget(null)}
          onConfirm={(reason) =>
            void handleSettlementStatusChange(reverseTarget, "ESTORNAR", reason)
          }
        />
      )}

      {showAdjustmentDialog && (
        <NewAdjustmentDialog
          transportType={transportType}
          responsibleOptions={responsibleOptions}
          defaultResponsible={responsible && responsible !== UNIDENTIFIED ? responsible : ""}
          defaultDate={toDate}
          saving={actionSaving}
          error={actionError}
          onClose={() => setShowAdjustmentDialog(false)}
          onSave={(data) => void handleCreateAdjustment(data)}
        />
      )}
    </div>
  );
}
