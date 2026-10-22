"""Cria um ambiente descartável de desenvolvimento local e a primeira conta DEV."""

from __future__ import annotations

import os
from datetime import UTC, date, datetime
from getpass import getpass
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import CheckConstraint, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import dispose_engine, get_engine
from app.core.orm import Base
from app.core.security import InvalidPassword, hash_password
from app.model_registry import CORE_OPERATIONAL_TABLES  # noqa: F401
from app.modules.access_control.models import (
    AutorizacaoEvento,
    Escopo,
    Permissao,
    Perfil,
    PerfilPermissao,
    Recurso,
    UsuarioEscopo,
)
from app.modules.access_control.catalog import (
    DELIVERY_SECTOR_CODE,
    DELIVERY_SECTOR_NAME,
    PERMISSION_DEFINITIONS,
    PROFILE_PERMISSION_CODES,
    RESOURCE_DEFINITIONS,
)
from app.modules.auth.models import Usuario
from app.modules.auth.normalization import normalize_username
from app.modules.catalogs.models import (
    Localidade,
    MotivoNaoEntrega,
    Pessoa,
    Setor,
)
from app.modules.deliveries.models import FormularioVersao


PERMISSION_SEED = PERMISSION_DEFINITIONS


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _validate_local_target() -> None:
    settings = get_settings()
    database_url = settings.op_logistica_database_url
    if settings.app_env.strip().lower() not in {"local", "dev", "development", "test"}:
        raise RuntimeError("O bootstrap só pode rodar com APP_ENV local/dev/test.")
    if os.environ.get("LOCAL_DEV_BOOTSTRAP") != "1":
        raise RuntimeError("Defina LOCAL_DEV_BOOTSTRAP=1 para confirmar o bootstrap local.")
    if not database_url:
        raise RuntimeError("OP_LOGISTICA_DATABASE_URL não está configurada.")

    url = make_url(database_url)
    if (
        url.get_backend_name() != "mysql"
        or url.database != "op_logistica_dev"
        or url.host not in {"db", "mysql", "localhost", "127.0.0.1"}
    ):
        raise RuntimeError(
            "Destino recusado. O bootstrap aceita somente o MySQL local "
            "op_logistica_dev (host db/mysql/localhost)."
        )


