import { useEffect, useState } from "react";
import { FreightForm } from "../components/FreightForm";
import { freightsApi } from "../api";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type { FreightResponse, FreightTariffOptions } from "../types";
import { formatDate } from "../format";
import styles from "./FreightLaunchPage.module.css";

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
      window.sessionStorage.setItem(
        "lancamento-logistica:freight-saved",
        editId ? "Frete atualizado com sucesso." : "Frete registrado com sucesso e disponível no histórico.",
      );
      onNavigate("/fretes/historico");
    } else {
      setCreatedWithoutHistory(freight);
    }
  }

  const pageAction = editId ? "Editar lançamento" : "Novo lançamento";

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "freight-launch-page")}>
      <div className={cx(styles, commonStyles, "breadcrumb")}><span>Fretes</span><span aria-hidden="true">/</span><strong>{pageAction}</strong></div>
      <header className={cx(styles, commonStyles, "page-heading-row", "launch-heading")}>
        <div><p className={cx(styles, commonStyles, "eyebrow")}>OPERAÇÃO DE TRANSPORTE</p><h1>{editId ? "Editar frete" : "Lançar frete"}</h1><p className={cx(styles, commonStyles, "page-lead")}>{editId ? "Atualize os dados do serviço. O frete será recalculado e a alteração ficará registrada na auditoria." : "Selecione o responsável e complete os dados do serviço. Para agregados, a cidade, as entregas e as avarias vêm dos lançamentos de Entregas."}</p></div>
        <div className={cx(styles, "heading-actions")}>
          {canViewFreights && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/historico")}>Ver histórico</button>}
          {canViewAggregatePayments && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/pagamentos")}>Pagamentos</button>}
        </div>
      </header>

      {createdWithoutHistory && <div className={cx(styles, commonStyles, "notice notice-success")} role="status"><span><strong>Frete registrado.</strong> {formatDate(createdWithoutHistory.data_servico)} · {createdWithoutHistory.tipo_transporte === "AGREGADO" ? "Agregado" : "Transportadora independente"}</span><button type="button" onClick={() => setCreatedWithoutHistory(null)} aria-label="Fechar aviso">×</button></div>}

      {loading ? <div className={cx(styles, commonStyles, "loading-card")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />{editId ? "Carregando lançamento e tabelas de tarifa..." : "Carregando tabelas de tarifa..."}</div>
        : error ? <div className={cx(styles, commonStyles, "notice notice-error", "load-error")} role="alert"><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReloadVersion((value) => value + 1)}>Tentar novamente</button></div>
          : options && (!editId || initialFreight) && <>
            <div className={cx(styles, "tariff-snapshot")}><span className={cx(styles, "snapshot-mark")} aria-hidden="true">↗</span><span>Tabelas de tarifa atualizadas em <strong>{formatDate(options.retrato_tarifas_em)}</strong></span><span className={cx(styles, "snapshot-hash")}>Referência {options.hash_retrato_tarifas.slice(0, 10)}</span></div>
            <FreightForm
              options={options}
              initialFreight={initialFreight ?? undefined}
              onCreated={handleSaved}
              onUpdated={handleSaved}
            />
          </>}
    </div>
  );
}
