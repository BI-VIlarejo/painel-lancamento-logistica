"""Respostas públicas paginadas para as opções dos formulários."""

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

ItemT = TypeVar("ItemT", bound=BaseModel)


class CatalogPage(BaseModel, Generic[ItemT]):
    """Página estável com total para navegação de catálogos grandes."""

    items: list[ItemT]
    total: int
    limit: int
    offset: int


class SectorCatalogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_setor: int
    codigo: str
    nome: str


class LocalityCatalogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_localidade: int
    codigo_localidade: str
    nome_localidade: str
    tipo_localidade: str


class PersonCatalogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_pessoa: int
    nome_exibicao: str
    tipo_funcao: str
    tipo_transporte_entrega: str | None


class NonDeliveryReasonCatalogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_motivo_nao_entrega: int
    codigo_motivo: str
    descricao_motivo: str
    grupo_motivo: str | None
