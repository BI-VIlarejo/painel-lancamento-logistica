import styles from "./DeliveryForm.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { messageFromApiError } from "../../../shared/api/apiError";
import { deliveriesApi } from "../api";
import { deliveryTransportLabel, nonDeliveryReasonGroupLabel } from "../classifications";
import type { DeliveryTransportType } from "../classifications";
import type {
  DeliveryDraftRequest,
  DeliveryItemInput,
  DeliveryLaunchDetail,
  LocalityCatalogItem,
  NonDeliveryReasonCatalogItem,
  PersonCatalogItem,
} from "../types";

type Operation = "ENTREGA" | "COLETA";
type ReasonDraft = { key: string; id: string; observation: string };
type OperationDraft = { completed: string; notCompleted: string; reasons: ReasonDraft[] };
type DeliveryDraftLine = {
  key: string;
  itemCode?: string;
  date: string;
  locality: string;
  driver: string;
  helpers: [string, string];
  entregas: OperationDraft;
  coletas: OperationDraft;
  legacyObservation: string;
};

type DeliveryFormProps = {
  localities: LocalityCatalogItem[];
  drivers: PersonCatalogItem[];
  helpers: PersonCatalogItem[];
  reasons: NonDeliveryReasonCatalogItem[];
  canLaunch: boolean;
  initialLaunch?: DeliveryLaunchDetail;
  onSaved: (launch: DeliveryLaunchDetail) => void;
};

const maximumQuantity = 2_147_483_647;

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function operationLabel(operation: Operation): string {
  return operation === "COLETA" ? "coleta" : "entrega";
}

function operationDraft(): OperationDraft {
  return { completed: "", notCompleted: "", reasons: [] };
}

function newLine(): DeliveryDraftLine {
  return {
    key: crypto.randomUUID(), date: localDate(), locality: "", driver: "",
    helpers: ["", ""], entregas: operationDraft(), coletas: operationDraft(), legacyObservation: "",
  };
}

function newReason(): ReasonDraft {
  return { key: crypto.randomUUID(), id: "", observation: "" };
}

function linesFromLaunch(launch: DeliveryLaunchDetail): DeliveryDraftLine[] {
  return launch.itens.map((item) => {
    const driver = item.participantes.find((person) => person.papel_participante === "MOTORISTA");
    const helpers = item.participantes
      .filter((person) => person.papel_participante === "AJUDANTE")
      .sort((left, right) => left.ordem - right.ordem);
    const legacyOperation = item.tipo_operacao ?? "ENTREGA";
    const reasonsFor = (operation: Operation) => item.motivos
      .filter((reason) => (reason.tipo_operacao ?? legacyOperation) === operation)
      .flatMap((reason, reasonIndex) =>
        Array.from({ length: Math.max(1, reason.quantidade) }, (_, occurrence) => ({
          key: `${item.codigo_item_lancamento}-${operation}-${reason.id_motivo_nao_entrega}-${reasonIndex}-${occurrence}`,
          id: String(reason.id_motivo_nao_entrega),
          observation: reason.observacao ?? "",
        })),
      );
    const legacyCollection = legacyOperation === "COLETA";
    return {
      key: item.codigo_item_lancamento,
      itemCode: item.codigo_item_lancamento,
      date: item.data_entrega.slice(0, 10),
      locality: String(item.id_localidade),
      driver: driver ? String(driver.id_pessoa) : "",
      helpers: [String(helpers[0]?.id_pessoa ?? ""), String(helpers[1]?.id_pessoa ?? "")] as [string, string],
      entregas: {
        completed: String(legacyCollection ? 0 : item.quantidade_realizada),
        notCompleted: String(legacyCollection ? 0 : item.quantidade_nao_realizada),
        reasons: reasonsFor("ENTREGA"),
      },
      coletas: {
        completed: String(item.quantidade_coleta_realizada ?? (legacyCollection ? item.quantidade_realizada : 0)),
        notCompleted: String(item.quantidade_coleta_nao_realizada ?? (legacyCollection ? item.quantidade_nao_realizada : 0)),
        reasons: reasonsFor("COLETA"),
      },
      legacyObservation: item.observacao ?? "",
    };
  });
}

