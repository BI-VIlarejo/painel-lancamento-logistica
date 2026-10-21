"""Consultas de concessões vigentes usadas pela autorização do portal."""

from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.modules.access_control.models import (
    Escopo,
    Perfil,
    PerfilPermissao,
    Permissao,
    Recurso,
    UsuarioEscopo,
)
from app.modules.auth.models import Usuario
from app.modules.catalogs.models import Localidade, Setor


def get_effective_access_rows(
    db: Session,
    *,
    id_usuario: int,
    agora: datetime,
) -> list[tuple[Permissao, Recurso, Perfil, UsuarioEscopo, Escopo]]:
    """Busca permissões efetivas, incluindo acesso total para DEV global."""
    has_profile_permission = (
        select(PerfilPermissao.id_permissao)
        .where(
            PerfilPermissao.id_perfil == Perfil.id_perfil,
            PerfilPermissao.id_permissao == Permissao.id_permissao,
        )
        .exists()
    )
    statement = (
        select(Permissao, Recurso, Perfil, UsuarioEscopo, Escopo)
        .select_from(UsuarioEscopo)
        .join(Perfil, Perfil.id_perfil == UsuarioEscopo.id_perfil)
        .join(Escopo, Escopo.id_escopo == UsuarioEscopo.id_escopo)
        .join(
            Permissao,
            and_(
                Permissao.ativo.is_(True),
                or_(
                    and_(Perfil.codigo == "DEV", Escopo.tipo_escopo == "GLOBAL"),
                    has_profile_permission,
                ),
            ),
        )
        .join(Recurso, Recurso.id_recurso == Permissao.id_recurso)
        .where(
            UsuarioEscopo.id_usuario == id_usuario,
            UsuarioEscopo.ativo.is_(True),
            UsuarioEscopo.vigente_desde <= agora,
            or_(UsuarioEscopo.vigente_ate.is_(None), UsuarioEscopo.vigente_ate > agora),
            Perfil.ativo.is_(True),
            Escopo.ativo.is_(True),
            Permissao.ativo.is_(True),
            Recurso.ativo.is_(True),
        )
        .order_by(
            Permissao.codigo,
            Escopo.codigo_escopo,
            Perfil.codigo,
        )
    )
    return list(db.execute(statement).all())


def list_active_profiles(db: Session) -> list[Perfil]:
    statement = select(Perfil).where(Perfil.ativo.is_(True)).order_by(Perfil.nome)
    return list(db.scalars(statement).all())


def list_active_permissions(db: Session) -> list[tuple[Permissao, Recurso]]:
    statement = (
        select(Permissao, Recurso)
        .join(Recurso, Recurso.id_recurso == Permissao.id_recurso)
        .where(Permissao.ativo.is_(True), Recurso.ativo.is_(True))
        .order_by(Recurso.codigo, Permissao.acao)
    )
    return list(db.execute(statement).all())


def list_user_scope_rows(
    db: Session,
    *,
    id_usuario: int,
) -> list[tuple[UsuarioEscopo, Perfil, Escopo]]:
    statement = (
        select(UsuarioEscopo, Perfil, Escopo)
        .join(Perfil, Perfil.id_perfil == UsuarioEscopo.id_perfil)
        .join(Escopo, Escopo.id_escopo == UsuarioEscopo.id_escopo)
        .where(UsuarioEscopo.id_usuario == id_usuario)
        .order_by(UsuarioEscopo.concedido_em.desc(), UsuarioEscopo.id_usuario_escopo)
    )
    return list(db.execute(statement).all())


def get_user(db: Session, *, id_usuario: int) -> Usuario | None:
    return db.get(Usuario, id_usuario)


