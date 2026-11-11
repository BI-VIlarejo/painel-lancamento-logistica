import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { freightsApi } from "../api";
import { formatDate, formatMoney, formatNumber, firstDayOfCurrentMonth, localDateValue, numericValue, tariffSourceLabel } from "../format";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type {
  FreightCarrierSource,
  FreightHistoryFilters,
  FreightHistoryFilterOptions,
  FreightRecordedTransportType,
  FreightResponse,
  FreightStatus,
} from "../types";
import styles from "./FreightHistoryPage.module.css";
import { FreightImportDialog } from "../components/FreightImportDialog";
import type { FreightImportCompletion } from "../components/FreightImportDialog";

type Props = { onNavigate: (path: string) => void; canCreate: boolean; canViewPayments: boolean };
type FreightDetailSection = "Operação" | "Hodômetro" | "Valores e conferência";
const pageSizeOptions = [10, 25, 50, 100];
const historyReturnKey = "lancamento-logistica:freight-history-return";

type HistoryReturnState = {
  fromDate: string; toDate: string; transportType: FreightRecordedTransportType | "TODOS";
  statusFilter: FreightStatus | "TODOS"; driverId: string; routeFilter: string;
  carrierFilter: FreightCarrierSource | ""; pageSize: number; offset: number; allHistory: boolean;
  scrollX: number; scrollY: number; tableScrollLeft: number;
};

function readHistoryReturnState(): Partial<HistoryReturnState> {
  try {
    const stored = window.sessionStorage.getItem(historyReturnKey);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    return parsed && typeof parsed === "object" ? parsed as Partial<HistoryReturnState> : {};
  } catch {
    return {};
  }
}

function transportTypeLabel(type: FreightRecordedTransportType): string {
  if (type === "PROPRIO") return "Frota própria";
  if (type === "AGREGADO") return "Agregado";
  return "Transportadora independente";
}

function transportTypeLabelForItem(item: FreightResponse): string {
  const source = importSource(item);
  return source?.tipo_transporte_identificado === false
    ? "Tipo pendente de identificação"
    : transportTypeLabel(item.tipo_transporte);
}

function transportName(item: FreightResponse): string {
  const source = importSource(item);
  if (source?.tipo_transporte_identificado === false) {
    return item.nome_transportador || "Responsável não identificado";
  }
  if (item.tipo_transporte === "AGREGADO") return item.nome_transportador || "Agregado sem identificação";
  if (item.tipo_transporte === "PROPRIO") return item.nome_transportador || "Frota própria";
  const carrier = item.nome_transportador || "Transportadora não informada";
  return item.nome_motorista_transportadora
    ? `${carrier} · ${item.nome_motorista_transportadora}`
    : carrier;
}

