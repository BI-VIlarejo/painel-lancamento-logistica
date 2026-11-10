import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import { freightsApi } from "../api";
import { numericValue } from "../format";
import type {
  FreightDeliverySummary,
  FreightResponse,
  HistoricalFreightEditDriverOption,
  HistoricalFreightEditInput,
} from "../types";
import formStyles from "./FreightForm.module.css";

type Props = {
  freight: FreightResponse;
  onUpdated: (freight: FreightResponse) => void;
  onCancel: () => void;
};

type Values = Record<Exclude<
  keyof HistoricalFreightEditInput,
  "id_motorista_selecionado" | "complementar_com_entregas"
>, string>;

function importDetails(freight: FreightResponse): Record<string, unknown> {
  const source = freight.detalhe_calculo.importacao_planilha;
  return typeof source === "object" && source !== null
    ? source as Record<string, unknown>
    : {};
}

function sourceHasValue(source: Record<string, unknown>, field: string): boolean {
  const originals = source.valores_originais_planilha;
  if (typeof originals !== "object" || originals === null) return false;
  const value = (originals as Record<string, unknown>)[field];
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function registeredDriverId(freight: FreightResponse, source: Record<string, unknown>): string {
  const linkedId = freight.id_motorista_agregado ?? freight.id_motorista_transportadora;
  if (linkedId !== null) return String(linkedId);
  const sourceId = source.vinculo_responsavel_id_pessoa;
  return typeof sourceId === "number" ? String(sourceId) : "";
}

function normalizePersonName(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ");
}

function matchesSourceName(candidate: string, sourceName: string): boolean {
  const normalizedCandidate = normalizePersonName(candidate);
  const normalizedSource = normalizePersonName(sourceName);
  if (normalizedCandidate === normalizedSource) return true;
  const components = normalizedCandidate.split(/\s*(?:\/|,|\||\+)\s*|\s+E\s+/).filter(Boolean);
  return components.includes(normalizedSource);
}

function sourceNumber(
  source: Record<string, unknown>,
  field: string,
  originalField: string,
): string {
  const editKey = `${field}_editado`;
  const currentEdit = source[editKey];
  if (
    Object.hasOwn(source, editKey)
    && (typeof currentEdit === "string" || typeof currentEdit === "number")
  ) {
    return String(currentEdit);
  }
  const sourceValue = source[originalField];
  if (typeof sourceValue === "string" || typeof sourceValue === "number") {
    return String(sourceValue);
  }
  const originals = source.valores_originais_planilha;
  if (typeof originals === "object" && originals !== null) {
    const value = (originals as Record<string, unknown>)[field];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "";
}

function percentForInput(freight: FreightResponse, source: Record<string, unknown>): string {
  const ratio = numericValue(freight.percentual_frete)
    ?? numericValue(source.percentual_frete_importado as string | number | null | undefined);
  return ratio === null ? "" : String(ratio * 100);
}

function valuesFromFreight(freight: FreightResponse): Values {
  const source = importDetails(freight);
  const rawDamageValue = sourceHasValue(source, "valor_avaria");
  return {
    data_servico: freight.data_servico,
    nome_transportador: freight.nome_motorista_transportadora ?? freight.nome_transportador ?? "",
    rota_cidade: freight.rota_cidade ?? "",
    km_inicial: freight.km_inicial === null
      ? sourceNumber(source, "km_inicial", "km_inicial_planilha")
      : String(freight.km_inicial),
    km_final: freight.km_final === null
      ? sourceNumber(source, "km_final", "km_final_planilha")
      : String(freight.km_final),
    km_rodado: freight.km_rodado === null
      ? sourceNumber(source, "km_rodado", "km_rodado_planilha")
      : String(freight.km_rodado),
    quantidade_entregas: freight.quantidade_entregas === null ? "" : String(freight.quantidade_entregas),
    peso_kg: freight.peso_kg === null ? "" : String(freight.peso_kg),
    valor_nota: freight.valor_nota === null ? "" : String(freight.valor_nota),
    valor_frete_bruto: freight.valor_frete_bruto === null ? "" : String(freight.valor_frete_bruto),
    valor_frete_pago: freight.valor_frete_pago === null ? "" : String(freight.valor_frete_pago),
    percentual_frete: percentForInput(freight, source),
    valor_avaria: rawDamageValue || numericValue(freight.valor_avaria) !== 0
      ? String(freight.valor_avaria)
      : "",
  };
}

function optionalNumber(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = numericValue(value);
  if (parsed === null) throw new Error(`${label}: informe um número válido.`);
  return parsed;
}

function optionalNonNegativeNumber(value: string, label: string): number | null {
  const parsed = optionalNumber(value, label);
  if (parsed !== null && parsed < 0) {
    throw new Error(`${label}: informe um valor igual ou maior que zero.`);
  }
  return parsed;
}

function optionalInteger(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label}: informe um número inteiro igual ou maior que zero.`);
  }
  return parsed;
}

function makePayload(
  values: Values,
  freight: FreightResponse,
  selectedDriverId: string,
  selectedDriverName: string | undefined,
  complementarComEntregas: boolean,
): HistoricalFreightEditInput {
  if (!values.data_servico) throw new Error("Informe a data do serviço.");
  const carrierFreight = freight.tipo_transporte === "TRANSPORTADORA";
  const kmInitial = carrierFreight ? null : optionalNonNegativeNumber(values.km_inicial, "KM inicial");
  const kmFinal = carrierFreight ? null : optionalNonNegativeNumber(values.km_final, "KM final");
  const enteredDistance = carrierFreight ? null : optionalNonNegativeNumber(values.km_rodado, "KM rodado");
  const kmDriven = kmInitial !== null && kmFinal !== null
    ? kmFinal - kmInitial
    : enteredDistance;
  if (kmDriven !== null && kmDriven < 0) {
    throw new Error("KM final deve ser igual ou maior que KM inicial.");
  }
  const percentage = optionalNumber(values.percentual_frete, "Percentual do frete");
  if (percentage !== null && percentage < 0) {
    throw new Error("O percentual do frete deve ser igual ou maior que zero.");
  }
  return {
    data_servico: values.data_servico,
    id_motorista_selecionado: selectedDriverId ? Number(selectedDriverId) : null,
    complementar_com_entregas: complementarComEntregas,
    nome_transportador: selectedDriverName ?? (values.nome_transportador.trim() || null),
    rota_cidade: values.rota_cidade.trim() || null,
    km_inicial: kmInitial,
    km_final: kmFinal,
    km_rodado: kmDriven,
    quantidade_entregas: optionalInteger(values.quantidade_entregas, "Entregas"),
    peso_kg: optionalNonNegativeNumber(values.peso_kg, "Peso"),
    valor_nota: optionalNonNegativeNumber(values.valor_nota, "Valor da nota"),
    valor_frete_bruto: optionalNonNegativeNumber(values.valor_frete_bruto, "Frete bruto"),
    valor_frete_pago: optionalNumber(values.valor_frete_pago, "Total líquido"),
    percentual_frete: percentage === null ? null : (percentage / 100).toFixed(6),
    valor_avaria: optionalNonNegativeNumber(values.valor_avaria, "Valor da avaria") ?? 0,
  };
}

/** Edição de dados importados que conserva os valores históricos e audita as alterações. */
export function HistoricalFreightForm({ freight, onUpdated, onCancel }: Props) {
  const [values, setValues] = useState(() => valuesFromFreight(freight));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editDrivers, setEditDrivers] = useState<HistoricalFreightEditDriverOption[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [driversError, setDriversError] = useState("");
  const source = importDetails(freight);
  const originalSheetName = typeof source.transportador_planilha === "string"
    ? source.transportador_planilha
    : "";
  const [selectedDriverId, setSelectedDriverId] = useState(() => registeredDriverId(freight, source));
  const [deliverySummary, setDeliverySummary] = useState<FreightDeliverySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [deliveryApplied, setDeliveryApplied] = useState(false);
  const [appliedDeliveryValues, setAppliedDeliveryValues] = useState<Partial<Record<keyof Values, string>>>({});
  const driverSelectionTouched = useRef(false);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    setDriversLoading(true);
    setDriversError("");
    void freightsApi.historicalEditDrivers(freight.data_servico)
      .then((options) => {
        if (active) setEditDrivers(options);
      })
      .catch((loadError: unknown) => {
        if (active) setDriversError(messageFromApiError(loadError));
      })
      .finally(() => {
        if (active) setDriversLoading(false);
      });
    return () => { active = false; };
  }, [freight.data_servico]);

  useEffect(() => {
    if (driversLoading || selectedDriverId || driverSelectionTouched.current) return;
    if (!originalSheetName.trim()) return;
    const isVitor = normalizePersonName(originalSheetName) === "VITOR";
    const candidatesByName = editDrivers.filter((driver) =>
      matchesSourceName(driver.nome_motorista, originalSheetName)
      || (isVitor
        && normalizePersonName(driver.nome_motorista) === "VICTOR TRANSPORTADORA NITEROI"
        && driver.codigo_transportadora === "PAULO_CRUZ"),
    );
    const candidates = isVitor
      ? candidatesByName.filter((driver) => driver.codigo_transportadora === "PAULO_CRUZ"
        && normalizePersonName(driver.nome_motorista) === "VICTOR TRANSPORTADORA NITEROI")
      : freight.codigo_fonte_tarifa === "PAULO_CRUZ"
      || freight.codigo_fonte_tarifa === "JUST_IN_TIME"
      ? candidatesByName.filter((driver) => driver.codigo_transportadora === freight.codigo_fonte_tarifa)
      : freight.codigo_fonte_tarifa === "AGREGADOS_CD"
        ? candidatesByName.filter((driver) => driver.tipo_transporte === "AGREGADO")
        : candidatesByName;
    if (candidates.length === 1) {
      setSelectedDriverId(String(candidates[0].id_motorista));
      setValues((current) => ({ ...current, nome_transportador: candidates[0].nome_motorista }));
    }
  }, [driversLoading, editDrivers, selectedDriverId, originalSheetName, freight.codigo_fonte_tarifa]);

  useEffect(() => {
    if (driversLoading || !selectedDriverId) return;
    if (editDrivers.some((driver) => String(driver.id_motorista) === selectedDriverId)) return;
    setSelectedDriverId("");
    setValues((current) => ({
      ...current,
      nome_transportador: originalSheetName || current.nome_transportador,
    }));
  }, [driversLoading, editDrivers, selectedDriverId, originalSheetName]);

  useEffect(() => {
    const driverId = Number(selectedDriverId);
    if (!Number.isInteger(driverId) || driverId < 1) {
      setDeliverySummary(null);
      setSummaryError("");
      return;
    }
    let active = true;
    setDeliverySummary(null);
    setSummaryLoading(true);
    setSummaryError("");
    void freightsApi.deliverySummary(freight.data_servico, driverId)
      .then((summary) => { if (active) setDeliverySummary(summary); })
      .catch((loadError: unknown) => { if (active) setSummaryError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [freight.data_servico, selectedDriverId]);

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    if (key in appliedDeliveryValues && appliedDeliveryValues[key] !== value) {
      setAppliedDeliveryValues((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    setError("");
  }

  function changeDriver(driverId: string) {
    driverSelectionTouched.current = true;
    setValues((current) => {
      const next = { ...current };
      for (const [key, appliedValue] of Object.entries(appliedDeliveryValues) as [keyof Values, string][]) {
        if (next[key] === appliedValue) next[key] = "";
      }
      const selected = editDrivers.find((driver) => String(driver.id_motorista) === driverId);
      const originalName = source.transportador_planilha;
      next.nome_transportador = selected?.nome_motorista
        ?? (typeof originalName === "string" ? originalName : current.nome_transportador);
      return next;
    });
    setSelectedDriverId(driverId);
    setAppliedDeliveryValues({});
    setDeliveryApplied(false);
    setError("");
  }

  function fillMissingFromDeliveries() {
    if (!deliverySummary || deliverySummary.quantidade_registros === 0) return;
    const valuesToApply: Partial<Record<keyof Values, string>> = {};
    const blankInSheet = (field: string) => !sourceHasValue(source, field);
    if (
      blankInSheet("rota_cidade")
      && freight.rota_cidade === null
      && !values.rota_cidade.trim()
      && deliverySummary.rota_cidade
    ) valuesToApply.rota_cidade = deliverySummary.rota_cidade;
    if (
      blankInSheet("quantidade_entregas")
      && freight.quantidade_entregas === null
      && !values.quantidade_entregas.trim()
    ) valuesToApply.quantidade_entregas = String(deliverySummary.quantidade_entregas);
    if (
      blankInSheet("peso_kg")
      && freight.peso_kg === null
      && !values.peso_kg.trim()
      && deliverySummary.peso_total_kg !== null
    ) valuesToApply.peso_kg = String(deliverySummary.peso_total_kg);
    setValues((current) => ({ ...current, ...valuesToApply }));
    setAppliedDeliveryValues(valuesToApply);
    setDeliveryApplied(true);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    let payload: HistoricalFreightEditInput;
    try {
      const selectedDriver = editDrivers.find(
        (driver) => String(driver.id_motorista) === selectedDriverId,
      );
      payload = makePayload(
        values,
        freight,
        selectedDriverId,
        selectedDriver?.nome_motorista,
        deliveryApplied,
      );
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Confira os valores informados.");
      return;
    }
    setBusy(true);
    try {
      const signature = JSON.stringify(payload);
      const requestKey = idempotency.current?.signature === signature
        ? idempotency.current.key
        : crypto.randomUUID();
      idempotency.current = { signature, key: requestKey };
      const updated = await freightsApi.updateHistorical(
        String(freight.codigo_frete),
        payload,
        requestKey,
      );
      idempotency.current = null;
      onUpdated(updated);
    } catch (saveError: unknown) {
      setError(messageFromApiError(saveError));
    } finally {
      setBusy(false);
    }
  }

  const field = (
    key: keyof Values,
    label: string,
    type = "text",
    hint?: string,
    inputMode?: "decimal" | "numeric",
    readOnly = false,
  ) => (
    <label className={cx(formStyles, "field")}>
      {label}
      <input
        type={type}
        inputMode={inputMode}
        value={values[key]}
        onChange={(event) => update(key, event.target.value)}
        readOnly={readOnly}
        disabled={busy || (readOnly && type === "date")}
      />
      {hint && <small>{hint}</small>}
    </label>
  );

  return (
    <form className={cx(formStyles, "freight-form")} onSubmit={(event) => void submit(event)}>
      <div className={cx(formStyles, "form-card")}>
        <div className={cx(formStyles, "form-section-heading")}>
          <div><span className={cx(formStyles, "step-number")}>01</span><div><p>IDENTIFICAÇÃO</p><h2>Serviço e responsável</h2></div></div>
        </div>
        <p className={cx(formStyles, "section-help")}>
          A data veio da planilha. Selecione o motorista cadastrado para conferir as Entregas confirmadas nessa data.
        </p>
        <div className={cx(formStyles, "field-grid", "field-grid-two")}>
          {field("data_servico", "Data do serviço", "date", "Data original preservada.", undefined, true)}
          <label className={cx(formStyles, "field")}>
            Motorista cadastrado
            <select
              value={selectedDriverId}
              onChange={(event) => changeDriver(event.target.value)}
              disabled={busy || driversLoading || Boolean(driversError)}
            >
              <option value="">Usar identificação da planilha · tentar vínculo automático</option>
              {editDrivers.map((driver) => (
                <option key={driver.id_motorista} value={driver.id_motorista}>
                  {driver.nome_motorista}{driver.nome_transportadora ? ` · ${driver.nome_transportadora}` : " · Agregado"}
                </option>
              ))}
            </select>
            {driversLoading && <small>Carregando motoristas vigentes nesta data…</small>}
            {driversError && <small role="alert">{driversError}</small>}
            {!driversLoading && !driversError && editDrivers.length === 0 && <small>Nenhum motorista cadastrado e vigente nesta data.</small>}
            {originalSheetName && <small>Identificação original: {originalSheetName}</small>}
          </label>
          {field(
            "rota_cidade",
            "Rota / cidade",
            "text",
            sourceHasValue(source, "rota_cidade")
              ? "Valor informado na planilha; bloqueado para preservar o histórico."
              : "Pode ser preenchida pelas Entregas quando estiver vazia.",
            undefined,
            sourceHasValue(source, "rota_cidade"),
          )}
        </div>
        {selectedDriverId && <section className={cx(formStyles, "delivery-match-panel")} aria-label="Entregas do motorista e data">
          <div className={cx(formStyles, "delivery-match-heading")}>
            <div><p>COMPARAÇÃO COM ENTREGAS</p><h3>Motorista e data selecionados</h3></div>
            <span>{summaryLoading ? "Buscando…" : deliverySummary ? `${deliverySummary.quantidade_registros} registros` : "Aguardando consulta"}</span>
          </div>
          {summaryError ? <p className={cx(formStyles, "delivery-match-message")} role="alert">{summaryError}</p> : deliverySummary ? (
            <>
              <div className={cx(formStyles, "delivery-match-stats")}>
                <div><small>Rota encontrada</small><strong>{deliverySummary.rota_cidade || "—"}</strong></div>
                <div><small>Entregas realizadas</small><strong>{deliverySummary.quantidade_entregas}</strong></div>
                <div><small>Peso total</small><strong>{deliverySummary.peso_total_kg === null ? "Não informado" : `${deliverySummary.peso_total_kg} kg`}</strong></div>
                <div><small>Avarias registradas</small><strong>{deliverySummary.quantidade_avarias} ocorrências</strong></div>
              </div>
              <p className={cx(formStyles, "delivery-match-message")}>
                A ação abaixo só completa rota, entregas e peso que estejam vazios. Os valores já informados na planilha ficam bloqueados. As Entregas não fornecem KM, valor da nota, frete ou valor em R$ das avarias.
              </p>
              {deliverySummary.quantidade_registros === 0 && <p className={cx(formStyles, "delivery-match-message")}>Não há Entregas confirmadas para esse motorista nesta data.</p>}
              <button
                className={cx(commonStyles, "button button-secondary", formStyles, "small-action")}
                type="button"
                onClick={fillMissingFromDeliveries}
                disabled={busy || summaryLoading || deliverySummary.quantidade_registros === 0}
              >
                Preencher somente os campos vazios
              </button>
            </>
          ) : <p className={cx(formStyles, "delivery-match-message")}>Selecione um motorista cadastrado para consultar as Entregas desta data.</p>}
        </section>}
      </div>

      <div className={cx(formStyles, "form-card")}>
        <div className={cx(formStyles, "form-section-heading")}>
          <div><span className={cx(formStyles, "step-number")}>02</span><div><p>DADOS ORIGINAIS</p><h2>Operação e valores</h2></div></div>
        </div>
        <p className={cx(formStyles, "section-help")}>
          Valores presentes na planilha ficam bloqueados. Campos ausentes podem ser completados; a edição não recalcula a tarifa atual.
        </p>
        <div className={cx(formStyles, "field-grid", "field-grid-two")}>
          {field("quantidade_entregas", "Entregas", "text", sourceHasValue(source, "quantidade_entregas") ? "Informado na planilha; bloqueado." : "Ausente na planilha; pode ser completado pelas Entregas.", "numeric", sourceHasValue(source, "quantidade_entregas"))}
          {field("peso_kg", "Peso (kg)", "text", sourceHasValue(source, "peso_kg") ? "Informado na planilha; bloqueado." : "Ausente na planilha; pode ser completado pelas Entregas.", "decimal", sourceHasValue(source, "peso_kg"))}
          {field("km_inicial", "KM inicial", "text", sourceHasValue(source, "km_inicial") ? "Informado na planilha; bloqueado." : undefined, "decimal", sourceHasValue(source, "km_inicial"))}
          {field("km_final", "KM final", "text", sourceHasValue(source, "km_final") ? "Informado na planilha; bloqueado." : undefined, "decimal", sourceHasValue(source, "km_final"))}
          {field("km_rodado", "KM rodado", "text", sourceHasValue(source, "km_rodado") ? "Informado na planilha; bloqueado." : undefined, "decimal", sourceHasValue(source, "km_rodado") || (sourceHasValue(source, "km_inicial") && sourceHasValue(source, "km_final")))}
          {field("valor_nota", "Valor da nota (R$)", "text", sourceHasValue(source, "valor_nota") ? "Informado na planilha; bloqueado." : undefined, "decimal", sourceHasValue(source, "valor_nota"))}
          {field("valor_frete_bruto", "Frete bruto (R$)", "text", sourceHasValue(source, "valor_frete_bruto") ? "Informado na planilha; bloqueado." : undefined, "decimal", sourceHasValue(source, "valor_frete_bruto"))}
          {field("valor_avaria", "Avaria (R$)", "text", sourceHasValue(source, "valor_avaria") ? "Informado na planilha; bloqueado." : "Ausente na planilha; informe o valor em reais se conhecido.", "decimal", sourceHasValue(source, "valor_avaria"))}
          {field("valor_frete_pago", "Total líquido (R$)", "text", sourceHasValue(source, "valor_frete_pago") ? "Informado na planilha; bloqueado." : "Se deixar em branco, será calculado como frete bruto menos avaria.", "decimal", sourceHasValue(source, "valor_frete_pago"))}
          {field("percentual_frete", "Percentual (%)", "text", sourceHasValue(source, "percentual_frete") ? "Informado na planilha; bloqueado." : "Informe, por exemplo, 12 para 12%. Em branco, será calculado pela nota.", "decimal", sourceHasValue(source, "percentual_frete"))}
        </div>
        {freight.tipo_transporte === "TRANSPORTADORA" && <div className={cx(formStyles, "distance-result")}><span>Hodômetro operacional</span><strong>Não se aplica</strong><small>Os valores da planilha continuam preservados na origem do frete.</small></div>}
        {Boolean(source.ultima_edicao_manual) && <p className={cx(formStyles, "route-hint")}>Este lançamento já foi corrigido anteriormente. A próxima alteração também será auditada.</p>}
      </div>

      {error && <div className={cx(commonStyles, "notice notice-error", "form-message")} role="alert">{error}</div>}

      <div className={cx(formStyles, "form-actions")}>
        <span>O histórico da planilha será mantido junto com a nova revisão dos dados.</span>
        <div>
          <button className={cx(commonStyles, "button button-secondary")} type="button" onClick={onCancel} disabled={busy}>Voltar</button>
          <button className={cx(commonStyles, "button button-primary")} type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar alterações"}</button>
        </div>
      </div>
    </form>
  );
}