def _get_or_create_profile(db: Session, *, code: str, name: str, now: datetime) -> Perfil:
    profile = db.scalar(select(Perfil).where(Perfil.codigo == code))
    if profile is None:
        profile = Perfil(
            codigo=code,
            nome=name,
            ativo=True,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(profile)
        db.flush()
    return profile


def _get_or_create_permission(
    db: Session,
    *,
    resource: Recurso,
    action: str,
    description: str,
) -> Permissao:
    code = f"{resource.codigo}:{action}"
    permission = db.scalar(select(Permissao).where(Permissao.codigo == code))
    if permission is None:
        permission = Permissao(
            id_recurso=resource.id_recurso,
            acao=action,
            codigo=code,
            descricao=description,
            ativo=True,
        )
        db.add(permission)
        db.flush()
    return permission


def _seed_access_catalog(
    db: Session,
    *,
    now: datetime,
) -> tuple[dict[str, Perfil], list[Permissao]]:
    resources: dict[str, Recurso] = {}
    for code, name in RESOURCE_DEFINITIONS:
        resource = db.scalar(select(Recurso).where(Recurso.codigo == code))
        if resource is None:
            resource = Recurso(
                codigo=code,
                nome=name,
                id_setor=None,
                ativo=True,
                criado_em=now,
            )
            db.add(resource)
            db.flush()
        resources[code] = resource

    permissions = [
        _get_or_create_permission(
            db,
            resource=resources[resource_code],
            action=action,
            description=description,
        )
        for resource_code, action, description in PERMISSION_SEED
    ]
    dev_profile = _get_or_create_profile(db, code="DEV", name="Desenvolvimento", now=now)
    operator_profile = _get_or_create_profile(db, code="OPERADOR", name="Operação", now=now)
    catalog_profile = _get_or_create_profile(
        db,
        code="CADASTRADOR",
        name="Cadastros operacionais",
        now=now,
    )
    manager_profile = _get_or_create_profile(db, code="GESTOR", name="Gestão", now=now)
    director_profile = _get_or_create_profile(db, code="DIRETORIA", name="Diretoria", now=now)
    return {
        "DEV": dev_profile,
        "OPERADOR": operator_profile,
        "CADASTRADOR": catalog_profile,
        "GESTOR": manager_profile,
        "DIRETORIA": director_profile,
    }, permissions


def _profile_permissions(
    *,
    profile_code: str,
    permissions: list[Permissao],
) -> list[Permissao]:
    allowed_codes = PROFILE_PERMISSION_CODES.get(profile_code, frozenset())
    return [permission for permission in permissions if permission.codigo in allowed_codes]


def _grant_profile_permissions(
    db: Session,
    *,
    profiles: dict[str, Perfil],
    permissions: list[Permissao],
    actor_id: int,
    now: datetime,
) -> None:
    for profile_code, profile in profiles.items():
        granted_ids = set(
            db.scalars(
                select(PerfilPermissao.id_permissao).where(
                    PerfilPermissao.id_perfil == profile.id_perfil
                )
            ).all()
        )
        for permission in _profile_permissions(
            profile_code=profile_code,
            permissions=permissions,
        ):
            if permission.id_permissao in granted_ids:
                continue
            db.add(
                PerfilPermissao(
                    id_perfil=profile.id_perfil,
                    id_permissao=permission.id_permissao,
                    concedido_em=now,
                    concedido_por=actor_id,
                )
            )
            db.add(
                AutorizacaoEvento(
                    tipo_evento="PERFIL_PERMISSAO_CONCEDIDA",
                    id_usuario_ator=actor_id,
                    id_perfil=profile.id_perfil,
                    id_permissao=permission.id_permissao,
                    ocorrido_em=now,
                    detalhes={"origem": "bootstrap local", "perfil": profile_code},
                )
            )


def _find_dev_admin(db: Session) -> int | None:
    statement = (
        select(Usuario.id_usuario)
        .join(UsuarioEscopo, UsuarioEscopo.id_usuario == Usuario.id_usuario)
        .join(Perfil, Perfil.id_perfil == UsuarioEscopo.id_perfil)
        .join(Escopo, Escopo.id_escopo == UsuarioEscopo.id_escopo)
        .where(
            Usuario.ativo.is_(True),
            UsuarioEscopo.ativo.is_(True),
            Perfil.codigo == "DEV",
            Escopo.codigo_escopo == "GLOBAL",
        )
        .limit(1)
    )
    return db.scalar(statement)


def _seed_sample_catalog(db: Session, *, actor_id: int, now: datetime) -> None:
    sector = db.scalar(select(Setor).where(Setor.codigo == DELIVERY_SECTOR_CODE))
    if sector is None:
        # Reaproveita o setor criado por versões anteriores do bootstrap para
        # manter os lançamentos e a versão do formulário no mesmo registro.
        sector = db.scalar(select(Setor).where(Setor.codigo == "LOCAL_DEV"))
        if sector is None:
            sector = Setor(
                codigo=DELIVERY_SECTOR_CODE,
                nome=DELIVERY_SECTOR_NAME,
                ativo=True,
                criado_em=now,
                atualizado_em=now,
            )
            db.add(sector)
            db.flush()
        else:
            sector.codigo = DELIVERY_SECTOR_CODE
            sector.nome = DELIVERY_SECTOR_NAME
            sector.atualizado_em = now

    locality = db.scalar(
        select(Localidade).where(Localidade.codigo_localidade == "LOCALIDADE_DEV")
    )
    if locality is None:
        locality = Localidade(
            codigo_localidade="LOCALIDADE_DEV",
            nome_localidade="Localidade de teste",
            tipo_localidade="LOCAL_DEV",
            ativo=True,
            sincronizado_em=now,
        )
        db.add(locality)

    sample_people = (
        ("MOTORISTA", "MOTORISTA_DEV_01", "Motorista de teste"),
        ("AJUDANTE", "AJUDANTE_DEV_01", "Ajudante de teste"),
    )
    for role, origin_code, display_name in sample_people:
        existing = db.scalar(
            select(Pessoa).where(Pessoa.codigo_pessoa_origem == origin_code)
        )
        if existing is None:
            db.add(
                Pessoa(
                    codigo_pessoa=str(uuid4()),
                    sistema_origem="LOCAL_DEV",
                    codigo_pessoa_origem=origin_code,
                    nome_exibicao=display_name,
                    tipo_funcao=role,
                    ativo=True,
                    vigente_desde=date(2020, 1, 1),
                    vigente_ate=None,
                    criado_por=actor_id,
                    criado_em=now,
                    atualizado_em=now,
                )
            )

    reason = db.scalar(
        select(MotivoNaoEntrega).where(
            MotivoNaoEntrega.codigo_motivo == "NAO_LOCALIZADO_DEV",
            MotivoNaoEntrega.vigente_desde == date(2020, 1, 1),
        )
    )
    if reason is None:
        db.add(
            MotivoNaoEntrega(
                codigo_motivo="NAO_LOCALIZADO_DEV",
                descricao_motivo="Destinatário não localizado (teste)",
                ativo=True,
                vigente_desde=date(2020, 1, 1),
                vigente_ate=None,
                criado_por=actor_id,
                criado_em=now,
                atualizado_em=now,
            )
        )

    form = db.scalar(
        select(FormularioVersao).where(
            FormularioVersao.id_setor == sector.id_setor,
            FormularioVersao.codigo_formulario == "ENTREGAS_DIARIAS",
            FormularioVersao.versao == 1,
        )
    )
    if form is None:
        db.add(
            FormularioVersao(
                id_setor=sector.id_setor,
                codigo_formulario="ENTREGAS_DIARIAS",
                versao=1,
                hash_contrato=sha256(b"portal-logistica-local-dev-v1").hexdigest(),
                status="PUBLICADO",
                vigente_desde=now,
                vigente_ate=None,
                criado_por=actor_id,
                criado_em=now,
                publicado_por=actor_id,
                publicado_em=now,
            )
        )


def _ensure_local_feedback_creator_column(engine) -> None:
    """Aplica a evolução aditiva do schema somente ao MySQL local validado."""
    inspector = inspect(engine)
    if not inspector.has_table("op_logistica_feedback"):
        return
    columns = {column["name"] for column in inspector.get_columns("op_logistica_feedback")}
    if "criado_por" in columns:
        return
    with engine.begin() as connection:
        connection.execute(
            text(
                "ALTER TABLE op_logistica_feedback "
                "ADD COLUMN criado_por BIGINT NULL, "
                "ADD CONSTRAINT fk_op_logistica_feedback_criador "
                "FOREIGN KEY (criado_por) REFERENCES op_logistica_usuario (id_usuario)"
            )
        )


def _ensure_local_feedback_idempotency(engine) -> None:
    """Permite vários feedbacks por entrega e protege retries no MySQL local."""
    table = "op_logistica_feedback"
    inspector = inspect(engine)
    if not inspector.has_table(table):
        return

    columns = {column["name"]: column for column in inspector.get_columns(table)}
    index_names = {
        index["name"]
        for index in inspector.get_indexes(table)
        if index.get("name")
    }
    index_names.update(
        constraint["name"]
        for constraint in inspector.get_unique_constraints(table)
        if constraint.get("name")
    )

    with engine.begin() as connection:
        if "chave_idempotencia" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE op_logistica_feedback "
                    "ADD COLUMN chave_idempotencia CHAR(36) NULL"
                )
            )
        connection.execute(
            text(
                "UPDATE op_logistica_feedback "
                "SET chave_idempotencia = UUID() "
                "WHERE chave_idempotencia IS NULL"
            )
        )
        if (
            "chave_idempotencia" not in columns
            or columns["chave_idempotencia"].get("nullable", True)
        ):
            connection.execute(
                text(
                    "ALTER TABLE op_logistica_feedback "
                    "MODIFY COLUMN chave_idempotencia CHAR(36) NOT NULL"
                )
            )
        if "ix_op_logistica_feedback_revisao" not in index_names:
            connection.execute(
                text(
                    "ALTER TABLE op_logistica_feedback "
                    "ADD INDEX ix_op_logistica_feedback_revisao "
                    "(id_lancamento_revisao)"
                )
            )
        if "uq_op_logistica_feedback_revisao_item" in index_names:
            connection.execute(
                text(
                    "ALTER TABLE op_logistica_feedback "
                    "DROP INDEX uq_op_logistica_feedback_revisao_item"
                )
            )
        if "uq_op_logistica_feedback_idempotencia" not in index_names:
            connection.execute(
                text(
                    "ALTER TABLE op_logistica_feedback "
                    "ADD CONSTRAINT uq_op_logistica_feedback_idempotencia "
                    "UNIQUE (chave_idempotencia)"
                )
            )


