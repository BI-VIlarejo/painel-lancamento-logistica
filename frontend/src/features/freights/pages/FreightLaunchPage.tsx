import { useEffect, useState } from "react";
import { FreightForm } from "../components/FreightForm";
import { HistoricalFreightForm } from "../components/HistoricalFreightForm";
import { freightsApi } from "../api";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type { FreightResponse, FreightTariffOptions } from "../types";
import { formatDate } from "../format";
import styles from "./FreightLaunchPage.module.css";
import { FreightImportDialog } from "../components/FreightImportDialog";
import type { FreightImportCompletion } from "../components/FreightImportDialog";

type Props = {
  onNavigate: (path: string) => void;
  canViewFreights: boolean;
  canViewAggregatePayments: boolean;
  editId?: string;
};

/** Formulário de lançamento ou edição com os catálogos tarifários. */
export function FreightLaunchPage({ onNavigate, canViewFreights, canViewAggregatePayments, editId }: Props) {
  const [options, setOptions] = useState<FreightTariffOptions | null>(null);
  const [initialFreight, setInitialFreight] = useState<FreightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [createdWithoutHistory, setCreatedWithoutHistory] = useState<FreightResponse | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      freightsApi.tariffOptions(),
      editId ? freightsApi.get(editId) : Promise.resolve(null),
    ])
      .then(([tariffOptions, freight]) => {
        if (!active) return;
        if (freight?.cancelado) throw new Error("Um frete cancelado não pode ser editado.");
        setOptions(tariffOptions);
        setInitialFreight(freight);
      })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [editId, reloadVersion]);

  function handleSaved(freight: FreightResponse) {
    if (canViewFreights) {
      if (!editId) {
        window.sessionStorage.removeItem("lancamento-logistica:freight-history-return");
        window.sessionStorage.setItem("lancamento-logistica:freight-history-top", "1");
      }
      window.sessionStorage.setItem(
        "lancamento-logistica:freight-saved",
        editId ? "Frete atualizado com sucesso." : "Frete registrado com sucesso e disponível no histórico.",
      );
      onNavigate("/fretes/historico");
    } else {
      setCreatedWithoutHistory(freight);
    }
  }

  function handleImported(result: FreightImportCompletion) {
    const message = `${result.importados.toLocaleString("pt-BR")} fretes importados; ${result.vinculados_agregados.toLocaleString("pt-BR")} agregados vinculados; ${result.vinculados_transportadoras.toLocaleString("pt-BR")} motoristas de transportadoras vinculados; ${result.sem_vinculo.toLocaleString("pt-BR")} sem vínculo e pendentes; ${result.atualizados.toLocaleString("pt-BR")} pendências atualizadas; ${result.ja_existentes.toLocaleString("pt-BR")} já registrados.`;
    setImportNotice(result.linhasComErro
      ? `${message} ${result.linhasComErro.toLocaleString("pt-BR")} linhas precisam de correção e podem ser reenviadas.`
      : message);
  }

  const pageAction = editId ? "Editar lançamento" : "Novo lançamento";
  const historicalEdit = Boolean(
    initialFreight
    && typeof initialFreight.detalhe_calculo.importacao_planilha === "object"
    && initialFreight.detalhe_calculo.importacao_planilha !== null,
  );

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "freight-launch-page")}>
      <div className={cx(styles, commonStyles, "breadcrumb")}><span>Fretes</span><span aria-hidden="true">/</span><strong>{pageAction}</strong></div>
      <header className={cx(styles, commonStyles, "page-heading-row", "launch-heading")}>
        <div><p className={cx(styles, commonStyles, "eyebrow")}>OPERAÇÃO DE TRANSPORTE</p><h1>{historicalEdit ? "Editar frete histórico" : editId ? "Editar frete" : "Lançar frete"}</h1><p className={cx(styles, commonStyles, "page-lead")}>{historicalEdit ? initialFreight?.codigo_fonte_tarifa === "AGREGADOS_CD" ? "Para calcular um frete bruto ausente de Agregados CD, informe rota, peso, valor da nota e KM rodado. Se o bruto ou líquido histórico já estiver informado, o KM ausente é apenas um aviso e não bloqueia o pagamento." : initialFreight?.codigo_fonte_tarifa === "JUST_IN_TIME" ? "JUST IN TIME não usa KM. Para calcular um bruto ausente, informe zona e peso; adicional é opcional. Valores históricos existentes são preservados." : "Paulo Cruz não usa KM, rota nem peso na tarifa. Para calcular um bruto ausente, informe o tipo de caminhão; carro de apoio é opcional. Valores históricos existentes são preservados." : editId ? "Atualize os dados do serviço. O frete será recalculado e a alteração ficará registrada na auditoria." : "Selecione o responsável e complete os dados do serviço. Para agregados, os dados de Entregas são preenchidos automaticamente quando disponíveis; caso contrário, informe-os manualmente."}</p></div>
        <div className={cx(styles, "heading-actions")}>
          {!editId && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setImportOpen(true)}>Importar planilha XLSX</button>}
          {canViewFreights && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/historico")}>Ver histórico</button>}
          {canViewAggregatePayments && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/pagamentos")}>Pagamentos</button>}
        </div>
      </header>

      {createdWithoutHistory && <div className={cx(styles, commonStyles, "notice notice-success")} role="status"><span><strong>Frete registrado.</strong> {formatDate(createdWithoutHistory.data_servico)} · {createdWithoutHistory.tipo_transporte === "AGREGADO" ? "Agregado" : "Transportadora independente"}</span><button type="button" onClick={() => setCreatedWithoutHistory(null)} aria-label="Fechar aviso">×</button></div>}
      {importNotice && <div className={cx(styles, commonStyles, "notice notice-success")} role="status"><span>{importNotice}</span><button type="button" onClick={() => setImportNotice("")} aria-label="Fechar aviso">×</button></div>}

      {loading ? <div className={cx(styles, commonStyles, "loading-card")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />{editId ? "Carregando lançamento e tabelas de tarifa..." : "Carregando tabelas de tarifa..."}</div>
        : error ? <div className={cx(styles, commonStyles, "notice notice-error", "load-error")} role="alert"><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReloadVersion((value) => value + 1)}>Tentar novamente</button></div>
          : historicalEdit && initialFreight && options
            ? <HistoricalFreightForm
                freight={initialFreight}
                options={options}
                onUpdated={handleSaved}
                onCancel={() => onNavigate("/fretes/historico")}
              />
            : options && (!editId || initialFreight) && <>
              <div className={cx(styles, "tariff-snapshot")}><span className={cx(styles, "snapshot-mark")} aria-hidden="true">↗</span><span>Tabelas de tarifa atualizadas em <strong>{formatDate(options.retrato_tarifas_em)}</strong></span><span className={cx(styles, "snapshot-hash")}>Referência {options.hash_retrato_tarifas.slice(0, 10)}</span></div>
              <FreightForm
                options={options}
                initialFreight={initialFreight ?? undefined}
                onCreated={handleSaved}
                onUpdated={handleSaved}
              />
            </>}
      {importOpen && <FreightImportDialog onClose={() => setImportOpen(false)} onImported={handleImported} />}
    </div>
  );
}