function numberValue(value: string): number {
  return value === "" ? 0 : Number(value);
}

function personTransportType(
  personId: string,
  line: DeliveryDraftLine,
  drivers: PersonCatalogItem[],
  helpers: PersonCatalogItem[],
  initialLaunch?: DeliveryLaunchDetail,
): DeliveryTransportType | null {
  const catalogPerson = [...drivers, ...helpers].find((person) => String(person.id_pessoa) === personId);
  if (catalogPerson) return catalogPerson.tipo_transporte_entrega;
  return initialLaunch?.itens
    .find((item) => item.codigo_item_lancamento === line.itemCode)
    ?.participantes.find((person) => String(person.id_pessoa) === personId)
    ?.tipo_transporte_entrega ?? null;
}

function reasonGroup(
  reasonId: string,
  line: DeliveryDraftLine,
  reasons: NonDeliveryReasonCatalogItem[],
  initialLaunch?: DeliveryLaunchDetail,
) {
  const catalogReason = reasons.find((reason) => String(reason.id_motivo_nao_entrega) === reasonId);
  if (catalogReason) return catalogReason.grupo_motivo;
  return initialLaunch?.itens
    .find((item) => item.codigo_item_lancamento === line.itemCode)
    ?.motivos.find((reason) => String(reason.id_motivo_nao_entrega) === reasonId)
    ?.grupo_motivo ?? null;
}

function validateLines(
  lines: DeliveryDraftLine[],
  drivers: PersonCatalogItem[],
  helpers: PersonCatalogItem[],
  reasons: NonDeliveryReasonCatalogItem[],
  initialLaunch?: DeliveryLaunchDetail,
): Record<string, string> {
  const errors: Record<string, string> = {};
  lines.forEach((line, index) => {
    const prefix = `item-${index + 1}`;
    const operationValues = [line.entregas, line.coletas];
    const quantities = operationValues.flatMap((values) => [numberValue(values.completed), numberValue(values.notCompleted)]);
    if (!line.date) errors[`${prefix}-date`] = "Informe a data da entrega e da coleta.";
    if (!line.locality) errors[`${prefix}-locality`] = "Selecione a localidade.";
    if (!line.driver) errors[`${prefix}-driver`] = "Selecione o motorista.";
    if (!quantities.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= maximumQuantity)) {
      errors[`${prefix}-total`] = `As quantidades devem ser inteiros entre zero e ${maximumQuantity}.`;
    }
    if (quantities.reduce((total, value) => total + value, 0) <= 0) errors[`${prefix}-total`] = "Informe ao menos uma entrega ou coleta realizada ou não realizada.";
    const selectedPeople = [line.driver, ...line.helpers].filter(Boolean);
    if (new Set(selectedPeople).size !== selectedPeople.length) errors[`${prefix}-team`] = "Uma pessoa não pode ocupar dois papéis.";
    const selectedTypes = selectedPeople.map((id) => personTransportType(id, line, drivers, helpers, initialLaunch));
    if (selectedTypes.some((type) => type === null)) {
      errors[`${prefix}-team`] = "Classifique como própria ou terceirizada todas as pessoas da equipe.";
    } else if (new Set(selectedTypes).size > 1) {
      errors[`${prefix}-team`] = "Motorista e ajudantes precisam pertencer ao mesmo tipo de entrega.";
    }

    (['ENTREGA', 'COLETA'] as const).forEach((operation) => {
      const key = operation === "ENTREGA" ? "entregas" : "coletas";
      const values = line[key];
      const operationPrefix = `${prefix}-${operation.toLowerCase()}`;
      const selectedReasons = values.reasons.filter((reason) => reason.id);
      if (selectedReasons.some((reason) => !reasonGroup(reason.id, line, reasons, initialLaunch))) {
        errors[`${operationPrefix}-reasons`] = "Classifique o grupo de todos os motivos antes de usá-los.";
      }
      if (numberValue(values.notCompleted) === 0 && values.reasons.length > 0) {
        errors[`${operationPrefix}-reasons`] = "Remova os motivos quando não houver itens não realizados.";
      } else if (values.reasons.length !== numberValue(values.notCompleted)) {
        errors[`${operationPrefix}-reasons`] = `Informe exatamente um motivo para cada ${operationLabel(operation)} não realizada (${numberValue(values.notCompleted)}).`;
      }
      if (selectedReasons.length !== values.reasons.length) {
        errors[`${operationPrefix}-reasons`] = "Selecione um motivo em cada item não realizado.";
      }
    });
  });
  return errors;
}