def _ensure_local_delivery_otif_columns(engine) -> None:
    """Mantém as colunas históricas de prazo/completude no schema local."""
    table = "op_logistica_entrega_diaria"
    inspector = inspect(engine)
    if not inspector.has_table(table):
        return

    columns = {column["name"] for column in inspector.get_columns(table)}
    checks = {
        constraint.get("name")
        for constraint in inspector.get_check_constraints(table)
    }
    with engine.begin() as connection:
        if "quantidade_entregas_no_prazo" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE op_logistica_entrega_diaria "
                    "ADD COLUMN quantidade_entregas_no_prazo INT NULL"
                )
            )
        if "quantidade_entregas_completas" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE op_logistica_entrega_diaria "
                    "ADD COLUMN quantidade_entregas_completas INT NULL"
                )
            )
        if "ck_op_logistica_entrega_otif_quantidades" not in checks:
            connection.execute(
                text(
                    "ALTER TABLE op_logistica_entrega_diaria "
                    "ADD CONSTRAINT ck_op_logistica_entrega_otif_quantidades CHECK ("
                    "(quantidade_entregas_no_prazo IS NULL AND "
                    "quantidade_entregas_completas IS NULL) OR "
                    "(quantidade_entregas_no_prazo IS NOT NULL AND "
                    "quantidade_entregas_completas IS NOT NULL AND "
                    "quantidade_entregas_no_prazo >= 0 AND "
                    "quantidade_entregas_completas >= 0 AND "
                    "quantidade_entregas_no_prazo <= quantidade_realizada AND "
                    "quantidade_entregas_completas <= quantidade_realizada))"
                )
            )


def _ensure_local_authorization_event_checks(engine) -> None:
    """Evolui checks antigos de auditoria somente no MySQL local validado."""
    table = AutorizacaoEvento.__tablename__
    inspector = inspect(engine)
    if not inspector.has_table(table):
        return

    existing = {
        constraint["name"]: constraint.get("sqltext", "")
        for constraint in inspector.get_check_constraints(table)
        if constraint.get("name")
    }
    dialect = engine.dialect
    preparer = dialect.identifier_preparer
    table_name = preparer.quote(table)

    with engine.begin() as connection:
        for constraint in AutorizacaoEvento.__table_args__:
            if not isinstance(constraint, CheckConstraint) or not constraint.name:
                continue

            current_expression = existing.get(constraint.name, "")
            expected_values = {
                value
                for value in constraint.sqltext.text.split("'")[1::2]
                if value
            }
            if current_expression and all(
                value in current_expression for value in expected_values
            ):
                continue

            constraint_name = preparer.quote(constraint.name)
            if current_expression:
                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} "
                        f"DROP CHECK {constraint_name}"
                    )
                )

            expression = constraint.sqltext.compile(
                dialect=dialect,
                compile_kwargs={"literal_binds": True},
            )
            connection.execute(
                text(
                    f"ALTER TABLE {table_name} ADD CONSTRAINT {constraint_name} "
                    f"CHECK ({expression})"
                )
            )


