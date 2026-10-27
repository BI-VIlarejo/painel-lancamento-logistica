import { useEffect, useMemo, useState } from "react";
import styles from "./ManagementDashboardPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { analyticsApi } from "../api";
import type { DashboardPerson, DashboardResponse } from "../types";
import { catalogsApi } from "../../catalogs/api";
import type { LocalityCatalogItem } from "../../deliveries/types";
import { deliveryTransportLabel, nonDeliveryReasonGroupLabel } from "../../deliveries/classifications";
import type { DeliveryTransportType, NonDeliveryReasonGroup } from "../../deliveries/classifications";
import { messageFromApiError } from "../../../shared/api/apiError";

const formatCount = new Intl.NumberFormat("pt-BR");
const formatPercent = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthStart(): string {
  const date = new Date();
  date.setDate(1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${formatPercent.format(value)}%`;
}

function groupName(group: string | null): string {
  return group ? nonDeliveryReasonGroupLabel(group as NonDeliveryReasonGroup) : "Sem classificação";
}

function transportName(type: string | null): string {
  return type ? deliveryTransportLabel(type as DeliveryTransportType) : "Todos os tipos";
}

function PersonRate({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span>—</span>;
  const width = Math.min(100, Math.max(0, value));
  return <span className={cx(styles, commonStyles, "rate-cell")} aria-label={`${label}: ${percent(value)}`}>
    <span className={cx(styles, commonStyles, "rate-meter-track")}><i style={{ width: `${width}%` }} /></span>
    <strong className={cx(styles, commonStyles, "rate-value")}>{percent(value)}</strong>
  </span>;
}

export function PeopleRankingPage() {
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [localityId, setLocalityId] = useState("");
  const [transportType, setTransportType] = useState<"" | DeliveryTransportType>("");
  const [nameFilter, setNameFilter] = useState("");
  const [functionFilter, setFunctionFilter] = useState<"TODOS" | "MOTORISTA" | "AJUDANTE">("TODOS");
  const [statusFilter, setStatusFilter] = useState<"TODOS" | "ATIVO" | "INATIVO">("TODOS");
  const [localities, setLocalities] = useState<LocalityCatalogItem[]>([]);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    void catalogsApi.localities().then((page) => {
      if (active) setLocalities(page.items);
    }).catch((loadError: unknown) => {
      if (active) setError(messageFromApiError(loadError));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void analyticsApi.dashboard({
      data_de: fromDate || undefined,
      data_ate: toDate || undefined,
      id_localidade: localityId ? Number(localityId) : undefined,
      tipo_transporte_entrega: transportType || undefined,
    }).then((result) => {
      if (active) setData(result);
    }).catch((loadError: unknown) => {
      if (active) setError(messageFromApiError(loadError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [fromDate, toDate, localityId, transportType, reload]);

  const people = useMemo(() => (data?.por_pessoa ?? []).filter((person) => {
    const nameMatches = person.nome.toLocaleLowerCase("pt-BR").includes(nameFilter.trim().toLocaleLowerCase("pt-BR"));
    const functionMatches = functionFilter === "TODOS" || person.funcao === functionFilter;
    const statusMatches = statusFilter === "TODOS" || (statusFilter === "ATIVO" ? person.ativo : !person.ativo);
    return nameMatches && functionMatches && statusMatches;
  }), [data, nameFilter, functionFilter, statusFilter]);

  function clearFilters() {
    setFromDate(monthStart());
    setToDate(today());
    setLocalityId("");
    setTransportType("");
    setNameFilter("");
    setFunctionFilter("TODOS");
    setStatusFilter("TODOS");
  }

  return <div className={cx(styles, commonStyles, "page-stack", "manager-dashboard-page")}>
    <div className={cx(styles, commonStyles, "page-heading-row", "manager-heading")}>
      <div><h1>Indicadores por pessoa</h1><p className={cx(styles, commonStyles, "page-lead")}>Ranking de motoristas e ajudantes com o mesmo recorte aplicado a todos os dados.</p></div>
      <div className={cx(styles, commonStyles, "manager-heading-status")}><span className={cx(styles, commonStyles, "registered-status-dot")} />{loading ? "Atualizando" : `${formatCount.format(people.length)} pessoas`}</div>
    </div>

    <section className={cx(styles, commonStyles, "manager-filter-card")} aria-label="Filtros do ranking por pessoa">
      <label className={cx(styles, commonStyles, "filter-control")}><span>Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Loja / localidade</span><select value={localityId} onChange={(event) => setLocalityId(event.target.value)}><option value="">Todas as localidades</option>{localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Tipo de entrega</span><select value={transportType} onChange={(event) => setTransportType(event.target.value as "" | DeliveryTransportType)}><option value="">Próprias e terceirizadas</option><option value="PROPRIA">Entregas próprias</option><option value="TERCEIRIZADA">Entregas terceirizadas</option></select></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Buscar pessoa</span><input type="search" value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="Nome" /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Função</span><select value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value as typeof functionFilter)}><option value="TODOS">Motoristas e ajudantes</option><option value="MOTORISTA">Motoristas</option><option value="AJUDANTE">Ajudantes</option></select></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Situação cadastral</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="TODOS">Todas as situações</option><option value="ATIVO">Ativos</option><option value="INATIVO">Inativos</option></select></label>
      <button className={cx(styles, commonStyles, "button button-secondary", "manager-reset-button")} type="button" onClick={clearFilters}>Limpar filtros</button>
      <span className={cx(styles, commonStyles, "manager-filter-note")}>Os motivos são atribuídos às equipes e aparecem como contexto do trabalho da pessoa, sem indicar responsabilidade individual. O tipo selecionado considera a classificação da equipe.</span>
    </section>

    {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReload((current) => current + 1)}>Tentar novamente</button></div>}
    <section className={cx(styles, commonStyles, "manager-panel")}>
      <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Ranking</h2><p>Taxa de realização, score de atendimento, volume, motivos das equipes e situação cadastral.</p></div><span>{loading ? "—" : `${formatCount.format(people.length)} resultados`}</span></div>
      {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando indicadores por pessoa...</div>
        : !people.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Nenhuma pessoa corresponde aos filtros selecionados.</div>
          : <div className={cx(styles, commonStyles, "manager-table-wrap")}><table className={cx(styles, commonStyles, "manager-table", "manager-compact-table")}>
            <thead><tr><th>Posição</th><th>Pessoa</th><th>Tipo filtrado</th><th>Equipes</th><th>Planejadas</th><th>Realizadas</th><th>Não realizadas</th><th>Taxa</th><th>OTIF</th><th>Motivos das equipes</th><th>Score atendimento</th><th>Elogios</th><th>Reclamações</th><th>Status</th></tr></thead>
            <tbody>{people.map((person: DashboardPerson, index) => <tr key={person.id_pessoa}>
              <td className={cx(styles, commonStyles, "ranking-position")}>{index + 1}</td>
              <th scope="row"><span className={cx(styles, commonStyles, "person-cell-name")}>{person.nome}</span><small>{person.funcao === "MOTORISTA" ? "Motorista" : "Ajudante"}</small></th>
              <td>{transportName(data?.tipo_transporte_entrega ?? null)}</td><td>{formatCount.format(person.equipes)}</td>
              <td>{formatCount.format(person.itens_planejados)}</td><td className={cx(styles, commonStyles, "number-positive")}>{formatCount.format(person.realizadas)}</td><td className={cx(styles, commonStyles, "number-attention")}>{formatCount.format(person.nao_realizadas)}</td>
              <td><PersonRate value={person.taxa_realizacao} label="Taxa de realização" /></td><td><PersonRate value={person.otif_percentual} label="OTIF" /></td>
              <td><div className={cx(styles, commonStyles, "person-reason-list")}>{person.motivos_da_equipe.length ? person.motivos_da_equipe.slice(0, 6).map((reason, reasonIndex) => <small key={`${reason.tipo_operacao}:${reason.id_motivo}:${reasonIndex}`}>{reason.tipo_operacao === "COLETA" ? "Coleta" : "Entrega"} · {reason.motivo} · {groupName(reason.grupo_motivo)} ({formatCount.format(reason.quantidade)})</small>) : <span>—</span>}</div></td>
              <td>{person.score_atendimento > 0 ? `+${person.score_atendimento}` : person.score_atendimento}</td><td>{person.elogios === null ? "—" : formatCount.format(person.elogios)}</td><td>{person.reclamacoes === null ? "—" : formatCount.format(person.reclamacoes)}</td>
              <td><span className={cx(styles, commonStyles, person.ativo ? "ranking-status ranking-status-active" : "ranking-status ranking-status-inactive")}>{person.ativo ? "Ativo" : "Inativo"}</span></td>
            </tr>)}</tbody>
          </table></div>}
    </section>
  </div>;
}
