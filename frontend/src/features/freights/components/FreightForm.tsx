import { useAuth } from "../../../app/providers";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "../../../shared/drafts/sessionDraft";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import { freightsApi } from "../api";
import { formatMoney, formatNumber, localDateValue, numericValue } from "../format";
import type {
  FreightInput,
  FreightAggregateDriverOption,
  FreightCarrierDriverOption,
  FreightDeliverySummary,
  FreightQuoteResponse,
  FreightResponse,
  FreightTariffOptions,
  FreightTariffSource,
  FreightTransportType,
  FreightTruckType,
} from "../types";
import styles from "./FreightForm.module.css";

type FormValues = {
  data_servico: string;
  tipo_transporte: FreightTransportType;
  nome_transportador: string;
  id_motorista_agregado: string;
  id_motorista_transportadora: string;
  codigo_fonte_tarifa: FreightTariffSource | "";
  rota_cidade: string;
  km_inicial: string;
  km_final: string;
  quantidade_entregas: string;
  peso_kg: string;
  valor_nota: string;
  valor_frete_bruto: string;
  valor_avaria: string;
  quantidade_avarias: string;
  nome_cliente: string;
  codigo_cliente: string;
  observacao: string;
  codigo_zona_jit: string;
  codigos_zonas_jit: string[];
  adicionais_jit: string[];
  tipo_caminhao: FreightTruckType | "";
  carro_apoio: "SAVEIRO" | "KIA_BONGO" | "";
};

type Props = {
  options: FreightTariffOptions;
  onCreated: (freight: FreightResponse) => void;
  initialFreight?: FreightResponse;
  onUpdated?: (freight: FreightResponse) => void;
};

function emptyValues(options: FreightTariffOptions): FormValues {
  return {
    data_servico: localDateValue(),
    tipo_transporte: "AGREGADO",
    nome_transportador: "",
    id_motorista_agregado: "",
    id_motorista_transportadora: "",
    codigo_fonte_tarifa: (options.fontes.find((source) => source.codigo === "AGREGADOS_CD")?.codigo as FreightTariffSource | undefined) ?? "AGREGADOS_CD",
    rota_cidade: "",
    km_inicial: "",
    km_final: "",
    quantidade_entregas: "0",
    peso_kg: "0",
    valor_nota: "",
    valor_frete_bruto: "",
    valor_avaria: "0",
    quantidade_avarias: "0",
    nome_cliente: "",
    codigo_cliente: "",
    observacao: "",
    codigo_zona_jit: "",
    codigos_zonas_jit: [],
    adicionais_jit: [],
    tipo_caminhao: "",
    carro_apoio: "",
  };
}

function valuesFromFreight(freight: FreightResponse): FormValues {
  return {
    data_servico: freight.data_servico,
    tipo_transporte: freight.tipo_transporte === "TRANSPORTADORA" ? "TRANSPORTADORA" : "AGREGADO",
    nome_transportador: freight.nome_transportador ?? "",
    id_motorista_agregado: freight.id_motorista_agregado === null ? "" : String(freight.id_motorista_agregado),
    id_motorista_transportadora: freight.id_motorista_transportadora == null ? "" : String(freight.id_motorista_transportadora),
    codigo_fonte_tarifa: freight.codigo_fonte_tarifa ?? "",
    rota_cidade: freight.rota_cidade ?? "",
    km_inicial: freight.km_inicial === null ? "" : String(freight.km_inicial),
    km_final: freight.km_final === null ? "" : String(freight.km_final),
    quantidade_entregas: freight.quantidade_entregas === null ? "" : String(freight.quantidade_entregas),
    peso_kg: freight.peso_kg === null ? "" : String(freight.peso_kg),
    valor_nota: freight.valor_nota === null ? "" : String(freight.valor_nota),
    valor_frete_bruto: freight.valor_frete_bruto === null ? "" : String(freight.valor_frete_bruto),
    valor_avaria: String(freight.valor_avaria),
    quantidade_avarias: String(freight.quantidade_avarias),
    nome_cliente: freight.nome_cliente ?? "",
    codigo_cliente: freight.codigo_cliente ?? "",
    observacao: freight.observacao ?? "",
    codigo_zona_jit: freight.codigo_zona_jit ?? freight.codigos_zonas_jit?.[0] ?? "",
    codigos_zonas_jit: freight.codigos_zonas_jit?.length
      ? freight.codigos_zonas_jit
      : freight.codigo_zona_jit ? [freight.codigo_zona_jit] : [],
    adicionais_jit: freight.adicionais_jit,
    tipo_caminhao: freight.tipo_caminhao ?? "",
    carro_apoio: freight.carro_apoio ?? "",
  };
}

function valuesFromDraft(values: FormValues, options: FreightTariffOptions): FormValues {
  const zones = values.codigos_zonas_jit?.length
    ? values.codigos_zonas_jit
    : values.codigo_zona_jit ? [values.codigo_zona_jit] : [];
  return { ...emptyValues(options), ...values, codigos_zonas_jit: zones };
}

function decimalInput(value: string, label: string, optional = false): number | null {
  if (!value.trim() && optional) return null;
  const parsed = numericValue(value);
  if (parsed === null || parsed < 0) throw new Error(`${label}: informe um número igual ou maior que zero.`);
  return parsed;
}

