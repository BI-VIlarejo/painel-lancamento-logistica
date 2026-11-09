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
  valor_avaria: string;
  quantidade_avarias: string;
  codigo_zona_jit: string;
  adicionais_jit: string[];
  tipo_caminhao: FreightTruckType | "";
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
    valor_avaria: "0",
    quantidade_avarias: "0",
    codigo_zona_jit: "",
    adicionais_jit: [],
    tipo_caminhao: "",
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
    rota_cidade: freight.rota_cidade,
    km_inicial: freight.km_inicial === null ? "" : String(freight.km_inicial),
    km_final: freight.km_final === null ? "" : String(freight.km_final),
    quantidade_entregas: String(freight.quantidade_entregas),
    peso_kg: String(freight.peso_kg),
    valor_nota: freight.valor_nota === null ? "" : String(freight.valor_nota),
    valor_avaria: String(freight.valor_avaria),
    quantidade_avarias: String(freight.quantidade_avarias),
    codigo_zona_jit: freight.codigo_zona_jit ?? "",
    adicionais_jit: freight.adicionais_jit,
    tipo_caminhao: freight.tipo_caminhao ?? "",
  };
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
  if (values.codigo_fonte_tarifa === "JUST_IN_TIME" && !values.codigo_zona_jit) {
    throw new Error("Selecione a região da transportadora JUST IN TIME.");
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
    valor_avaria: damage ?? 0,
    quantidade_avarias: values.tipo_transporte === "AGREGADO" ? damageCount : 0,
    codigo_zona_jit: values.codigo_fonte_tarifa === "JUST_IN_TIME" ? values.codigo_zona_jit : null,
    adicionais_jit: values.codigo_fonte_tarifa === "JUST_IN_TIME" ? values.adicionais_jit : [],
    tipo_caminhao: values.codigo_fonte_tarifa === "PAULO_CRUZ" ? values.tipo_caminhao as FreightTruckType : null,
  };
}

