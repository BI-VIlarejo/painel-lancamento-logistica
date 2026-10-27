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
    LocalityCreateRequest,
    LocalityStatusRequest,
    LocalityUpdateRequest,
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


def _audit_changes(
    before: dict[str, object | None],
    after: dict[str, object | None],
) -> list[dict[str, str | None]]:
    changes: list[dict[str, str | None]] = []
    for field, new_value in after.items():
        old_value = before.get(field)
        if old_value == new_value:
            continue
        changes.append(
            {
                "campo": field,
                "anterior": None if old_value is None else str(old_value),
                "novo": None if new_value is None else str(new_value),
            }
        )
    return changes


def _person_audit_values(person: Pessoa | None) -> dict[str, object | None]:
    if person is None:
        return {
            "nome_exibicao": None,
            "tipo_funcao": None,
            "tipo_transporte_entrega": None,
        }
    return {
        "nome_exibicao": person.nome_exibicao,
        "tipo_funcao": person.tipo_funcao,
        "tipo_transporte_entrega": person.tipo_transporte_entrega,
    }


def _reason_audit_values(
    reason: MotivoNaoEntrega | None,
) -> dict[str, object | None]:
    if reason is None:
        return {"descricao_motivo": None, "grupo_motivo": None}
    return {
        "descricao_motivo": reason.descricao_motivo,
        "grupo_motivo": reason.grupo_motivo,
    }


def list_localities(db: Session) -> list[LocalityAdminItem]:
    try:
        return [
            LocalityAdminItem.model_validate(item)
            for item in repository.list_admin_localities(db)
        ]
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def _ensure_locality_unique(
    db: Session,
    *,
    codigo_localidade: str,
    nome_localidade: str,
    cidade: str,
    uf: str,
    exclude_id: int | None = None,
) -> None:
    if repository.locality_code_exists(
        db,
        codigo_localidade=codigo_localidade,
        exclude_id=exclude_id,
    ):
        raise ConflictError("Já existe uma localidade com esse código.")
    if repository.locality_name_city_uf_exists(
        db,
        nome_localidade=nome_localidade,
        cidade=cidade,
        uf=uf,
        exclude_id=exclude_id,
    ):
        raise ConflictError("Já existe uma localidade com esse nome, cidade e UF.")


