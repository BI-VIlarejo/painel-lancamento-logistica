"""Manutenção controlada dos catálogos de referência da operação."""

import re
import unicodedata
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
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
    LocalitySyncResult,
    PersonAdminItem,
    PersonCreateRequest,
    PersonStatusRequest,
    ReasonAdminItem,
    ReasonCreateRequest,
    ReasonStatusRequest,
)
from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa


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


def sync_localities_from_bi(
    db: Session,
    *,
    actor_id: int,
) -> LocalitySyncResult:
    """Espelha a dimensão canônica do BI sem inventar códigos de integração."""
    database_url = get_settings().vilarejo_bi_logistica_database_url
    if not database_url:
        raise ServiceUnavailableError(
            "A conexão de leitura do catálogo do Vilarejo BI não está configurada."
        )

    now = _now()
    source_engine = None
    try:
        source_engine = create_engine(database_url, pool_pre_ping=True)
        with source_engine.connect() as connection:
            source_rows = connection.execute(
                text(
                    "SELECT codigo_localidade, nome_localidade, tipo_localidade, ativo "
                    "FROM dim_localidade "
                    "WHERE codigo_localidade IS NOT NULL "
                    "AND TRIM(codigo_localidade) <> '' "
                    "AND UPPER(TRIM(tipo_localidade)) <> 'CONSOLIDADO' "
                    "AND UPPER(TRIM(nome_localidade)) <> 'CONSOLIDADO'"
                )
            ).mappings().all()

        source_by_code: dict[str, dict[str, object]] = {}
        for row in source_rows:
            code = str(row["codigo_localidade"])
            if code != code.strip():
                raise ConflictError(
                    "A dimensão do BI contém um código de localidade com espaços nas extremidades."
                )
            name = " ".join(str(row["nome_localidade"]).split())
            if not code or not name:
                continue
            source_type = str(row["tipo_localidade"]).strip().upper()
            if source_type == "CD":
                locality_type = "CD"
            elif source_type in {"FILIAL", "LOJA"}:
                locality_type = "LOJA"
            elif source_type == "CONSOLIDADO":
                continue
            else:
                raise ConflictError(
                    "A dimensão do BI contém uma classificação de localidade não reconhecida."
                )
            item = {
                "codigo_localidade": code,
                "nome_localidade": name,
                "tipo_localidade": locality_type,
                "ativo": bool(row["ativo"]),
            }
            if code in source_by_code:
                raise ConflictError(
                    "A dimensão do BI contém códigos de localidade duplicados."
                )
            source_by_code[code] = item

        if not source_by_code:
            raise ServiceUnavailableError(
                "O catálogo do BI não retornou localidades com códigos válidos."
            )

        codes = list(source_by_code)
        existing = {
            item.codigo_localidade: item
            for item in db.scalars(
                select(Localidade).where(Localidade.codigo_localidade.in_(codes))
            ).all()
        }
        created = 0
        updated = 0
        deactivated = 0
        for code, source_item in source_by_code.items():
            item = existing.get(code)
            if item is None:
                item = Localidade(
                    codigo_localidade=code,
                    nome_localidade=str(source_item["nome_localidade"]),
                    tipo_localidade=str(source_item["tipo_localidade"]),
                    ativo=bool(source_item["ativo"]),
                    sincronizado_em=now,
                )
                db.add(item)
                created += 1
                continue
            item.nome_localidade = str(source_item["nome_localidade"])
            item.tipo_localidade = str(source_item["tipo_localidade"])
            item.ativo = bool(source_item["ativo"])
            item.sincronizado_em = now
            updated += 1

        stale_items = db.scalars(
            select(Localidade).where(Localidade.codigo_localidade.not_in(codes))
        ).all()
        for item in stale_items:
            if item.ativo:
                item.ativo = False
                item.sincronizado_em = now
                deactivated += 1

        db.flush()
        _event(
            db,
            kind="LOCALIDADES_SINCRONIZADAS_BI",
            actor_id=actor_id,
            details={
                "total_origem": len(source_by_code),
                "criadas": created,
                "atualizadas": updated,
                "desativadas": deactivated,
            },
        )
        db.commit()
        return LocalitySyncResult(
            total_origem=len(source_by_code),
            criadas=created,
            atualizadas=updated,
            desativadas=deactivated,
        )
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "O catálogo de localidades mudou durante a sincronização. Tente novamente."
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise ServiceUnavailableError(
            "Não foi possível sincronizar o catálogo do BI."
        ) from exc
    finally:
        if source_engine is not None:
            source_engine.dispose()


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
