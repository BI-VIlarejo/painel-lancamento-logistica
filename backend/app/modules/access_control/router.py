"""Endpoints administrativos de perfis, permissões e escopos."""

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.exceptions import PermissionDeniedError
from app.api.v1.dependencies import (
    CsrfProtectedAuth,
    DatabaseSession,
    require_global_permission,
)
from app.modules.access_control import service
from app.modules.access_control.catalog import PermissionCode
from app.modules.access_control.schemas import (
    PermissionCreateRequest,
    PermissionSummary,
    PermissionUpdateRequest,
    ProfileCreateRequest,
    ProfilePermissionRequest,
    ProfileSummary,
    ProfileUpdateRequest,
    RevocationRequest,
    ResourceCreateRequest,
    ResourceSummary,
    ResourceUpdateRequest,
    UserScopeGrantRequest,
    UserScopeGrantResponse,
    UserAccountCreateRequest,
    UserAccountCreated,
    UserAccountIdentityUpdateRequest,
    UserAccountPage,
    UserAccountStatusRequest,
    UserAccountSummary,
    AccessScopeOptions,
)
from app.modules.access_control.service import AuthorizationContext

router = APIRouter(prefix="/access", tags=["Controle de acesso"])
_admin_access = require_global_permission(PermissionCode.ACCESS_ADMIN)

def _require_dev_global(
    access: AuthorizationContext = Depends(_admin_access),
) -> AuthorizationContext:
    if not any(
        grant.codigo_perfil == "DEV" and grant.tipo_escopo == "GLOBAL"
        for grant in access.grants
    ):
        raise PermissionDeniedError(
            "Somente uma conta DEV global pode alterar definições de perfis e permissões."
        )
    return access

_dev_access = _require_dev_global

