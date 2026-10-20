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
  SectorCatalogItem,
} from "../types";

type DeliveryLaunchPageProps = { onNavigate: (path: string) => void; responsibleName: string; canLaunch: boolean; editId?: string };

export function DeliveryLaunchPage({ onNavigate, responsibleName, canLaunch, editId }: DeliveryLaunchPageProps) {
  const [sectors, setSectors] = useState<SectorCatalogItem[]>([]);
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
      catalogsApi.sectors(),
      catalogsApi.localities(),
      catalogsApi.people("MOTORISTA"),
      catalogsApi.people("AJUDANTE"),
      catalogsApi.reasons(),
      editId ? deliveriesApi.get(editId) : Promise.resolve(undefined),
    ])
      .then(([sectorPage, localityPage, driverPage, helperPage, reasonPage, launch]) => {
        if (!active) return;
        if (launch && launch.estado !== "RASCUNHO") {
          setError("Este lançamento não está mais em rascunho e não pode ser editado.");
          return;
        }
        setSectors(sectorPage.items);
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
  const missingCatalogs = !localities.length || (!isEdit && (!sectors.length || !drivers.length));

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
      ) : missingCatalogs ? (
        <div className={cx(styles, commonStyles, "empty-card")}><div className={cx(styles, commonStyles, "empty-state-icon")}>⌁</div><h2>Os cadastros ainda não estão prontos</h2><p>O formulário precisa de setores, localidades e motoristas ativos. Peça à pessoa administradora para conferir os catálogos.</p></div>
      ) : (
        <DeliveryForm
          key={initialLaunch?.codigo_lancamento ?? "novo-lancamento"}
          sectors={sectors}
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
      )}
    </div>
  );
}
