"""Contratos de administração dos catálogos operacionais."""

import re
from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LocalityAdminItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_localidade: int
    codigo_localidade: str
    nome_localidade: str
    tipo_localidade: str
    cidade: str | None
    uf: str | None
    ativo: bool


LOCALITY_UF_CODES = {
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
    "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
    "RR", "SC", "SP", "SE", "TO",
}


def _normalize_locality_text(value: str) -> str:
    normalized = " ".join(value.split())
    if not normalized:
        raise ValueError("O campo é obrigatório.")
    return normalized


def _normalize_uf(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in LOCALITY_UF_CODES:
        raise ValueError("Informe uma UF brasileira válida com duas letras.")
    return normalized


class LocalityCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codigo_localidade: str = Field(min_length=1, max_length=60)
    nome_localidade: str = Field(min_length=1, max_length=160)
    tipo_localidade: Literal["LOJA", "CD", "OUTRO"]
    cidade: str = Field(min_length=1, max_length=120)
    uf: str = Field(min_length=2, max_length=2)

    @field_validator("codigo_localidade")
    @classmethod
    def normalize_locality_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{0,59}", normalized):
            raise ValueError("Use letras sem acento, números, hífen ou _ no código.")
        return normalized

    @field_validator("nome_localidade", "cidade")
    @classmethod
    def normalize_locality_text(cls, value: str) -> str:
        return _normalize_locality_text(value)

    @field_validator("uf")
    @classmethod
    def normalize_uf(cls, value: str) -> str:
        return _normalize_uf(value)


class LocalityUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nome_localidade: str = Field(min_length=1, max_length=160)
    tipo_localidade: Literal["LOJA", "CD", "OUTRO"]
    cidade: str = Field(min_length=1, max_length=120)
    uf: str = Field(min_length=2, max_length=2)

    @field_validator("nome_localidade", "cidade")
    @classmethod
    def normalize_locality_text(cls, value: str) -> str:
        return _normalize_locality_text(value)

    @field_validator("uf")
    @classmethod
    def normalize_uf(cls, value: str) -> str:
        return _normalize_uf(value)


class LocalityStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ativo: bool


class PersonAdminItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_pessoa: int
    codigo_pessoa: str
    nome_exibicao: str
    tipo_funcao: str
    tipo_transporte_entrega: Literal["PROPRIA", "TERCEIRIZADA"] | None
    ativo: bool
    vigente_desde: date
    vigente_ate: date | None
    sistema_origem: str | None
    codigo_pessoa_origem: str | None


class PersonCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codigo_pessoa: UUID | None = None
    nome_exibicao: str = Field(min_length=1, max_length=160)
    tipo_funcao: Literal["MOTORISTA", "AJUDANTE"]
    tipo_transporte_entrega: Literal["PROPRIA", "TERCEIRIZADA"]
    sistema_origem: str | None = Field(default=None, min_length=1, max_length=40)
    codigo_pessoa_origem: str | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("nome_exibicao")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("O nome é obrigatório.")
        return normalized

    @field_validator("sistema_origem", "codigo_pessoa_origem")
    @classmethod
    def normalize_optional_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_origin_pair(self) -> "PersonCreateRequest":
        if (self.sistema_origem is None) != (self.codigo_pessoa_origem is None):
            raise ValueError("Informe sistema e código de origem juntos.")
        return self


class PersonStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ativo: bool

    @model_validator(mode="after")
    def only_deactivate(self) -> "PersonStatusRequest":
        if self.ativo:
            raise ValueError("A reativação de pessoas não está disponível por esta ação.")
        return self


class ReasonAdminItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_motivo_nao_entrega: int
    codigo_motivo: str
    descricao_motivo: str
    grupo_motivo: Literal[
        "TRANSPORTE_PROPRIO",
        "TRANSPORTE_TERCEIRIZADO",
        "LOJA",
        "LOGISTICA",
    ] | None
    ativo: bool
    vigente_desde: date
    vigente_ate: date | None


class ReasonCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codigo_motivo: str | None = Field(default=None, min_length=2, max_length=40)
    descricao_motivo: str = Field(min_length=1, max_length=160)
    grupo_motivo: Literal[
        "TRANSPORTE_PROPRIO",
        "TRANSPORTE_TERCEIRIZADO",
        "LOJA",
        "LOGISTICA",
    ]

    @field_validator("codigo_motivo")
    @classmethod
    def normalize_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,39}", normalized):
            raise ValueError("Use letras sem acento, números e _; comece por uma letra.")
        return normalized

    @field_validator("descricao_motivo")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("A descrição é obrigatória.")
        return normalized


class ReasonStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ativo: bool

    @model_validator(mode="after")
    def only_deactivate(self) -> "ReasonStatusRequest":
        if self.ativo:
            raise ValueError("A reativação de motivos não está disponível por esta ação.")
        return self
