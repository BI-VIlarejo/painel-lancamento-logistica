"""Consultas de persistência para contas e sessões locais."""

from datetime import datetime
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app.modules.auth.models import Usuario, UsuarioSessao

def get_user_by_username(db: Session, username: str) -> Usuario | None:
    """Busca uma conta pelo username canônico armazenado."""
    statement = select(Usuario).where(Usuario.username == username)
    return db.scalar(statement)

def get_user_by_username_for_update(db: Session, username: str) -> Usuario | None:
    """Busca uma conta pelo username e bloqueia sua linha para atualização."""
    statement = (
        select(Usuario)
        .where(Usuario.username == username)
        .with_for_update()
    )
    return db.scalar(statement)

def create_session_for_user(
    db: Session,
    *,
    id_usuario: int,
    expected_password_hash: str,
    hash_token: str,
    criado_em: datetime,
    expira_em: datetime,
) -> tuple[UsuarioSessao, Usuario] | None:
    """Revalida a conta e cria a sessão na mesma transação."""
    statement = (
        select(Usuario)
        .where(Usuario.id_usuario == id_usuario)
        .with_for_update()
    )
    user = db.scalar(statement)
    if (
        user is None
        or not user.ativo
        or user.hash_senha != expected_password_hash
    ):
        return None

    session = UsuarioSessao(
        id_usuario=user.id_usuario,
        hash_token=hash_token,
        criado_em=criado_em,
        expira_em=expira_em,
    )
    user.ultimo_login_em = criado_em
    db.add(session)
    return session, user

def get_valid_session(
    db: Session,
    *,
    hash_token: str,
    agora: datetime,
) -> tuple[UsuarioSessao, Usuario] | None:
    """Busca sessão não revogada e não expirada, junto da conta."""
    statement = (
        select(UsuarioSessao, Usuario)
        .join(Usuario, Usuario.id_usuario == UsuarioSessao.id_usuario)
        .where(
            UsuarioSessao.hash_token == hash_token,
            UsuarioSessao.revogado_em.is_(None),
            UsuarioSessao.expira_em > agora,
            Usuario.ativo.is_(True),
        )
    )
    result = db.execute(statement).one_or_none()
    if result is None:
        return None
    return result[0], result[1]

def get_session_by_hash(
    db: Session,
    *,
    hash_token: str,
) -> UsuarioSessao | None:
    """Localiza uma sessão pelo hash, inclusive quando já expirou."""
    statement = select(UsuarioSessao).where(UsuarioSessao.hash_token == hash_token)
    return db.scalar(statement)

def update_session_last_use(
    session: UsuarioSessao,
    *,
    usado_em: datetime,
) -> None:
    """Atualiza o último uso sem emitir um UPDATE por requisição."""
    session.ultimo_uso_em = usado_em

def revoke_session(
    db: Session,
    *,
    id_sessao: int,
    revogado_em: datetime,
) -> bool:
    """Revoga uma sessão existente sem alterar uma revogação anterior."""
    statement = (
        select(UsuarioSessao)
        .where(UsuarioSessao.id_sessao == id_sessao)
        .with_for_update()
    )
    session = db.scalar(statement)
    if session is None or session.revogado_em is not None:
        return False

    session.revogado_em = revogado_em
    return True


def get_user_for_update(db: Session, *, id_usuario: int) -> Usuario | None:
    statement = select(Usuario).where(Usuario.id_usuario == id_usuario).with_for_update()
    return db.scalar(statement)


def revoke_other_user_sessions(
    db: Session,
    *,
    id_usuario: int,
    id_sessao_atual: int,
    revogado_em: datetime,
) -> None:
    statement = (
        update(UsuarioSessao)
        .where(
            UsuarioSessao.id_usuario == id_usuario,
            UsuarioSessao.id_sessao != id_sessao_atual,
            UsuarioSessao.revogado_em.is_(None),
        )
        .values(revogado_em=revogado_em)
    )
    db.execute(statement)


def revoke_user_sessions(
    db: Session,
    *,
    id_usuario: int,
    revogado_em: datetime,
) -> None:
    statement = (
        update(UsuarioSessao)
        .where(
            UsuarioSessao.id_usuario == id_usuario,
            UsuarioSessao.revogado_em.is_(None),
        )
        .values(revogado_em=revogado_em)
    )
    db.execute(statement)
