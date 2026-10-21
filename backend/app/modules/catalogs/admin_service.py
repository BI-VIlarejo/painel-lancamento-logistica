"""Manutenção controlada dos catálogos de referência da operação."""

import re
import unicodedata
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    APIError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
)
from app.modules.access_control.models import AutorizacaoEvento
from app.modules.catalogs import repository
from app.modules.catalogs.admin_schemas import (
    LocalityAdminItem,
    PersonAdminItem,
    PersonCreateRequest,
    PersonStatusRequest,
    ReasonAdminItem,
    ReasonCreateRequest,
    ReasonStatusRequest,
)
from app.modules.catalogs.models import MotivoNaoEntrega, Pessoa


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _business_today() -> date:
    return datetime.now(ZoneInfo("America/Sao_Paulo")).date()


def _next_effective_date(
    *,
    starts_on: date,
    ends_on: date | None,
    today: date,
) -> date:
    return max(today, starts_on + timedelta(days=1), ends_on or today)


def _db_unavailable(db: Session, exc: SQLAlchemyError) -> ServiceUnavailableError:
    try:
        db.rollback()
    except SQLAlchemyError:
        pass
    return ServiceUnavailableError("Cadastros temporariamente indisponíveis.")


def _code_slug(value: str, *, prefix: str, max_length: int) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").upper()
    slug = re.sub(r"[^A-Z0-9]+", "_", ascii_value).strip("_") or "ITEM"
    return f"{prefix}_{slug}"[:max_length].rstrip("_")


def _unique_reason_code(db: Session, *, description: str) -> str:
    base = _code_slug(description, prefix="MOTIVO", max_length=40)
    candidate = base
    suffix = 2
    while repository.get_latest_reason_for_update(db, codigo_motivo=candidate):
        tail = f"_{suffix}"
        candidate = f"{base[:40 - len(tail)].rstrip('_')}{tail}"
        suffix += 1
    return candidate


def _event(
    db: Session,
    *,
    kind: str,
    actor_id: int,
    details: dict[str, object],
) -> None:
    db.add(
        AutorizacaoEvento(
            tipo_evento=kind,
            id_usuario_ator=actor_id,
            ocorrido_em=_now(),
            detalhes=details,
        )
    )