def create_locality(
    db: Session,
    *,
    payload: LocalityCreateRequest,
    actor_id: int,
) -> LocalityAdminItem:
    now = _now()
    try:
        _ensure_locality_unique(
            db,
            codigo_localidade=payload.codigo_localidade,
            nome_localidade=payload.nome_localidade,
            cidade=payload.cidade,
            uf=payload.uf,
        )
        item = Localidade(
            codigo_localidade=payload.codigo_localidade,
            nome_localidade=payload.nome_localidade,
            tipo_localidade=payload.tipo_localidade,
            cidade=payload.cidade,
            uf=payload.uf,
            ativo=True,
            sincronizado_em=now,
        )
        db.add(item)
        db.flush()
        _event(
            db,
            kind="LOCALIDADE_CRIADA",
            actor_id=actor_id,
            details={
                "alvo_tipo": "LOCALIDADE",
                "alvo_id": item.id_localidade,
                "alvo_codigo": item.codigo_localidade,
                "alvo_nome": item.nome_localidade,
                "alteracoes": _audit_changes(
                    {
                        "nome_localidade": None,
                        "tipo_localidade": None,
                        "cidade": None,
                        "uf": None,
                    },
                    {
                        "nome_localidade": item.nome_localidade,
                        "tipo_localidade": item.tipo_localidade,
                        "cidade": item.cidade,
                        "uf": item.uf,
                    },
                ),
            },
        )
        db.commit()
        return LocalityAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "Já existe uma localidade com esse código ou nome, cidade e UF."
        ) from exc
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def update_locality(
    db: Session,
    *,
    id_localidade: int,
    payload: LocalityUpdateRequest,
    actor_id: int,
) -> LocalityAdminItem:
    try:
        item = repository.get_locality_for_update(db, id_localidade=id_localidade)
        if item is None:
            raise NotFoundError("Localidade não encontrada.")
        _ensure_locality_unique(
            db,
            codigo_localidade=item.codigo_localidade,
            nome_localidade=payload.nome_localidade,
            cidade=payload.cidade,
            uf=payload.uf,
            exclude_id=item.id_localidade,
        )
        before = {
            "nome_localidade": item.nome_localidade,
            "tipo_localidade": item.tipo_localidade,
            "cidade": item.cidade,
            "uf": item.uf,
        }
        after = {
            "nome_localidade": payload.nome_localidade,
            "tipo_localidade": payload.tipo_localidade,
            "cidade": payload.cidade,
            "uf": payload.uf,
        }
        changes = _audit_changes(before, after)
        if not changes:
            return LocalityAdminItem.model_validate(item)
        item.nome_localidade = payload.nome_localidade
        item.tipo_localidade = payload.tipo_localidade
        item.cidade = payload.cidade
        item.uf = payload.uf
        db.flush()
        _event(
            db,
            kind="LOCALIDADE_ATUALIZADA",
            actor_id=actor_id,
            details={
                "alvo_tipo": "LOCALIDADE",
                "alvo_id": item.id_localidade,
                "alvo_codigo": item.codigo_localidade,
                "alvo_nome": item.nome_localidade,
                "campos_alterados": [change["campo"] for change in changes],
                "alteracoes": changes,
            },
        )
        db.commit()
        return LocalityAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "Já existe uma localidade com esse nome, cidade e UF."
        ) from exc
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def set_locality_active(
    db: Session,
    *,
    id_localidade: int,
    payload: LocalityStatusRequest,
    actor_id: int,
) -> LocalityAdminItem:
    try:
        item = repository.get_locality_for_update(db, id_localidade=id_localidade)
        if item is None:
            raise NotFoundError("Localidade não encontrada.")
        if item.ativo == payload.ativo:
            raise ConflictError(
                "A localidade já está " + ("ativa." if item.ativo else "inativa.")
            )
        if payload.ativo and (not item.cidade or not item.uf):
            raise ConflictError(
                "Informe cidade e UF antes de ativar a localidade."
            )
        item.ativo = payload.ativo
        changes = _audit_changes({"ativo": not payload.ativo}, {"ativo": payload.ativo})
        _event(
            db,
            kind="LOCALIDADE_ATIVADA" if item.ativo else "LOCALIDADE_DESATIVADA",
            actor_id=actor_id,
            details={
                "alvo_tipo": "LOCALIDADE",
                "alvo_id": item.id_localidade,
                "alvo_codigo": item.codigo_localidade,
                "alvo_nome": item.nome_localidade,
                "campos_alterados": [change["campo"] for change in changes],
                "alteracoes": changes,
            },
        )
        db.commit()
        return LocalityAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
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