function toPayloadLine(line: DeliveryDraftLine): DeliveryItemInput {
  const participants: DeliveryItemInput["participantes"] = [
    { id_pessoa: Number(line.driver), papel_participante: "MOTORISTA" },
    ...line.helpers
      .filter(Boolean)
      .map((id) => ({ id_pessoa: Number(id), papel_participante: "AJUDANTE" as const })),
  ];
  return {
    ...(line.itemCode ? { codigo_item_lancamento: line.itemCode } : {}),
    data_entrega: line.date,
    id_localidade: Number(line.locality),
    quantidade_realizada: numberValue(line.entregas.completed),
    quantidade_nao_realizada: numberValue(line.entregas.notCompleted),
    quantidade_coleta_realizada: numberValue(line.coletas.completed),
    quantidade_coleta_nao_realizada: numberValue(line.coletas.notCompleted),
    participantes: participants,
    motivos: ([
      ...line.entregas.reasons.map((reason) => ({ reason, operation: "ENTREGA" as const })),
      ...line.coletas.reasons.map((reason) => ({ reason, operation: "COLETA" as const })),
    ]).map(({ reason, operation }) => ({
      id_motivo_nao_entrega: Number(reason.id),
      tipo_operacao: operation,
      observacao: reason.observation.trim() || null,
    })),
  };
}