function payloadFromValues(values: FormValues): FreightInput {
  if (!values.data_servico) throw new Error("Informe a data do serviço.");
  if (values.tipo_transporte === "TRANSPORTADORA" && values.codigo_fonte_tarifa !== "JUST_IN_TIME" && values.codigo_fonte_tarifa !== "PAULO_CRUZ") {
    throw new Error("Selecione a transportadora na etapa 01.");
  }
  if (values.codigo_fonte_tarifa === "JUST_IN_TIME" && values.codigos_zonas_jit.length === 0) {
    throw new Error("Marque pelo menos uma zona de atendimento JUST IN TIME.");
  }
  if (values.codigo_fonte_tarifa !== "JUST_IN_TIME" && values.rota_cidade.trim().length < 2) {
    throw new Error("Informe a rota ou cidade do frete.");
  }

  if (values.tipo_transporte === "AGREGADO" && values.nome_transportador.trim().length < 2) {
    throw new Error("Selecione um motorista no cadastro de equipes.");
  }
  if (values.tipo_transporte === "TRANSPORTADORA" && values.nome_transportador.trim().length < 2) {
    throw new Error("Informe o nome da transportadora.");
  }
  if (values.tipo_transporte === "TRANSPORTADORA" && !values.id_motorista_transportadora) {
    throw new Error("Selecione o motorista da transportadora.");
  }

  const odometerIsOptional = values.tipo_transporte === "TRANSPORTADORA";
  const initial = odometerIsOptional ? null : decimalInput(values.km_inicial, "KM inicial");
  const final = odometerIsOptional ? null : decimalInput(values.km_final, "KM final");
  if (!odometerIsOptional && (initial === null || final === null)) {
    throw new Error("Informe as duas leituras do hodômetro.");
  }
  if (initial !== null && final !== null && final < initial) {
    throw new Error("KM final deve ser igual ou maior que KM inicial.");
  }

  const deliveries = Number(values.quantidade_entregas);
  if (!Number.isInteger(deliveries) || deliveries < 0) {
    throw new Error("Informe uma quantidade de entregas igual ou maior que zero.");
  }
  const weight = decimalInput(values.peso_kg, "Peso");
  const damage = decimalInput(values.valor_avaria, "Valor da Avaria");
  const damageCount = Number(values.quantidade_avarias);
  if (!Number.isInteger(damageCount) || damageCount < 0) {
    throw new Error("A quantidade de avarias deve ser um número igual ou maior que zero.");
  }
  const invoice = decimalInput(values.valor_nota, "Valor da nota", true);
  const gross = decimalInput(values.valor_frete_bruto, "Valor bruto do frete", true);
  if (values.tipo_transporte === "AGREGADO" && values.codigo_fonte_tarifa !== "AGREGADOS_CD") {
    throw new Error("Selecione a tabela de tarifa de agregados.");
  }
  if (values.tipo_transporte === "AGREGADO" && invoice === null) {
    throw new Error("Informe o valor da nota para calcular a tarifa Agregados CD.");
  }
  if (values.codigo_fonte_tarifa === "PAULO_CRUZ" && !values.tipo_caminhao) {
    throw new Error("Selecione o tipo de caminhão da tarifa Paulo Cruz.");
  }

  return {
    data_servico: values.data_servico,
    tipo_transporte: values.tipo_transporte,
    nome_transportador: values.nome_transportador.trim().replace(/\s+/g, " "),
    id_motorista_agregado: values.tipo_transporte === "AGREGADO" ? Number(values.id_motorista_agregado) : null,
    id_motorista_transportadora: values.tipo_transporte === "TRANSPORTADORA" ? Number(values.id_motorista_transportadora) : null,
    codigo_fonte_tarifa: values.codigo_fonte_tarifa as FreightTariffSource,
    rota_cidade: values.rota_cidade.trim().replace(/\s+/g, " "),
    km_inicial: initial,
    km_final: final,
    quantidade_entregas: deliveries,
    peso_kg: weight ?? 0,
    valor_nota: invoice,
    valor_frete_bruto: gross,
    valor_avaria: damage ?? 0,
    quantidade_avarias: values.tipo_transporte === "AGREGADO" ? damageCount : 0,
    nome_cliente: values.nome_cliente.trim() || null,
    codigo_cliente: values.codigo_cliente.trim() || null,
    observacao: values.observacao.trim() || null,
    codigo_zona_jit: values.codigo_fonte_tarifa === "JUST_IN_TIME" ? values.codigos_zonas_jit[0] ?? null : null,
    codigos_zonas_jit: values.codigo_fonte_tarifa === "JUST_IN_TIME" ? values.codigos_zonas_jit : [],
    adicionais_jit: values.codigo_fonte_tarifa === "JUST_IN_TIME" ? values.adicionais_jit : [],
    tipo_caminhao: values.codigo_fonte_tarifa === "PAULO_CRUZ" ? values.tipo_caminhao as FreightTruckType : null,
    carro_apoio: values.codigo_fonte_tarifa === "PAULO_CRUZ" ? values.carro_apoio || null : null,
  };
}

