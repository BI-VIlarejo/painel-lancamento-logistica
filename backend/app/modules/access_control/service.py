"""Resolução central de permissões e escopos efetivos."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    APIError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ServiceUnavailableError,
)
from app.core.security import hash_password
from app.modules.access_control import repository
from app.modules.access_control.models import (
    AutorizacaoEvento,
    Escopo,
    Permissao,
    Perfil,
    PerfilPermissao,
    Recurso,
    UsuarioEscopo,
)
from app.modules.access_control.schemas import (
    AccessScopeSummary,
    AccessScopeOptions,
    PermissionCreateRequest,
    PermissionSummary,
    PermissionUpdateRequest,
    ProfileCreateRequest,
    ProfileSummary,
    ProfileUpdateRequest,
    ResourceCreateRequest,
    ResourceSummary,
    ResourceUpdateRequest,
    UserScopeGrantRequest,
    UserScopeGrantResponse,
    UserAccountCreateRequest,
    UserAccountCreated,
    UserAccountPage,
    UserAccountStatusRequest,
    UserAccountSummary,
)
from app.modules.auth.schemas import AuthenticatedUser, MeResponse
from app.modules.auth.models import Usuario
from app.modules.auth.repository import revoke_user_sessions


@dataclass(frozen=True)
class EffectiveGrant:
    """Uma permissão efetiva dentro de uma concessão de perfil e escopo."""

    permission_code: str
    resource_code: str
    action: str
    resource_id_setor: int | None
    id_perfil: int
    codigo_perfil: str
    id_escopo: int
    codigo_escopo: str
    tipo_escopo: str
    id_setor: int | None
    id_localidade: int | None


@dataclass(frozen=True)
class AuthorizationContext:
    """Concessões efetivas de uma permissão para a pessoa autenticada."""

    id_usuario: int
    permission_code: str
    grants: tuple[EffectiveGrant, ...]


_PROFILE_ASSIGNMENT_LEVELS = {
    "OPERADOR": 0,
    "GESTOR": 1,
    "DIRETORIA": 2,
    "DEV": 3,
}


def _global_profile_codes(db: Session, id_usuario: int) -> set[str]:
    return {
        grant.codigo_perfil
        for grant in _load_effective_grants(db, id_usuario)
        if grant.tipo_escopo == "GLOBAL"
    }


def _profile_level(profile_code: str) -> int:
    # Perfis customizados exigem administração DEV até receberem uma política explícita.
    return _PROFILE_ASSIGNMENT_LEVELS.get(profile_code, _PROFILE_ASSIGNMENT_LEVELS["DEV"])


def _administrator_level(db: Session, id_usuario: int) -> int:
    return max(
        (
            _PROFILE_ASSIGNMENT_LEVELS[code]
            for code in _global_profile_codes(db, id_usuario)
            if code in _PROFILE_ASSIGNMENT_LEVELS
        ),
        default=-1,
    )


def _can_assign_profile(
    db: Session,
    *,
    id_usuario_ator: int,
    target_profile_code: str,
) -> bool:
    actor_level = _administrator_level(db, id_usuario_ator)
    if target_profile_code not in _PROFILE_ASSIGNMENT_LEVELS:
        return actor_level >= _PROFILE_ASSIGNMENT_LEVELS["DEV"]
    return _profile_level(target_profile_code) <= actor_level


def _utc_now() -> datetime:
    """Usa UTC sem timezone para comparar com as colunas DATETIME do schema."""
    return datetime.now(UTC).replace(tzinfo=None)


def _database_unavailable(db: Session, exc: SQLAlchemyError) -> ServiceUnavailableError:
    try:
        db.rollback()
    except SQLAlchemyError:
        pass
    return ServiceUnavailableError("Controle de acesso temporariamente indisponível.")


def _scope_code(
    *,
    tipo_escopo: str,
    id_setor: int | None,
    id_localidade: int | None,
) -> str:
    if tipo_escopo == "GLOBAL":
        return "GLOBAL"
    if tipo_escopo == "SETOR":
        return f"SETOR:{id_setor}"
    if tipo_escopo == "LOCALIDADE":
        return f"LOCALIDADE:{id_localidade}"
    return f"SETOR_LOCALIDADE:{id_setor}:{id_localidade}"


def _scope_grant_response(
    grant: UsuarioEscopo,
    profile: Perfil,
    scope: Escopo,
) -> UserScopeGrantResponse:
    return UserScopeGrantResponse(
        id_usuario_escopo=grant.id_usuario_escopo,
        id_usuario=grant.id_usuario,
        id_perfil=grant.id_perfil,
        codigo_perfil=profile.codigo,
        nome_perfil=profile.nome,
        id_escopo=grant.id_escopo,
        codigo_escopo=scope.codigo_escopo,
        tipo_escopo=scope.tipo_escopo,
        id_setor=scope.id_setor,
        id_localidade=scope.id_localidade,
        ativo=grant.ativo,
        vigente_desde=grant.vigente_desde,
        vigente_ate=grant.vigente_ate,
        concedido_por=grant.concedido_por,
        concedido_em=grant.concedido_em,
    )


def _load_effective_grants(db: Session, id_usuario: int) -> tuple[EffectiveGrant, ...]:
    try:
        rows = repository.get_effective_access_rows(
            db,
            id_usuario=id_usuario,
            agora=_utc_now(),
        )
    except SQLAlchemyError as exc:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass
        raise ServiceUnavailableError(
            "Autorização temporariamente indisponível."
        ) from exc

    return tuple(
        EffectiveGrant(
            permission_code=permission.codigo,
            resource_code=resource.codigo,
            action=permission.acao,
            resource_id_setor=resource.id_setor,
            id_perfil=profile.id_perfil,
            codigo_perfil=profile.codigo,
            id_escopo=scope.id_escopo,
            codigo_escopo=scope.codigo_escopo,
            tipo_escopo=scope.tipo_escopo,
            id_setor=scope.id_setor,
            id_localidade=scope.id_localidade,
        )
        for permission, resource, profile, _, scope in rows
    )


def _scope_matches(
    grant: EffectiveGrant,
    *,
    id_setor: int | None,
    id_localidade: int | None,
) -> bool:
    """Confere um alvo solicitado com a concessão e o setor dono do recurso."""
    if (
        grant.resource_id_setor is not None
        and id_setor is not None
        and grant.resource_id_setor != id_setor
    ):
        return False

    target_sector = id_setor or grant.resource_id_setor
    if grant.tipo_escopo == "GLOBAL":
        return True

    if grant.tipo_escopo in {"SETOR", "SETOR_LOCALIDADE"}:
        if target_sector is not None and grant.id_setor != target_sector:
            return False
        if (
            grant.tipo_escopo == "SETOR"
            and id_localidade is not None
            and target_sector is None
        ):
            return False

    if grant.tipo_escopo in {"LOCALIDADE", "SETOR_LOCALIDADE"}:
        if id_localidade is not None and grant.id_localidade != id_localidade:
            return False

    return True


def require_permission(
    db: Session,
    *,
    id_usuario: int,
    permission_code: str,
) -> AuthorizationContext:
    """Exige uma permissão efetiva, sem confiar em dados enviados pelo cliente."""
    grants = tuple(
        grant
        for grant in _load_effective_grants(db, id_usuario)
        if grant.permission_code == permission_code
    )
    if not grants:
        raise PermissionDeniedError("Permissão não concedida.")
    return AuthorizationContext(
        id_usuario=id_usuario,
        permission_code=permission_code,
        grants=grants,
    )


def require_scope(
    access: AuthorizationContext,
    *,
    id_setor: int | None = None,
    id_localidade: int | None = None,
) -> AuthorizationContext:
    """Exige que a permissão também cubra o setor/localidade solicitados."""
    grants = tuple(
        grant
        for grant in access.grants
        if _scope_matches(
            grant,
            id_setor=id_setor,
            id_localidade=id_localidade,
        )
    )
    if not grants:
        raise PermissionDeniedError("Setor ou localidade fora do seu escopo.")
    return AuthorizationContext(
        id_usuario=access.id_usuario,
        permission_code=access.permission_code,
        grants=grants,
    )


def allowed_locality_ids(access: AuthorizationContext) -> set[int] | None:
    """Retorna localidades permitidas; None significa escopo global ou por setor."""
    if any(grant.tipo_escopo in {"GLOBAL", "SETOR"} for grant in access.grants):
        return None
    return {
        grant.id_localidade
        for grant in access.grants
        if grant.id_localidade is not None
    }


def allowed_sector_ids(access: AuthorizationContext) -> set[int] | None:
    """Retorna setores permitidos; None representa concessão global explícita."""
    if any(grant.tipo_escopo == "GLOBAL" for grant in access.grants):
        return None
    sectors = {
        sector_id
        for grant in access.grants
        for sector_id in (grant.id_setor, grant.resource_id_setor)
        if sector_id is not None
    }
    return sectors


def scope_pairs(access: AuthorizationContext) -> tuple[tuple[int | None, int | None], ...]:
    """Converte concessões em pares de setor/localidade para filtros SQL."""
    pairs: set[tuple[int | None, int | None]] = set()
    for grant in access.grants:
        resource_sector = grant.resource_id_setor
        if (
            resource_sector is not None
            and grant.id_setor is not None
            and grant.id_setor != resource_sector
        ):
            continue

        if grant.tipo_escopo == "GLOBAL":
            pairs.add((resource_sector, None))
        elif grant.tipo_escopo == "SETOR":
            pairs.add((grant.id_setor, None))
        elif grant.tipo_escopo == "LOCALIDADE":
            pairs.add((resource_sector, grant.id_localidade))
        elif grant.tipo_escopo == "SETOR_LOCALIDADE":
            pairs.add((grant.id_setor, grant.id_localidade))
    return tuple(sorted(pairs, key=lambda pair: (pair[0] or 0, pair[1] or 0)))


def build_me_response(
    db: Session,
    *,
    user: AuthenticatedUser,
) -> MeResponse:
    """Retorna identidade e capacidades derivadas das concessões vigentes."""
    grants = _load_effective_grants(db, user.id_usuario)
    permissions = sorted({grant.permission_code for grant in grants})
    grouped: dict[
        tuple[int, str, str, int | None, int | None, int, str], set[str]
    ] = {}

    for grant in grants:
        key = (
            grant.id_escopo,
            grant.codigo_escopo,
            grant.tipo_escopo,
            grant.id_setor,
            grant.id_localidade,
            grant.id_perfil,
            grant.codigo_perfil,
        )
        grouped.setdefault(key, set()).add(grant.permission_code)

    scopes = [
        AccessScopeSummary(
            id_escopo=scope_id,
            codigo_escopo=scope_code,
            tipo_escopo=scope_type,
            id_setor=sector_id,
            id_localidade=locality_id,
            id_perfil=profile_id,
            codigo_perfil=profile_code,
            permissions=sorted(scope_permissions),
        )
        for (
            scope_id,
            scope_code,
            scope_type,
            sector_id,
            locality_id,
            profile_id,
            profile_code,
        ), scope_permissions in sorted(grouped.items())
    ]
    return MeResponse(user=user, permissions=permissions, scopes=scopes)


def list_profiles(
    db: Session,
    *,
    include_inactive: bool = False,
    id_usuario_ator: int,
) -> list[ProfileSummary]:
    try:
        profiles = repository.list_profiles(db, include_inactive=include_inactive)
        profiles = [
            profile
            for profile in profiles
            if _can_assign_profile(
                db,
                id_usuario_ator=id_usuario_ator,
                target_profile_code=profile.codigo,
            )
        ]
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc
    return [ProfileSummary.model_validate(profile) for profile in profiles]


def list_profile_permissions(
    db: Session,
    *,
    id_perfil: int,
) -> list[PermissionSummary]:
    try:
        if repository.get_profile(db, id_perfil=id_perfil) is None:
            raise NotFoundError("Perfil não encontrado.")
        rows = repository.list_profile_permission_rows(db, id_perfil=id_perfil)
        return [
            PermissionSummary(
                id_permissao=permission.id_permissao,
                id_recurso=resource.id_recurso,
                codigo_recurso=resource.codigo,
                codigo=permission.codigo,
                acao=permission.acao,
                descricao=permission.descricao,
                ativo=permission.ativo,
            )
            for permission, resource in rows
        ]
    except APIError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_resources(
    db: Session,
    *,
    include_inactive: bool = False,
) -> list[ResourceSummary]:
    try:
        resources = repository.list_resources(db, include_inactive=include_inactive)
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc
    return [ResourceSummary.model_validate(resource) for resource in resources]


def list_permissions(
    db: Session,
    *,
    include_inactive: bool = False,
) -> list[PermissionSummary]:
    try:
        rows = repository.list_permissions(db, include_inactive=include_inactive)
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc
    return [
        PermissionSummary(
            id_permissao=permission.id_permissao,
            id_recurso=resource.id_recurso,
            codigo_recurso=resource.codigo,
            codigo=permission.codigo,
            acao=permission.acao,
            descricao=permission.descricao,
            ativo=permission.ativo,
        )
        for permission, resource in rows
    ]


def _add_definition_event(
    db: Session,
    *,
    tipo_evento: str,
    id_usuario_ator: int,
    id_perfil: int | None = None,
    id_permissao: int | None = None,
    id_recurso: int | None = None,
    motivo: str | None = None,
    detalhes: dict[str, object] | None = None,
) -> None:
    db.add(
        AutorizacaoEvento(
            tipo_evento=tipo_evento,
            id_usuario_ator=id_usuario_ator,
            id_perfil=id_perfil,
            id_permissao=id_permissao,
            id_recurso=id_recurso,
            ocorrido_em=_utc_now(),
            motivo=motivo,
            detalhes=detalhes,
        )
    )


def create_profile(
    db: Session,
    *,
    payload: ProfileCreateRequest,
    id_usuario_ator: int,
) -> ProfileSummary:
    now = _utc_now()
    try:
        if repository.profile_code_exists(db, codigo=payload.codigo):
            raise ConflictError("Já existe um perfil com esse código.")
        profile = Perfil(
            codigo=payload.codigo,
            nome=payload.nome,
            ativo=True,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(profile)
        db.flush()
        _add_definition_event(
            db,
            tipo_evento="PERFIL_CRIADO",
            id_usuario_ator=id_usuario_ator,
            id_perfil=profile.id_perfil,
            detalhes={"codigo": profile.codigo, "nome": profile.nome},
        )
        db.commit()
        return ProfileSummary.model_validate(profile)
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("O código do perfil já está cadastrado.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def update_profile(
    db: Session,
    *,
    id_perfil: int,
    payload: ProfileUpdateRequest,
    id_usuario_ator: int,
) -> ProfileSummary:
    now = _utc_now()
    changes = payload.model_dump(exclude_unset=True)
    try:
        profile = repository.get_profile_for_update(db, id_perfil=id_perfil)
        if profile is None:
            raise NotFoundError("Perfil não encontrado.")
        before = {name: getattr(profile, name) for name in changes}
        for name, value in changes.items():
            setattr(profile, name, value)
        profile.atualizado_em = now
        if "ativo" in changes and before["ativo"] != profile.ativo:
            event_type = "PERFIL_ATIVADO" if profile.ativo else "PERFIL_DESATIVADO"
        else:
            event_type = "PERFIL_ATUALIZADO"
        _add_definition_event(
            db,
            tipo_evento=event_type,
            id_usuario_ator=id_usuario_ator,
            id_perfil=profile.id_perfil,
            detalhes={
                "alteracoes": {
                    name: {"anterior": before[name], "novo": getattr(profile, name)}
                    for name in changes
                    if before[name] != getattr(profile, name)
                }
            },
        )
        db.commit()
        return ProfileSummary.model_validate(profile)
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def create_resource(
    db: Session,
    *,
    payload: ResourceCreateRequest,
    id_usuario_ator: int,
) -> ResourceSummary:
    now = _utc_now()
    try:
        if repository.resource_code_exists(db, codigo=payload.codigo):
            raise ConflictError("Já existe um recurso com esse código.")
        if payload.id_setor is not None and not repository.sector_is_active(
            db,
            id_setor=payload.id_setor,
        ):
            raise NotFoundError("Setor ativo não encontrado.")
        resource = Recurso(
            codigo=payload.codigo,
            nome=payload.nome,
            id_setor=payload.id_setor,
            ativo=True,
            criado_em=now,
        )
        db.add(resource)
        db.flush()
        _add_definition_event(
            db,
            tipo_evento="RECURSO_CRIADO",
            id_usuario_ator=id_usuario_ator,
            id_recurso=resource.id_recurso,
            detalhes={
                "codigo": resource.codigo,
                "nome": resource.nome,
                "id_setor": resource.id_setor,
            },
        )
        db.commit()
        return ResourceSummary.model_validate(resource)
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("O código do recurso já está cadastrado.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def update_resource(
    db: Session,
    *,
    id_recurso: int,
    payload: ResourceUpdateRequest,
    id_usuario_ator: int,
) -> ResourceSummary:
    changes = payload.model_dump(exclude_unset=True)
    try:
        resource = repository.get_resource_for_update(db, id_recurso=id_recurso)
        if resource is None:
            raise NotFoundError("Recurso não encontrado.")
        before = {name: getattr(resource, name) for name in changes}
        for name, value in changes.items():
            setattr(resource, name, value)
        if "ativo" in changes and before["ativo"] != resource.ativo:
            event_type = "RECURSO_ATIVADO" if resource.ativo else "RECURSO_DESATIVADO"
        else:
            event_type = "RECURSO_ATUALIZADO"
        _add_definition_event(
            db,
            tipo_evento=event_type,
            id_usuario_ator=id_usuario_ator,
            id_recurso=resource.id_recurso,
            detalhes={
                "alteracoes": {
                    name: {"anterior": before[name], "novo": getattr(resource, name)}
                    for name in changes
                    if before[name] != getattr(resource, name)
                }
            },
        )
        db.commit()
        return ResourceSummary.model_validate(resource)
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def create_permission(
    db: Session,
    *,
    payload: PermissionCreateRequest,
    id_usuario_ator: int,
) -> PermissionSummary:
    try:
        resource = repository.get_resource(db, id_recurso=payload.id_recurso)
        if resource is None or not resource.ativo:
            raise NotFoundError("Recurso ativo não encontrado.")
        if repository.permission_action_exists(
            db,
            id_recurso=resource.id_recurso,
            acao=payload.acao,
        ):
            raise ConflictError("Essa ação já está cadastrada no recurso.")
        permission = Permissao(
            id_recurso=resource.id_recurso,
            acao=payload.acao,
            codigo=f"{resource.codigo}:{payload.acao}",
            descricao=payload.descricao,
            ativo=True,
        )
        db.add(permission)
        db.flush()
        _add_definition_event(
            db,
            tipo_evento="PERMISSAO_CRIADA",
            id_usuario_ator=id_usuario_ator,
            id_permissao=permission.id_permissao,
            detalhes={
                "codigo": permission.codigo,
                "acao": permission.acao,
                "descricao": permission.descricao,
                "id_recurso": resource.id_recurso,
            },
        )
        db.commit()
        return PermissionSummary(
            id_permissao=permission.id_permissao,
            id_recurso=resource.id_recurso,
            codigo_recurso=resource.codigo,
            codigo=permission.codigo,
            acao=permission.acao,
            descricao=permission.descricao,
            ativo=permission.ativo,
        )
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A permissão já está cadastrada.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def update_permission(
    db: Session,
    *,
    id_permissao: int,
    payload: PermissionUpdateRequest,
    id_usuario_ator: int,
) -> PermissionSummary:
    changes = payload.model_dump(exclude_unset=True)
    try:
        permission = repository.get_permission_for_update(
            db,
            id_permissao=id_permissao,
        )
        if permission is None:
            raise NotFoundError("Permissão não encontrada.")
        resource = repository.get_resource(db, id_recurso=permission.id_recurso)
        if resource is None:
            raise NotFoundError("Recurso da permissão não encontrado.")
        before = {name: getattr(permission, name) for name in changes}
        for name, value in changes.items():
            setattr(permission, name, value)
        if "ativo" in changes and before["ativo"] != permission.ativo:
            event_type = "PERMISSAO_ATIVADA" if permission.ativo else "PERMISSAO_DESATIVADA"
        else:
            event_type = "PERMISSAO_ATUALIZADA"
        _add_definition_event(
            db,
            tipo_evento=event_type,
            id_usuario_ator=id_usuario_ator,
            id_permissao=permission.id_permissao,
            detalhes={
                "alteracoes": {
                    name: {"anterior": before[name], "novo": getattr(permission, name)}
                    for name in changes
                    if before[name] != getattr(permission, name)
                }
            },
        )
        db.commit()
        return PermissionSummary(
            id_permissao=permission.id_permissao,
            id_recurso=resource.id_recurso,
            codigo_recurso=resource.codigo,
            codigo=permission.codigo,
            acao=permission.acao,
            descricao=permission.descricao,
            ativo=permission.ativo,
        )
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_user_scope_grants(
    db: Session,
    *,
    id_usuario: int,
) -> list[UserScopeGrantResponse]:
    try:
        if repository.get_user(db, id_usuario=id_usuario) is None:
            raise NotFoundError("Usuário não encontrado.")
        rows = repository.list_user_scope_rows(db, id_usuario=id_usuario)
    except APIError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc
    return [
        _scope_grant_response(grant, profile, scope)
        for grant, profile, scope in rows
    ]


def list_user_accounts(
    db: Session,
    *,
    search: str | None,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> UserAccountPage:
    try:
        users, total = repository.list_users(
            db,
            search=search,
            include_inactive=include_inactive,
            limit=limit,
            offset=offset,
        )
        return UserAccountPage(
            items=[UserAccountSummary.model_validate(user) for user in users],
            total=total,
            limit=limit,
            offset=offset,
        )
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_scope_options(db: Session) -> AccessScopeOptions:
    try:
        sectors, localities = repository.list_scope_options(db)
        return AccessScopeOptions(
            setores=sectors,
            localidades=localities,
        )
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def create_user_account(
    db: Session,
    *,
    payload: UserAccountCreateRequest,
    id_usuario_ator: int,
) -> UserAccountCreated:
    now = _utc_now()
    initial_password = token_urlsafe(12)
    try:
        user = Usuario(
            username=payload.username,
            nome_completo=payload.nome_completo,
            ativo=True,
            criado_em=now,
            atualizado_em=now,
            hash_senha=hash_password(initial_password),
            senha_alterada_em=now,
            troca_senha_obrigatoria=True,
        )
        repository.create_user(db, user)
        _add_definition_event(
            db,
            tipo_evento="USUARIO_CRIADO",
            id_usuario_ator=id_usuario_ator,
            detalhes={"id_usuario": user.id_usuario},
        )
        initial_access = _grant_user_scope(
            db,
            id_usuario=user.id_usuario,
            id_usuario_ator=id_usuario_ator,
            payload=payload.acesso_inicial,
            now=now,
        )
        db.commit()
        return UserAccountCreated(
            **UserAccountSummary.model_validate(user).model_dump(),
            senha_inicial=initial_password,
            acesso_inicial=initial_access,
        )
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "Não foi possível criar a conta com esse usuário e acesso. Confira se o nome de usuário já existe."
        ) from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def reset_user_temporary_password(
    db: Session,
    *,
    id_usuario: int,
    id_usuario_ator: int,
) -> UserAccountCreated:
    """Substitui a senha e a revela apenas na resposta protegida desta operação."""
    if id_usuario == id_usuario_ator:
        raise ConflictError("Use a troca de senha da própria conta para alterar seu acesso.")

    now = _utc_now()
    temporary_password = token_urlsafe(12)
    try:
        user = repository.get_user_for_update(db, id_usuario=id_usuario)
        if user is None:
            raise NotFoundError("Conta não encontrada.")
        target_grants = repository.list_user_scope_rows(db, id_usuario=id_usuario)
        target_level = max(
            (
                _profile_level(profile.codigo)
                for grant, profile, _ in target_grants
                if grant.ativo
            ),
            default=-1,
        )
        if target_level > _administrator_level(db, id_usuario_ator):
            raise PermissionDeniedError(
                "Você não pode redefinir a senha de uma conta com perfil de administração superior."
            )
        if not user.ativo:
            raise ConflictError("Ative a conta antes de gerar uma nova senha temporária.")

        user.hash_senha = hash_password(temporary_password)
        user.senha_alterada_em = now
        user.troca_senha_obrigatoria = True
        user.atualizado_em = now
        revoke_user_sessions(db, id_usuario=user.id_usuario, revogado_em=now)
        _add_definition_event(
            db,
            tipo_evento="SENHA_TEMPORARIA_REDEFINIDA",
            id_usuario_ator=id_usuario_ator,
            detalhes={"id_usuario": user.id_usuario},
        )
        db.commit()
        return UserAccountCreated(
            **UserAccountSummary.model_validate(user).model_dump(),
            senha_inicial=temporary_password,
        )
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def update_user_account_status(
    db: Session,
    *,
    id_usuario: int,
    payload: UserAccountStatusRequest,
    id_usuario_ator: int,
) -> UserAccountSummary:
    now = _utc_now()
    if id_usuario == id_usuario_ator and not payload.ativo:
        raise ConflictError("Você não pode desativar a própria conta.")
    try:
        user = repository.get_user_for_update(db, id_usuario=id_usuario)
        if user is None:
            raise NotFoundError("Conta não encontrada.")
        target_grants = repository.list_user_scope_rows(db, id_usuario=id_usuario)
        target_level = max(
            (
                _profile_level(profile.codigo)
                for grant, profile, _ in target_grants
                if grant.ativo
            ),
            default=-1,
        )
        if target_level > _administrator_level(db, id_usuario_ator):
            raise PermissionDeniedError(
                "Você não pode alterar uma conta com perfil de administração superior."
            )
        if user.ativo != payload.ativo:
            user.ativo = payload.ativo
            user.atualizado_em = now
            event_type = "USUARIO_ATIVADO" if payload.ativo else "USUARIO_DESATIVADO"
            _add_definition_event(
                db,
                tipo_evento=event_type,
                id_usuario_ator=id_usuario_ator,
                motivo=payload.motivo if not payload.ativo else None,
                detalhes={
                    "id_usuario": user.id_usuario,
                    "motivo": payload.motivo if not payload.ativo else None,
                },
            )
            if not payload.ativo:
                revoke_user_sessions(db, id_usuario=user.id_usuario, revogado_em=now)
        db.commit()
        return UserAccountSummary.model_validate(user)
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def grant_user_scope(
    db: Session,
    *,
    id_usuario: int,
    id_usuario_ator: int,
    payload: UserScopeGrantRequest,
) -> UserScopeGrantResponse:
    now = _utc_now()
    try:
        result = _grant_user_scope(
            db,
            id_usuario=id_usuario,
            id_usuario_ator=id_usuario_ator,
            payload=payload,
            now=now,
        )
        db.commit()
        return result
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A concessão conflita com um registro existente.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def _grant_user_scope(
    db: Session,
    *,
    id_usuario: int,
    id_usuario_ator: int,
    payload: UserScopeGrantRequest,
    now: datetime,
) -> UserScopeGrantResponse:
    """Cria uma concessão na transação atual, sem confirmar a transação."""
    user = repository.get_user_for_update(db, id_usuario=id_usuario)
    profile = repository.get_profile(db, id_perfil=payload.id_perfil)
    if user is None:
        raise NotFoundError("Usuário não encontrado.")
    if not user.ativo:
        raise ConflictError("Não é possível conceder acesso a uma conta inativa.")
    if profile is None or not profile.ativo:
        raise NotFoundError("Perfil ativo não encontrado.")
    if not _can_assign_profile(
        db,
        id_usuario_ator=id_usuario_ator,
        target_profile_code=profile.codigo,
    ):
        raise PermissionDeniedError(
            "Você só pode conceder perfis do seu nível de administração ou abaixo."
        )
    if profile.codigo == "DEV" and payload.tipo_escopo != "GLOBAL":
        raise ConflictError("O perfil DEV exige escopo global.")

    if payload.id_setor is not None and not repository.sector_is_active(
        db,
        id_setor=payload.id_setor,
    ):
        raise NotFoundError("Setor ativo não encontrado.")
    if payload.id_localidade is not None and not repository.locality_is_active(
        db,
        id_localidade=payload.id_localidade,
    ):
        raise NotFoundError("Localidade ativa não encontrada.")

    code = _scope_code(
        tipo_escopo=payload.tipo_escopo,
        id_setor=payload.id_setor,
        id_localidade=payload.id_localidade,
    )
    scope = repository.get_scope_by_code(db, codigo_escopo=code)
    if scope is None:
        scope = Escopo(
            codigo_escopo=code,
            tipo_escopo=payload.tipo_escopo,
            id_setor=payload.id_setor,
            id_localidade=payload.id_localidade,
            ativo=True,
            criado_em=now,
        )
        db.add(scope)
        db.flush()
    elif not scope.ativo:
        scope.ativo = True

    if repository.get_overlapping_user_scope(
        db,
        id_usuario=id_usuario,
        id_perfil=payload.id_perfil,
        id_escopo=scope.id_escopo,
        vigente_desde=now,
        vigente_ate=None,
    ) is not None:
        raise ConflictError("Essa concessão já está ativa.")

    grant = UsuarioEscopo(
        id_usuario=id_usuario,
        id_perfil=profile.id_perfil,
        id_escopo=scope.id_escopo,
        ativo=True,
        vigente_desde=now,
        vigente_ate=None,
        concedido_por=id_usuario_ator,
        concedido_em=now,
    )
    db.add(grant)
    db.flush()
    db.add(
        AutorizacaoEvento(
            tipo_evento="USUARIO_ESCOPO_CONCEDIDO",
            id_usuario_ator=id_usuario_ator,
            id_usuario_escopo=grant.id_usuario_escopo,
            ocorrido_em=now,
        )
    )
    return _scope_grant_response(grant, profile, scope)


def revoke_user_scope(
    db: Session,
    *,
    id_usuario: int,
    id_usuario_escopo: int,
    id_usuario_ator: int,
    motivo: str,
) -> None:
    now = _utc_now()
    normalized_reason = motivo.strip()
    if not normalized_reason or len(normalized_reason) > 500:
        raise ConflictError("Informe um motivo de revogação com até 500 caracteres.")
    try:
        grant = repository.get_user_scope_for_update(
            db,
            id_usuario=id_usuario,
            id_usuario_escopo=id_usuario_escopo,
        )
        if grant is None:
            raise NotFoundError("Concessão de acesso não encontrada.")
        profile = repository.get_profile(db, id_perfil=grant.id_perfil)
        if profile is None:
            raise NotFoundError("Perfil da concessão não encontrado.")
        if _profile_level(profile.codigo) > _administrator_level(db, id_usuario_ator):
            raise PermissionDeniedError(
                "Você não pode revogar uma concessão de administração superior."
            )
        if not grant.ativo:
            db.rollback()
            return

        grant.ativo = False
        if grant.vigente_desde < now:
            end_at = now
            if grant.vigente_ate is not None:
                end_at = min(end_at, grant.vigente_ate)
            if end_at <= grant.vigente_desde:
                end_at = grant.vigente_desde + timedelta(microseconds=1)
            grant.vigente_ate = end_at

        db.add(
            AutorizacaoEvento(
                tipo_evento="USUARIO_ESCOPO_REVOGADO",
                id_usuario_ator=id_usuario_ator,
                id_usuario_escopo=grant.id_usuario_escopo,
                ocorrido_em=now,
                motivo=normalized_reason,
            )
        )
        db.commit()
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def grant_profile_permission(
    db: Session,
    *,
    id_perfil: int,
    id_permissao: int,
    id_usuario_ator: int,
) -> PermissionSummary:
    now = _utc_now()
    try:
        profile = repository.get_profile(db, id_perfil=id_perfil)
        permission_row = repository.get_active_permission(
            db,
            id_permissao=id_permissao,
        )
        if profile is None or not profile.ativo:
            raise NotFoundError("Perfil ativo não encontrado.")
        if permission_row is None:
            raise NotFoundError("Permissão ativa não encontrada.")
        permission, resource = permission_row
        if repository.profile_permission_exists(
            db,
            id_perfil=id_perfil,
            id_permissao=id_permissao,
        ):
            raise ConflictError("Essa permissão já foi concedida ao perfil.")

        db.add(
            PerfilPermissao(
                id_perfil=id_perfil,
                id_permissao=id_permissao,
                concedido_em=now,
                concedido_por=id_usuario_ator,
            )
        )
        db.add(
            AutorizacaoEvento(
                tipo_evento="PERFIL_PERMISSAO_CONCEDIDA",
                id_usuario_ator=id_usuario_ator,
                id_perfil=id_perfil,
                id_permissao=id_permissao,
                ocorrido_em=now,
            )
        )
        db.commit()
        return PermissionSummary(
            id_permissao=permission.id_permissao,
            id_recurso=resource.id_recurso,
            codigo_recurso=resource.codigo,
            codigo=permission.codigo,
            acao=permission.acao,
            descricao=permission.descricao,
            ativo=permission.ativo,
        )
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A permissão conflita com uma concessão existente.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def revoke_profile_permission(
    db: Session,
    *,
    id_perfil: int,
    id_permissao: int,
    id_usuario_ator: int,
    motivo: str,
) -> None:
    now = _utc_now()
    normalized_reason = motivo.strip()
    if not normalized_reason or len(normalized_reason) > 500:
        raise ConflictError("Informe um motivo de revogação com até 500 caracteres.")
    try:
        assignment = repository.get_profile_permission_for_update(
            db,
            id_perfil=id_perfil,
            id_permissao=id_permissao,
        )
        if assignment is None:
            raise NotFoundError("Permissão concedida ao perfil não encontrada.")
        db.delete(assignment)
        db.add(
            AutorizacaoEvento(
                tipo_evento="PERFIL_PERMISSAO_REVOGADA",
                id_usuario_ator=id_usuario_ator,
                id_perfil=id_perfil,
                id_permissao=id_permissao,
                ocorrido_em=now,
                motivo=normalized_reason,
            )
        )
        db.commit()
    except APIError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc
