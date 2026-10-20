"""Regras de escopo e leitura dos catálogos usados pelos formulários."""

from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import TypeVar

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    PermissionDeniedError,
    ServiceUnavailableError,
)
from app.modules.access_control import service as access_control_service
from app.modules.access_control.service import AuthorizationContext
from app.modules.catalogs import repository
from app.modules.catalogs.schemas import (
    CatalogPage,
    LocalityCatalogItem,
    NonDeliveryReasonCatalogItem,
    PersonCatalogItem,
    SectorCatalogItem,
)

T = TypeVar("T")


def _run_query(db: Session, query: Callable[[], T]) -> T:
    try:
        return query()
    except SQLAlchemyError as exc:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        raise ServiceUnavailableError("Catálogos temporariamente indisponíveis.") from exc


def _page(
    items: Sequence[object],
    total: int,
    limit: int,
    offset: int,
) -> dict[str, object]:
    return {"items": list(items), "total": total, "limit": limit, "offset": offset}


def _require_contextual_scope(
    access: AuthorizationContext,
    *,
    id_setor: int | None,
    id_localidade: int | None,
) -> AuthorizationContext:
    scoped_access = access_control_service.require_scope(
        access,
        id_setor=id_setor,
        id_localidade=id_localidade,
    )
    if (
        id_setor is None
        and id_localidade is None
        and not any(grant.tipo_escopo == "GLOBAL" for grant in scoped_access.grants)
        and not any(grant.resource_id_setor is not None for grant in scoped_access.grants)
    ):
        raise PermissionDeniedError(
            "Informe um setor ou uma localidade dentro do seu escopo."
        )
    return scoped_access


def list_sectors(
    db: Session,
    *,
    access: AuthorizationContext,
    limit: int,
    offset: int,
) -> CatalogPage[SectorCatalogItem]:
    scoped_access = access_control_service.require_scope(access)
    allowed_ids = access_control_service.allowed_sector_ids(scoped_access)
    items, total = _run_query(
        db,
        lambda: repository.list_sectors(
            db,
            allowed_ids=allowed_ids,
            limit=limit,
            offset=offset,
        ),
    )
    return CatalogPage[SectorCatalogItem](
        **_page(items, total, limit, offset)
    )


def list_localities(
    db: Session,
    *,
    access: AuthorizationContext,
    id_setor: int | None,
    id_localidade: int | None,
    limit: int,
    offset: int,
) -> CatalogPage[LocalityCatalogItem]:
    scoped_access = access_control_service.require_scope(
        access,
        id_setor=id_setor,
        id_localidade=id_localidade,
    )
    allowed_ids = access_control_service.allowed_locality_ids(scoped_access)
    if id_localidade is not None:
        if allowed_ids is not None and id_localidade not in allowed_ids:
            raise PermissionDeniedError("Localidade fora do seu escopo.")
        allowed_ids = {id_localidade}

    items, total = _run_query(
        db,
        lambda: repository.list_localities(
            db,
            allowed_ids=allowed_ids,
            limit=limit,
            offset=offset,
        ),
    )
    return CatalogPage[LocalityCatalogItem](
        **_page(items, total, limit, offset)
    )


def list_people(
    db: Session,
    *,
    access: AuthorizationContext,
    id_setor: int | None,
    id_localidade: int | None,
    tipo_funcao: str | None,
    limit: int,
    offset: int,
) -> CatalogPage[PersonCatalogItem]:
    _require_contextual_scope(
        access,
        id_setor=id_setor,
        id_localidade=id_localidade,
    )
    reference_date = datetime.now(UTC).date()
    items, total = _run_query(
        db,
        lambda: repository.list_people(
            db,
            tipo_funcao=tipo_funcao,
            data_referencia=reference_date,
            limit=limit,
            offset=offset,
        ),
    )
    return CatalogPage[PersonCatalogItem](
        **_page(items, total, limit, offset)
    )


def list_non_delivery_reasons(
    db: Session,
    *,
    access: AuthorizationContext,
    id_setor: int | None,
    id_localidade: int | None,
    limit: int,
    offset: int,
) -> CatalogPage[NonDeliveryReasonCatalogItem]:
    _require_contextual_scope(
        access,
        id_setor=id_setor,
        id_localidade=id_localidade,
    )
    reference_date = datetime.now(UTC).date()
    items, total = _run_query(
        db,
        lambda: repository.list_non_delivery_reasons(
            db,
            data_referencia=reference_date,
            limit=limit,
            offset=offset,
        ),
    )
    return CatalogPage[NonDeliveryReasonCatalogItem](
        **_page(items, total, limit, offset)
    )