/** Formulário do lançamento, incluindo leitura do hodômetro e cotação da tarifa. */
export function FreightForm({ options, onCreated, initialFreight, onUpdated }: Props) {
  const { user } = useAuth();
  const draftKey = `lancamento-logistica:draft:freight:${user?.id_usuario}:${initialFreight?.codigo_frete ?? "new"}`;
  const [restored] = useState(() => readSessionDraft<{ values: FormValues; idempotency: { signature: string; key: string } | null }>(draftKey));
  const dateId = useId();
  const transportTypeId = useId();
  const aggregateDriverId = useId();
  const transporterDriverId = useId();
  const sourceId = useId();
  const routeId = useId();
  const kmInitialId = useId();
  const kmFinalId = useId();
  const deliveriesId = useId();
  const weightId = useId();
  const invoiceId = useId();
  const grossId = useId();
  const damageId = useId();
  const damageCountId = useId();
  const truckId = useId();
  const supportId = useId();
  const [values, setValues] = useState(() => restored
    ? valuesFromDraft(restored.values, options)
    : initialFreight ? valuesFromFreight(initialFreight) : emptyValues(options));
  const preserveSummaryFor = useRef(restored || initialFreight ? `${values.data_servico}:${values.id_motorista_agregado}` : "");
  const [aggregateDrivers, setAggregateDrivers] = useState<FreightAggregateDriverOption[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [driversError, setDriversError] = useState("");
  const [carrierDrivers, setCarrierDrivers] = useState<FreightCarrierDriverOption[]>([]);
  const [carrierDriversLoading, setCarrierDriversLoading] = useState(false);
  const [carrierDriversError, setCarrierDriversError] = useState("");
  const [deliverySummary, setDeliverySummary] = useState<FreightDeliverySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [quote, setQuote] = useState<FreightQuoteResponse | null>(null);
  const [quoteSignature, setQuoteSignature] = useState("");
  const [pendingSignature, setPendingSignature] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"quote" | "submit" | null>(null);
  const idempotency = useRef<{ signature: string; key: string } | null>(restored?.idempotency ?? null);

  useEffect(() => {
    writeSessionDraft(draftKey, { values, idempotency: idempotency.current });
  }, [draftKey, values]);

  useEffect(() => {
    if (values.tipo_transporte !== "AGREGADO") {
      setDriversLoading(false);
      setDriversError("");
      return;
    }
    let active = true;
    setDriversLoading(true);
    setDriversError("");
    void freightsApi.aggregateDrivers(values.data_servico)
      .then((drivers) => {
        if (!active) return;
        setAggregateDrivers(drivers);
        setValues((current) => {
          const selected = drivers.find((driver) => String(driver.id_motorista) === current.id_motorista_agregado);
          if (current.tipo_transporte !== "AGREGADO" || selected) return current;
          return { ...current, id_motorista_agregado: "", nome_transportador: "", rota_cidade: "", quantidade_entregas: "0", peso_kg: "0", quantidade_avarias: "0" };
        });
      })
      .catch((loadError: unknown) => { if (active) setDriversError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setDriversLoading(false); });
    return () => { active = false; };
  }, [values.data_servico, values.tipo_transporte]);

  useEffect(() => {
    if (values.tipo_transporte !== "TRANSPORTADORA") {
      setCarrierDrivers([]);
      setCarrierDriversLoading(false);
      setCarrierDriversError("");
      setValues((current) => current.id_motorista_transportadora
        ? { ...current, id_motorista_transportadora: "" }
        : current);
      return;
    }
    let active = true;
    setCarrierDrivers([]);
    setCarrierDriversLoading(true);
    setCarrierDriversError("");
    void freightsApi.carrierDrivers(values.data_servico)
      .then((drivers) => {
        if (!active) return;
        setCarrierDrivers(drivers);
        setValues((current) => {
          if (current.tipo_transporte !== "TRANSPORTADORA"
            || current.data_servico !== values.data_servico) return current;
          const selected = drivers.find((driver) =>
            String(driver.id_motorista) === current.id_motorista_transportadora
            && driver.codigo_transportadora === current.codigo_fonte_tarifa,
          );
          if (selected) return current;
          return current.id_motorista_transportadora
            ? {
                ...current,
                id_motorista_transportadora: "",
                codigo_fonte_tarifa: "",
                nome_transportador: "",
              }
            : current;
        });
      })
      .catch((loadError: unknown) => { if (active) setCarrierDriversError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setCarrierDriversLoading(false); });
    return () => { active = false; };
  }, [values.data_servico, values.tipo_transporte]);

  useEffect(() => {
    const idMotorista = Number(values.id_motorista_agregado);
    if (values.tipo_transporte !== "AGREGADO" || !Number.isInteger(idMotorista) || idMotorista < 1) {
      setDeliverySummary(null);
      setSummaryError("");
      return;
    }
    let active = true;
    setDeliverySummary(null);
    setSummaryLoading(true);
    setSummaryError("");
    void freightsApi.deliverySummary(values.data_servico, idMotorista)
      .then((summary) => {
        if (!active) return;
        setDeliverySummary(summary);
        const summaryKey = `${summary.data_servico}:${summary.id_motorista}`;
        if (preserveSummaryFor.current === summaryKey) {
          preserveSummaryFor.current = "";
          return;
        }
        setValues((current) => summary.quantidade_registros > 0 && current.data_servico === summary.data_servico
          && current.id_motorista_agregado === String(summary.id_motorista)
          ? { ...current, rota_cidade: summary.rota_cidade, quantidade_entregas: String(summary.quantidade_entregas), peso_kg: summary.peso_total_kg === null || Number(summary.peso_total_kg) <= 0 ? current.peso_kg : String(summary.peso_total_kg), quantidade_avarias: String(summary.quantidade_avarias), valor_frete_bruto: "" }
          : current);
      })
      .catch((loadError: unknown) => { if (active) setSummaryError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [values.data_servico, values.id_motorista_agregado, values.tipo_transporte]);

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    const resetGross = key !== "valor_frete_bruto" && key !== "valor_avaria" && key !== "quantidade_avarias" && key !== "nome_cliente" && key !== "codigo_cliente" && key !== "observacao";
    setValues((current) => ({
      ...current,
      [key]: value,
      ...(resetGross ? { valor_frete_bruto: "" } : {}),
    }));
    setQuote(null);
    setQuoteSignature("");
    setPendingSignature("");
    setError("");
  };

  const selectedRoute = options.rotas_agregados_cd.find((route) => route.codigo === values.rota_cidade || route.nome === values.rota_cidade);
  const sourceOptions = options.fontes.filter((source) => values.tipo_transporte === "AGREGADO"
    ? source.codigo === "AGREGADOS_CD"
    : source.codigo === "JUST_IN_TIME" || source.codigo === "PAULO_CRUZ");
  const selectedSource = sourceOptions.find((source) => source.codigo === values.codigo_fonte_tarifa);
  const kmInitial = numericValue(values.km_inicial);
  const kmFinal = numericValue(values.km_final);
  const kmRun = kmInitial !== null && kmFinal !== null && kmFinal >= kmInitial ? kmFinal - kmInitial : null;
  const aggregateSummaryMatches = deliverySummary !== null
    && deliverySummary.id_motorista === Number(values.id_motorista_agregado)
    && deliverySummary.data_servico === values.data_servico;
  const aggregateWeight = aggregateSummaryMatches ? numericValue(deliverySummary.peso_total_kg) : null;
  const deliveryWeightAvailable = aggregateSummaryMatches && aggregateWeight !== null && aggregateWeight > 0;
  const manuallyEnteredWeight = numericValue(values.peso_kg);
  const manuallyEnteredWeightAvailable = manuallyEnteredWeight !== null && manuallyEnteredWeight > 0;
  const aggregateSummaryReady = values.tipo_transporte !== "AGREGADO"
    || (aggregateSummaryMatches
      && manuallyEnteredWeightAvailable);
  const aggregateSummaryProblem = summaryError
    || (aggregateSummaryMatches
      ? "Informe um peso total maior que zero para continuar."
      : "Selecione um motorista e aguarde a consulta de Entregas.");
  const selectedCarrierDriverExists = carrierDrivers.some(
    (driver) => String(driver.id_motorista) === values.id_motorista_transportadora
      && driver.codigo_transportadora === values.codigo_fonte_tarifa,
  );
  const carrierDriverReady = values.tipo_transporte !== "TRANSPORTADORA"
    || (!carrierDriversLoading && !carrierDriversError && selectedCarrierDriverExists);

  async function simulate(): Promise<void> {
    if (!carrierDriverReady) {
      setError(carrierDriversError || "Selecione o motorista e a transportadora independente.");
      return;
    }
    if (!aggregateSummaryReady || summaryLoading) {
      setError(aggregateSummaryProblem);
      return;
    }
    let input: FreightInput;
    try {
      input = payloadFromValues(values);
    } catch (validationError) {
      setError(messageFromApiError(validationError));
      return;
    }
    setBusy(true);
    setBusyAction("quote");
    setError("");
    try {
      const result = await freightsApi.quote(input);
      const quotedGross = numericValue(result.valor_frete_bruto);
      const reviewedInput = input.valor_frete_bruto == null && quotedGross !== null
        ? { ...input, valor_frete_bruto: quotedGross }
        : input;
      if (input.valor_frete_bruto == null && quotedGross !== null) {
        setValues((current) => ({ ...current, valor_frete_bruto: String(quotedGross) }));
      }
      const signature = JSON.stringify(reviewedInput);
      setQuote(result);
      setQuoteSignature(signature);
      setPendingSignature(quotedGross !== null || input.valor_frete_bruto != null ? signature : "");
    } catch (quoteError: unknown) {
      setError(messageFromApiError(quoteError));
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!carrierDriverReady) {
      setError(carrierDriversError || "Selecione o motorista e a transportadora independente.");
      return;
    }
    if (!aggregateSummaryReady || summaryLoading) {
      setError(aggregateSummaryProblem);
      return;
    }
    let payload: FreightInput;
    try {
      payload = payloadFromValues(values);
    } catch (validationError) {
      setError(messageFromApiError(validationError));
      return;
    }
    setBusy(true);
    setBusyAction("submit");
    setError("");
    try {
      const latestQuote = await freightsApi.quote(payload);
      const quotedGross = numericValue(latestQuote.valor_frete_bruto);
      const finalPayload = payload.valor_frete_bruto == null && quotedGross !== null
        ? { ...payload, valor_frete_bruto: quotedGross }
        : payload;
      if (payload.valor_frete_bruto == null && quotedGross !== null) {
        setValues((current) => ({ ...current, valor_frete_bruto: String(quotedGross) }));
      }
      const signature = JSON.stringify(finalPayload);
      setQuote(latestQuote);
      setQuoteSignature(signature);
      if (finalPayload.valor_frete_bruto == null) {
        setPendingSignature("");
        setError("A tarifa não gerou um valor automaticamente. Informe o valor bruto correto para continuar com o lançamento.");
        return;
      }
      if (pendingSignature !== signature) {
        setPendingSignature(signature);
        return;
      }
      setPendingSignature("");
      if (!idempotency.current || idempotency.current.signature !== signature) {
        idempotency.current = { signature, key: crypto.randomUUID() };
      }
      writeSessionDraft(draftKey, { values, idempotency: idempotency.current });
      const saved = initialFreight
        ? await freightsApi.update(initialFreight.codigo_frete, finalPayload, idempotency.current.key)
        : await freightsApi.create(finalPayload, idempotency.current.key);
      idempotency.current = null;
      clearSessionDraft(draftKey);
      if (!initialFreight) setValues(emptyValues(options));
      if (initialFreight) onUpdated?.(saved);
      else onCreated(saved);
    } catch (submitError: unknown) {
      setError(messageFromApiError(submitError));
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  const currentSignature = (() => {
    try { return JSON.stringify(payloadFromValues(values)); } catch { return ""; }
  })();
  const liveQuote = quote && quoteSignature === currentSignature ? quote : null;
  const pendingConfirm = currentSignature !== "" && pendingSignature === currentSignature;
  const jitZoneOptions = options.zonas_just_in_time.flatMap((region) => region.subzonas);
  const selectedJitZoneNames = jitZoneOptions
    .filter((zone) => values.codigos_zonas_jit.includes(zone.codigo))
    .map((zone) => zone.nome);
  const selectedTruck = options.tipos_caminhao_paulo_cruz.find((truck) => truck.codigo === values.tipo_caminhao);

  return (
    <form className={cx(styles, commonStyles, "portal-page", "freight-form")} onSubmit={submit}>
      <section className={cx(styles, "form-card")} aria-labelledby="freight-service-heading">
        <div className={cx(styles, "form-section-heading")}>
          <div><span className={cx(styles, "step-number")}>01</span><div><p>IDENTIFICAÇÃO DO SERVIÇO</p><h2 id="freight-service-heading">Quem realizou o frete?</h2></div></div>
        </div>
        <div className={cx(styles, "field-grid", "field-grid-two")}>
          <label className={cx(styles, "field")} htmlFor={transportTypeId}>Tipo de transporte
            <select id={transportTypeId} value={values.tipo_transporte} onChange={(event) => {
              const type = event.target.value as FreightTransportType;
              const source: FreightTariffSource | "" = type === "AGREGADO" ? "AGREGADOS_CD" : "";
              setValues((current) => ({ ...current, tipo_transporte: type, nome_transportador: "", id_motorista_agregado: "", id_motorista_transportadora: "", codigo_fonte_tarifa: source, rota_cidade: "", quantidade_entregas: "0", peso_kg: "0", quantidade_avarias: "0", codigo_zona_jit: "", codigos_zonas_jit: [], adicionais_jit: [], valor_frete_bruto: "", tipo_caminhao: "", carro_apoio: "", km_inicial: "", km_final: "" }));
              setQuote(null); setQuoteSignature(""); setPendingSignature(""); setError("");
            }} disabled={busy}>
              <option value="AGREGADO">Agregado</option>
              <option value="TRANSPORTADORA">Transportadora independente</option>
            </select>
          </label>
          {values.tipo_transporte === "AGREGADO" && <label className={cx(styles, "field")} htmlFor={aggregateDriverId}>Motorista de entrega terceirizada
            <select id={aggregateDriverId} value={values.id_motorista_agregado} onChange={(event) => {
              const id = event.target.value;
              const driver = aggregateDrivers.find((item) => String(item.id_motorista) === id);
              setValues((current) => ({ ...current, id_motorista_agregado: id, nome_transportador: driver?.nome_motorista ?? "", rota_cidade: "", quantidade_entregas: "0", peso_kg: "0", quantidade_avarias: "0", valor_frete_bruto: "" }));
              setQuote(null); setQuoteSignature(""); setPendingSignature(""); setError("");
            }} required disabled={busy || driversLoading || Boolean(driversError)}>
              <option value="">{driversLoading ? "Carregando motoristas..." : "Selecione o motorista"}</option>
              {aggregateDrivers.map((driver) => <option key={driver.id_motorista} value={driver.id_motorista}>{driver.nome_motorista}</option>)}
            </select>
            {driversError && <small role="alert">{driversError}</small>}
            {!driversLoading && !driversError && aggregateDrivers.length === 0 && <small role="status">Não há motoristas classificados como Agregado e vigentes nesta data.</small>}
          </label>}
          {values.tipo_transporte === "TRANSPORTADORA" && <label className={cx(styles, "field")} htmlFor={transporterDriverId}>Motorista / transportadora
            <select id={transporterDriverId} value={values.id_motorista_transportadora} onChange={(event) => {
              const id = event.target.value;
              const selected = carrierDrivers.find((driver) => String(driver.id_motorista) === id);
              setValues((current) => ({
                ...current,
                id_motorista_transportadora: id,
                codigo_fonte_tarifa: selected?.codigo_transportadora ?? "",
                nome_transportador: selected?.nome_transportadora ?? "",
                rota_cidade: "",
                codigo_zona_jit: "",
                codigos_zonas_jit: [],
                adicionais_jit: [],
                valor_frete_bruto: "",
                tipo_caminhao: "",
                carro_apoio: "",
              }));
              setQuote(null); setQuoteSignature(""); setPendingSignature(""); setError("");
            }} required disabled={busy || carrierDriversLoading || Boolean(carrierDriversError)}>
              <option value="">{carrierDriversLoading ? "Carregando motoristas..." : "Selecione o motorista"}</option>
              {carrierDrivers.map((driver) => <option key={driver.id_motorista} value={driver.id_motorista}>{driver.nome_motorista} · {driver.nome_transportadora}</option>)}
            </select>
            {carrierDriversError && <small role="alert">{carrierDriversError}</small>}
            {!carrierDriversLoading && !carrierDriversError && carrierDrivers.length === 0 && <small role="status">Nenhum motorista ativo de transportadora independente nesta data. Confira o cadastro em Administração &gt; Cadastros.</small>}
          </label>}
          <label className={cx(styles, "field")} htmlFor={dateId}>Data do serviço
            <input id={dateId} type="date" value={values.data_servico} onChange={(event) => update("data_servico", event.target.value)} required disabled={busy} />
          </label>
        </div>
      </section>

      <section className={cx(styles, "form-card")} aria-labelledby="freight-route-heading">
        <div className={cx(styles, "form-section-heading")}>
          <div><span className={cx(styles, "step-number")}>02</span><div><p>ROTA E TARIFA</p><h2 id="freight-route-heading">Onde foi realizado?</h2></div></div>
        </div>
        <div className={cx(styles, "field-grid", "field-grid-two")}>
          {values.tipo_transporte === "TRANSPORTADORA" ? <div className={cx(styles, "field")}>
            <span>Transportadora selecionada</span>
            <div className={cx(styles, "locked-selection")} aria-live="polite">{selectedSource?.nome ?? "Selecione na etapa 01"}</div>
            <small>Definida na etapa 01 e mantida nesta cotação.</small>
          </div> : <label className={cx(styles, "field")} htmlFor={sourceId}>Fonte tarifária
            <select id={sourceId} value={values.codigo_fonte_tarifa} onChange={(event) => {
              const source = event.target.value as FreightTariffSource;
              setValues((current) => ({ ...current, codigo_fonte_tarifa: source, rota_cidade: "", codigo_zona_jit: "", codigos_zonas_jit: [], adicionais_jit: [], valor_frete_bruto: "", tipo_caminhao: "", carro_apoio: "" }));
              setQuote(null); setQuoteSignature(""); setPendingSignature(""); setError("");
            }} disabled={busy}>
              {sourceOptions.map((source) => <option key={source.codigo} value={source.codigo}>{source.nome}</option>)}
            </select>
          </label>}
          {values.tipo_transporte === "AGREGADO" ? (
            <label className={cx(styles, "field")} htmlFor={routeId}>Cidade / rota
              <select id={routeId} value={values.rota_cidade} onChange={(event) => update("rota_cidade", event.target.value)} required disabled={busy || summaryLoading}>
                <option value="">Selecione a rota</option>
                {values.rota_cidade && !options.rotas_agregados_cd.some((route) => route.nome === values.rota_cidade || route.codigo === values.rota_cidade) && <option value={values.rota_cidade}>{values.rota_cidade}</option>}
                {options.rotas_agregados_cd.map((route) => <option key={route.codigo} value={route.nome}>{route.nome}</option>)}
              </select>
              {summaryError && <small role="alert">{summaryError}</small>}
              {deliverySummary && deliverySummary.cidades.length > 1 && <small>Cidades consideradas: {deliverySummary.cidades.join(", ")}</small>}
              <small>{deliverySummary?.quantidade_registros ? "Preenchida pelas Entregas; confira e altere se necessário." : "Selecione a rota do frete."}</small>
            </label>
          ) : values.codigo_fonte_tarifa === "JUST_IN_TIME" ? (
            <div className={cx(styles, "field")}>
              <span>Zonas selecionadas</span>
              <div className={cx(styles, "locked-selection")}>
                {selectedJitZoneNames.length ? selectedJitZoneNames.join(", ") : "Nenhuma zona selecionada"}
              </div>
              <small>Marque abaixo todas as zonas atendidas por este serviço.</small>
            </div>
          ) : values.codigo_fonte_tarifa === "PAULO_CRUZ" ? (
            <label className={cx(styles, "field")} htmlFor={routeId}>Cidade / rota
              <input id={routeId} value={values.rota_cidade} onChange={(event) => update("rota_cidade", event.target.value)} required minLength={2} maxLength={160} placeholder="Ex.: Macaé — região serrana" disabled={busy} />
            </label>
          ) : (
            <div className={cx(styles, "field")}>
              <span>Região / rota</span>
              <div className={cx(styles, "locked-selection")}>Selecione a transportadora na etapa 01</div>
            </div>
          )}
        </div>
        {values.codigo_fonte_tarifa === "JUST_IN_TIME" && <section className={cx(styles, "jit-panel")} aria-label="Configuração da tarifa JUST IN TIME">
          <header className={cx(styles, "jit-panel-header")}>
            <div><p>CONFIGURAÇÃO DA TARIFA</p><h3>JUST IN TIME</h3><span>Marque as zonas atendidas e os adicionais aplicáveis.</span></div>
            <span className={cx(styles, "jit-selection-count")}>{values.codigos_zonas_jit.length === 0 ? "Nenhuma zona" : `${values.codigos_zonas_jit.length} ${values.codigos_zonas_jit.length === 1 ? "zona" : "zonas"}`}</span>
          </header>
          <div className={cx(styles, "jit-grid")}>
            <fieldset className={cx(styles, "jit-additions-card")}>
              <legend>Zonas atendidas <span aria-hidden="true">*</span></legend>
              <p className={cx(styles, "checkbox-help")}>Selecione uma ou mais zonas. A região de cada zona e suas áreas atendidas aparecem abaixo.</p>
              <div className={cx(styles, "jit-zone-groups")}>
                {options.zonas_just_in_time.map((region) => <section className={cx(styles, "jit-zone-group")} key={region.codigo}>
                  <h4 className={cx(styles, "jit-zone-group-title")}>{region.nome}</h4>
                  <div className={cx(styles, "checkbox-list")}>
                    {region.subzonas.map((zone) => {
                      const checked = values.codigos_zonas_jit.includes(zone.codigo);
                      return <label className={cx(styles, `checkbox-option checkbox-zone-option${checked ? " checkbox-option-selected" : ""}`)} key={zone.codigo}>
                        <input
                          type="checkbox"
                          checked={checked}
                          aria-required="true"
                          disabled={busy}
                          onChange={(event) => {
                            const nextCodes = event.target.checked
                              ? [...values.codigos_zonas_jit, zone.codigo]
                              : values.codigos_zonas_jit.filter((code) => code !== zone.codigo);
                            const nextZones = jitZoneOptions.filter((item) => nextCodes.includes(item.codigo));
                            setValues((current) => ({
                              ...current,
                              codigos_zonas_jit: nextCodes,
                              codigo_zona_jit: nextCodes[0] ?? "",
                              valor_frete_bruto: "",
                              rota_cidade: nextZones.length > 1
                                ? "JUST IN TIME"
                                : nextZones[0]?.nome ?? "",
                            }));
                            setQuote(null); setQuoteSignature(""); setPendingSignature(""); setError("");
                          }}
                        />
                        <span className={cx(styles, "jit-zone-option-copy")}><strong>{zone.nome}</strong><small>{zone.areas}</small></span>
                      </label>;
                    })}
                  </div>
                </section>)}
              </div>
              {values.codigos_zonas_jit.length === 0 && <small className={cx(styles, "jit-required-note")} role="status">Marque pelo menos uma zona para fazer o lançamento.</small>}
              {values.codigos_zonas_jit.length > 1 && <small className={cx(styles, "jit-review-note")}>Fretes com várias zonas seguem para conferência do valor, conforme a tabela JIT.</small>}
            </fieldset>
            <fieldset className={cx(styles, "jit-additions-card")}>
              <legend>Adicionais aplicáveis</legend>
              <p className={cx(styles, "checkbox-help")}>Selecione apenas o que foi realizado neste frete.</p>
              <div className={cx(styles, "checkbox-list")}>
                {options.adicionais_just_in_time.map((addition) => <label className={cx(styles, `checkbox-option${values.adicionais_jit.includes(addition.codigo) ? " checkbox-option-selected" : ""}`)} key={addition.codigo}>
                  <input type="checkbox" checked={values.adicionais_jit.includes(addition.codigo)} disabled={busy} onChange={(event) => update("adicionais_jit", event.target.checked ? [...values.adicionais_jit, addition.codigo] : values.adicionais_jit.filter((code) => code !== addition.codigo))} />
                  <span>{addition.nome}</span>
                </label>)}
              </div>
              {values.adicionais_jit.length > 1 && <small className={cx(styles, "jit-review-note")}>Mais de um adicional pode exigir conferência antes do cálculo.</small>}
            </fieldset>
          </div>
        </section>}
        {values.codigo_fonte_tarifa === "PAULO_CRUZ" && <div className={cx(styles, "conditional-grid")}>
          <label className={cx(styles, "field", "field-compact")} htmlFor={truckId}>Tipo de caminhão
            <select id={truckId} value={values.tipo_caminhao} onChange={(event) => update("tipo_caminhao", event.target.value as FreightTruckType | "")} required disabled={busy}>
              <option value="">Selecione o veículo</option>
              {options.tipos_caminhao_paulo_cruz.map((truck) => <option value={truck.codigo} key={truck.codigo}>{truck.nome}</option>)}
            </select>
          </label>
          <label className={cx(styles, "field", "field-compact")} htmlFor={supportId}>Carro de apoio (opcional)
            <select id={supportId} value={values.carro_apoio || ""} onChange={(event) => update("carro_apoio", event.target.value as FormValues["carro_apoio"])} disabled={busy}>
              <option value="">Sem carro de apoio</option>
              <option value="SAVEIRO">Saveiro · adicional de R$ 300,00</option>
              <option value="KIA_BONGO">Bongo · adicional de R$ 500,00</option>
            </select>
            <small>Se deixar sem carro de apoio, nenhum adicional será somado.</small>
          </label>
          <div className={cx(styles, commonStyles, "notice notice-warning", "source-note")}>
            O valor é definido pelo veículo e pelo carro de apoio. A rota é apenas informativa.
            {selectedTruck && <strong>{selectedTruck.nome} selecionado.</strong>}
          </div>
        </div>}
        {values.codigo_fonte_tarifa === "AGREGADOS_CD" && selectedRoute && <p className={cx(styles, "route-hint")}>A tarifa será calculada com base na rota {selectedRoute.nome}, peso, nota e quilômetros rodados.</p>}
      </section>

      {values.tipo_transporte === "AGREGADO" && <section className={cx(styles, "form-card")} aria-labelledby="freight-odometer-heading">
        <div className={cx(styles, "form-section-heading")}>
          <div><span className={cx(styles, "step-number")}>03</span><div><p>LEITURA DO HODÔMETRO</p><h2 id="freight-odometer-heading">Registre o início e o fim do trajeto</h2></div></div>
          <span className={cx(styles, "required-chip")}>Obrigatório</span>
        </div>
        <p className={cx(styles, "section-help")}>Digite os números mostrados no painel do veículo no início e no fim do serviço. O Portal calcula a distância percorrida.</p>
        <div className={cx(styles, "field-grid", "field-grid-two")}>
          <label className={cx(styles, "field")} htmlFor={kmInitialId}>KM inicial
            <input id={kmInitialId} inputMode="decimal" type="text" value={values.km_inicial} onChange={(event) => update("km_inicial", event.target.value)} required placeholder="Ex.: 12450" disabled={busy} />
          </label>
          <label className={cx(styles, "field")} htmlFor={kmFinalId}>KM final
            <input id={kmFinalId} inputMode="decimal" type="text" value={values.km_final} onChange={(event) => update("km_final", event.target.value)} required placeholder="Ex.: 12612" disabled={busy} />
          </label>
        </div>
        <div className={cx(styles, "distance-result")}><span>Distância calculada</span><strong>{kmRun === null ? "—" : `${formatNumber(kmRun)} km`}</strong><small>KM final − KM inicial</small></div>
      </section>}

      <section className={cx(styles, "form-card")} aria-labelledby="freight-details-heading">
        <div className={cx(styles, "form-section-heading")}>
          <div><span className={cx(styles, "step-number")}>{values.tipo_transporte === "TRANSPORTADORA" ? "03" : "04"}</span><div><p>DETALHES DO SERVIÇO</p><h2 id="freight-details-heading">Volume e valores</h2></div></div>
        </div>
        <div className={cx(styles, "field-grid", "field-grid-two")}>
          <label className={cx(styles, "field")}>Nome do cliente (opcional)
            <input type="text" maxLength={160} value={values.nome_cliente} onChange={(event) => update("nome_cliente", event.target.value)} disabled={busy} />
          </label>
          <label className={cx(styles, "field")}>Código do cliente (opcional)
            <input type="text" maxLength={80} value={values.codigo_cliente} onChange={(event) => update("codigo_cliente", event.target.value)} disabled={busy} />
          </label>
          <label className={cx(styles, "field", "field-wide")}>Observação (opcional)
            <textarea maxLength={1000} rows={3} value={values.observacao} onChange={(event) => update("observacao", event.target.value)} disabled={busy} />
          </label>
          <label className={cx(styles, "field")} htmlFor={deliveriesId}>Quantidade de entregas
            <input id={deliveriesId} type="number" min="0" step="1" value={values.quantidade_entregas} onChange={(event) => update("quantidade_entregas", event.target.value)} required disabled={busy || (values.tipo_transporte === "AGREGADO" && (!aggregateSummaryMatches || summaryLoading))} />
            {values.tipo_transporte === "AGREGADO" && <small>{deliverySummary?.quantidade_registros ? "Preenchida pelas Entregas; confira e altere se necessário." : "Informe a quantidade manualmente."}</small>}
          </label>
          <label className={cx(styles, "field")} htmlFor={weightId}>Peso total (kg)
            <input id={weightId} inputMode="decimal" type="text" value={values.peso_kg} onChange={(event) => update("peso_kg", event.target.value)} required disabled={busy || (values.tipo_transporte === "AGREGADO" && (!aggregateSummaryMatches || summaryLoading))} />
            {values.tipo_transporte === "AGREGADO" && <small>{deliveryWeightAvailable ? "Preenchido pelas Entregas; confira e altere se necessário." : "Sem peso nas Entregas? Informe o total manualmente."}</small>}
          </label>
          <label className={cx(styles, "field")} htmlFor={invoiceId}>
            <span className={cx(styles, "field-label-row")}><span>Valor da nota</span>{values.codigo_fonte_tarifa === "AGREGADOS_CD" ? <span className={cx(styles, "required-label")}>Obrigatório</span> : <span className={cx(styles, "optional-label")}>Opcional</span>}</span>
            <input id={invoiceId} inputMode="decimal" type="text" value={values.valor_nota} onChange={(event) => update("valor_nota", event.target.value)} required={values.codigo_fonte_tarifa === "AGREGADOS_CD"} placeholder="R$ 0,00" disabled={busy} />
          </label>
          <label className={cx(styles, "field")} htmlFor={grossId}>
            <span className={cx(styles, "field-label-row")}><span>Valor bruto do frete</span><span className={cx(styles, "required-label")}>Conferir antes de lançar</span></span>
            <input id={grossId} inputMode="decimal" type="text" value={values.valor_frete_bruto} onChange={(event) => update("valor_frete_bruto", event.target.value)} placeholder="Calculado ao simular" disabled={busy} />
            <small>{values.valor_frete_bruto
              ? "Confira o valor calculado e altere se necessário. O valor exibido será registrado no lançamento."
              : values.codigo_fonte_tarifa === "JUST_IN_TIME" && values.codigos_zonas_jit.length > 1
                ? "Para várias zonas, informe o valor total acordado; a tabela não define uma soma automática."
                : "O sistema calcula o valor ao simular. Se não houver tarifa automática, informe o valor correto aqui."}</small>
          </label>
          <label className={cx(styles, "field")} htmlFor={damageCountId}>Quantidade de avarias
            <input id={damageCountId} type="number" min="0" step="1" value={values.quantidade_avarias} onChange={(event) => update("quantidade_avarias", event.target.value)} readOnly={values.tipo_transporte !== "AGREGADO"} disabled={busy || (values.tipo_transporte === "AGREGADO" && (!aggregateSummaryMatches || summaryLoading))} />
            <small>{values.tipo_transporte === "AGREGADO" ? deliverySummary?.quantidade_registros ? "Preenchida pelas Entregas; confira e altere se necessário." : "Informe a quantidade manualmente." : "Não há motorista vinculado para buscar ocorrências de Entrega."}</small>
          </label>
          <label className={cx(styles, "field")} htmlFor={damageId}>
            <span className={cx(styles, "field-label-row")}><span>Valor da Avaria (R$)</span><span className={cx(styles, "optional-label")}>Se houver</span></span>
            <input id={damageId} inputMode="decimal" type="text" value={values.valor_avaria} onChange={(event) => update("valor_avaria", event.target.value)} required disabled={busy} />
            <small>Valor financeiro a descontar do frete, conforme a coluna R$ AVARIA da planilha. A quantidade de avarias é registrada separadamente.</small>
          </label>
        </div>
      </section>

      {error && <div className={cx(styles, commonStyles, "notice notice-error", "form-message")} role="alert">{error}</div>}
      {liveQuote && <section className={cx(styles, "quote-card", liveQuote.status_calculo === "PENDENTE_CONFERENCIA" ? "quote-pending" : "quote-ready")} aria-live="polite">
        <div><span className={cx(styles, "quote-icon")}>{liveQuote.status_calculo === "CALCULADO" ? "✓" : "!"}</span><div><p>{liveQuote.status_calculo === "CALCULADO" ? "PRÉVIA DO FRETE" : "CONFERÊNCIA NECESSÁRIA"}</p><h2>{liveQuote.status_calculo === "CALCULADO" ? formatMoney(liveQuote.valor_frete_bruto) : "Valor aguardando conferência"}</h2>{liveQuote.motivo_pendencia && <small>{liveQuote.motivo_pendencia}</small>}{liveQuote.detalhe_calculo.valor_frete_bruto_informado_manualmente === true && <small>Valor informado manualmente; a tarifa de referência foi preservada na memória do cálculo.</small>}</div></div>
        {liveQuote.status_calculo === "CALCULADO" && <span className={cx(styles, "quote-route")}>{values.nome_transportador} · {values.rota_cidade}</span>}
      </section>}
      {pendingConfirm && <div className={cx(styles, commonStyles, "notice notice-warning", "form-message")} role="status">Confira o valor bruto acima. Clique em confirmar para {initialFreight ? "salvar as alterações" : "registrar o frete"} com esse valor.</div>}

      <div className={cx(styles, "form-actions")}>
        <span>Confira o valor bruto calculado antes de registrar.</span>
        <div>
          <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { void simulate(); }} disabled={busy || driversLoading || summaryLoading}>{busyAction === "quote" ? "Calculando..." : "Simular cálculo"}</button>
          <button className={cx(styles, commonStyles, "button button-primary")} type="submit" disabled={busy || driversLoading || summaryLoading}>
            {busyAction === "submit" ? (initialFreight ? "Salvando..." : "Registrando...") : pendingConfirm ? "Confirmar valor e registrar" : initialFreight ? "Salvar alterações" : "Registrar frete"}
          </button>
        </div>
      </div>
    </form>
  );
}