def _create_dev_user(
    db: Session,
    *,
    profiles: dict[str, Perfil],
    permissions: list[Permissao],
) -> Usuario:
    username = normalize_username(input("Usuário (ex.: nome.sobrenome): "))
    if not username or len(username) > 80:
        raise ValueError("O usuário deve ter de 1 a 80 caracteres.")
    name = input("Nome completo: ").strip()
    if not name or len(name) > 160:
        raise ValueError("O nome deve ter de 1 a 160 caracteres.")
    password = getpass("Senha (mínimo 6 caracteres): ")
    confirmation = getpass("Confirme a senha: ")
    if password != confirmation:
        raise ValueError("As senhas não coincidem.")

    now = _now()
    user = Usuario(
        username=username,
        nome_completo=name,
        ativo=True,
        criado_em=now,
        atualizado_em=now,
        hash_senha=hash_password(password),
        senha_alterada_em=now,
        troca_senha_obrigatoria=False,
    )
    db.add(user)
    db.flush()

    _grant_profile_permissions(
        db,
        profiles=profiles,
        permissions=permissions,
        actor_id=user.id_usuario,
        now=now,
    )

    scope = db.scalar(select(Escopo).where(Escopo.codigo_escopo == "GLOBAL"))
    if scope is None:
        scope = Escopo(
            codigo_escopo="GLOBAL",
            tipo_escopo="GLOBAL",
            id_setor=None,
            id_localidade=None,
            ativo=True,
            criado_em=now,
        )
        db.add(scope)
        db.flush()

    grant = UsuarioEscopo(
        id_usuario=user.id_usuario,
        id_perfil=profiles["DEV"].id_perfil,
        id_escopo=scope.id_escopo,
        ativo=True,
        vigente_desde=now,
        vigente_ate=None,
        concedido_por=user.id_usuario,
        concedido_em=now,
    )
    db.add(grant)
    db.flush()
    db.add(
        AutorizacaoEvento(
            tipo_evento="USUARIO_ESCOPO_CONCEDIDO",
            id_usuario_ator=user.id_usuario,
            id_usuario_escopo=grant.id_usuario_escopo,
            ocorrido_em=now,
            detalhes={"origem": "bootstrap local"},
        )
    )
    _seed_sample_catalog(db, actor_id=user.id_usuario, now=now)
    return user


def main() -> int:
    """Confirma o destino local, cria o schema e solicita a primeira conta DEV."""
    try:
        _validate_local_target()
    except (RuntimeError, ValueError) as exc:
        print(f"Bootstrap local bloqueado: {exc}")
        return 2

    engine = get_engine()
    if engine is None:
        print("Não foi possível criar a conexão com o banco local.")
        return 2

    try:
        Base.metadata.create_all(engine)
        _ensure_local_feedback_creator_column(engine)
        _ensure_local_feedback_idempotency(engine)
        _ensure_local_delivery_otif_columns(engine)
        _ensure_local_authorization_event_checks(engine)
        with Session(engine) as db, db.begin():
            now = _now()
            profiles, permissions = _seed_access_catalog(
                db,
                now=now,
            )
            existing_dev_id = _find_dev_admin(db)
            if existing_dev_id is not None:
                _grant_profile_permissions(
                    db,
                    profiles=profiles,
                    permissions=permissions,
                    actor_id=existing_dev_id,
                    now=now,
                )
                print("Permissões locais do perfil DEV atualizadas; nenhuma conta foi alterada.")
                return 0
            user = _create_dev_user(
                db,
                profiles=profiles,
                permissions=permissions,
            )
            username = user.username
            user_id = user.id_usuario
        print(
            f"Conta DEV local pronta: username={username}, id_usuario={user_id}. "
            "Ela tem acesso global e todas as permissões disponíveis neste portal."
        )
        return 0
    except (InvalidPassword, ValueError) as exc:
        print(f"Não foi possível concluir o bootstrap: {exc}")
        return 2
    except IntegrityError:
        print("Conflito de dados no bootstrap local; nenhum registro foi confirmado.")
        return 1
    except SQLAlchemyError:
        print(
            "Não foi possível preparar o MySQL local. Confira se o serviço db está "
            "saudável e se OP_LOGISTICA_DATABASE_URL aponta para op_logistica_dev."
        )
        return 1
    finally:
        dispose_engine()


if __name__ == "__main__":
    raise SystemExit(main())