def list_users(
    db: Session,
    *,
    search: str | None,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> tuple[list[Usuario], int]:
    statement = select(Usuario)
    count_statement = select(func.count()).select_from(Usuario)
    if not include_inactive:
        statement = statement.where(Usuario.ativo.is_(True))
        count_statement = count_statement.where(Usuario.ativo.is_(True))
    if search:
        term = f"%{search.strip()}%"
        condition = or_(Usuario.username.ilike(term), Usuario.nome_completo.ilike(term))
        statement = statement.where(condition)
        count_statement = count_statement.where(condition)
    total = db.scalar(count_statement) or 0
    statement = statement.order_by(Usuario.nome_completo, Usuario.id_usuario)
    statement = statement.offset(offset).limit(limit)
    return list(db.scalars(statement).all()), total


def list_scope_options(db: Session) -> tuple[list[Setor], list[Localidade]]:
    sectors = list(
        db.scalars(select(Setor).where(Setor.ativo.is_(True)).order_by(Setor.nome)).all()
    )
    localities = list(
        db.scalars(
            select(Localidade)
            .where(Localidade.ativo.is_(True))
            .order_by(Localidade.nome_localidade)
        ).all()
    )
    return sectors, localities


def create_user(db: Session, user: Usuario) -> Usuario:
    db.add(user)
    db.flush()
    return user


def get_profile(db: Session, *, id_perfil: int) -> Perfil | None:
    return db.get(Perfil, id_perfil)


def list_profiles(db: Session, *, include_inactive: bool) -> list[Perfil]:
    statement = select(Perfil)
    if not include_inactive:
        statement = statement.where(Perfil.ativo.is_(True))
    return list(db.scalars(statement.order_by(Perfil.nome, Perfil.id_perfil)).all())


def list_resources(db: Session, *, include_inactive: bool) -> list[Recurso]:
    statement = select(Recurso)
    if not include_inactive:
        statement = statement.where(Recurso.ativo.is_(True))
    return list(db.scalars(statement.order_by(Recurso.codigo, Recurso.id_recurso)).all())


def list_permissions(
    db: Session,
    *,
    include_inactive: bool,
) -> list[tuple[Permissao, Recurso]]:
    statement = select(Permissao, Recurso).join(
        Recurso,
        Recurso.id_recurso == Permissao.id_recurso,
    )
    if not include_inactive:
        statement = statement.where(
            Permissao.ativo.is_(True),
            Recurso.ativo.is_(True),
        )
    statement = statement.order_by(Recurso.codigo, Permissao.acao)
    return list(db.execute(statement).all())


def profile_code_exists(db: Session, *, codigo: str) -> bool:
    return db.scalar(select(Perfil.id_perfil).where(Perfil.codigo == codigo)) is not None


def resource_code_exists(db: Session, *, codigo: str) -> bool:
    return db.scalar(select(Recurso.id_recurso).where(Recurso.codigo == codigo)) is not None


def permission_action_exists(
    db: Session,
    *,
    id_recurso: int,
    acao: str,
) -> bool:
    statement = select(Permissao.id_permissao).where(
        Permissao.id_recurso == id_recurso,
        Permissao.acao == acao,
    )
    return db.scalar(statement) is not None


def get_profile_for_update(db: Session, *, id_perfil: int) -> Perfil | None:
    statement = select(Perfil).where(Perfil.id_perfil == id_perfil).with_for_update()
    return db.scalar(statement)


def get_resource(db: Session, *, id_recurso: int) -> Recurso | None:
    return db.get(Recurso, id_recurso)


def get_resource_for_update(db: Session, *, id_recurso: int) -> Recurso | None:
    statement = select(Recurso).where(Recurso.id_recurso == id_recurso).with_for_update()
    return db.scalar(statement)


def get_permission_for_update(db: Session, *, id_permissao: int) -> Permissao | None:
    statement = (
        select(Permissao)
        .where(Permissao.id_permissao == id_permissao)
        .with_for_update()
    )
    return db.scalar(statement)


def get_active_permission(
    db: Session,
    *,
    id_permissao: int,
) -> tuple[Permissao, Recurso] | None:
    statement = (
        select(Permissao, Recurso)
        .join(Recurso, Recurso.id_recurso == Permissao.id_recurso)
        .where(
            Permissao.id_permissao == id_permissao,
            Permissao.ativo.is_(True),
            Recurso.ativo.is_(True),
        )
    )
    row = db.execute(statement).one_or_none()
    return (row[0], row[1]) if row is not None else None


def get_user_for_update(db: Session, *, id_usuario: int) -> Usuario | None:
    statement = (
        select(Usuario)
        .where(Usuario.id_usuario == id_usuario)
        .with_for_update()
    )
    return db.scalar(statement)


def get_scope_by_code(db: Session, *, codigo_escopo: str) -> Escopo | None:
    statement = select(Escopo).where(Escopo.codigo_escopo == codigo_escopo)
    return db.scalar(statement)


def sector_is_active(db: Session, *, id_setor: int) -> bool:
    statement = select(Setor.id_setor).where(
        Setor.id_setor == id_setor,
        Setor.ativo.is_(True),
    )
    return db.scalar(statement) is not None


def locality_is_active(db: Session, *, id_localidade: int) -> bool:
    statement = select(Localidade.id_localidade).where(
        Localidade.id_localidade == id_localidade,
        Localidade.ativo.is_(True),
    )
    return db.scalar(statement) is not None


def get_overlapping_user_scope(
    db: Session,
    *,
    id_usuario: int,
    id_perfil: int,
    id_escopo: int,
    vigente_desde: datetime,
    vigente_ate: datetime | None,
) -> UsuarioEscopo | None:
    conditions = [
        UsuarioEscopo.id_usuario == id_usuario,
        UsuarioEscopo.id_perfil == id_perfil,
        UsuarioEscopo.id_escopo == id_escopo,
        UsuarioEscopo.ativo.is_(True),
        or_(UsuarioEscopo.vigente_ate.is_(None), UsuarioEscopo.vigente_ate > vigente_desde),
    ]
    if vigente_ate is not None:
        conditions.append(UsuarioEscopo.vigente_desde < vigente_ate)
    statement = select(UsuarioEscopo).where(*conditions).with_for_update()
    return db.scalar(statement)


def get_user_scope_for_update(
    db: Session,
    *,
    id_usuario: int,
    id_usuario_escopo: int,
) -> UsuarioEscopo | None:
    statement = (
        select(UsuarioEscopo)
        .where(
            UsuarioEscopo.id_usuario == id_usuario,
            UsuarioEscopo.id_usuario_escopo == id_usuario_escopo,
        )
        .with_for_update()
    )
    return db.scalar(statement)


def profile_permission_exists(
    db: Session,
    *,
    id_perfil: int,
    id_permissao: int,
) -> bool:
    statement = select(PerfilPermissao.id_perfil).where(
        PerfilPermissao.id_perfil == id_perfil,
        PerfilPermissao.id_permissao == id_permissao,
    )
    return db.scalar(statement) is not None


def list_profile_permission_rows(
    db: Session,
    *,
    id_perfil: int,
) -> list[tuple[Permissao, Recurso]]:
    statement = (
        select(Permissao, Recurso)
        .join(Recurso, Recurso.id_recurso == Permissao.id_recurso)
        .join(PerfilPermissao, PerfilPermissao.id_permissao == Permissao.id_permissao)
        .where(
            PerfilPermissao.id_perfil == id_perfil,
            Permissao.ativo.is_(True),
            Recurso.ativo.is_(True),
        )
        .order_by(Recurso.nome, Permissao.acao)
    )
    return list(db.execute(statement).all())


def get_profile_permission_for_update(
    db: Session,
    *,
    id_perfil: int,
    id_permissao: int,
) -> PerfilPermissao | None:
    statement = (
        select(PerfilPermissao)
        .where(
            PerfilPermissao.id_perfil == id_perfil,
            PerfilPermissao.id_permissao == id_permissao,
        )
        .with_for_update()
    )
    return db.scalar(statement)
