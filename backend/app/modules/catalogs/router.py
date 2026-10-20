"""Endpoints de leitura dos catálogos autorizados para formulários."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.v1.dependencies import (
    CsrfProtectedAuth,
    DatabaseSession,
    require_global_permission,
    require_permission,
)
from app.modules.catalogs import admin_service
from app.modules.catalogs.admin_schemas import (
    LocalityAdminItem,
    LocalitySyncResult,
    PersonAdminItem,
    PersonCreateRequest,
    PersonStatusRequest,
    ReasonAdminItem,
    ReasonCreateRequest,
    ReasonStatusRequest,
)
from app.modules.access_control.service import AuthorizationContext
from app.modules.catalogs import service
from app.modules.catalogs.schemas import (
    CatalogPage,
    LocalityCatalogItem,
    NonDeliveryReasonCatalogItem,
    PersonCatalogItem,
    SectorCatalogItem,
)

router = APIRouter(tags=["Catálogos"])
_delivery_read_access = require_permission("ENTREGAS_DIARIAS:VER")
_catalog_admin_access = require_global_permission("CADASTROS:ADMINISTRAR")


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.get("/setores", response_model=CatalogPage[SectorCatalogItem])
def get_sectors(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_delivery_read_access),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> CatalogPage[SectorCatalogItem]:
    _no_store(response)
    return service.list_sectors(db, access=access, limit=limit, offset=offset)


@router.get("/localidades", response_model=CatalogPage[LocalityCatalogItem])
def get_localities(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_delivery_read_access),
    id_setor: int | None = Query(default=None, ge=1),
    id_localidade: int | None = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> CatalogPage[LocalityCatalogItem]:
    _no_store(response)
    return service.list_localities(
        db,
        access=access,
        id_setor=id_setor,
        id_localidade=id_localidade,
        limit=limit,
        offset=offset,
    )


@router.get("/pessoas", response_model=CatalogPage[PersonCatalogItem])
def get_people(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_delivery_read_access),
    id_setor: int | None = Query(default=None, ge=1),
    id_localidade: int | None = Query(default=None, ge=1),
    tipo_funcao: Literal["MOTORISTA", "AJUDANTE"] | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> CatalogPage[PersonCatalogItem]:
    _no_store(response)
    return service.list_people(
        db,
        access=access,
        id_setor=id_setor,
        id_localidade=id_localidade,
        tipo_funcao=tipo_funcao,
        limit=limit,
        offset=offset,
    )


@router.get("/motivos", response_model=CatalogPage[NonDeliveryReasonCatalogItem])
def get_non_delivery_reasons(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_delivery_read_access),
    id_setor: int | None = Query(default=None, ge=1),
    id_localidade: int | None = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> CatalogPage[NonDeliveryReasonCatalogItem]:
    _no_store(response)
    return service.list_non_delivery_reasons(
        db,
        access=access,
        id_setor=id_setor,
        id_localidade=id_localidade,
        limit=limit,
        offset=offset,
    )


@router.get("/cadastros/localidades", response_model=list[LocalityAdminItem])
def get_admin_localities(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_catalog_admin_access),
) -> list[LocalityAdminItem]:
    _no_store(response)
    return admin_service.list_localities(db)


@router.post(
    "/cadastros/localidades/sincronizar",
    response_model=LocalitySyncResult,
)
def sync_localities(
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    response: Response,
    access: AuthorizationContext = Depends(_catalog_admin_access),
) -> LocalitySyncResult:
    _no_store(response)
    return admin_service.sync_localities_from_bi(
        db,
        actor_id=auth.user.id_usuario,
    )


@router.get("/cadastros/pessoas", response_model=list[PersonAdminItem])
def get_admin_people(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_catalog_admin_access),
) -> list[PersonAdminItem]:
    _no_store(response)
    return admin_service.list_people(db)


@router.post(
    "/cadastros/pessoas",
    response_model=PersonAdminItem,
    status_code=status.HTTP_201_CREATED,
)
def create_person_version(
    payload: PersonCreateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_catalog_admin_access),
) -> PersonAdminItem:
    return admin_service.create_person_version(
        db,
        payload=payload,
        actor_id=auth.user.id_usuario,
    )


@router.patch("/cadastros/pessoas/{id_pessoa}", response_model=PersonAdminItem)
def deactivate_person(
    id_pessoa: int,
    payload: PersonStatusRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_catalog_admin_access),
) -> PersonAdminItem:
    return admin_service.deactivate_person(
        db,
        id_pessoa=id_pessoa,
        payload=payload,
        actor_id=auth.user.id_usuario,
    )


@router.get("/cadastros/motivos", response_model=list[ReasonAdminItem])
def get_admin_reasons(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_catalog_admin_access),
) -> list[ReasonAdminItem]:
    _no_store(response)
    return admin_service.list_reasons(db)


@router.post(
    "/cadastros/motivos",
    response_model=ReasonAdminItem,
    status_code=status.HTTP_201_CREATED,
)
def create_reason_version(
    payload: ReasonCreateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_catalog_admin_access),
) -> ReasonAdminItem:
    return admin_service.create_reason_version(
        db,
        payload=payload,
        actor_id=auth.user.id_usuario,
    )


@router.patch("/cadastros/motivos/{id_motivo_nao_entrega}", response_model=ReasonAdminItem)
def deactivate_reason(
    id_motivo_nao_entrega: int,
    payload: ReasonStatusRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_catalog_admin_access),
) -> ReasonAdminItem:
    return admin_service.deactivate_reason(
        db,
        id_motivo_nao_entrega=id_motivo_nao_entrega,
        payload=payload,
        actor_id=auth.user.id_usuario,
    )
