import { useAuth } from "../../../app/providers";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "../../../shared/drafts/sessionDraft";
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
  FreightTariffOptions,
  FreightTruckType,
  HistoricalFreightEditDriverOption,
  HistoricalFreightEditInput,
} from "../types";
import formStyles from "./FreightForm.module.css";

type Props = {
  freight: FreightResponse;
  options: FreightTariffOptions;
  onUpdated: (freight: FreightResponse) => void;
  onCancel: () => void;
};

type Values = Record<Exclude<
  keyof HistoricalFreightEditInput,
  "id_motorista_selecionado" | "complementar_com_entregas" | "adicionais_jit"
>, string> & { adicionais_jit: string };

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

function inferJustInTimeZone(cities: string[], options: FreightTariffOptions): string | null {
  const normalizedCities = new Set(cities.map(normalizePersonName));
  const matchingZones = options.zonas_just_in_time
    .flatMap((region) => region.subzonas)
    .filter((zone) => zone.areas.split(",").some((area) => normalizedCities.has(normalizePersonName(area))))
    .map((zone) => zone.codigo);
  const uniqueMatches = [...new Set(matchingZones)];
  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
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
    codigo_zona_jit: freight.codigo_zona_jit ?? "",
    adicionais_jit: freight.adicionais_jit.join(","),
    tipo_caminhao: freight.tipo_caminhao ?? "",
    carro_apoio: freight.carro_apoio ?? "",
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
    codigo_zona_jit: values.codigo_zona_jit.trim() || null,
    adicionais_jit: values.adicionais_jit
      ? values.adicionais_jit.split(",").filter(Boolean)
      : [],
    tipo_caminhao: values.tipo_caminhao ? values.tipo_caminhao as FreightTruckType : null,
    carro_apoio: values.carro_apoio === "SAVEIRO" || values.carro_apoio === "KIA_BONGO"
      ? values.carro_apoio
      : null,
    valor_avaria: optionalNonNegativeNumber(values.valor_avaria, "Valor da avaria") ?? 0,
  };
}