@router.get("/users", response_model=UserAccountPage)
def get_users(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
    busca: str | None = Query(default=None, max_length=120),
    incluir_inativos: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> UserAccountPage:
    response.headers["Cache-Control"] = "no-store"
    return service.list_user_accounts(
        db,
        search=busca,
        include_inactive=incluir_inativos,
        limit=limit,
        offset=offset,
    )

@router.post(
    "/users",
    response_model=UserAccountCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_user(
    payload: UserAccountCreateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
) -> UserAccountCreated:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return service.create_user_account(
        db,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.post("/users/{id_usuario}/temporary-password", response_model=UserAccountCreated)
def reset_user_temporary_password(
    id_usuario: int,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
) -> UserAccountCreated:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return service.reset_user_temporary_password(
        db,
        id_usuario=id_usuario,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.patch("/users/{id_usuario}", response_model=UserAccountSummary)
def update_user(
    id_usuario: int,
    payload: UserAccountStatusRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_admin_access),
) -> UserAccountSummary:
    return service.update_user_account_status(
        db,
        id_usuario=id_usuario,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.patch("/users/{id_usuario}/identity", response_model=UserAccountSummary)
def update_user_identity(
    id_usuario: int,
    payload: UserAccountIdentityUpdateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_admin_access),
) -> UserAccountSummary:
    return service.update_user_account_identity(
        db,
        id_usuario=id_usuario,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.get("/scope-options", response_model=AccessScopeOptions)
def get_scope_options(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
) -> AccessScopeOptions:
    response.headers["Cache-Control"] = "no-store"
    return service.list_scope_options(db)

@router.get("/profiles", response_model=list[ProfileSummary])
def get_profiles(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
    incluir_inativos: bool = Query(default=False),
) -> list[ProfileSummary]:
    response.headers["Cache-Control"] = "no-store"
    return service.list_profiles(
        db,
        include_inactive=incluir_inativos,
        id_usuario_ator=access.id_usuario,
    )

@router.get(
    "/profiles/{id_perfil}/permissions",
    response_model=list[PermissionSummary],
)
def get_profile_permissions(
    id_perfil: int,
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
) -> list[PermissionSummary]:
    response.headers["Cache-Control"] = "no-store"
    return service.list_profile_permissions(db, id_perfil=id_perfil)

@router.post(
    "/profiles",
    response_model=ProfileSummary,
    status_code=status.HTTP_201_CREATED,
)
def create_profile(
    payload: ProfileCreateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_dev_access),
) -> ProfileSummary:
    return service.create_profile(
        db,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.patch("/profiles/{id_perfil}", response_model=ProfileSummary)
def update_profile(
    id_perfil: int,
    payload: ProfileUpdateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_dev_access),
) -> ProfileSummary:
    return service.update_profile(
        db,
        id_perfil=id_perfil,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.get("/resources", response_model=list[ResourceSummary])
def get_resources(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
    incluir_inativos: bool = Query(default=False),
) -> list[ResourceSummary]:
    response.headers["Cache-Control"] = "no-store"
    return service.list_resources(db, include_inactive=incluir_inativos)

@router.post(
    "/resources",
    response_model=ResourceSummary,
    status_code=status.HTTP_201_CREATED,
)
def create_resource(
    payload: ResourceCreateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_dev_access),
) -> ResourceSummary:
    return service.create_resource(
        db,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.patch("/resources/{id_recurso}", response_model=ResourceSummary)
def update_resource(
    id_recurso: int,
    payload: ResourceUpdateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_dev_access),
) -> ResourceSummary:
    return service.update_resource(
        db,
        id_recurso=id_recurso,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.get("/permissions", response_model=list[PermissionSummary])
def get_permissions(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
    incluir_inativos: bool = Query(default=False),
) -> list[PermissionSummary]:
    response.headers["Cache-Control"] = "no-store"
    return service.list_permissions(db, include_inactive=incluir_inativos)

@router.post(
    "/permissions",
    response_model=PermissionSummary,
    status_code=status.HTTP_201_CREATED,
)
def create_permission(
    payload: PermissionCreateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_dev_access),
) -> PermissionSummary:
    return service.create_permission(
        db,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.patch("/permissions/{id_permissao}", response_model=PermissionSummary)
def update_permission(
    id_permissao: int,
    payload: PermissionUpdateRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_dev_access),
) -> PermissionSummary:
    return service.update_permission(
        db,
        id_permissao=id_permissao,
        payload=payload,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.get(
    "/users/{id_usuario}/scopes",
    response_model=list[UserScopeGrantResponse],
)
def get_user_scopes(
    id_usuario: int,
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_admin_access),
) -> list[UserScopeGrantResponse]:
    response.headers["Cache-Control"] = "no-store"
    return service.list_user_scope_grants(db, id_usuario=id_usuario)

@router.post(
    "/users/{id_usuario}/scopes",
    response_model=UserScopeGrantResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_scope(
    id_usuario: int,
    payload: UserScopeGrantRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_admin_access),
) -> UserScopeGrantResponse:
    return service.grant_user_scope(
        db,
        id_usuario=id_usuario,
        id_usuario_ator=auth.user.id_usuario,
        payload=payload,
    )

@router.delete(
    "/users/{id_usuario}/scopes/{id_usuario_escopo}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def delete_user_scope(
    id_usuario: int,
    id_usuario_escopo: int,
    payload: RevocationRequest,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_admin_access),
) -> Response:
    service.revoke_user_scope(
        db,
        id_usuario=id_usuario,
        id_usuario_escopo=id_usuario_escopo,
        id_usuario_ator=auth.user.id_usuario,
        motivo=payload.motivo,
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response

@router.post(
    "/profiles/{id_perfil}/permissions",
    response_model=PermissionSummary,
    status_code=status.HTTP_201_CREATED,
)
def create_profile_permission(
    id_perfil: int,
    payload: ProfilePermissionRequest,
    db: DatabaseSession,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_dev_access),
) -> PermissionSummary:
    return service.grant_profile_permission(
        db,
        id_perfil=id_perfil,
        id_permissao=payload.id_permissao,
        id_usuario_ator=auth.user.id_usuario,
    )

@router.delete(
    "/profiles/{id_perfil}/permissions/{id_permissao}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def delete_profile_permission(
    id_perfil: int,
    id_permissao: int,
    payload: RevocationRequest,
    db: DatabaseSession,
    response: Response,
    auth: CsrfProtectedAuth,
    access: AuthorizationContext = Depends(_dev_access),
) -> Response:
    service.revoke_profile_permission(
        db,
        id_perfil=id_perfil,
        id_permissao=id_permissao,
        id_usuario_ator=auth.user.id_usuario,
        motivo=payload.motivo,
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