export function DeliveryForm({ localities, drivers, helpers, reasons, canLaunch, initialLaunch, onSaved }: DeliveryFormProps) {
  const [lines, setLines] = useState<DeliveryDraftLine[]>(() => initialLaunch ? linesFromLaunch(initialLaunch) : [newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedDraft, setSavedDraft] = useState(initialLaunch);
  const saveIdempotencyKey = useRef(crypto.randomUUID());
  const confirmIdempotencyKey = useRef(crypto.randomUUID());

  const totals = useMemo(() => lines.reduce((sum, line) => {
    sum.entregas.realizadas += numberValue(line.entregas.completed);
    sum.entregas.naoRealizadas += numberValue(line.entregas.notCompleted);
    sum.coletas.realizadas += numberValue(line.coletas.completed);
    sum.coletas.naoRealizadas += numberValue(line.coletas.notCompleted);
    return sum;
  }, {
    entregas: { realizadas: 0, naoRealizadas: 0 },
    coletas: { realizadas: 0, naoRealizadas: 0 },
  }), [lines]);

  function renewIdempotencyKeys() {
    saveIdempotencyKey.current = crypto.randomUUID();
    confirmIdempotencyKey.current = crypto.randomUUID();
  }

  function updateLine(key: string, changes: Partial<DeliveryDraftLine>) {
    renewIdempotencyKeys();
    setErrors({});
    setRequestError("");
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  }

  function updateReason(lineKey: string, operation: Operation, reasonKey: string, changes: Partial<ReasonDraft>) {
    const field = operation === "ENTREGA" ? "entregas" : "coletas";
    renewIdempotencyKeys();
    setErrors({});
    setRequestError("");
    setLines((current) => current.map((line) => line.key !== lineKey ? line : {
      ...line,
      [field]: {
        ...line[field],
        reasons: line[field].reasons.map((reason) => reason.key === reasonKey ? { ...reason, ...changes } : reason),
      },
    }));
  }

  function addLine() {
    renewIdempotencyKeys();
    setErrors({});
    setRequestError("");
    setLines((current) => [...current, newLine()]);
  }

  function addReason(line: DeliveryDraftLine, operation: Operation) {
    const field = operation === "ENTREGA" ? "entregas" : "coletas";
    if (line[field].reasons.length >= numberValue(line[field].notCompleted)) return;
    updateLine(line.key, { [field]: { ...line[field], reasons: [...line[field].reasons, newReason()] } });
  }

  function changeNotCompleted(line: DeliveryDraftLine, operation: Operation, value: string) {
    const field = operation === "ENTREGA" ? "entregas" : "coletas";
    const count = Number(value);
    let nextReasons = line[field].reasons;
    if (count <= 0) nextReasons = [];
    else if (Number.isSafeInteger(count) && count < line[field].reasons.length) nextReasons = line[field].reasons.slice(0, count);
    else if (line[field].reasons.length === 0 && Number.isSafeInteger(count) && count > 0) nextReasons = [newReason()];
    updateLine(line.key, { [field]: { ...line[field], notCompleted: value, reasons: nextReasons } });
  }

  function validateForm(): boolean {
    const nextErrors = validateLines(lines, drivers, helpers, reasons, initialLaunch);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      document.querySelector("[data-form-error]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  async function persistDraft(items: DeliveryItemInput[]): Promise<DeliveryLaunchDetail> {
    const draft = savedDraft ?? initialLaunch;
    const saved = draft
      ? await deliveriesApi.updateDraft(draft.codigo_lancamento, { itens: items }, saveIdempotencyKey.current)
      : await deliveriesApi.createDraft({ itens: items } satisfies DeliveryDraftRequest, saveIdempotencyKey.current);
    setSavedDraft(saved);
    return saved;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError("");
    if (!canLaunch) {
      setRequestError("Seu perfil não tem permissão para lançar ou confirmar este registro.");
      return;
    }
    if (!validateForm()) return;
    setSaving(true);
    try {
      const draft = await persistDraft(lines.map(toPayloadLine));
      if (draft.estado !== "RASCUNHO") {
        throw new Error("Este lançamento não está mais em rascunho. Atualize o histórico para conferir o estado atual.");
      }
      onSaved(await deliveriesApi.confirmDraft(draft.codigo_lancamento, confirmIdempotencyKey.current));
    } catch (error) {
      setRequestError(messageFromApiError(error));
    } finally {
      setSaving(false);
    }
  }

  function renderReasons(line: DeliveryDraftLine, index: number, operation: Operation, originalItem?: DeliveryLaunchDetail["itens"][number]) {
    const field = operation === "ENTREGA" ? "entregas" : "coletas";
    const values = line[field];
    const notCompleted = numberValue(values.notCompleted);
    const prefix = `item-${index + 1}-${operation.toLowerCase()}-reasons`;
    if (notCompleted === 0 && values.reasons.length === 0) return null;
    return <div className={cx(styles, commonStyles, "reasons-panel")}>
      <div className={cx(styles, commonStyles, "reasons-heading")}><div><strong>Motivos de não realização</strong><p>Informe um motivo e uma observação para cada uma das {notCompleted} {operationLabel(operation)}(s) não realizada(s). Preenchidas: {values.reasons.length}.</p></div><button type="button" className={cx(styles, commonStyles, "text-button")} disabled={values.reasons.length >= notCompleted || saving} onClick={() => addReason(line, operation)}>＋ Adicionar motivo</button></div>
      {values.reasons.map((reason, reasonIndex) => <div className={cx(styles, commonStyles, "reason-entry")} key={reason.key}>
        <div className={cx(styles, commonStyles, "reason-row")}>
          <label className={cx(styles, commonStyles, "form-field reason-select")}><span className={cx(styles, commonStyles, "visually-hidden")}>Motivo</span><select aria-label={`Motivo ${reasonIndex + 1} da ${operationLabel(operation)} ${index + 1}`} value={reason.id} onChange={(event) => updateReason(line.key, operation, reason.key, { id: event.target.value, observation: event.target.value === reason.id ? reason.observation : "" })}>
            <option value="">Selecione o motivo</option>
            {originalItem?.motivos.filter((entry) => (entry.tipo_operacao ?? (originalItem.tipo_operacao === "COLETA" ? "COLETA" : "ENTREGA")) === operation && String(entry.id_motivo_nao_entrega) === reason.id && !reasons.some((candidate) => String(candidate.id_motivo_nao_entrega) === reason.id)).map((entry, occurrence) => <option key={`${entry.id_motivo_nao_entrega}-${occurrence}`} value={entry.id_motivo_nao_entrega}>{entry.descricao_motivo} · {nonDeliveryReasonGroupLabel(entry.grupo_motivo)}</option>)}
            {reasons.map((item) => <option key={item.id_motivo_nao_entrega} value={item.id_motivo_nao_entrega}>{item.descricao_motivo} · {nonDeliveryReasonGroupLabel(item.grupo_motivo)}</option>)}
          </select></label>
          <button type="button" className={cx(styles, commonStyles, "icon-button remove-reason")} aria-label={`Remover motivo ${reasonIndex + 1} da ${operationLabel(operation)} ${index + 1}`} disabled={saving} onClick={() => updateLine(line.key, { [field]: { ...values, reasons: values.reasons.filter((entry) => entry.key !== reason.key) } })}>×</button>
        </div>
        <label className={cx(styles, commonStyles, "form-field reason-observation")}><span>Observação</span><textarea value={reason.observation} onChange={(event) => updateReason(line.key, operation, reason.key, { observation: event.target.value })} placeholder="Detalhe o que aconteceu com este motivo..." maxLength={5000} rows={2} /></label>
      </div>)}
      {errors[prefix] && <small className={cx(styles, commonStyles, "field-error")}>{errors[prefix]}</small>}
    </div>;
  }

  function renderOperationFields(line: DeliveryDraftLine, index: number, operation: Operation, originalItem?: DeliveryLaunchDetail["itens"][number]) {
    const field = operation === "ENTREGA" ? "entregas" : "coletas";
    const values = line[field];
    const label = operation === "ENTREGA" ? "Entregas" : "Coletas";
    const reasonPanel = renderReasons(line, index, operation, originalItem);
    return <section className={cx(styles, commonStyles, "operation-entry")} aria-label={label} key={operation}>
      <div className={cx(styles, commonStyles, "operation-entry-heading")}><h4>{label}</h4>{operation === "COLETA" && <p>Registrada nesta mesma data, localidade e equipe.</p>}</div>
      <div className={cx(styles, commonStyles, "quantity-section")}>
        <div className={cx(styles, commonStyles, "quantity-field")}><span className={cx(styles, commonStyles, "quantity-dot")} /><label className={cx(styles, commonStyles, "form-field")}><span>{label} realizadas</span><input type="number" min="0" max={maximumQuantity} step="1" value={values.completed} onChange={(event) => updateLine(line.key, { [field]: { ...values, completed: event.target.value } })} placeholder="0" /></label></div>
        <div className={cx(styles, commonStyles, "quantity-field quantity-incomplete")}><span className={cx(styles, commonStyles, "quantity-dot")} /><label className={cx(styles, commonStyles, "form-field")}><span>{label} não realizadas</span><input type="number" min="0" max={maximumQuantity} step="1" value={values.notCompleted} onChange={(event) => changeNotCompleted(line, operation, event.target.value)} placeholder="0" /></label></div>
        <div className={cx(styles, commonStyles, "quantity-total")}><span>Total informado</span><strong>{numberValue(values.completed) + numberValue(values.notCompleted)}</strong></div>
      </div>
      {reasonPanel}
    </section>;
  }

  function renderLines() {
    return <div className={cx(styles, commonStyles, "delivery-line-list")}>
      {lines.map((line, index) => {
        const prefix = `item-${index + 1}`;
        const originalItem = initialLaunch?.itens.find((item) => item.codigo_item_lancamento === line.itemCode);
        const selectedTeamIds = [line.driver, ...line.helpers].filter(Boolean);
        const teamTypes = selectedTeamIds.map((id) => personTransportType(id, line, drivers, helpers, initialLaunch));
        const distinctTeamTypes = new Set(teamTypes.filter((type): type is DeliveryTransportType => Boolean(type)));
        const teamTypeLabel = selectedTeamIds.length === 0
          ? "Selecione a equipe"
          : teamTypes.some((type) => type === null)
            ? "Classificação pendente"
            : distinctTeamTypes.size > 1
              ? "Equipe mista"
              : deliveryTransportLabel([...distinctTeamTypes][0]);
        return <article className={cx(styles, commonStyles, "delivery-line-card")} key={line.key}>
          <div className={cx(styles, commonStyles, "delivery-line-top")}>
            <div className={cx(styles, commonStyles, "delivery-line-title")}><span className={cx(styles, commonStyles, "delivery-index")}>{String(index + 1).padStart(2, "0")}</span><div><h3>Entrega e coleta {index + 1}</h3><p>Data, localidade e equipe compartilhadas pelas duas operações</p></div></div>
            {lines.length > 1 && <button className={cx(styles, commonStyles, "icon-button")} type="button" aria-label={`Remover registro ${index + 1}`} disabled={saving} onClick={() => { renewIdempotencyKeys(); setErrors({}); setLines((current) => current.filter((entry) => entry.key !== line.key)); }}>×</button>}
          </div>

          <div className={cx(styles, commonStyles, "field-grid field-grid-delivery-top")}>
            <label className={cx(styles, commonStyles, "form-field")}><span>Data da entrega e coleta <b>*</b></span><input type="date" value={line.date} onChange={(event) => updateLine(line.key, { date: event.target.value })} required />{errors[`${prefix}-date`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-date`]}</small>}</label>
            <label className={cx(styles, commonStyles, "form-field")}><span>Localidade <b>*</b></span><select value={line.locality} onChange={(event) => updateLine(line.key, { locality: event.target.value })} required>
              <option value="">Selecione a localidade</option>
              {originalItem && !localities.some((locality) => String(locality.id_localidade) === line.locality) && <option value={line.locality}>{originalItem.nome_localidade}</option>}
              {localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}
            </select>{errors[`${prefix}-locality`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-locality`]}</small>}</label>
          </div>

          <div className={cx(styles, commonStyles, "team-fields")}>
            <label className={cx(styles, commonStyles, "form-field")}><span>Motorista <b>*</b></span><select value={line.driver} onChange={(event) => updateLine(line.key, { driver: event.target.value })} required>
              <option value="">Selecione o motorista</option>
              {originalItem?.participantes.filter((person) => person.papel_participante === "MOTORISTA" && !drivers.some((candidate) => String(candidate.id_pessoa) === line.driver)).map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</option>)}
              {drivers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</option>)}
            </select>{errors[`${prefix}-driver`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-driver`]}</small>}</label>
            {line.helpers.map((helperId, helperIndex) => <label className={cx(styles, commonStyles, "form-field")} key={`helper-${helperIndex}`}><span>Ajudante {helperIndex + 1} <small className={cx(styles, commonStyles, "field-hint")}>opcional</small></span><select value={helperId} onChange={(event) => {
              const nextHelpers: [string, string] = [line.helpers[0], line.helpers[1]];
              nextHelpers[helperIndex] = event.target.value;
              updateLine(line.key, { helpers: nextHelpers });
            }}><option value="">Nenhum</option>
              {originalItem?.participantes.filter((person) => person.papel_participante === "AJUDANTE" && String(person.id_pessoa) === helperId && !helpers.some((candidate) => String(candidate.id_pessoa) === helperId)).map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</option>)}
              {helpers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</option>)}
            </select></label>)}
          </div>
          <div className={cx(styles, commonStyles, "team-classification")}><span>Tipo do transporte</span><strong className={cx(styles, commonStyles, `transport-badge${teamTypeLabel.includes("pendente") || teamTypeLabel === "Equipe mista" ? " transport-badge-warning" : ""}`)}>{teamTypeLabel}</strong></div>
          {errors[`${prefix}-team`] && <small className={cx(styles, commonStyles, "field-error team-error")}>{errors[`${prefix}-team`]}</small>}

          <div className={cx(styles, commonStyles, "operation-entries")}>
            {renderOperationFields(line, index, "ENTREGA", originalItem)}
            {renderOperationFields(line, index, "COLETA", originalItem)}
          </div>
          {errors[`${prefix}-total`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-total`]}</small>}
          {line.legacyObservation.trim() && <div className={cx(styles, commonStyles, "notice notice-info legacy-observation")}><strong>Observação geral de um lançamento antigo:</strong> {line.legacyObservation.trim()}</div>}
        </article>;
      })}
    </div>;
  }

  return <form className={cx(styles, commonStyles, "delivery-form")} onSubmit={submit} noValidate aria-busy={saving}>
    <fieldset className={cx(styles, commonStyles, "form-fieldset")} disabled={saving} aria-label="Formulário de lançamentos de entregas e coletas">
      {requestError && <div className={cx(styles, commonStyles, "notice notice-error form-error-summary")} data-form-error role="alert">{requestError}</div>}
      {Object.keys(errors).length > 0 && <div className={cx(styles, commonStyles, "notice notice-error form-error-summary")} data-form-error role="alert">Revise os campos destacados antes de lançar.</div>}

      <section className={cx(styles, commonStyles, "form-section")}>
        <div className={cx(styles, commonStyles, "section-heading section-heading-between")}>
          <div className={cx(styles, commonStyles, "section-heading-main")}><div><h2>Entregas e coletas do dia</h2><p>Cada registro usa a mesma data, localidade, motorista e equipe para as duas operações.</p></div></div>
          <button className={cx(styles, commonStyles, "button button-secondary button-add")} type="button" disabled={lines.length >= 100 || saving} onClick={addLine}><span aria-hidden="true">＋</span> Adicionar registro</button>
        </div>
        {renderLines()}
      </section>

      <section className={cx(styles, commonStyles, "form-summary-bar")}>
        <div className={cx(styles, commonStyles, "summary-bar-icon")} aria-hidden="true">↗</div>
        <div className={cx(styles, commonStyles, "summary-bar-copy")}><strong>Resumo do lançamento</strong><span>{lines.length} registros em {new Set(lines.map((line) => line.locality).filter(Boolean)).size} localidades</span></div>
        <div className={cx(styles, commonStyles, "summary-bar-count")}><strong>{totals.entregas.realizadas + totals.entregas.naoRealizadas}</strong><span>entregas</span></div>
        <div className={cx(styles, commonStyles, "summary-bar-divider")} />
        <div className={cx(styles, commonStyles, "summary-bar-count summary-bar-count-muted")}><strong>{totals.coletas.realizadas + totals.coletas.naoRealizadas}</strong><span>coletas</span></div>
        <div className={cx(styles, commonStyles, "summary-bar-divider")} />
        <div className={cx(styles, commonStyles, "summary-bar-count")}><strong>{totals.entregas.realizadas + totals.coletas.realizadas}</strong><span>realizadas</span></div>
        <div className={cx(styles, commonStyles, "summary-bar-count summary-bar-count-muted")}><strong>{totals.entregas.naoRealizadas + totals.coletas.naoRealizadas}</strong><span>não realizadas</span></div>
      </section>

      <div className={cx(styles, commonStyles, "form-actions")}>
        <p><span aria-hidden="true">ⓘ</span> O lançamento será registrado diretamente e ficará disponível no histórico para edição ou cancelamento.</p>
        <div className={cx(styles, commonStyles, "form-action-buttons")}><button className={cx(styles, commonStyles, "button button-primary button-save")} type="submit" disabled={saving || !canLaunch}>{saving ? <><span className={cx(styles, commonStyles, "spinner")} /> Registrando...</> : <>Lançar <span aria-hidden="true">→</span></>}</button></div>
      </div>
    </fieldset>
  </form>;
}
