import styles from "./DeliveryLaunchPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { useEffect, useState } from "react";
import { catalogsApi } from "../../catalogs/api";
import { messageFromApiError } from "../../../shared/api/apiError";
import { DeliveryForm } from "../components/DeliveryForm";
import { deliveriesApi } from "../api";
import type {
  DeliveryLaunchDetail,
  LocalityCatalogItem,
  NonDeliveryReasonCatalogItem,
  PersonCatalogItem,
} from "../types";

type DeliveryLaunchPageProps = { onNavigate: (path: string) => void; responsibleName: string; canLaunch: boolean; canManageCatalogs: boolean; editId?: string };

export function DeliveryLaunchPage({ onNavigate, responsibleName, canLaunch, canManageCatalogs, editId }: DeliveryLaunchPageProps) {
  const [localities, setLocalities] = useState<LocalityCatalogItem[]>([]);
  const [drivers, setDrivers] = useState<PersonCatalogItem[]>([]);
  const [helpers, setHelpers] = useState<PersonCatalogItem[]>([]);
  const [reasons, setReasons] = useState<NonDeliveryReasonCatalogItem[]>([]);
  const [initialLaunch, setInitialLaunch] = useState<DeliveryLaunchDetail>();
  const [loading, setLoading] = useState(Boolean(editId));
  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(Boolean(editId));
    setCatalogsLoading(true);
    setError("");
    setCatalogError("");
    setInitialLaunch(undefined);
    setLocalities([]);
    setDrivers([]);
    setHelpers([]);
    setReasons([]);

    const catalogRequests = [
      catalogsApi.localities().then((page) => {
        if (active) setLocalities(page.items);
      }),
      catalogsApi.people("MOTORISTA").then((page) => {
        if (active) setDrivers(page.items);
      }),
      catalogsApi.people("AJUDANTE").then((page) => {
        if (active) setHelpers(page.items);
      }),
      catalogsApi.reasons().then((page) => {
        if (active) setReasons(page.items);
      }),
    ];

    void Promise.allSettled(catalogRequests).then((results) => {
      if (!active) return;
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") {
        setCatalogError(messageFromApiError(failed.reason));
      }
      setCatalogsLoading(false);
    });

    if (editId) {
      void deliveriesApi.get(editId)
        .then((launch) => {
          if (!active) return;
          if (launch.estado !== "RASCUNHO") {
            setError("Este lançamento não está mais em rascunho e não pode ser editado.");
            return;
          }
          setInitialLaunch(launch);
        })
        .catch((loadError: unknown) => {
          if (active) setError(messageFromApiError(loadError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else {
      setLoading(false);
    }
    return () => { active = false; };
  }, [editId]);

  const isEdit = Boolean(editId);
  const requiredCatalogs: string[] = [];
  if (!isEdit && !localities.length) requiredCatalogs.push("uma loja ou filial");
  if (!isEdit && !drivers.length) requiredCatalogs.push("um motorista");
  const needsCatalogSetup = !isEdit && !catalogsLoading && (requiredCatalogs.length > 0 || reasons.length === 0);

  return (
    <div className={cx(styles, commonStyles, "page-stack")}>
      <div className={cx(styles, commonStyles, "page-heading-row")}>
        <div>
          <h1>{isEdit ? "Editar lançamento" : "Lançamento de entregas e coletas"}</h1>
          <p className={cx(styles, commonStyles, "page-lead")}>{isEdit ? "Atualize os dados e registre a nova revisão do lançamento." : "Informe as entregas e coletas da rota para registrar o lançamento diretamente."}</p>
        </div>
      </div>

      {loading && isEdit ? (
        <div className={cx(styles, commonStyles, "loading-card")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> {isEdit ? "Carregando rascunho e opções de Entregas..." : "Carregando opções de Entregas..."}</div>
      ) : error ? (
        <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><strong>Não foi possível carregar o formulário.</strong><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => window.location.reload()}>Tentar novamente</button></div>
      ) : (
        <>
          {catalogsLoading && <div className={cx(styles, commonStyles, "notice notice-info catalog-prerequisite")} role="status">O formulário já está disponível; carregando as opções de localidades, equipes e motivos.</div>}
          {catalogError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><strong>Algumas opções não carregaram.</strong><span>{catalogError}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => window.location.reload()}>Tentar novamente</button></div>}
          {needsCatalogSetup && <div className={cx(styles, commonStyles, "notice notice-info catalog-prerequisite")} role="note">
            <div className={cx(styles, "catalog-prerequisite-copy")}>
              <strong>Formulário disponível para teste.</strong>
              {requiredCatalogs.length > 0 && <p>Para salvar, cadastre e mantenha ativos pelo menos {requiredCatalogs.join(" e ")}.</p>}
              {reasons.length === 0 && <p>Para testar entregas não realizadas, cadastre também um motivo.</p>}
            </div>
            {canManageCatalogs
              ? <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/cadastros")}>Abrir Cadastros</button>
              : <span>Peça à pessoa gestora para cadastrar esses itens.</span>}
          </div>}
          <DeliveryForm
            key={initialLaunch?.codigo_lancamento ?? "novo-lancamento"}
            localities={localities}
            drivers={drivers}
            helpers={helpers}
            reasons={reasons}
            responsibleName={responsibleName}
            canLaunch={canLaunch}
            initialLaunch={initialLaunch}
            onSaved={(launch) => {
              const messageType = launch.estado === "ENVIADA" ? "launched" : isEdit ? "updated" : "created";
              window.sessionStorage.setItem("lancamento-logistica:show-saved-message", messageType);
              onNavigate("/historico");
            }}
          />
        </>
      )}
    </div>
  );
}
