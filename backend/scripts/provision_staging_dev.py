"""Semeia o acesso operacional e prepara a primeira conta DEV em staging.

Este comando não cria tabelas, não executa migrations e não carrega cadastros de
teste. Exige uma confirmação interativa e só aceita o catálogo de staging.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from hashlib import sha256

from sqlalchemy import inspect, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import dispose_engine, get_engine, get_session_factory
from app.core.security import generate_temporary_password, hash_password
from app.modules.access_control.catalog import (
    DELIVERY_SECTOR_CODE,
    DELIVERY_SECTOR_NAME,
    PERMISSION_DEFINITIONS,
    PROFILE_PERMISSION_CODES,
    RESOURCE_DEFINITIONS,
)
from app.modules.access_control.models import (
    AutorizacaoEvento,
    Escopo,
    Permissao,
    Perfil,
    PerfilPermissao,
    Recurso,
    UsuarioEscopo,
)
from app.modules.auth.models import Usuario
from app.modules.auth.normalization import normalize_username
from app.modules.catalogs.models import Setor
from app.modules.deliveries.models import FormularioVersao


STAGING_DATABASE = "vilarejo_bi_logistica_staging"
CONFIRMATION_TEXT = "CRIAR OU CONCEDER DEV GLOBAL EM STAGING"
PROFILE_NAMES = {
    "DEV": "Desenvolvimento",
    "GESTOR": "Gestão",
    "DIRETORIA": "Diretoria",
    "OPERADOR": "Operação",
}
REQUIRED_TABLES = (
    "op_logistica_usuario",
    "op_logistica_perfil",
    "op_logistica_recurso",
    "op_logistica_permissao",
    "op_logistica_perfil_permissao",
    "op_logistica_escopo",
    "op_logistica_usuario_escopo",
    "op_logistica_autorizacao_evento",
    "op_logistica_setor",
    "op_logistica_formulario_versao",
)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _confirm_staging_target() -> None:
    settings = get_settings()
    if settings.app_env.strip().lower() != "staging":
        raise RuntimeError("APP_ENV precisa ser exatamente staging.")
    if not settings.op_logistica_database_url:
        raise RuntimeError("OP_LOGISTICA_DATABASE_URL não está configurada.")
    url = make_url(settings.op_logistica_database_url)
    if url.get_backend_name() != "mysql" or url.database != STAGING_DATABASE:
        raise RuntimeError(
            f"Destino recusado. A URL precisa apontar para o MySQL {STAGING_DATABASE}."
        )
    if not sys.stdin.isatty():
        raise RuntimeError("Execute em um terminal interativo para confirmar o destino.")
    print(f"Destino validado: MySQL/{STAGING_DATABASE}")
    if input(f"Digite '{CONFIRMATION_TEXT}' para continuar: ").strip() != CONFIRMATION_TEXT:
        raise RuntimeError("Confirmação não corresponde; nenhuma alteração foi feita.")


def _event(
    db: Session,
    *,
    kind: str,
    actor_id: int,
    details: dict[str, object],
    profile_id: int | None = None,
    permission_id: int | None = None,
    resource_id: int | None = None,
    user_scope_id: int | None = None,
) -> None:
    db.add(
        AutorizacaoEvento(
            tipo_evento=kind,
            id_usuario_ator=actor_id,
            id_perfil=profile_id,
            id_permissao=permission_id,
            id_recurso=resource_id,
            id_usuario_escopo=user_scope_id,
            ocorrido_em=_now(),
            detalhes=details,
        )
    )


def _seed_reference_access(db: Session, *, actor_id: int, now: datetime) -> dict[str, Perfil]:
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
            _event(
                db,
                kind="RECURSO_CRIADO",
                actor_id=actor_id,
                resource_id=resource.id_recurso,
                details={"codigo": code, "origem": "provisionamento staging"},
            )
        elif not resource.ativo:
            raise RuntimeError(f"O recurso {code} está inativo; revise-o antes do provisionamento.")
        resources[code] = resource

    permissions: dict[str, Permissao] = {}
    for resource_code, action, description in PERMISSION_DEFINITIONS:
        resource = resources[resource_code]
        code = f"{resource_code}:{action}"
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
            _event(
                db,
                kind="PERMISSAO_CRIADA",
                actor_id=actor_id,
                permission_id=permission.id_permissao,
                details={"codigo": code, "origem": "provisionamento staging"},
            )
        elif (
            permission.id_recurso != resource.id_recurso
            or permission.acao != action
            or not permission.ativo
        ):
            raise RuntimeError(f"A permissão {code} diverge do catálogo de código ou está inativa.")
        permissions[code] = permission

    profiles: dict[str, Perfil] = {}
    for code, name in PROFILE_NAMES.items():
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
            _event(
                db,
                kind="PERFIL_CRIADO",
                actor_id=actor_id,
                profile_id=profile.id_perfil,
                details={"codigo": code, "origem": "provisionamento staging"},
            )
        elif not profile.ativo:
            raise RuntimeError(f"O perfil {code} está inativo; revise-o antes do provisionamento.")
        profiles[code] = profile

    for profile_code, profile in profiles.items():
        allowed_codes = PROFILE_PERMISSION_CODES.get(profile_code, frozenset())
        for code in allowed_codes:
            permission = permissions[code]
            exists = db.scalar(
                select(PerfilPermissao.id_perfil).where(
                    PerfilPermissao.id_perfil == profile.id_perfil,
                    PerfilPermissao.id_permissao == permission.id_permissao,
                )
            )
            if exists is not None:
                continue
            db.add(
                PerfilPermissao(
                    id_perfil=profile.id_perfil,
                    id_permissao=permission.id_permissao,
                    concedido_em=now,
                    concedido_por=actor_id,
                )
            )
            _event(
                db,
                kind="PERFIL_PERMISSAO_CONCEDIDA",
                actor_id=actor_id,
                profile_id=profile.id_perfil,
                permission_id=permission.id_permissao,
                details={"origem": "provisionamento staging"},
            )
    return profiles


def _get_or_create_user(db: Session, *, username: str, now: datetime) -> tuple[Usuario, str | None]:
    user = db.scalar(select(Usuario).where(Usuario.username == username).with_for_update())
    if user is not None:
        if not user.ativo:
            raise RuntimeError("A conta existente está inativa; nenhum dado foi alterado.")
        if user.hash_senha:
            return user, None
        password = generate_temporary_password()
        user.hash_senha = hash_password(password)
        user.senha_alterada_em = now
        user.troca_senha_obrigatoria = False
        user.atualizado_em = now
        return user, password

    full_name = " ".join(input("Nome completo para a conta DEV: ").split())
    if not full_name or len(full_name) > 160:
        raise RuntimeError("Nome completo inválido; informe de 1 a 160 caracteres.")
    password = generate_temporary_password()
    user = Usuario(
        username=username,
        nome_completo=full_name,
        ativo=True,
        criado_em=now,
        atualizado_em=now,
        hash_senha=hash_password(password),
        senha_alterada_em=now,
        troca_senha_obrigatoria=False,
    )
    db.add(user)
    db.flush()
    _event(
        db,
        kind="USUARIO_CRIADO",
        actor_id=user.id_usuario,
        details={"id_usuario": user.id_usuario, "origem": "provisionamento staging"},
    )
    return user, password


def _seed_operational_reference_data(db: Session, *, actor_id: int, now: datetime) -> None:
    sector = db.scalar(select(Setor).where(Setor.codigo == DELIVERY_SECTOR_CODE))
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
    elif not sector.ativo or sector.nome != DELIVERY_SECTOR_NAME:
        raise RuntimeError("O setor existente diverge de Entregas ou está inativo; revise-o manualmente.")

    form = db.scalar(
        select(FormularioVersao).where(
            FormularioVersao.id_setor == sector.id_setor,
            FormularioVersao.codigo_formulario == "ENTREGAS_DIARIAS",
            FormularioVersao.versao == 1,
        )
    )
    if form is None:
        contract_hash = sha256(b"portal-logistica-entregas-v1").hexdigest()
        db.add(
            FormularioVersao(
                id_setor=sector.id_setor,
                codigo_formulario="ENTREGAS_DIARIAS",
                versao=1,
                hash_contrato=contract_hash,
                status="PUBLICADO",
                vigente_desde=now,
                vigente_ate=None,
                criado_por=actor_id,
                criado_em=now,
                publicado_por=actor_id,
                publicado_em=now,
            )
        )
    elif form.status != "PUBLICADO":
        raise RuntimeError("A versão do formulário de Entregas não está publicada; revise-a manualmente.")


def _grant_global_dev(db: Session, *, user: Usuario, profile: Perfil, now: datetime) -> None:
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
    elif not scope.ativo or scope.tipo_escopo != "GLOBAL":
        raise RuntimeError("O escopo GLOBAL existente está inativo ou inconsistente.")

    existing = db.scalar(
        select(UsuarioEscopo).where(
            UsuarioEscopo.id_usuario == user.id_usuario,
            UsuarioEscopo.id_perfil == profile.id_perfil,
            UsuarioEscopo.id_escopo == scope.id_escopo,
            UsuarioEscopo.ativo.is_(True),
            UsuarioEscopo.vigente_desde <= now,
            or_(UsuarioEscopo.vigente_ate.is_(None), UsuarioEscopo.vigente_ate > now),
        )
    )
    if existing is not None:
        return
    grant = UsuarioEscopo(
        id_usuario=user.id_usuario,
        id_perfil=profile.id_perfil,
        id_escopo=scope.id_escopo,
        ativo=True,
        vigente_desde=now,
        vigente_ate=None,
        concedido_por=user.id_usuario,
        concedido_em=now,
    )
    db.add(grant)
    db.flush()
    _event(
        db,
        kind="USUARIO_ESCOPO_CONCEDIDO",
        actor_id=user.id_usuario,
        user_scope_id=grant.id_usuario_escopo,
        details={
            "id_usuario": user.id_usuario,
            "codigo_perfil": profile.codigo,
            "codigo_escopo": scope.codigo_escopo,
            "origem": "provisionamento staging",
        },
    )


def main() -> int:
    try:
        _confirm_staging_target()
        username = normalize_username(input("Username da conta DEV: "))
        if not username or len(username) > 80:
            raise RuntimeError("Username inválido; informe de 1 a 80 caracteres.")
        if input("Confirme novamente o catálogo digitando STAGING: ").strip() != "STAGING":
            raise RuntimeError("O catálogo não foi confirmado; nenhuma alteração foi feita.")

        engine = get_engine()
        session_factory = get_session_factory()
        if engine is None or session_factory is None:
            raise RuntimeError("Não foi possível abrir a conexão operacional configurada.")
        missing_tables = [name for name in REQUIRED_TABLES if not inspect(engine).has_table(name)]
        if missing_tables:
            raise RuntimeError(
                "Faltam tabelas de migrations; nenhuma alteração foi feita: "
                + ", ".join(missing_tables)
            )

        db = session_factory()
        temporary_password: str | None = None
        try:
            now = _now()
            user, temporary_password = _get_or_create_user(
                db,
                username=username,
                now=now,
            )
            profiles = _seed_reference_access(db, actor_id=user.id_usuario, now=now)
            _seed_operational_reference_data(db, actor_id=user.id_usuario, now=now)
            _grant_global_dev(
                db,
                user=user,
                profile=profiles["DEV"],
                now=now,
            )
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        print(f"Conta DEV global pronta: username={username}.")
        if temporary_password is not None:
            print(f"Senha inicial de seis dígitos (exibida uma única vez): {temporary_password}")
        else:
            print("A conta já existia; nenhuma senha foi alterada ou exibida.")
        print(
            "Foram preparados perfis, permissões, setor Entregas e a versão inicial "
            "do formulário. Lojas, pessoas e motivos reais devem ser "
            "cadastrados pela Administração do Portal."
        )
        return 0
    except (IntegrityError, SQLAlchemyError):
        print("O provisionamento falhou; a transação foi revertida. Confira migrations e conexões.")
        return 1
    except (RuntimeError, ValueError) as exc:
        print(f"Provisionamento interrompido: {exc}")
        return 2
    finally:
        dispose_engine()


if __name__ == "__main__":
    raise SystemExit(main())
