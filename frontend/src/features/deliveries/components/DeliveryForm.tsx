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

type ReasonDraft = { key: string; id: string; quantity: string; observation: string };
type DeliveryDraftLine = {
  key: string;
  itemCode?: string;
  date: string;
  locality: string;
  driver: string;
  helpers: [string, string];
  completed: string;
  notCompleted: string;
  reasons: ReasonDraft[];
  legacyObservation: string;
};

type DeliveryFormProps = {
  localities: LocalityCatalogItem[];
  drivers: PersonCatalogItem[];
  helpers: PersonCatalogItem[];
  reasons: NonDeliveryReasonCatalogItem[];
  responsibleName: string;
  canLaunch: boolean;
  initialLaunch?: DeliveryLaunchDetail;
  onSaved: (launch: DeliveryLaunchDetail) => void;
};

const maximumQuantity = 2_147_483_647;

function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function newLine(): DeliveryDraftLine {
  return {
    key: crypto.randomUUID(),
    date: localDate(),
    locality: "",
    driver: "",
    helpers: ["", ""],
    completed: "",
    notCompleted: "",
    reasons: [],
    legacyObservation: "",
  };
}

function newReason(quantity = "1"): ReasonDraft {
  return { key: crypto.randomUUID(), id: "", quantity, observation: "" };
}

function linesFromLaunch(launch: DeliveryLaunchDetail): DeliveryDraftLine[] {
  return launch.itens.map((item) => {
    const driver = item.participantes.find((person) => person.papel_participante === "MOTORISTA");
    const helpers = item.participantes
      .filter((person) => person.papel_participante === "AJUDANTE")
      .sort((left, right) => left.ordem - right.ordem);
    return {
      key: item.codigo_item_lancamento,
      itemCode: item.codigo_item_lancamento,
      date: item.data_entrega.slice(0, 10),
      locality: String(item.id_localidade),
      driver: driver ? String(driver.id_pessoa) : "",
      helpers: [String(helpers[0]?.id_pessoa ?? ""), String(helpers[1]?.id_pessoa ?? "")] as [string, string],
      completed: String(item.quantidade_realizada),
      notCompleted: String(item.quantidade_nao_realizada),
      reasons: item.motivos.map((reason) => ({
        key: `${item.codigo_item_lancamento}-${reason.id_motivo_nao_entrega}`,
        id: String(reason.id_motivo_nao_entrega),
        quantity: String(reason.quantidade),
        observation: reason.observacao ?? "",
      })),
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
    const completed = numberValue(line.completed);
    const notCompleted = numberValue(line.notCompleted);
    if (!line.date) errors[`${prefix}-date`] = "Informe a data da entrega.";
    if (!line.locality) errors[`${prefix}-locality`] = "Selecione a localidade.";
    if (!line.driver) errors[`${prefix}-driver`] = "Selecione o motorista.";
    if (![completed, notCompleted].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= maximumQuantity)) {
      errors[`${prefix}-total`] = `As quantidades devem ser inteiros entre zero e ${maximumQuantity}.`;
    }
    if (completed + notCompleted <= 0) errors[`${prefix}-total`] = "Informe pelo menos uma entrega realizada ou não realizada.";
    const selectedPeople = [line.driver, ...line.helpers].filter(Boolean);
    if (new Set(selectedPeople).size !== selectedPeople.length) errors[`${prefix}-team`] = "Uma pessoa não pode ocupar dois papéis.";
    const selectedTypes = selectedPeople.map((id) => personTransportType(id, line, drivers, helpers, initialLaunch));
    if (selectedTypes.some((type) => type === null)) {
      errors[`${prefix}-team`] = "Classifique como própria ou terceirizada todas as pessoas da equipe.";
    } else if (new Set(selectedTypes).size > 1) {
      errors[`${prefix}-team`] = "Motorista e ajudantes precisam pertencer ao mesmo tipo de entrega.";
    }

    const selectedReasons = line.reasons.filter((reason) => reason.id);
    const reasonQuantity = selectedReasons.reduce((sum, reason) => sum + numberValue(reason.quantity), 0);
    if (selectedReasons.some((reason) => !reasonGroup(reason.id, line, reasons, initialLaunch))) {
      errors[`${prefix}-reasons`] = "Classifique o grupo de todos os motivos antes de usá-los.";
    }
    if (line.reasons.some((reason) => reason.id && (!Number.isSafeInteger(numberValue(reason.quantity)) || numberValue(reason.quantity) <= 0 || numberValue(reason.quantity) > maximumQuantity))) {
      errors[`${prefix}-reasons`] = `A quantidade de cada motivo deve ser um inteiro entre um e ${maximumQuantity}.`;
    }
    if (notCompleted === 0 && selectedReasons.length > 0) {
      errors[`${prefix}-reasons`] = "Remova os motivos quando não houver entregas não realizadas.";
    } else if (notCompleted > 0 && selectedReasons.length === 0) {
      errors[`${prefix}-reasons`] = "Informe o motivo das entregas não realizadas.";
    } else if (notCompleted > 0 && reasonQuantity !== notCompleted) {
      errors[`${prefix}-reasons`] = "A soma dos motivos deve igualar a quantidade não realizada.";
    }
    if (selectedReasons.length !== line.reasons.length) {
      errors[`${prefix}-reasons`] = "Selecione um motivo em cada linha adicionada.";
    }
    if (new Set(selectedReasons.map((reason) => reason.id)).size !== selectedReasons.length) {
      errors[`${prefix}-reasons`] = "Cada motivo deve aparecer somente uma vez por entrega.";
    }
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
    quantidade_realizada: numberValue(line.completed),
    quantidade_nao_realizada: numberValue(line.notCompleted),
    participantes: participants,
    motivos: line.reasons
      .filter((reason) => reason.id)
      .map((reason) => ({
        id_motivo_nao_entrega: Number(reason.id),
        quantidade: numberValue(reason.quantity),
        observacao: reason.observation.trim() || null,
      })),
  };
}

export function DeliveryForm({ localities, drivers, helpers, reasons, responsibleName, canLaunch, initialLaunch, onSaved }: DeliveryFormProps) {
  const [lines, setLines] = useState<DeliveryDraftLine[]>(() => initialLaunch ? linesFromLaunch(initialLaunch) : [newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedDraft, setSavedDraft] = useState(initialLaunch);
  const [reviewing, setReviewing] = useState(false);
  const saveIdempotencyKey = useRef(crypto.randomUUID());
  const confirmIdempotencyKey = useRef(crypto.randomUUID());

  const totals = useMemo(
    () => lines.reduce(
      (sum, line) => ({
        completed: sum.completed + numberValue(line.completed),
        notCompleted: sum.notCompleted + numberValue(line.notCompleted),
      }),
      { completed: 0, notCompleted: 0 },
    ),
    [lines],
  );

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

  function updateReason(lineKey: string, reasonKey: string, changes: Partial<ReasonDraft>) {
    renewIdempotencyKeys();
    setErrors({});
    setRequestError("");
    setLines((current) => current.map((line) => line.key !== lineKey ? line : {
      ...line,
      reasons: line.reasons.map((reason) => reason.key === reasonKey ? { ...reason, ...changes } : reason),
    }));
  }

  function addReason(line: DeliveryDraftLine) {
    updateLine(line.key, { reasons: [...line.reasons, newReason()] });
  }

  function removeReason(line: DeliveryDraftLine, reasonKey: string) {
    updateLine(line.key, { reasons: line.reasons.filter((reason) => reason.key !== reasonKey) });
  }

  function changeNotCompleted(line: DeliveryDraftLine, value: string) {
    let nextReasons = line.reasons;
    if (Number(value) <= 0) nextReasons = [];
    else if (line.reasons.length === 0) nextReasons = [newReason(value)];
    else if (line.reasons.length === 1) nextReasons = [{ ...line.reasons[0], quantity: value || "1" }];
    updateLine(line.key, { notCompleted: value, reasons: nextReasons });
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

  async function saveDraftAndExit() {
    setRequestError("");
    if (!validateForm()) return;
    setSaving(true);
    try {
      onSaved(await persistDraft(lines.map(toPayloadLine)));
    } catch (error) {
      setRequestError(messageFromApiError(error));
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError("");
    if (!reviewing && !validateForm()) return;
    setSaving(true);
    try {
      if (reviewing) {
        if (!canLaunch) throw new Error("Seu perfil não tem permissão para confirmar lançamentos.");
        const draft = savedDraft ?? initialLaunch;
        if (!draft) throw new Error("Salve o rascunho antes de confirmar o lançamento.");
        onSaved(await deliveriesApi.confirmDraft(draft.codigo_lancamento, confirmIdempotencyKey.current));
        return;
      }
      const saved = await persistDraft(lines.map(toPayloadLine));
      if (saved.estado !== "RASCUNHO") {
        throw new Error("Este lançamento não está mais em rascunho. Atualize o histórico para conferir o estado atual.");
      }
      setReviewing(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setRequestError(messageFromApiError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={cx(styles, commonStyles, "delivery-form")} onSubmit={submit} noValidate aria-busy={saving}>
      <fieldset className={cx(styles, commonStyles, "form-fieldset")} disabled={saving} aria-label="Formulário de lançamento de entregas">
      <div className={cx(styles, commonStyles, "form-progress")} aria-label="Etapas do lançamento" role="list">
        <div role="listitem" aria-current={!reviewing ? "step" : undefined} className={cx(styles, commonStyles, `progress-step${reviewing ? " progress-step-complete" : " progress-step-active"}`)}><span aria-hidden="true">{reviewing ? "✓" : "1"}</span><div><strong>Preencher</strong><small>Data, equipe e quantidades</small></div></div>
        <div className={cx(styles, commonStyles, `progress-track${reviewing ? " progress-track-complete" : ""}`)} aria-hidden="true" />
        <div role="listitem" aria-current={reviewing ? "step" : undefined} className={cx(styles, commonStyles, `progress-step${reviewing ? " progress-step-active" : ""}`)}><span aria-hidden="true">2</span><div><strong>Conferir e lançar</strong><small>Revisão e confirmação</small></div></div>
      </div>
      {requestError && <div className={cx(styles, commonStyles, "notice notice-error form-error-summary")} data-form-error role="alert">{requestError}</div>}

      {!reviewing ? <>
      <section className={cx(styles, commonStyles, "form-section form-section-basic")}>
        <div className={cx(styles, commonStyles, "section-heading")}>
          <div><h2>Identificação do lançamento</h2><p>Setor definido automaticamente para Suporte. Confira quem está registrando.</p></div>
        </div>
        <div className={cx(styles, commonStyles, "field-grid field-grid-basic")}>
          <div className={cx(styles, commonStyles, "form-field form-field-readonly")}><span>Setor responsável</span><div className={cx(styles, commonStyles, "readonly-value")}>{initialLaunch?.nome_setor ?? "Suporte"}</div></div>
          <div className={cx(styles, commonStyles, "form-field form-field-readonly")}>
            <span>Responsável pelo registro</span>
            <div className={cx(styles, commonStyles, "readonly-value")}><span className={cx(styles, commonStyles, "mini-avatar")}>{responsibleName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span> {responsibleName} <span className={cx(styles, commonStyles, "field-hint")}>Preenchido automaticamente</span></div>
          </div>
        </div>
      </section>

      <section className={cx(styles, commonStyles, "form-section")}>
        <div className={cx(styles, commonStyles, "section-heading section-heading-between")}>
          <div className={cx(styles, commonStyles, "section-heading-main")}>
            <div><h2>Entregas do dia</h2><p>Adicione uma linha para cada localidade e equipe.</p></div>
          </div>
          <button className={cx(styles, commonStyles, "button button-secondary button-add")} type="button" disabled={lines.length >= 100 || saving} onClick={() => { renewIdempotencyKeys(); setErrors({}); setRequestError(""); setLines((current) => [...current, newLine()]); }}>
            <span aria-hidden="true">＋</span> Adicionar entrega
          </button>
        </div>

        {Object.keys(errors).length > 0 && <div className={cx(styles, commonStyles, "notice notice-error form-error-summary")} data-form-error role="alert">Revise os campos destacados antes de salvar.</div>}

        <div className={cx(styles, commonStyles, "delivery-line-list")}>
          {lines.map((line, index) => {
            const prefix = `item-${index + 1}`;
            const filledReasonIds = line.reasons.map((reason) => reason.id).filter(Boolean);
            const completed = numberValue(line.completed);
            const notCompleted = numberValue(line.notCompleted);
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
            return (
              <article className={cx(styles, commonStyles, "delivery-line-card")} key={line.key}>
                <div className={cx(styles, commonStyles, "delivery-line-top")}>
                  <div className={cx(styles, commonStyles, "delivery-line-title")}><span className={cx(styles, commonStyles, "delivery-index")}>{String(index + 1).padStart(2, "0")}</span><div><h3>Entrega {index + 1}</h3><p>Localidade, equipe e quantidades</p></div></div>
                  {lines.length > 1 && <button className={cx(styles, commonStyles, "icon-button")} type="button" aria-label={`Remover entrega ${index + 1}`} disabled={saving} onClick={() => { renewIdempotencyKeys(); setErrors({}); setRequestError(""); setLines((current) => current.filter((entry) => entry.key !== line.key)); }}>×</button>}
                </div>

                <div className={cx(styles, commonStyles, "field-grid field-grid-delivery-top")}>
                  <label className={cx(styles, commonStyles, "form-field")}>
                    <span>Data da entrega <b>*</b></span>
                    <input type="date" value={line.date} onChange={(event) => updateLine(line.key, { date: event.target.value })} required />
                    {errors[`${prefix}-date`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-date`]}</small>}
                  </label>
                  <label className={cx(styles, commonStyles, "form-field")}>
                    <span>Localidade <b>*</b></span>
                    <select value={line.locality} onChange={(event) => updateLine(line.key, { locality: event.target.value })} required>
                      <option value="">Selecione a localidade</option>
                      {initialLaunch?.itens.find((item) => item.codigo_item_lancamento === line.itemCode && !localities.some((locality) => String(locality.id_localidade) === line.locality)) && <option value={line.locality}>{initialLaunch.itens.find((item) => item.codigo_item_lancamento === line.itemCode)?.nome_localidade}</option>}
                      {localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}
                    </select>
                    {errors[`${prefix}-locality`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-locality`]}</small>}
                  </label>
                </div>

                <div className={cx(styles, commonStyles, "team-fields")}>
                  <label className={cx(styles, commonStyles, "form-field")}>
                    <span>Motorista <b>*</b></span>
                    <select value={line.driver} onChange={(event) => updateLine(line.key, { driver: event.target.value })} required>
                      <option value="">Selecione o motorista</option>
                      {initialLaunch?.itens.find((item) => item.codigo_item_lancamento === line.itemCode)?.participantes.filter((person) => person.papel_participante === "MOTORISTA" && !drivers.some((candidate) => String(candidate.id_pessoa) === line.driver)).map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</option>)}
                      {drivers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</option>)}
                    </select>
                    {errors[`${prefix}-driver`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-driver`]}</small>}
                  </label>
                  {line.helpers.map((helperId, helperIndex) => (
                    <label className={cx(styles, commonStyles, "form-field")} key={`helper-${helperIndex}`}>
                      <span>Ajudante {helperIndex + 1} <small className={cx(styles, commonStyles, "field-hint")}>opcional</small></span>
                      <select
                        value={helperId}
                        onChange={(event) => {
                          const nextHelpers: [string, string] = [line.helpers[0], line.helpers[1]];
                          nextHelpers[helperIndex] = event.target.value;
                          updateLine(line.key, { helpers: nextHelpers });
                        }}
                      >
                        <option value="">Nenhum</option>
                        {initialLaunch?.itens.find((item) => item.codigo_item_lancamento === line.itemCode)?.participantes.filter((person) => person.papel_participante === "AJUDANTE" && String(person.id_pessoa) === helperId && !helpers.some((candidate) => String(candidate.id_pessoa) === helperId)).map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</option>)}
                        {helpers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <div className={cx(styles, commonStyles, "team-classification")}><span>Tipo da entrega</span><strong className={cx(styles, commonStyles, `transport-badge${teamTypeLabel.includes("pendente") || teamTypeLabel === "Equipe mista" ? " transport-badge-warning" : ""}`)}>{teamTypeLabel}</strong></div>
                {errors[`${prefix}-team`] && <small className={cx(styles, commonStyles, "field-error team-error")}>{errors[`${prefix}-team`]}</small>}

                <div className={cx(styles, commonStyles, "quantity-section")}>
                  <div className={cx(styles, commonStyles, "quantity-field")}>
                    <span className={cx(styles, commonStyles, "quantity-dot")} />
                    <label className={cx(styles, commonStyles, "form-field")}><span>Entregas realizadas <b>*</b></span><input type="number" min="0" max={maximumQuantity} step="1" value={line.completed} onChange={(event) => updateLine(line.key, { completed: event.target.value })} placeholder="0" required /></label>
                  </div>
                  <div className={cx(styles, commonStyles, "quantity-field quantity-incomplete")}>
                    <span className={cx(styles, commonStyles, "quantity-dot")} />
                    <label className={cx(styles, commonStyles, "form-field")}><span>Não realizadas</span><input type="number" min="0" max={maximumQuantity} step="1" value={line.notCompleted} onChange={(event) => changeNotCompleted(line, event.target.value)} placeholder="0" /></label>
                  </div>
                  <div className={cx(styles, commonStyles, "quantity-total")}><span>Total informado</span><strong>{completed + notCompleted}</strong></div>
                </div>
                {errors[`${prefix}-total`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-total`]}</small>}

                {notCompleted > 0 && (
                  <div className={cx(styles, commonStyles, "reasons-panel")}>
                    <div className={cx(styles, commonStyles, "reasons-heading")}><div><strong>Motivos de não realização</strong><p>Distribua as {notCompleted} entrega(s) não realizada(s).</p></div><button type="button" className={cx(styles, commonStyles, "text-button")} disabled={line.reasons.length >= 30 || saving} onClick={() => addReason(line)}>＋ Adicionar motivo</button></div>
                    {line.reasons.map((reason, reasonIndex) => (
                      <div className={cx(styles, commonStyles, "reason-entry")} key={reason.key}>
                        <div className={cx(styles, commonStyles, "reason-row")}>
                          <label className={cx(styles, commonStyles, "form-field reason-select")}><span className={cx(styles, commonStyles, "visually-hidden")}>Motivo</span><select aria-label={`Motivo ${reasonIndex + 1} da entrega ${index + 1}`} value={reason.id} onChange={(event) => updateReason(line.key, reason.key, { id: event.target.value, observation: event.target.value === reason.id ? reason.observation : "" })}>
                            <option value="">Selecione o motivo</option>
                            {initialLaunch?.itens.find((item) => item.codigo_item_lancamento === line.itemCode)?.motivos.filter((entry) => String(entry.id_motivo_nao_entrega) === reason.id && !reasons.some((candidate) => String(candidate.id_motivo_nao_entrega) === reason.id)).map((entry) => <option key={entry.id_motivo_nao_entrega} value={entry.id_motivo_nao_entrega}>{entry.descricao_motivo} · {nonDeliveryReasonGroupLabel(entry.grupo_motivo)}</option>)}
                            {reasons.filter((item) => !filledReasonIds.includes(String(item.id_motivo_nao_entrega)) || String(item.id_motivo_nao_entrega) === reason.id).map((item) => <option key={item.id_motivo_nao_entrega} value={item.id_motivo_nao_entrega}>{item.descricao_motivo} · {nonDeliveryReasonGroupLabel(item.grupo_motivo)}</option>)}
                          </select></label>
                          <label className={cx(styles, commonStyles, "form-field reason-quantity")}><span className={cx(styles, commonStyles, "visually-hidden")}>Quantidade</span><input type="number" min="1" max={maximumQuantity} step="1" value={reason.quantity} onChange={(event) => updateReason(line.key, reason.key, { quantity: event.target.value })} aria-label={`Quantidade do motivo ${reasonIndex + 1} da entrega ${index + 1}`} /></label>
                          <button type="button" className={cx(styles, commonStyles, "icon-button remove-reason")} aria-label={`Remover motivo ${reasonIndex + 1} da entrega ${index + 1}`} disabled={saving} onClick={() => removeReason(line, reason.key)}>×</button>
                        </div>
                        <label className={cx(styles, commonStyles, "form-field reason-observation")}>
                          <span>Observação deste motivo <small className={cx(styles, commonStyles, "field-hint")}>opcional</small></span>
                          <textarea value={reason.observation} onChange={(event) => updateReason(line.key, reason.key, { observation: event.target.value })} placeholder="Detalhe o que aconteceu com este motivo..." maxLength={5000} rows={2} />
                        </label>
                      </div>
                    ))}
                    {errors[`${prefix}-reasons`] && <small className={cx(styles, commonStyles, "field-error")}>{errors[`${prefix}-reasons`]}</small>}
                  </div>
                )}

                {line.legacyObservation.trim() && <div className={cx(styles, commonStyles, "notice notice-info legacy-observation")}><strong>Observação geral de um lançamento antigo:</strong> {line.legacyObservation.trim()}</div>}
              </article>
            );
          })}
        </div>
      </section>

      <section className={cx(styles, commonStyles, "form-summary-bar")}>
        <div className={cx(styles, commonStyles, "summary-bar-icon")} aria-hidden="true">↗</div>
        <div className={cx(styles, commonStyles, "summary-bar-copy")}><strong>Resumo do lançamento</strong><span>{lines.length} {lines.length === 1 ? "entrega" : "entregas"} em {new Set(lines.map((line) => line.locality).filter(Boolean)).size} localidades</span></div>
        <div className={cx(styles, commonStyles, "summary-bar-count")}><strong>{totals.completed}</strong><span>realizadas</span></div>
        <div className={cx(styles, commonStyles, "summary-bar-divider")} />
        <div className={cx(styles, commonStyles, "summary-bar-count summary-bar-count-muted")}><strong>{totals.notCompleted}</strong><span>não realizadas</span></div>
      </section>

      </> : <section className={cx(styles, commonStyles, "review-panel")} aria-labelledby="review-title">
        <div className={cx(styles, commonStyles, "review-panel-heading")}><div><p className={cx(styles, commonStyles, "eyebrow")}>CONFERÊNCIA FINAL</p><h2 id="review-title">Confira antes de lançar</h2><p>Confira as quantidades, as equipes e as localidades. Ao confirmar, o lançamento será registrado e já contará nos indicadores.</p></div><span className={cx(styles, commonStyles, "review-draft-badge")}>Rascunho salvo</span></div>
        <div className={cx(styles, commonStyles, "review-meta-grid")}><div><span>Setor responsável</span><strong>{savedDraft?.nome_setor ?? initialLaunch?.nome_setor ?? "Suporte"}</strong></div><div><span>Responsável pelo registro</span><strong>{responsibleName}</strong></div><div><span>Entregas registradas</span><strong>{lines.length}</strong></div></div>
        <div className={cx(styles, commonStyles, "review-delivery-list")}>{lines.map((line, index) => {
          const originalItem = initialLaunch?.itens.find((item) => item.codigo_item_lancamento === line.itemCode);
          const locality = localities.find((item) => String(item.id_localidade) === line.locality)?.nome_localidade ?? originalItem?.nome_localidade ?? "Localidade indisponível";
          const driverName = drivers.find((person) => String(person.id_pessoa) === line.driver)?.nome_exibicao ?? originalItem?.participantes.find((person) => person.papel_participante === "MOTORISTA")?.nome_exibicao ?? "Motorista não disponível";
          const helperNames = line.helpers.map((id) => helpers.find((person) => String(person.id_pessoa) === id)?.nome_exibicao ?? originalItem?.participantes.find((person) => person.papel_participante === "AJUDANTE" && String(person.id_pessoa) === id)?.nome_exibicao).filter(Boolean);
          const date = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${line.date}T12:00:00`));
          const selectedTeamIds = [line.driver, ...line.helpers].filter(Boolean);
          const teamTypes = selectedTeamIds.map((id) => personTransportType(id, line, drivers, helpers, initialLaunch));
          const distinctTeamTypes = new Set(teamTypes.filter((type): type is DeliveryTransportType => Boolean(type)));
          const teamTypeLabel = selectedTeamIds.length === 0
            ? "Sem classificação"
            : teamTypes.some((type) => type === null)
              ? "Classificação pendente"
              : distinctTeamTypes.size > 1
                ? "Equipe mista"
                : deliveryTransportLabel([...distinctTeamTypes][0]);
          const reasonLabels = line.reasons.map((reason) => {
            const label = reasons.find((item) => String(item.id_motivo_nao_entrega) === reason.id)?.descricao_motivo ?? originalItem?.motivos.find((item) => String(item.id_motivo_nao_entrega) === reason.id)?.descricao_motivo ?? "Motivo";
            const group = reasonGroup(reason.id, line, reasons, initialLaunch);
            const observation = reason.observation.trim();
            return `${label} · ${nonDeliveryReasonGroupLabel(group)} (${numberValue(reason.quantity)})${observation ? ` — Observação: ${observation}` : ""}`;
          });
          return <article className={cx(styles, commonStyles, "review-delivery-card")} key={line.key}>
            <div className={cx(styles, commonStyles, "review-delivery-heading")}><span className={cx(styles, commonStyles, "delivery-index")}>{String(index + 1).padStart(2, "0")}</span><div><h3>{locality}</h3><p>{date}</p></div></div>
            <div className={cx(styles, commonStyles, "review-data-grid")}><div><span>Motorista</span><strong>{driverName}</strong></div><div><span>Ajudantes</span><strong>{helperNames.length ? helperNames.join(", ") : "Nenhum"}</strong></div><div><span>Tipo da entrega</span><strong>{teamTypeLabel}</strong></div><div><span>Realizadas</span><strong>{numberValue(line.completed).toLocaleString("pt-BR")}</strong></div><div><span>Não realizadas</span><strong>{numberValue(line.notCompleted).toLocaleString("pt-BR")}</strong></div></div>
            {reasonLabels.length > 0 && <p className={cx(styles, commonStyles, "review-reasons")}><strong>Motivos:</strong> {reasonLabels.join(", ")}</p>}
            {line.legacyObservation.trim() && <p className={cx(styles, commonStyles, "review-observation")}><strong>Observação geral (registro antigo):</strong> {line.legacyObservation.trim()}</p>}
          </article>;
        })}</div>
        <div className={cx(styles, commonStyles, "review-total-row")}><span>Total do lançamento</span><strong>{totals.completed.toLocaleString("pt-BR")} realizadas</strong><strong>{totals.notCompleted.toLocaleString("pt-BR")} não realizadas</strong></div>
      </section>}

      <div className={cx(styles, commonStyles, "form-actions")}>
        {!reviewing ? <>
          <p><span aria-hidden="true">ⓘ</span> Salve como rascunho ou avance para conferir e confirmar o lançamento.</p>
          <div className={cx(styles, commonStyles, "form-action-buttons")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={saving} onClick={() => { void saveDraftAndExit(); }}>{saving ? "Salvando..." : "Salvar rascunho"}</button><button className={cx(styles, commonStyles, "button button-primary button-save")} type="submit" disabled={saving}>{saving ? <><span className={cx(styles, commonStyles, "spinner")} /> Salvando...</> : <>Conferir lançamento <span aria-hidden="true">→</span></>}</button></div>
        </> : <>
          <button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={saving} onClick={() => { setReviewing(false); setRequestError(""); }}>← Voltar para editar</button>
          {canLaunch ? <button className={cx(styles, commonStyles, "button button-primary button-save")} type="submit" disabled={saving}>{saving ? <><span className={cx(styles, commonStyles, "spinner")} /> Registrando...</> : <>Confirmar lançamento <span aria-hidden="true">→</span></>}</button> : <p>Seu perfil não pode confirmar este lançamento.</p>}
        </>}
      </div>
      </fieldset>
    </form>
  );
}