/** Edição de dados importados que conserva os valores históricos e audita as alterações. */
export function HistoricalFreightForm({ freight, options, onUpdated, onCancel }: Props) {
  const { user } = useAuth();
  const draftKey = `lancamento-logistica:draft:historical-freight:${user?.id_usuario}:${freight.codigo_frete}`;
  const [restored] = useState(() => readSessionDraft<{ values: Values; selectedDriverId: string; deliveryApplied: boolean; appliedDeliveryValues: Partial<Record<keyof Values, string>>; idempotency: { signature: string; key: string } | null }>(draftKey));
  const [values, setValues] = useState(() => {
    const defaults = valuesFromFreight(freight);
    return restored?.values ? { ...defaults, ...restored.values } : defaults;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editDrivers, setEditDrivers] = useState<HistoricalFreightEditDriverOption[]>([]);
  const [driversLoading, setDriversLoading] = useState(true);
  const [driversError, setDriversError] = useState("");
  const source = importDetails(freight);
  const originalSheetName = typeof source.transportador_planilha === "string"
    ? source.transportador_planilha
    : "";
  const [selectedDriverId, setSelectedDriverId] = useState(() => restored?.selectedDriverId ?? registeredDriverId(freight, source));
  const [deliverySummary, setDeliverySummary] = useState<FreightDeliverySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [deliveryApplied, setDeliveryApplied] = useState(restored?.deliveryApplied ?? false);
  const [appliedDeliveryValues, setAppliedDeliveryValues] = useState<Partial<Record<keyof Values, string>>>(restored?.appliedDeliveryValues ?? {});
  const driverSelectionTouched = useRef(Boolean(restored));
  const idempotency = useRef<{ signature: string; key: string } | null>(restored?.idempotency ?? null);

  useEffect(() => {
    writeSessionDraft(draftKey, { values, selectedDriverId, deliveryApplied, appliedDeliveryValues, idempotency: idempotency.current });
  }, [draftKey, values, selectedDriverId, deliveryApplied, appliedDeliveryValues]);

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

  useEffect(() => {
    if (
      freight.codigo_fonte_tarifa !== "JUST_IN_TIME"
      || values.codigo_zona_jit
      || !deliverySummary
    ) return;
    const inferredZone = inferJustInTimeZone(deliverySummary.cidades, options);
    if (inferredZone) {
      setValues((current) => current.codigo_zona_jit
        ? current
        : { ...current, codigo_zona_jit: inferredZone });
    }
  }, [freight.codigo_fonte_tarifa, deliverySummary, options, values.codigo_zona_jit]);

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
      writeSessionDraft(draftKey, { values, selectedDriverId, deliveryApplied, appliedDeliveryValues, idempotency: idempotency.current });
      const updated = await freightsApi.updateHistorical(
        String(freight.codigo_frete),
        payload,
        requestKey,
      );
      idempotency.current = null;
      clearSessionDraft(draftKey);
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
  const inferredZoneCode = freight.codigo_fonte_tarifa === "JUST_IN_TIME" && deliverySummary
    ? inferJustInTimeZone(deliverySummary.cidades, options)
    : null;
  const inferredZoneName = inferredZoneCode
    ? options.zonas_just_in_time.flatMap((region) => region.subzonas)
      .find((zone) => zone.codigo === inferredZoneCode)?.nome
    : undefined;
  const selectedAdditions = values.adicionais_jit.split(",").filter(Boolean);

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
              {freight.codigo_fonte_tarifa === "JUST_IN_TIME"
                && values.quantidade_entregas.trim()
                && Number(values.quantidade_entregas) !== deliverySummary.quantidade_entregas
                && <p className={cx(formStyles, "delivery-match-message")}>
                  A planilha informa {values.quantidade_entregas} entregas e o registro de Entregas soma {deliverySummary.quantidade_entregas}. Essa diferença fica para conferência; a quantidade de entregas não altera a tarifa JUST IN TIME.
                </p>}
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
          {freight.codigo_fonte_tarifa === "AGREGADOS_CD"
            ? freight.valor_frete_bruto !== null
              ? "O frete bruto histórico será preservado. KM ausente fica como aviso e não bloqueia o pagamento; rota, peso, nota e KM só são necessários para recalcular um bruto ausente."
              : "Para calcular o bruto de Agregados CD, preencha rota, peso, valor da nota e KM rodado. Entregas e quantidade de avarias não entram na fórmula da tarifa."
            : freight.codigo_fonte_tarifa === "JUST_IN_TIME"
              ? "JUST IN TIME não usa KM. Se o bruto estiver ausente, informe zona e peso; adicional é opcional. O valor líquido histórico, quando preenchido, basta para o pagamento."
              : "Paulo Cruz não usa KM, rota nem peso para calcular a tarifa. Se o bruto estiver ausente, informe o tipo de caminhão; carro de apoio é opcional. O valor líquido histórico, quando preenchido, basta para o pagamento."}
        </p>
        <div className={cx(formStyles, "field-grid", "field-grid-two")}>
          {field("quantidade_entregas", "Entregas", "text", sourceHasValue(source, "quantidade_entregas") ? "Informado na planilha; bloqueado." : "Ausente na planilha; pode ser completado pelas Entregas.", "numeric", sourceHasValue(source, "quantidade_entregas"))}
          {field("peso_kg", "Peso (kg)", "text", sourceHasValue(source, "peso_kg") ? "Informado na planilha; bloqueado." : "Ausente na planilha; pode ser completado pelas Entregas.", "decimal", sourceHasValue(source, "peso_kg"))}
          {freight.tipo_transporte === "AGREGADO" && <>
            {field("km_inicial", "KM inicial", "text", sourceHasValue(source, "km_inicial") ? "Informado na planilha; bloqueado." : undefined, "decimal", sourceHasValue(source, "km_inicial"))}
            {field("km_final", "KM final", "text", sourceHasValue(source, "km_final") ? "Informado na planilha; bloqueado." : undefined, "decimal", sourceHasValue(source, "km_final"))}
            {field("km_rodado", "KM rodado", "text", sourceHasValue(source, "km_rodado") ? "Informado na planilha; bloqueado." : "Necessário apenas para calcular o bruto pela tarifa Agregados CD.", "decimal", sourceHasValue(source, "km_rodado") || (sourceHasValue(source, "km_inicial") && sourceHasValue(source, "km_final")))}
          </>}
          {field("valor_nota", "Valor da nota (R$)", "text", sourceHasValue(source, "valor_nota") ? "Informado na planilha; bloqueado." : undefined, "decimal", sourceHasValue(source, "valor_nota"))}
          {freight.codigo_fonte_tarifa === "JUST_IN_TIME" && <>
            <label className={cx(formStyles, "field")}>Zona JUST IN TIME
              <select value={values.codigo_zona_jit} onChange={(event) => update("codigo_zona_jit", event.target.value)} disabled={busy}>
                <option value="">Selecione a zona tarifária</option>
                {options.zonas_just_in_time.map((region) => <optgroup key={region.codigo} label={region.nome}>
                  {region.subzonas.map((zone) => <option key={zone.codigo} value={zone.codigo}>{zone.nome}</option>)}
                </optgroup>)}
              </select>
              <small>{inferredZoneName
                ? `Área ${inferredZoneName} sugerida pelas Entregas; será usada ao salvar. Só há tarifas para Rio de Janeiro e Região Serrana. KM não se aplica.`
                : deliverySummary?.cidades.length
                  ? "As Entregas não identificam uma única área tarifária válida de Rio de Janeiro ou Região Serrana. Selecione a área após conferência."
                  : "Selecione uma área tarifária de Rio de Janeiro ou Região Serrana. KM não se aplica."}</small>
            </label>
            <fieldset className={cx(formStyles, "jit-additions-card")}>
              <legend>Adicionais JUST IN TIME (opcional)</legend>
              <p className={cx(formStyles, "checkbox-help")}>Marque os adicionais que se aplicam a este frete.</p>
              <div className={cx(formStyles, "checkbox-list")}>
                {options.adicionais_just_in_time.map((addition) => {
                  const checked = selectedAdditions.includes(addition.codigo);
                  return <label className={cx(formStyles, `checkbox-option${checked ? " checkbox-option-selected" : ""}`)} key={addition.codigo}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...new Set([...selectedAdditions, addition.codigo])]
                          : selectedAdditions.filter((code) => code !== addition.codigo);
                        update("adicionais_jit", next.join(","));
                      }}
                    />
                    <span>{addition.nome}</span>
                  </label>;
                })}
              </div>
              {selectedAdditions.length > 1 && <small className={cx(formStyles, "jit-review-note")}>Mais de um adicional exige conferência antes do cálculo.</small>}
            </fieldset>
          </>}
          {freight.codigo_fonte_tarifa === "PAULO_CRUZ" && <>
            <label className={cx(formStyles, "field")}>Tipo de caminhão
              <select value={values.tipo_caminhao} onChange={(event) => update("tipo_caminhao", event.target.value)} disabled={busy}>
                <option value="">Selecione o caminhão tarifado</option>
                {options.tipos_caminhao_paulo_cruz.map((truck) => <option key={truck.codigo} value={truck.codigo}>{truck.nome}</option>)}
              </select>
              <small>Campo necessário para calcular o bruto; rota, peso e KM não alteram essa tarifa.</small>
            </label>
            <label className={cx(formStyles, "field")}>Carro de apoio (opcional)
              <select value={values.carro_apoio} onChange={(event) => update("carro_apoio", event.target.value)} disabled={busy}>
                <option value="">Sem carro de apoio</option>
                <option value="SAVEIRO">Saveiro · adicional de R$ 300,00</option>
                <option value="KIA_BONGO">Bongo · adicional de R$ 500,00</option>
              </select>
              <small>Deixe sem seleção quando não houver carro de apoio.</small>
            </label>
          </>}
          {field("valor_frete_bruto", "Frete bruto (R$)", "text", sourceHasValue(source, "valor_frete_bruto") ? "Informado na planilha; bloqueado." : freight.codigo_fonte_tarifa === "AGREGADOS_CD" ? "Em branco: calcula com rota, peso, nota e KM rodado, se os dados e a rota tarifária estiverem válidos." : freight.codigo_fonte_tarifa === "JUST_IN_TIME" ? "Em branco: calcula com zona, peso e o adicional opcional selecionado." : "Em branco: calcula pelo tipo de caminhão e pelo carro de apoio opcional.", "decimal", sourceHasValue(source, "valor_frete_bruto"))}
          {field("valor_avaria", "Avaria (R$)", "text", sourceHasValue(source, "valor_avaria") ? "Informado na planilha; bloqueado." : "Ausente na planilha; informe o valor em reais se conhecido.", "decimal", sourceHasValue(source, "valor_avaria"))}
          {field("valor_frete_pago", "Total líquido (R$)", "text", sourceHasValue(source, "valor_frete_pago") ? "Informado na planilha; bloqueado." : "Se deixar em branco, será calculado como frete bruto menos avaria.", "decimal", sourceHasValue(source, "valor_frete_pago"))}
          {field("percentual_frete", "Percentual (%)", "text", sourceHasValue(source, "percentual_frete") ? "Informado na planilha; bloqueado." : "Informe, por exemplo, 12 para 12%. Em branco, será calculado pela nota.", "decimal", sourceHasValue(source, "percentual_frete"))}
        </div>
        {freight.tipo_transporte === "TRANSPORTADORA" && <div className={cx(formStyles, "distance-result")}><span>Hodômetro operacional</span><strong>Não se aplica</strong><small>JUST IN TIME e Paulo Cruz não usam KM no cálculo do frete; eventual KM original continua preservado na planilha de origem.</small></div>}
        {Boolean(source.ultima_edicao_manual) && <p className={cx(formStyles, "route-hint")}>Este lançamento já foi corrigido anteriormente. A próxima alteração também será auditada.</p>}
      </div>

      {error && <div className={cx(commonStyles, "notice notice-error", "form-message")} role="alert">{error}</div>}

      <div className={cx(formStyles, "form-actions")}>
        <span>O histórico da planilha será mantido junto com a nova revisão dos dados.</span>
        <div>
          <button className={cx(commonStyles, "button button-secondary")} type="button" onClick={onCancel} disabled={busy}>Voltar</button>
          <button className={cx(commonStyles, "button button-primary")} type="submit" disabled={busy}>{busy ? "Salvando…" : freight.valor_frete_bruto === null ? "Salvar e calcular frete" : "Salvar alterações"}</button>
        </div>
      </div>
    </form>
  );
}
