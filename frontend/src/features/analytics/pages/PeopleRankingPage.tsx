import { useEffect, useMemo, useState } from "react";
import styles from "./ManagementDashboardPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { analyticsApi } from "../api";
import type { DashboardPerson, DashboardResponse } from "../types";
import { catalogsApi } from "../../catalogs/api";
import type { LocalityCatalogItem } from "../../deliveries/types";
import { messageFromApiError } from "../../../shared/api/apiError";
import { PaginatedTable } from "../components/PaginatedTable";
import { DashboardDetailDialog } from "./DashboardDetailDialog";

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

export function PeopleRankingPage() {
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [localityId, setLocalityId] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [functionFilter, setFunctionFilter] = useState<"TODOS" | "MOTORISTA" | "AJUDANTE">("TODOS");
  const [statusFilter, setStatusFilter] = useState<"TODOS" | "ATIVO" | "INATIVO">("TODOS");
  const [localities, setLocalities] = useState<LocalityCatalogItem[]>([]);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedPerson, setSelectedPerson] = useState<DashboardPerson | null>(null);

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
    }).then((result) => {
      if (active) setData(result);
    }).catch((loadError: unknown) => {
      if (active) setError(messageFromApiError(loadError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [fromDate, toDate, localityId, reload]);

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
    setNameFilter("");
    setFunctionFilter("TODOS");
    setStatusFilter("TODOS");
  }

  return <div className={cx(styles, commonStyles, "portal-page", "page-stack", "manager-dashboard-page")}>
    <div className={cx(styles, commonStyles, "page-heading-row", "manager-heading")}>
      <div><h1>Indicadores por pessoa</h1><p className={cx(styles, commonStyles, "page-lead")}>Ranking de motoristas e ajudantes. Selecione uma pessoa para abrir o detalhamento.</p></div>
      <div className={cx(styles, commonStyles, "manager-heading-status")}><span className={cx(styles, commonStyles, "registered-status-dot")} />{loading ? "Atualizando" : `${formatCount.format(people.length)} pessoas`}</div>
    </div>

    <section className={cx(styles, commonStyles, "manager-filter-card")} aria-label="Filtros do ranking por pessoa">
      <label className={cx(styles, commonStyles, "filter-control")}><span>Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Loja / localidade</span><select value={localityId} onChange={(event) => setLocalityId(event.target.value)}><option value="">Todas as localidades ativas</option>{localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Buscar pessoa</span><input type="search" value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder="Nome" /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Função</span><select value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value as typeof functionFilter)}><option value="TODOS">Motoristas e ajudantes</option><option value="MOTORISTA">Motoristas</option><option value="AJUDANTE">Ajudantes</option></select></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Situação cadastral</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="TODOS">Todas as situações</option><option value="ATIVO">Ativos</option><option value="INATIVO">Inativos</option></select></label>
      <button className={cx(styles, commonStyles, "manager-reset-button")} type="button" onClick={clearFilters}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6.5A6.5 6.5 0 1 1 3.6 11" /><path d="M4 3.8v3.5h3.5" /></svg><span>Limpar filtros</span></button>
      <span className={cx(styles, commonStyles, "manager-filter-note")}>Motivos e resultados das equipes aparecem somente no detalhamento da pessoa; os registros são coletivos e não indicam responsabilidade individual.</span>
    </section>

    {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReload((current) => current + 1)}>Tentar novamente</button></div>}
    <section className={cx(styles, commonStyles, "manager-panel")}>
      <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Ranking</h2><p>Posição, volumes e percentuais. Clique no nome para consultar resultados por operação e os motivos das equipes.</p></div><span>{loading ? "—" : `${formatCount.format(people.length)} resultados`}</span></div>
      {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando indicadores por pessoa...</div>
        : !people.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Nenhuma pessoa corresponde aos filtros selecionados.</div>
          : <PaginatedTable items={people} label="Ranking por pessoa" tableClassName={cx(styles, commonStyles, "manager-ranking-table-scroll")}>{(pagePeople, startIndex) => <table className={cx(styles, commonStyles, "data-table manager-table", "manager-compact-table", "people-ranking-table")}>
            <thead><tr><th>Posição</th><th>Pessoa</th><th>Planejadas</th><th>Realizadas</th><th>Não realizadas</th><th>Taxa</th><th>OTIF</th><th>Score</th><th>Elogios</th><th>Reclamações</th><th>Status</th></tr></thead>
            <tbody>{pagePeople.map((person: DashboardPerson, index) => <tr key={person.id_pessoa}>
              <td className={cx(styles, commonStyles, "ranking-position")}>{startIndex + index + 1}</td>
              <th scope="row"><button className={cx(styles, commonStyles, "person-detail-trigger")} type="button" onClick={() => setSelectedPerson(person)} aria-label={`Abrir detalhes de ${person.nome}`}><span className={cx(styles, commonStyles, "person-cell-name")}>{person.nome}</span><small>{person.funcao === "MOTORISTA" ? "Motorista · ver detalhes" : "Ajudante · ver detalhes"}</small></button></th>
              <td>{formatCount.format(person.itens_planejados)}</td><td className={cx(styles, commonStyles, "number-positive")}>{formatCount.format(person.realizadas)}</td><td className={cx(styles, commonStyles, "number-attention")}>{formatCount.format(person.nao_realizadas)}</td>
              <td>{percent(person.taxa_realizacao)}</td><td>{percent(person.otif_percentual)}</td>
              <td>{person.score_atendimento > 0 ? `+${person.score_atendimento}` : person.score_atendimento}</td><td>{person.elogios === null ? "—" : formatCount.format(person.elogios)}</td><td>{person.reclamacoes === null ? "—" : formatCount.format(person.reclamacoes)}</td>
              <td><span className={cx(styles, commonStyles, person.ativo ? "ranking-status ranking-status-active" : "ranking-status ranking-status-inactive")}>{person.ativo ? "Ativo" : "Inativo"}</span></td>
            </tr>)}</tbody>
          </table>}</PaginatedTable>}
    </section>
    <DashboardDetailDialog selection={selectedPerson ? { kind: "person", title: selectedPerson.nome, person: selectedPerson } : null} dashboard={data} localityDashboard={null} localityLoading={false} localityError="" onClose={() => setSelectedPerson(null)} />
  </div>;
}