def create_person(
    db: Session,
    *,
    payload: PersonCreateRequest,
    actor_id: int,
) -> PersonAdminItem:
    now = _now()
    stable_code = str(payload.codigo_pessoa or uuid4())
    try:
        if repository.get_latest_person_for_update(db, codigo_pessoa=stable_code):
            raise ConflictError("Já existe uma pessoa com esse código. Edite o cadastro existente.")
        values = {
            "nome_exibicao": payload.nome_exibicao,
            "tipo_funcao": payload.tipo_funcao,
            "tipo_transporte_entrega": payload.tipo_transporte_entrega,
        }
        changes = _audit_changes(_person_audit_values(None), values)

        item = Pessoa(
            codigo_pessoa=stable_code,
            sistema_origem=payload.sistema_origem,
            codigo_pessoa_origem=payload.codigo_pessoa_origem,
            nome_exibicao=payload.nome_exibicao,
            tipo_funcao=payload.tipo_funcao,
            tipo_transporte_entrega=payload.tipo_transporte_entrega,
            ativo=True,
            vigente_desde=_business_today(),
            vigente_ate=None,
            criado_por=actor_id,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(item)
        db.flush()
        _event(
            db,
            kind="PESSOA_CRIADA",
            actor_id=actor_id,
            details={
                "alvo_tipo": "PESSOA",
                "alvo_id": item.id_pessoa,
                "alvo_codigo": item.codigo_pessoa,
                "alvo_nome": item.nome_exibicao,
                "campos_alterados": [change["campo"] for change in changes],
                "alteracoes": changes,
            },
        )
        db.commit()
        return PersonAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("Já existe uma pessoa com esse código.") from exc
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def update_person(
    db: Session,
    *,
    id_pessoa: int,
    payload: PersonCreateRequest,
    actor_id: int,
) -> PersonAdminItem:
    try:
        item = repository.get_person_for_update(db, id_pessoa=id_pessoa)
        if item is None:
            raise NotFoundError("Pessoa não encontrada.")
        latest = repository.get_latest_person_for_update(
            db,
            codigo_pessoa=item.codigo_pessoa,
        )
        if latest is None or latest.id_pessoa != item.id_pessoa:
            raise ConflictError("O cadastro mudou. Atualize a lista antes de editar.")
        if payload.codigo_pessoa is not None and str(payload.codigo_pessoa) != item.codigo_pessoa:
            raise ConflictError("O código estável da pessoa não pode ser alterado.")
        before = _person_audit_values(item)
        after = {
            "nome_exibicao": payload.nome_exibicao,
            "tipo_funcao": payload.tipo_funcao,
            "tipo_transporte_entrega": payload.tipo_transporte_entrega,
        }
        changes = _audit_changes(before, after)
        if not changes:
            db.commit()
            return PersonAdminItem.model_validate(item)

        item.nome_exibicao = payload.nome_exibicao
        item.tipo_funcao = payload.tipo_funcao
        item.tipo_transporte_entrega = payload.tipo_transporte_entrega
        item.atualizado_em = _now()
        _event(
            db,
            kind="PESSOA_ATUALIZADA",
            actor_id=actor_id,
            details={
                "alvo_tipo": "PESSOA",
                "alvo_id": item.id_pessoa,
                "alvo_codigo": item.codigo_pessoa,
                "alvo_nome": item.nome_exibicao,
                "campos_alterados": [change["campo"] for change in changes],
                "alteracoes": changes,
            },
        )
        db.commit()
        return PersonAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
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
            raise ConflictError("Só é possível desativar o cadastro atual.")
        if not item.ativo:
            raise ConflictError("Essa pessoa já está inativa.")
        item.ativo = False
        item.vigente_ate = max(_business_today(), item.vigente_desde + timedelta(days=1))
        item.atualizado_em = _now()
        changes = _audit_changes(
            {"ativo": True},
            {"ativo": False},
        )
        _event(
            db,
            kind="PESSOA_DESATIVADA",
            actor_id=actor_id,
            details={
                "alvo_tipo": "PESSOA",
                "alvo_id": item.id_pessoa,
                "alvo_codigo": item.codigo_pessoa,
                "alvo_nome": item.nome_exibicao,
                "campos_alterados": [change["campo"] for change in changes],
                "alteracoes": changes,
            },
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


def create_reason(
    db: Session,
    *,
    payload: ReasonCreateRequest,
    actor_id: int,
) -> ReasonAdminItem:
    now = _now()
    try:
        stable_code = payload.codigo_motivo or _unique_reason_code(
            db, description=payload.descricao_motivo
        )
        if repository.get_latest_reason_for_update(db, codigo_motivo=stable_code):
            raise ConflictError("Já existe um motivo com esse código. Edite o cadastro existente.")
        values = {
            "descricao_motivo": payload.descricao_motivo,
            "grupo_motivo": payload.grupo_motivo,
        }
        changes = _audit_changes(_reason_audit_values(None), values)

        item = MotivoNaoEntrega(
            codigo_motivo=stable_code,
            descricao_motivo=payload.descricao_motivo,
            grupo_motivo=payload.grupo_motivo,
            ativo=True,
            vigente_desde=_business_today(),
            vigente_ate=None,
            criado_por=actor_id,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(item)
        db.flush()
        _event(
            db,
            kind="MOTIVO_CRIADO",
            actor_id=actor_id,
            details={
                "alvo_tipo": "MOTIVO",
                "alvo_id": item.id_motivo_nao_entrega,
                "alvo_codigo": item.codigo_motivo,
                "alvo_nome": item.descricao_motivo,
                "campos_alterados": [change["campo"] for change in changes],
                "alteracoes": changes,
            },
        )
        db.commit()
        return ReasonAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("Já existe um motivo com esse código.") from exc
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc


def update_reason(
    db: Session,
    *,
    id_motivo_nao_entrega: int,
    payload: ReasonCreateRequest,
    actor_id: int,
) -> ReasonAdminItem:
    try:
        previous = repository.get_reason_for_update(
            db,
            id_motivo_nao_entrega=id_motivo_nao_entrega,
        )
        if previous is None:
            raise NotFoundError("Motivo não encontrado.")
        latest = repository.get_latest_reason_for_update(
            db,
            codigo_motivo=previous.codigo_motivo,
        )
        if latest is None or latest.id_motivo_nao_entrega != previous.id_motivo_nao_entrega:
            raise ConflictError("O cadastro mudou. Atualize a lista antes de editar.")
        if payload.codigo_motivo is not None and payload.codigo_motivo != previous.codigo_motivo:
            raise ConflictError("O código estável do motivo não pode ser alterado.")
        before = _reason_audit_values(previous)
        after = {
            "descricao_motivo": payload.descricao_motivo,
            "grupo_motivo": payload.grupo_motivo,
        }
        changes = _audit_changes(before, after)
        if not changes:
            db.commit()
            return ReasonAdminItem.model_validate(previous)

        previous.descricao_motivo = payload.descricao_motivo
        previous.grupo_motivo = payload.grupo_motivo
        previous.atualizado_em = _now()
        _event(
            db,
            kind="MOTIVO_ATUALIZADO",
            actor_id=actor_id,
            details={
                "alvo_tipo": "MOTIVO",
                "alvo_id": previous.id_motivo_nao_entrega,
                "alvo_codigo": previous.codigo_motivo,
                "alvo_nome": previous.descricao_motivo,
                "campos_alterados": [change["campo"] for change in changes],
                "alteracoes": changes,
            },
        )
        db.commit()
        return ReasonAdminItem.model_validate(previous)
    except APIError:
        db.rollback()
        raise
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
            raise ConflictError("Só é possível desativar o cadastro atual do motivo.")
        if not item.ativo:
            raise ConflictError("Esse motivo já está inativo.")
        item.ativo = False
        item.vigente_ate = max(_business_today(), item.vigente_desde + timedelta(days=1))
        item.atualizado_em = _now()
        changes = _audit_changes(
            {"ativo": True},
            {"ativo": False},
        )
        _event(
            db,
            kind="MOTIVO_DESATIVADO",
            actor_id=actor_id,
            details={
                "alvo_tipo": "MOTIVO",
                "alvo_id": item.id_motivo_nao_entrega,
                "alvo_codigo": item.codigo_motivo,
                "alvo_nome": item.descricao_motivo,
                "campos_alterados": [change["campo"] for change in changes],
                "alteracoes": changes,
            },
        )
        db.commit()
        return ReasonAdminItem.model_validate(item)
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _db_unavailable(db, exc) from exc
