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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setInitialLaunch(undefined);
    void Promise.all([
      catalogsApi.localities(),
      catalogsApi.people("MOTORISTA"),
      catalogsApi.people("AJUDANTE"),
      catalogsApi.reasons(),
      editId ? deliveriesApi.get(editId) : Promise.resolve(undefined),
    ])
      .then(([localityPage, driverPage, helperPage, reasonPage, launch]) => {
        if (!active) return;
        if (launch && launch.estado !== "RASCUNHO") {
          setError("Este lançamento não está mais em rascunho e não pode ser editado.");
          return;
        }
        setLocalities(localityPage.items);
        setDrivers(driverPage.items);
        setHelpers(helperPage.items);
        setReasons(reasonPage.items);
        setInitialLaunch(launch);
      })
      .catch((loadError: unknown) => {
        if (active) setError(messageFromApiError(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [editId]);

  const isEdit = Boolean(editId);
  const requiredCatalogs: string[] = [];
  if (!isEdit && !localities.length) requiredCatalogs.push("uma loja ou filial");
  if (!isEdit && !drivers.length) requiredCatalogs.push("um motorista");
  const needsCatalogSetup = !isEdit && (requiredCatalogs.length > 0 || reasons.length === 0);

  return (
    <div className={cx(styles, commonStyles, "page-stack")}>
      <div className={cx(styles, commonStyles, "page-heading-row")}>
        <div>
          <h1>{isEdit ? "Editar rascunho" : "Lançamento de Entregas"}</h1>
          <p className={cx(styles, commonStyles, "page-lead")}>{isEdit ? "Atualize os dados do rascunho antes de confirmar o lançamento." : "Informe as entregas da rota, confira os dados e confirme o lançamento."}</p>
        </div>
      </div>

      {loading ? (
        <div className={cx(styles, commonStyles, "loading-card")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> {isEdit ? "Carregando rascunho e opções de Entregas..." : "Carregando opções de Entregas..."}</div>
      ) : error ? (
        <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><strong>Não foi possível carregar o formulário.</strong><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => window.location.reload()}>Tentar novamente</button></div>
      ) : (
        <>
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