/** Formulário do lançamento, incluindo leitura do hodômetro e cotação da tarifa. */
export function FreightForm({ options, onCreated, initialFreight, onUpdated }: Props) {
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
  const damageId = useId();
  const damageCountId = useId();
  const zoneId = useId();
  const truckId = useId();
  const [values, setValues] = useState(() => initialFreight ? valuesFromFreight(initialFreight) : emptyValues(options));
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
  const idempotency = useRef<{ signature: string; key: string } | null>(null);

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
          return { ...current, id_motorista_agregado: "", nome_transportador: "", rota_cidade: "", quantidade_entregas: "0", quantidade_avarias: "0" };
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
        setValues((current) => current.data_servico === summary.data_servico
          && current.id_motorista_agregado === String(summary.id_motorista)
          ? { ...current, rota_cidade: summary.rota_cidade, quantidade_entregas: String(summary.quantidade_entregas), quantidade_avarias: String(summary.quantidade_avarias) }
          : current);
      })
      .catch((loadError: unknown) => { if (active) setSummaryError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [values.data_servico, values.id_motorista_agregado, values.tipo_transporte]);

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
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
  const aggregateSummaryReady = values.tipo_transporte !== "AGREGADO"
    || (deliverySummary !== null
      && deliverySummary.id_motorista === Number(values.id_motorista_agregado)
      && deliverySummary.data_servico === values.data_servico
      && deliverySummary.quantidade_registros > 0);
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
      setError(summaryError || "Selecione um motorista com Entregas confirmadas nesta data.");
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
      const signature = JSON.stringify(input);
      setQuote(result);
      setQuoteSignature(signature);
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
      setError(summaryError || "Selecione um motorista com Entregas confirmadas nesta data.");
      return;
    }
    let payload: FreightInput;
    try {
      payload = payloadFromValues(values);
    } catch (validationError) {
      setError(messageFromApiError(validationError));
      return;
    }
    const signature = JSON.stringify(payload);
    setBusy(true);
    setBusyAction("submit");
    setError("");
    try {
      const latestQuote = await freightsApi.quote(payload);
      setQuote(latestQuote);
      setQuoteSignature(signature);
      if (latestQuote.status_calculo === "PENDENTE_CONFERENCIA" && pendingSignature !== signature) {
        setPendingSignature(signature);
        return;
      }
      setPendingSignature("");
      if (!idempotency.current || idempotency.current.signature !== signature) {
        idempotency.current = { signature, key: crypto.randomUUID() };
      }
      const saved = initialFreight
        ? await freightsApi.update(initialFreight.codigo_frete, payload, idempotency.current.key)
        : await freightsApi.create(payload, idempotency.current.key);
      idempotency.current = null;
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
  const selectedZone = options.zonas_just_in_time.find((zone) => zone.codigo === values.codigo_zona_jit);
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
              setValues((current) => ({ ...current, tipo_transporte: type, nome_transportador: "", id_motorista_agregado: "", id_motorista_transportadora: "", codigo_fonte_tarifa: source, rota_cidade: "", quantidade_entregas: "0", quantidade_avarias: "0", codigo_zona_jit: "", adicionais_jit: [], tipo_caminhao: "", km_inicial: "", km_final: "" }));
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
              setValues((current) => ({ ...current, id_motorista_agregado: id, nome_transportador: driver?.nome_motorista ?? "", rota_cidade: "", quantidade_entregas: "0", quantidade_avarias: "0" }));
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
                adicionais_jit: [],
                tipo_caminhao: "",
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
              setValues((current) => ({ ...current, codigo_fonte_tarifa: source, rota_cidade: "", codigo_zona_jit: "", adicionais_jit: [], tipo_caminhao: "" }));
              setQuote(null); setQuoteSignature(""); setPendingSignature(""); setError("");
            }} disabled={busy}>
              {sourceOptions.map((source) => <option key={source.codigo} value={source.codigo}>{source.nome}</option>)}
            </select>
          </label>}
          {values.tipo_transporte === "AGREGADO" ? (
            <div className={cx(styles, "field")}>
              <span>Cidade / rota das Entregas</span>
              <div className={cx(styles, "locked-selection")} aria-live="polite">{summaryLoading ? "Buscando Entregas..." : deliverySummary?.rota_cidade || "Selecione o motorista e a data"}</div>
              {summaryError && <small role="alert">{summaryError}</small>}
              {deliverySummary && deliverySummary.cidades.length > 1 && <small>Cidades consideradas: {deliverySummary.cidades.join(", ")}</small>}
              {deliverySummary?.quantidade_registros === 0 && <small>Nenhuma Entrega confirmada para esse motorista nesta data.</small>}
              <small>Preenchido pelo lançamento de Entregas; não pode ser editado aqui.</small>
            </div>
          ) : values.codigo_fonte_tarifa === "JUST_IN_TIME" ? (
            <label className={cx(styles, "field")} htmlFor={zoneId}>Região / zona
              <select id={zoneId} value={values.codigo_zona_jit} onChange={(event) => {
                const zoneCode = event.target.value;
                const zone = options.zonas_just_in_time.find((item) => item.codigo === zoneCode);
                setValues((current) => ({ ...current, codigo_zona_jit: zoneCode, rota_cidade: zone?.nome ?? "" }));
                setQuote(null); setQuoteSignature(""); setPendingSignature(""); setError("");
              }} required disabled={busy}>
                <option value="">Selecione a região</option>
                {options.zonas_just_in_time.map((zone) => <option value={zone.codigo} key={zone.codigo}>{zone.nome}</option>)}
              </select>
              {selectedZone && <span className={cx(styles, "jit-zone-areas")}><strong>Áreas atendidas</strong><small>{selectedZone.areas}</small></span>}
            </label>
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
            <div><p>CONFIGURAÇÃO DA TARIFA</p><h3>JUST IN TIME</h3><span>A tarifa usa a região selecionada acima e a faixa de peso do serviço.</span></div>
            <span className={cx(styles, "jit-selection-count")}>{values.adicionais_jit.length === 0 ? "Nenhum adicional" : `${values.adicionais_jit.length} ${values.adicionais_jit.length === 1 ? "adicional" : "adicionais"}`}</span>
          </header>
          <div className={cx(styles, "jit-grid")}>
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
          <div className={cx(styles, commonStyles, "notice notice-warning", "source-note")}>
            A tabela Paulo Cruz ainda será conferida. Confira o resultado antes de fechar o pagamento.
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
          <label className={cx(styles, "field")} htmlFor={deliveriesId}>Quantidade de entregas
            <input id={deliveriesId} type="number" min="0" step="1" value={values.quantidade_entregas} onChange={(event) => update("quantidade_entregas", event.target.value)} required readOnly={values.tipo_transporte === "AGREGADO"} disabled={busy || (values.tipo_transporte === "AGREGADO" && !deliverySummary)} />
            {values.tipo_transporte === "AGREGADO" && <small>Soma das entregas realizadas e não realizadas nas Entregas confirmadas.</small>}
          </label>
          <label className={cx(styles, "field")} htmlFor={weightId}>Peso total (kg)
            <input id={weightId} inputMode="decimal" type="text" value={values.peso_kg} onChange={(event) => update("peso_kg", event.target.value)} required disabled={busy} />
          </label>
          <label className={cx(styles, "field")} htmlFor={invoiceId}>
            <span className={cx(styles, "field-label-row")}><span>Valor da nota</span>{values.codigo_fonte_tarifa === "AGREGADOS_CD" ? <span className={cx(styles, "required-label")}>Obrigatório</span> : <span className={cx(styles, "optional-label")}>Opcional</span>}</span>
            <input id={invoiceId} inputMode="decimal" type="text" value={values.valor_nota} onChange={(event) => update("valor_nota", event.target.value)} required={values.codigo_fonte_tarifa === "AGREGADOS_CD"} placeholder="R$ 0,00" disabled={busy} />
          </label>
          <label className={cx(styles, "field")} htmlFor={damageCountId}>Quantidade de avarias
            <input id={damageCountId} type="number" min="0" step="1" value={values.quantidade_avarias} readOnly disabled />
            <small>{values.tipo_transporte === "AGREGADO" ? "Somada das ocorrências AVARIA nas Entregas confirmadas." : "Não há motorista vinculado para buscar ocorrências de Entrega."}</small>
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
        <div><span className={cx(styles, "quote-icon")}>{liveQuote.status_calculo === "CALCULADO" ? "✓" : "!"}</span><div><p>{liveQuote.status_calculo === "CALCULADO" ? "PRÉVIA DO FRETE" : "CONFERÊNCIA NECESSÁRIA"}</p><h2>{liveQuote.status_calculo === "CALCULADO" ? formatMoney(liveQuote.valor_frete_bruto) : "Valor aguardando conferência"}</h2>{liveQuote.motivo_pendencia && <small>{liveQuote.motivo_pendencia}</small>}</div></div>
        {liveQuote.status_calculo === "CALCULADO" && <span className={cx(styles, "quote-route")}>{values.nome_transportador} · {values.rota_cidade}</span>}
      </section>}
      {pendingConfirm && <div className={cx(styles, commonStyles, "notice notice-warning", "form-message")} role="status">Este lançamento ficará pendente de conferência e não entrará na exportação de pagamento deste responsável até ser resolvido. Clique em confirmar para {initialFreight ? "salvar as alterações" : "registrar"}.</div>}

      <div className={cx(styles, "form-actions")}>
        <span>Os valores são calculados pelas fontes tarifárias disponíveis.</span>
        <div>
          <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { void simulate(); }} disabled={busy || driversLoading || summaryLoading}>{busyAction === "quote" ? "Calculando..." : "Simular cálculo"}</button>
          <button className={cx(styles, commonStyles, "button button-primary")} type="submit" disabled={busy || driversLoading || summaryLoading}>
            {busyAction === "submit" ? (initialFreight ? "Salvando..." : "Registrando...") : pendingConfirm ? "Confirmar lançamento pendente" : initialFreight ? "Salvar alterações" : "Registrar frete"}
          </button>
        </div>
      </div>
    </form>
  );
}