function importSource(item: FreightResponse): Record<string, unknown> | null {
  const value = item.detalhe_calculo.importacao_planilha;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function isHistoricalImport(item: FreightResponse): boolean {
  return importSource(item) !== null;
}

function calculationStatusLabel(item: FreightResponse): string {
  if (isHistoricalImport(item)) {
    return item.status_calculo === "CALCULADO"
      ? "Valor histórico importado"
      : "Valor histórico importado · pendente de conferência";
  }
  return item.status_calculo === "CALCULADO" ? "Calculado" : "Pendente de conferência";
}

function formatDateTime(value: string | null): string {
  if (!value) return "Não informado";
  const timestamp = value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatPercentage(value: string | number | null): string {
  const parsed = numericValue(value);
  return parsed === null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(parsed * 100)}%`;
}

function formatSourcePercentage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  if (value.includes("%")) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(parsed * 100)}%`
    : value;
}

function truckLabel(type: FreightResponse["tipo_caminhao"]): string {
  if (type === "SAVEIRO") return "Saveiro";
  if (type === "KIA_BONGO") return "Kia Bongo";
  if (type === "CAMINHAO_3_4") return "Caminhão 3/4";
  if (type === "CAMINHAO_TOCO") return "Caminhão toco";
  return "Não se aplica";
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className={cx(styles, "detail-field")}><dt>{label}</dt><dd>{value || "Não informado"}</dd></div>;
}

function FreightDetailsDialog({
  item,
  focusSection,
  busy,
  error,
  onClose,
  onEdit,
  onCancel,
}: {
  item: FreightResponse;
  focusSection: FreightDetailSection | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const source = importSource(item);
  const sections: Array<{ title: string; fields: Array<[string, string]> }> = [
    {
      title: "Dados do serviço",
      fields: [
        ["Tipo de transporte", transportTypeLabelForItem(item)],
        ["Responsável", transportName(item)],
        ["Rota / cidade", item.rota_cidade || "Não informada na planilha"],
        ["Fonte tarifária", item.codigo_fonte_tarifa ? tariffSourceLabel(item.codigo_fonte_tarifa) : "Não informada"],
      ],
    },
    {
      title: "Operação",
      fields: [
        ["Quantidade de entregas", item.quantidade_entregas === null ? "Não informada na planilha" : item.quantidade_entregas.toLocaleString("pt-BR")],
        ["Peso", item.peso_kg === null ? "Não informado na planilha" : `${formatNumber(item.peso_kg)} kg`],
        ["Tipo de caminhão", truckLabel(item.tipo_caminhao)],
        ...(item.codigo_fonte_tarifa === "PAULO_CRUZ" ? [["Carro de apoio", item.carro_apoio === "SAVEIRO" ? "Saveiro · R$ 300,00" : item.carro_apoio === "KIA_BONGO" ? "Bongo · R$ 500,00" : "Nenhum"] as [string, string]] : []),
        ["Zona JUST IN TIME", item.codigo_zona_jit ?? "Não se aplica"],
        ["Adicionais", item.adicionais_jit.length ? item.adicionais_jit.join(", ") : "Nenhum"],
      ],
    },
    {
      title: "Hodômetro",
      fields: [
        ["KM inicial", formatNumber(item.km_inicial)],
        ["KM final", formatNumber(item.km_final)],
        ["KM rodado", item.km_rodado === null ? "Não se aplica" : `${formatNumber(item.km_rodado)} km`],
      ],
    },
    {
      title: "Valores e conferência",
      fields: [
        ["Valor da nota", formatMoney(item.valor_nota)],
        ["Quantidade de avarias", source?.quantidade_avarias_informada === false ? "Não informada na planilha" : item.quantidade_avarias.toLocaleString("pt-BR")],
        ["Valor da avaria", formatMoney(item.valor_avaria)],
        ["Frete bruto", formatMoney(item.valor_frete_bruto)],
        [source?.percentual_frete_planilha !== null && source?.percentual_frete_planilha !== undefined
          ? "Percentual na planilha" : "Percentual calculado", source?.percentual_frete_planilha !== null && source?.percentual_frete_planilha !== undefined
            ? formatSourcePercentage(source.percentual_frete_planilha)
            : formatPercentage(item.percentual_frete)],
        ["Total líquido", formatMoney(item.valor_frete_pago)],
        ["Status do cálculo", calculationStatusLabel(item)],
        ["Motivo da pendência", item.motivo_pendencia ?? "Nenhum"],
      ],
    },
    ...(source ? [{
      title: "Origem do lançamento",
      fields: [
        ["Tipo", "Importação de valores históricos; tarifa atual não aplicada."],
        ["Arquivo", String(source.arquivo ?? "Não informado")],
        ["Aba", String(source.aba ?? "Não informada")],
        ["Linha da planilha", String(source.linha ?? "Não informada")],
        ...(source.data_servico_planilha ? [["Data original na planilha", String(source.data_servico_planilha)] as [string, string]] : []),
        ...(source.data_servico_ano_inferido === true ? [["Data", "Ano interpretado pelas datas vizinhas; original preservado acima."] as [string, string]] : []),
        ["Nome informado na planilha", String(source.transportador_planilha ?? item.nome_transportador ?? "Não informado")],
        ...(source.vinculo_responsavel_nome_cadastrado ? [["Nome no cadastro", String(source.vinculo_responsavel_nome_cadastrado)] as [string, string]] : []),
        ...(source.vinculo_responsavel_correspondencia === "NOME_COMPOSTO"
          ? [["Correspondência do motorista", "O nome da planilha corresponde a uma parte do nome composto cadastrado."] as [string, string]] : []),
        ...(source.vinculo_responsavel_transportadora ? [["Transportadora independente", source.vinculo_responsavel_transportadora === "JUST_IN_TIME" ? "JUST IN TIME" : "Paulo Cruz"] as [string, string]] : []),
        ["Vínculo do responsável", source.vinculo_responsavel_status === "VINCULADO"
          ? source.vinculo_responsavel_criterio === "DATA_SERVICO"
            ? "Vinculado à versão vigente na data do frete."
            : "Vinculado ao cadastro atual pelo nome."
          : source.vinculo_responsavel_status === "AMBIGUO"
            ? source.vinculo_responsavel_transportadora
              ? "Transportadora identificada; há mais de um motorista possível. Requer conferência."
              : "Há mais de um cadastro com esse nome; requer conferência."
            : source.vinculo_responsavel_transportadora
              ? "Transportadora identificada, sem motorista associado; requer conferência."
              : "Nome preservado, sem vínculo no cadastro; requer conferência."],
        ...(source.rota_cidade_status === "VINCULADA" && source.rota_cidade_planilha !== item.rota_cidade
          ? [["Rota cadastrada", String(item.rota_cidade ?? "Não informada")] as [string, string], ["Rota na planilha", String(source.rota_cidade_planilha ?? "Não informada")] as [string, string]] : []),
        ...(source.rota_cidade_status === "NAO_ENCONTRADA" || source.rota_cidade_status === "AMBIGUA"
          ? [["Correspondência da rota", "Não foi possível vincular a rota de forma única ao catálogo."] as [string, string]] : []),
        ...(item.tipo_transporte === "TRANSPORTADORA" && source.km_inicial_planilha !== null && source.km_inicial_planilha !== undefined
          ? [["KM inicial na planilha", String(source.km_inicial_planilha)] as [string, string]] : []),
        ...(item.tipo_transporte === "TRANSPORTADORA" && source.km_final_planilha !== null && source.km_final_planilha !== undefined
          ? [["KM final na planilha", String(source.km_final_planilha)] as [string, string]] : []),
        ...(item.tipo_transporte === "TRANSPORTADORA" && source.km_rodado_planilha !== null && source.km_rodado_planilha !== undefined
          ? [["KM rodado na planilha", String(source.km_rodado_planilha)] as [string, string]] : []),
      ] as Array<[string, string]>,
    }] : []),
    {
      title: "Registro",
      fields: [
        ["Criado pelo usuário", String(item.criado_por)],
        ["Criado em", formatDateTime(item.criado_em)],
      ],
    },
  ];

  return (
    <div className={cx(styles, commonStyles, "dialog-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={cx(styles, commonStyles, "detail-dialog", "freight-detail-dialog")} role="dialog" aria-modal="true" aria-labelledby="freight-detail-title">
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div><p className={cx(styles, commonStyles, "eyebrow")}>DETALHES DO FRETE</p><h2 id="freight-detail-title">{transportName(item)} <span>· {formatDate(item.data_servico)}</span></h2></div>
          <button ref={closeButton} className={cx(styles, commonStyles, "icon-button", "dialog-close")} type="button" aria-label="Fechar detalhes" onClick={onClose}>×</button>
        </div>
        <div className={cx(styles, commonStyles, "dialog-meta", "freight-dialog-meta")}>
          <span className={cx(styles, "freight-status", item.cancelado ? "freight-status-cancelled" : "freight-status-active")}>{item.cancelado ? "Cancelado" : calculationStatusLabel(item)}</span>
        </div>
        {item.cancelado && <div className={cx(styles, "cancellation-summary")}><strong>Cancelado em {formatDateTime(item.cancelado_em)}</strong><span>Usuário #{item.cancelado_por ?? "não informado"}</span><p>{item.justificativa_cancelamento || "Justificativa não informada."}</p></div>}
        {error && <div className={cx(styles, commonStyles, "notice notice-error", "freight-dialog-error")} role="alert">{error}</div>}
        <div className={cx(styles, "freight-detail-content")}>
          {sections.filter((section) => focusSection === null || section.title === focusSection).map((section) => <section className={cx(styles, "detail-section")} key={section.title}>
            <h3>{section.title}</h3>
            <dl className={cx(styles, "detail-fields")}>
              {section.fields.map(([label, value]) => <DetailField key={label} label={label} value={value} />)}
            </dl>
          </section>)}
        </div>
        <div className={cx(styles, commonStyles, "dialog-footer")}>
          <span>{item.cancelado ? "Este lançamento está cancelado e não compõe o pagamento." : "Ações ficam registradas na auditoria do frete."}</span>
          <div className={cx(styles, commonStyles, "dialog-actions")}>
            {onEdit && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={onEdit}>Editar lançamento</button>}
            {onCancel && <button className={cx(styles, commonStyles, "button button-secondary", "table-action-danger")} type="button" onClick={onCancel} disabled={busy}>{busy ? "Cancelando..." : "Cancelar lançamento"}</button>}
            <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FreightRow({
  item,
  canManage,
  busy,
  onDetails,
  onMetricDetails,
  onEdit,
  onCancel,
}: {
  item: FreightResponse;
  canManage: boolean;
  busy: boolean;
  onDetails: () => void;
  onMetricDetails: (section: FreightDetailSection) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const canEdit = canManage && !item.cancelado && item.tipo_transporte !== "PROPRIO";
  const canCancel = canManage && !item.cancelado;
  return <tr>
    <td><strong>{formatDate(item.data_servico)}</strong>{!item.cancelado && item.status_calculo === "PENDENTE_CONFERENCIA" && <small className={cx(styles, "pending-label")}>Pendente de conferência</small>}{item.cancelado && <small className={cx(styles, "cancelled-row-label")}>Cancelado</small>}</td>
    <td><strong>{transportTypeLabelForItem(item)}</strong><small>{transportName(item)}</small></td>
    <td><strong>{item.rota_cidade || "Rota não informada"}</strong><div className={cx(styles, "freight-row-metrics")}><button type="button" onClick={() => onMetricDetails("Operação")} aria-label="Detalhar quantidade de entregas">{item.quantidade_entregas === null ? "Entregas não informadas" : `${item.quantidade_entregas.toLocaleString("pt-BR")} entregas`}</button><button type="button" onClick={() => onMetricDetails("Operação")} aria-label="Detalhar peso">{item.peso_kg === null ? "Peso não informado" : `${formatNumber(item.peso_kg)} kg`}</button></div></td>
    <td>{item.tipo_transporte === "TRANSPORTADORA" ? <span>Não se aplica</span> : <><button className={cx(styles, "freight-row-primary-metric")} type="button" onClick={() => onMetricDetails("Hodômetro")} aria-label="Detalhar hodômetro rodado">{formatNumber(item.km_rodado)} km</button><small>Inicial <button className={cx(styles, "freight-row-inline-metric")} type="button" onClick={() => onMetricDetails("Hodômetro")} aria-label="Detalhar KM inicial">{formatNumber(item.km_inicial)}</button> · Final <button className={cx(styles, "freight-row-inline-metric")} type="button" onClick={() => onMetricDetails("Hodômetro")} aria-label="Detalhar KM final">{formatNumber(item.km_final)}</button></small></>}</td>
    <td>{item.valor_frete_bruto === null ? <strong>{formatMoney(item.valor_frete_bruto)}</strong> : <button className={cx(styles, "freight-row-primary-metric")} type="button" onClick={() => onMetricDetails("Valores e conferência")} aria-label="Detalhar valor bruto do frete">{formatMoney(item.valor_frete_bruto)}</button>}<div className={cx(styles, "freight-row-metrics freight-row-value-metrics")}><button type="button" onClick={() => onMetricDetails("Valores e conferência")} aria-label="Detalhar quantidade de avarias">{item.quantidade_avarias} avarias</button><button type="button" onClick={() => onMetricDetails("Valores e conferência")} aria-label="Detalhar valor da avaria">Avaria {formatMoney(item.valor_avaria)}</button><button type="button" onClick={() => onMetricDetails("Valores e conferência")} aria-label="Detalhar total líquido">Líquido {formatMoney(item.valor_frete_pago)}</button></div></td>
    <td>{!item.cancelado && item.status_calculo === "PENDENTE_CONFERENCIA" && <div className={cx(styles, "pending-reason")}><strong>Pendência</strong><span>{item.motivo_pendencia || "Aguardando conferência."}</span></div>}<div className={cx(styles, commonStyles, "history-row-actions")}>
      <span className={cx(styles, commonStyles, "history-main-actions")}>
        <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={onDetails}>Detalhes</button>
        {canEdit && <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={onEdit}>Editar</button>}
        {canCancel && <button className={cx(styles, commonStyles, "table-action", "table-action-danger")} type="button" onClick={onCancel} disabled={busy}>{busy ? "Cancelando..." : "Cancelar"}</button>}
      </span>
    </div></td>
  </tr>;
}

/** Histórico de fretes com consulta completa e ações auditáveis. */
export function FreightHistoryPage({ onNavigate, canCreate, canViewPayments }: Props) {
  const [restored] = useState(readHistoryReturnState);
  const [items, setItems] = useState<FreightResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [fromDate, setFromDate] = useState(restored.fromDate ?? firstDayOfCurrentMonth());
  const [toDate, setToDate] = useState(restored.toDate ?? localDateValue());
  const [allHistory, setAllHistory] = useState(restored.allHistory ?? false);
  const [transportType, setTransportType] = useState<FreightRecordedTransportType | "TODOS">(restored.transportType ?? "TODOS");
  const [statusFilter, setStatusFilter] = useState<FreightStatus | "TODOS">(restored.statusFilter ?? "TODOS");
  const [driverId, setDriverId] = useState(restored.driverId ?? "");
  const [routeFilter, setRouteFilter] = useState(restored.routeFilter ?? "");
  const [carrierFilter, setCarrierFilter] = useState<FreightCarrierSource | "">(restored.carrierFilter ?? "");
  const [filterOptions, setFilterOptions] = useState<FreightHistoryFilterOptions>({
    motoristas: [],
    rotas: [],
    possui_sem_motorista: false,
  });
  const [filterOptionsError, setFilterOptionsError] = useState("");
  const [pageSize, setPageSize] = useState(pageSizeOptions.includes(restored.pageSize ?? 0) ? restored.pageSize! : 25);
  const [offset, setOffset] = useState(Number.isInteger(restored.offset) && (restored.offset ?? -1) >= 0 ? restored.offset! : 0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [filterOptionsSettled, setFilterOptionsSettled] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportingHistory, setExportingHistory] = useState(false);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<FreightResponse | null>(null);
  const [selectedSection, setSelectedSection] = useState<FreightDetailSection | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const historyTableRef = useRef<HTMLDivElement>(null);
  const restoreScrollPending = useRef(typeof restored.scrollY === "number" && Number.isFinite(restored.scrollY));

  useLayoutEffect(() => {
    if (window.sessionStorage.getItem("lancamento-logistica:freight-history-top") === "1") {
      window.sessionStorage.removeItem("lancamento-logistica:freight-history-top");
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.removeItem(historyReturnKey);
    const savedMessage = window.sessionStorage.getItem("lancamento-logistica:freight-saved");
    if (savedMessage) {
      setNotice(savedMessage);
      window.sessionStorage.removeItem("lancamento-logistica:freight-saved");
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHistoryLoaded(false);
    setError("");
    void freightsApi.list({
      data_de: fromDate || undefined,
      data_ate: toDate || undefined,
      tipo_transporte: transportType,
      status_calculo: statusFilter,
      id_motorista: driverId === "" ? undefined : Number(driverId),
      rota_cidade: routeFilter || undefined,
      codigo_transportadora: carrierFilter || undefined,
      limit: pageSize,
      offset,
    })
      .then((page) => {
        if (active) {
          if (offset > 0 && offset >= page.total) {
            setOffset(page.total === 0 ? 0 : Math.floor((page.total - 1) / pageSize) * pageSize);
            return;
          }
          setItems(page.items);
          setTotal(page.total);
          setHistoryLoaded(true);
          setSelected((current) => current
            ? page.items.find((item) => item.codigo_frete === current.codigo_frete) ?? current
            : null);
        }
      })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, transportType, statusFilter, driverId, routeFilter, carrierFilter, pageSize, offset, reloadVersion]);

  useEffect(() => {
    let active = true;
    setFilterOptionsError("");
    setFilterOptionsSettled(false);
    void freightsApi.historyFilterOptions(fromDate, toDate, transportType)
      .then((options) => {
        if (!active) return;
        setFilterOptions(options);
        setDriverId((current) => current && !options.motoristas.some((driver) => String(driver.id_motorista) === current)
          ? ""
          : current);
        setRouteFilter((current) => current && !options.rotas.includes(current) ? "" : current);
      })
      .catch((optionsError: unknown) => {
        if (active) setFilterOptionsError(messageFromApiError(optionsError));
      })
      .finally(() => { if (active) setFilterOptionsSettled(true); });
    if (transportType !== "TRANSPORTADORA") setCarrierFilter("");
    return () => { active = false; };
  }, [fromDate, toDate, transportType, reloadVersion]);

  useEffect(() => {
    if (!restoreScrollPending.current || loading || !historyLoaded || !filterOptionsSettled) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const left = typeof restored.scrollX === "number" && Number.isFinite(restored.scrollX) ? restored.scrollX : 0;
        window.scrollTo(left, restored.scrollY ?? 0);
        if (historyTableRef.current && typeof restored.tableScrollLeft === "number" && Number.isFinite(restored.tableScrollLeft)) {
          historyTableRef.current.scrollLeft = restored.tableScrollLeft;
        }
        restoreScrollPending.current = false;
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [loading, historyLoaded, filterOptionsSettled, restored]);

  const currentPage = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function changeFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setOffset(0);
  }

  function selectAllHistory(checked: boolean) {
    setAllHistory(checked);
    setOffset(0);
    setExportError("");
    if (checked) {
      setFromDate("");
      setToDate("");
      setTransportType("TODOS");
      setStatusFilter("TODOS");
      setDriverId("");
      setRouteFilter("");
      setCarrierFilter("");
    } else {
      setFromDate(firstDayOfCurrentMonth());
      setToDate(localDateValue());
    }
  }

  function changeTransportType(value: FreightRecordedTransportType | "TODOS") {
    setTransportType(value);
    setCarrierFilter("");
    setOffset(0);
  }

  function startEdit(item: FreightResponse) {
    const state: HistoryReturnState = {
      fromDate, toDate, transportType, statusFilter, driverId, routeFilter, carrierFilter, pageSize, offset, allHistory,
      scrollX: window.scrollX, scrollY: window.scrollY,
      tableScrollLeft: historyTableRef.current?.scrollLeft ?? 0,
    };
    window.sessionStorage.setItem(historyReturnKey, JSON.stringify(state));
    setSelected(null);
    setSelectedSection(null);
    onNavigate(`/fretes/${encodeURIComponent(item.codigo_frete)}`);
  }

  async function exportHistory() {
    if (exportingHistory || loading || total === 0) return;
    setExportingHistory(true);
    setExportError("");
    const filters: FreightHistoryFilters = allHistory ? {} : {
      data_de: fromDate || undefined,
      data_ate: toDate || undefined,
      tipo_transporte: transportType,
      status_calculo: statusFilter,
      id_motorista: driverId === "" ? undefined : Number(driverId),
      rota_cidade: routeFilter || undefined,
      codigo_transportadora: carrierFilter || undefined,
    };
    try {
      const blob = await freightsApi.exportHistory(filters);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = allHistory
        ? "historico-fretes-todos.xlsx"
        : `historico-fretes-${fromDate || "inicio"}-${toDate || "fim"}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (exportFailure: unknown) {
      setExportError(messageFromApiError(exportFailure));
    } finally {
      setExportingHistory(false);
    }
  }

  function openDetails(item: FreightResponse, section: FreightDetailSection | null = null) {
    setSelected(item);
    setSelectedSection(section);
  }

  async function cancelFreight(item: FreightResponse) {
    const justification = window.prompt("Informe a justificativa obrigatória para cancelar este lançamento:");
    if (justification === null) return;
    if (justification.trim().length < 5) {
      window.alert("A justificativa precisa ter pelo menos 5 caracteres.");
      return;
    }
    if (!window.confirm("Cancelar este frete? Ele permanecerá no histórico de auditoria e deixará de compor os pagamentos.")) return;
    setBusyId(item.codigo_frete);
    setError("");
    try {
      await freightsApi.cancel(item.codigo_frete, justification.trim(), crypto.randomUUID());
      setSelected(null);
      setSelectedSection(null);
      setNotice("Frete cancelado e preservado no histórico.");
      setReloadVersion((version) => version + 1);
    } catch (cancelError: unknown) {
      setError(messageFromApiError(cancelError));
      setReloadVersion((version) => version + 1);
    } finally {
      setBusyId(null);
    }
  }

  function handleImported(result: FreightImportCompletion) {
    const message = `${result.importados.toLocaleString("pt-BR")} fretes importados; ${result.vinculados_agregados.toLocaleString("pt-BR")} agregados vinculados; ${result.vinculados_transportadoras.toLocaleString("pt-BR")} motoristas de transportadoras vinculados; ${result.sem_vinculo.toLocaleString("pt-BR")} sem vínculo e pendentes; ${result.atualizados.toLocaleString("pt-BR")} pendências atualizadas; ${result.ja_existentes.toLocaleString("pt-BR")} já registrados.`;
    setNotice(result.linhasComErro
      ? `${message} ${result.linhasComErro.toLocaleString("pt-BR")} linhas precisam de correção e podem ser reenviadas.`
      : message);
    if (result.dataDe || result.dataAte) {
      setAllHistory(false);
      if (result.dataDe) setFromDate(result.dataDe);
      if (result.dataAte) setToDate(result.dataAte);
    }
    setOffset(0);
    setReloadVersion((version) => version + 1);
  }

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "freight-history-page")}>
      <div className={cx(styles, commonStyles, "breadcrumb")}><span>Fretes</span><span aria-hidden="true">/</span><strong>Histórico</strong></div>
      <header className={cx(styles, commonStyles, "page-heading-row", "freight-heading")}>
        <div><p className={cx(styles, commonStyles, "eyebrow")}>OPERAÇÃO DE TRANSPORTE</p><h1>Histórico de fretes</h1><p className={cx(styles, commonStyles, "page-lead")}>Consulte, edite, cancele ou abra os dados completos dos serviços registrados.</p></div>
        <div className={cx(styles, "heading-actions")}>
          {canViewPayments && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/pagamentos")}>Pagamentos</button>}
          <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => void exportHistory()} disabled={loading || total === 0 || exportingHistory}>{exportingHistory ? "Preparando XLSX…" : "Exportar histórico XLSX"}</button>
          {canCreate && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setImportOpen(true)}>Importar planilha XLSX</button>}
          {canCreate && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => onNavigate("/fretes")}>+ Lançar frete</button>}
        </div>
      </header>

      {notice && <div className={cx(styles, commonStyles, "notice notice-success")} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Fechar aviso">×</button></div>}
      {exportError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{exportError}</div>}

      <section className={cx(styles, "filter-panel")} aria-label="Filtros do histórico">
        <label className={cx(styles, commonStyles, "filter-control")}>Data inicial<input type="date" value={fromDate} disabled={allHistory} onChange={(event) => changeFilter(setFromDate, event.target.value)} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Data final<input type="date" value={toDate} disabled={allHistory} onChange={(event) => changeFilter(setToDate, event.target.value)} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Tipo de transporte<select value={transportType} disabled={allHistory} onChange={(event) => changeTransportType(event.target.value as FreightRecordedTransportType | "TODOS")}><option value="TODOS">Todos</option><option value="AGREGADO">Agregados</option><option value="TRANSPORTADORA">Transportadoras</option><option value="PROPRIO">Frota própria</option></select></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Pendências<select value={statusFilter} disabled={allHistory} onChange={(event) => changeFilter(setStatusFilter, event.target.value as FreightStatus | "TODOS")}><option value="TODOS">Todos os lançamentos</option><option value="PENDENTE_CONFERENCIA">Somente pendentes</option><option value="CALCULADO">Somente calculados</option></select></label>
        {transportType === "TRANSPORTADORA" && <label className={cx(styles, commonStyles, "filter-control")}>Transportadora<select value={carrierFilter} disabled={allHistory} onChange={(event) => changeFilter(setCarrierFilter, event.target.value as FreightCarrierSource | "")}><option value="">Todas as transportadoras</option><option value="JUST_IN_TIME">JUST IN TIME</option><option value="PAULO_CRUZ">Paulo Cruz</option></select></label>}
        <label className={cx(styles, commonStyles, "filter-control")}>Motorista<select value={driverId} disabled={allHistory} onChange={(event) => changeFilter(setDriverId, event.target.value)}><option value="">Todos os motoristas</option>{filterOptions.motoristas.map((driver) => <option key={driver.id_motorista} value={driver.id_motorista}>{driver.nome_motorista}</option>)}</select></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Rota / cidade<select value={routeFilter} disabled={allHistory} onChange={(event) => changeFilter(setRouteFilter, event.target.value)}><option value="">Todas as rotas</option>{filterOptions.rotas.map((route) => <option key={route} value={route}>{route}</option>)}</select></label>
        <label className={cx(styles, "all-history-control")}><input type="checkbox" checked={allHistory} onChange={(event) => selectAllHistory(event.target.checked)} /><span><strong>Selecionar tudo</strong><small>Todo o histórico, sem aplicar filtros</small></span></label>
        <span className={cx(styles, "result-count")}>{total.toLocaleString("pt-BR")} {total === 1 ? "lançamento" : "lançamentos"}</span>
      </section>

      {filterOptionsError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">Não foi possível carregar as opções dos filtros: {filterOptionsError}</div>}

      {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReloadVersion((version) => version + 1)}>Tentar novamente</button></div>}

      <section className={cx(styles, "table-card")} aria-label="Lançamentos de frete">
        {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Carregando histórico...</div>
          : items.length === 0 ? <div className={cx(styles, "empty-state")}><span className={cx(styles, commonStyles, "empty-state-icon")}>↗</span><h2>Nenhum frete neste período</h2><p>Altere as datas ou registre um novo serviço.</p>{canCreate && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes")}>Lançar frete</button>}</div>
            : <div ref={historyTableRef} className={cx(styles, commonStyles, "data-table-scroll history-table-scroll")} role="region" aria-label="Tabela do histórico de fretes" tabIndex={0}><table className={cx(styles, commonStyles, "data-table", "freight-table")}><thead><tr><th>Data</th><th>Transporte / responsável</th><th>Rota e volume</th><th>Hodômetro</th><th>Valores</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <FreightRow
              item={item}
              key={item.id_frete}
              canManage={canCreate}
              busy={busyId === item.codigo_frete}
              onDetails={() => openDetails(item)}
              onMetricDetails={(section) => openDetails(item, section)}
              onEdit={() => startEdit(item)}
              onCancel={() => void cancelFreight(item)}
            />)}</tbody></table></div>}
        {!loading && total > 0 && <footer className={cx(styles, "pagination")}>
          <label className={cx(styles, "page-size-control")}><span>Linhas</span><select aria-label="Fretes por página" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setOffset(0); }}>{pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <span>{offset + 1}–{Math.min(offset + items.length, total)} de {total}</span>
          <div><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={offset + items.length >= total} onClick={() => setOffset(offset + pageSize)}>Próxima</button></div>
        </footer>}
      </section>

      {selected && <FreightDetailsDialog
        item={selected}
        focusSection={selectedSection}
        busy={busyId === selected.codigo_frete}
        error={error}
        onClose={() => { setSelected(null); setSelectedSection(null); }}
        onEdit={canCreate && !selected.cancelado && selected.tipo_transporte !== "PROPRIO" ? () => startEdit(selected) : undefined}
        onCancel={canCreate && !selected.cancelado ? () => void cancelFreight(selected) : undefined}
      />}
      {importOpen && <FreightImportDialog onClose={() => setImportOpen(false)} onImported={handleImported} />}
    </div>
  );
}

