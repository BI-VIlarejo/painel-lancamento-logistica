"""Contratos públicos da autorização e administração de concessões."""

from datetime import datetime
from typing import Literal

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.modules.catalogs.schemas import LocalityCatalogItem, SectorCatalogItem

_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,59}$")


class AccessScopeSummary(BaseModel):
    """Perfil, escopo e permissões efetivas correspondentes para a navegação."""

    model_config = ConfigDict(extra="forbid")

    id_escopo: int
    codigo_escopo: str
    tipo_escopo: str
    id_setor: int | None
    id_localidade: int | None
    id_perfil: int
    codigo_perfil: str
    permissions: list[str]


class ProfileSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_perfil: int
    codigo: str
    nome: str
    ativo: bool


class ResourceSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_recurso: int
    codigo: str
    nome: str
    id_setor: int | None
    ativo: bool


class PermissionSummary(BaseModel):
    id_permissao: int
    id_recurso: int
    codigo_recurso: str
    codigo: str
    acao: str
    descricao: str
    ativo: bool


class ProfileCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codigo: str = Field(min_length=2, max_length=40)
    nome: str = Field(min_length=1, max_length=100)

    @field_validator("codigo")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not _CODE_PATTERN.fullmatch(normalized) or len(normalized) > 40:
            raise ValueError("Use letras, números e _; o código deve começar por letra.")
        return normalized

    @field_validator("nome")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("O nome é obrigatório.")
        return normalized


class ProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nome: str | None = Field(default=None, min_length=1, max_length=100)
    ativo: bool | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "ProfileUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("Informe ao menos um campo para atualizar.")
        for field_name in self.model_fields_set:
            value = getattr(self, field_name)
            if value is None:
                raise ValueError(f"O campo {field_name} não pode ser nulo.")
            if field_name == "nome":
                normalized = value.strip()
                if not normalized:
                    raise ValueError("O nome é obrigatório.")
                self.nome = normalized
        return self


class ResourceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codigo: str = Field(min_length=2, max_length=60)
    nome: str = Field(min_length=1, max_length=100)
    id_setor: int | None = Field(default=None, ge=1)

    @field_validator("codigo")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not _CODE_PATTERN.fullmatch(normalized):
            raise ValueError("Use letras, números e _; o código deve começar por letra.")
        return normalized

    @field_validator("nome")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("O nome é obrigatório.")
        return normalized


class ResourceUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nome: str | None = Field(default=None, min_length=1, max_length=100)
    ativo: bool | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "ResourceUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("Informe ao menos um campo para atualizar.")
        for field_name in self.model_fields_set:
            value = getattr(self, field_name)
            if value is None:
                raise ValueError(f"O campo {field_name} não pode ser nulo.")
            if field_name == "nome":
                normalized = value.strip()
                if not normalized:
                    raise ValueError("O nome é obrigatório.")
                self.nome = normalized
        return self


class PermissionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_recurso: int = Field(ge=1)
    acao: str = Field(min_length=2, max_length=39)
    descricao: str = Field(min_length=1, max_length=160)

    @field_validator("acao")
    @classmethod
    def normalize_action(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not _CODE_PATTERN.fullmatch(normalized) or len(normalized) > 39:
            raise ValueError("Use letras, números e _; a ação deve começar por letra.")
        return normalized

    @field_validator("descricao")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("A descrição é obrigatória.")
        return normalized


class PermissionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    descricao: str | None = Field(default=None, min_length=1, max_length=160)
    ativo: bool | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "PermissionUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("Informe ao menos um campo para atualizar.")
        for field_name in self.model_fields_set:
            value = getattr(self, field_name)
            if value is None:
                raise ValueError(f"O campo {field_name} não pode ser nulo.")
            if field_name == "descricao":
                normalized = value.strip()
                if not normalized:
                    raise ValueError("A descrição é obrigatória.")
                self.descricao = normalized
        return self


class UserScopeGrantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_perfil: int
    tipo_escopo: Literal["GLOBAL", "SETOR", "LOCALIDADE", "SETOR_LOCALIDADE"]
    id_setor: int | None = None
    id_localidade: int | None = None

    @model_validator(mode="after")
    def validate_scope_target(self) -> "UserScopeGrantRequest":
        expected_targets = {
            "GLOBAL": (False, False),
            "SETOR": (True, False),
            "LOCALIDADE": (False, True),
            "SETOR_LOCALIDADE": (True, True),
        }
        needs_sector, needs_locality = expected_targets[self.tipo_escopo]
        if (self.id_setor is not None) != needs_sector:
            raise ValueError("O id_setor não corresponde ao tipo_escopo.")
        if (self.id_localidade is not None) != needs_locality:
            raise ValueError("O id_localidade não corresponde ao tipo_escopo.")
        if self.id_perfil < 1 or (self.id_setor is not None and self.id_setor < 1):
            raise ValueError("Os identificadores devem ser positivos.")
        if self.id_localidade is not None and self.id_localidade < 1:
            raise ValueError("Os identificadores devem ser positivos.")
        return self


class UserScopeGrantResponse(BaseModel):
    id_usuario_escopo: int
    id_usuario: int
    id_perfil: int
    codigo_perfil: str
    nome_perfil: str
    id_escopo: int
    codigo_escopo: str
    tipo_escopo: str
    id_setor: int | None
    id_localidade: int | None
    ativo: bool
    vigente_desde: datetime
    vigente_ate: datetime | None
    concedido_por: int
    concedido_em: datetime


class UserAccountSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_usuario: int
    username: str
    nome_completo: str
    ativo: bool
    troca_senha_obrigatoria: bool | None = False
    criado_em: datetime
    ultimo_login_em: datetime | None

    @field_validator("troca_senha_obrigatoria", mode="before")
    @classmethod
    def no_first_login_password_gate(cls, _value: object) -> bool:
        """Mantém o campo legado na API sem sinalizar exigência de troca."""
        return False


class UserAccountCreated(UserAccountSummary):
    """Resposta de criação com credencial inicial exibida uma única vez."""

    senha_inicial: str
    acesso_inicial: UserScopeGrantResponse | None = None


class UserAccountPage(BaseModel):
    items: list[UserAccountSummary]
    total: int
    limit: int
    offset: int


class UserAccountCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=80)
    nome_completo: str = Field(min_length=1, max_length=160)
    acesso_inicial: UserScopeGrantRequest

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized or not re.fullmatch(r"[a-z0-9._-]{1,80}", normalized):
            raise ValueError("Use letras sem acento, números, ponto, hífen ou _. ")
        return normalized

    @field_validator("nome_completo")
    @classmethod
    def normalize_full_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("O nome completo é obrigatório.")
        return normalized


class UserAccountIdentityUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str | None = Field(default=None, min_length=1, max_length=80)
    nome_completo: str | None = Field(default=None, min_length=1, max_length=160)

    @model_validator(mode="after")
    def normalize_identity(self) -> "UserAccountIdentityUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("Informe o nome ou o usuário para atualizar.")
        if "username" in self.model_fields_set:
            if self.username is None:
                raise ValueError("O nome de usuário não pode ser nulo.")
            username = self.username.strip().lower()
            if not re.fullmatch(r"[a-z0-9._-]{1,80}", username):
                raise ValueError("Use letras sem acento, números, ponto, hífen ou _ no usuário.")
            self.username = username
        if "nome_completo" in self.model_fields_set:
            if self.nome_completo is None:
                raise ValueError("O nome completo não pode ser nulo.")
            full_name = " ".join(self.nome_completo.split())
            if not full_name:
                raise ValueError("O nome completo é obrigatório.")
            self.nome_completo = full_name
        return self


class UserAccountStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ativo: bool
    motivo: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_reason(self) -> "UserAccountStatusRequest":
        if self.motivo is not None:
            self.motivo = self.motivo.strip()
        if not self.ativo and not self.motivo:
            raise ValueError("Informe o motivo para desativar a conta.")
        return self


class AccessScopeOptions(BaseModel):
    setores: list[SectorCatalogItem]
    localidades: list[LocalityCatalogItem]


class ProfilePermissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_permissao: int


class RevocationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    motivo: str

    @model_validator(mode="after")
    def normalize_reason(self) -> "RevocationRequest":
        normalized = self.motivo.strip()
        if not normalized or len(normalized) > 500:
            raise ValueError("Informe um motivo com até 500 caracteres.")
        self.motivo = normalized
        return self