def list_localities(db: Session) -> list[LocalityAdminItem]:
    try:
        return [
            LocalityAdminItem.model_validate(item)
            for item in repository.list_admin_localities(db)
        ]
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def list_people(db: Session) -> list[PersonAdminItem]:
    try:
        return [
            PersonAdminItem.model_validate(item)
            for item in repository.list_admin_people(db)
        ]
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def create_person_version(
    db: Session,
    *,
    payload: PersonCreateRequest,
    actor_id: int,
) -> PersonAdminItem:
    now = _now()
    today = _business_today()
    stable_code = str(payload.codigo_pessoa or uuid4())
    try:
        previous = repository.get_latest_person_for_update(db, codigo_pessoa=stable_code)
        effective_date = (
            _next_effective_date(
                starts_on=previous.vigente_desde,
                ends_on=previous.vigente_ate,
                today=today,
            )
            if previous is not None
            else today
        )
        if previous is not None:
            if previous.ativo:
                previous.vigente_ate = effective_date
                previous.ativo = effective_date > today
                previous.atualizado_em = now
            event_kind = "PESSOA_VERSIONADA"
            origin_system = payload.sistema_origem or previous.sistema_origem
            origin_code = payload.codigo_pessoa_origem or previous.codigo_pessoa_origem
        else:
            event_kind = "PESSOA_CRIADA"
            origin_system = payload.sistema_origem
            origin_code = payload.codigo_pessoa_origem

        item = Pessoa(
            codigo_pessoa=stable_code,
            sistema_origem=origin_system,
            codigo_pessoa_origem=origin_code,
            nome_exibicao=payload.nome_exibicao,
            tipo_funcao=payload.tipo_funcao,
            ativo=True,
            vigente_desde=effective_date,
            vigente_ate=None,
            criado_por=actor_id,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(item)
        db.flush()
        _event(
            db,
            kind=event_kind,
            actor_id=actor_id,
            details={"id_pessoa": item.id_pessoa, "codigo_pessoa": item.codigo_pessoa},
        )
        db.commit()
        return PersonAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A pessoa já possui uma versão nesse período.") from exc
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def deactivate_person(
    db: Session,
    *,
    id_pessoa: int,
    payload: PersonStatusRequest,
    actor_id: int,
) -> PersonAdminItem:
    try:
        item = repository.get_person_for_update(db, id_pessoa=id_pessoa)
        if item is None:
            raise NotFoundError("Pessoa não encontrada.")
        latest = repository.get_latest_person_for_update(db, codigo_pessoa=item.codigo_pessoa)
        if latest is None or latest.id_pessoa != item.id_pessoa:
            raise ConflictError("Só é possível desativar a versão atual do cadastro.")
        if not item.ativo:
            raise ConflictError("Essa pessoa já está inativa.")
        item.ativo = False
        item.vigente_ate = max(_business_today(), item.vigente_desde + timedelta(days=1))
        item.atualizado_em = _now()
        _event(
            db,
            kind="PESSOA_DESATIVADA",
            actor_id=actor_id,
            details={"id_pessoa": item.id_pessoa, "codigo_pessoa": item.codigo_pessoa},
        )
        db.commit()
        return PersonAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def list_reasons(db: Session) -> list[ReasonAdminItem]:
    try:
        return [
            ReasonAdminItem.model_validate(item)
            for item in repository.list_admin_non_delivery_reasons(db)
        ]
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def create_reason_version(
    db: Session,
    *,
    payload: ReasonCreateRequest,
    actor_id: int,
) -> ReasonAdminItem:
    now = _now()
    today = _business_today()
    try:
        stable_code = payload.codigo_motivo or _unique_reason_code(
            db, description=payload.descricao_motivo
        )
        previous = (
            repository.get_latest_reason_for_update(db, codigo_motivo=stable_code)
        )
        effective_date = (
            _next_effective_date(
                starts_on=previous.vigente_desde,
                ends_on=previous.vigente_ate,
                today=today,
            )
            if previous is not None
            else today
        )
        if previous is not None:
            if previous.ativo:
                previous.vigente_ate = effective_date
                previous.ativo = effective_date > today
                previous.atualizado_em = now
            event_kind = "MOTIVO_VERSIONADO"
        else:
            event_kind = "MOTIVO_CRIADO"

        item = MotivoNaoEntrega(
            codigo_motivo=stable_code,
            descricao_motivo=payload.descricao_motivo,
            ativo=True,
            vigente_desde=effective_date,
            vigente_ate=None,
            criado_por=actor_id,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(item)
        db.flush()
        _event(
            db,
            kind=event_kind,
            actor_id=actor_id,
            details={"id_motivo_nao_entrega": item.id_motivo_nao_entrega, "codigo": item.codigo_motivo},
        )
        db.commit()
        return ReasonAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("O motivo já possui uma versão nesse período.") from exc
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def deactivate_reason(
    db: Session,
    *,
    id_motivo_nao_entrega: int,
    payload: ReasonStatusRequest,
    actor_id: int,
) -> ReasonAdminItem:
    try:
        item = repository.get_reason_for_update(
            db,
            id_motivo_nao_entrega=id_motivo_nao_entrega,
        )
        if item is None:
            raise NotFoundError("Motivo não encontrado.")
        latest = repository.get_latest_reason_for_update(db, codigo_motivo=item.codigo_motivo)
        if latest is None or latest.id_motivo_nao_entrega != item.id_motivo_nao_entrega:
            raise ConflictError("Só é possível desativar a versão atual do motivo.")
        if not item.ativo:
            raise ConflictError("Esse motivo já está inativo.")
        item.ativo = False
        item.vigente_ate = max(_business_today(), item.vigente_desde + timedelta(days=1))
        item.atualizado_em = _now()
        _event(
            db,
            kind="MOTIVO_DESATIVADO",
            actor_id=actor_id,
            details={"id_motivo_nao_entrega": item.id_motivo_nao_entrega, "codigo": item.codigo_motivo},
        )
        db.commit()
        return ReasonAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc
