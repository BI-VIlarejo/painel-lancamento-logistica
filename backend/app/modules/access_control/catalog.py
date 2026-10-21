"""Catálogo estável dos módulos e das ações protegidas pela API.

As rotas usam estes códigos como contrato. O bootstrap local também usa estas
definições para preparar os registros de autorização no banco. Os perfis comuns
usam concessões explícitas; DEV global recebe também todas as permissões ativas,
inclusive as cadastradas depois do bootstrap.
"""

from typing import Final


class PermissionCode:
    """Códigos de autorização exigidos por operações da API."""

    ACCESS_ADMIN: Final[str] = "CONTROLE_ACESSO:ADMINISTRAR"
    CATALOG_ADMIN: Final[str] = "CADASTROS:ADMINISTRAR"
    DELIVERY_VIEW: Final[str] = "ENTREGAS_DIARIAS:VER"
    DELIVERY_CREATE: Final[str] = "ENTREGAS_DIARIAS:CRIAR"
    DELIVERY_EDIT_DRAFT: Final[str] = "ENTREGAS_DIARIAS:EDITAR_RASCUNHO"
    DELIVERY_CORRECT: Final[str] = "ENTREGAS_DIARIAS:CORRIGIR"
    DELIVERY_CANCEL: Final[str] = "ENTREGAS_DIARIAS:CANCELAR"
    FEEDBACK_ACCESS: Final[str] = "FEEDBACK_CLIENTES:ACESSAR"
    FEEDBACK_VIEW: Final[str] = "FEEDBACK_CLIENTES:VER"
    FEEDBACK_CREATE: Final[str] = "FEEDBACK_CLIENTES:CRIAR"
    FEEDBACK_EXPORT: Final[str] = "FEEDBACK_CLIENTES:EXPORTAR"
    DASHBOARD_ACCESS: Final[str] = "PAINEL_GERENCIAL:ACESSAR"
    AUDIT_VIEW: Final[str] = "AUDITORIA:VER"


RESOURCE_DEFINITIONS: Final[tuple[tuple[str, str], ...]] = (
    ("CONTROLE_ACESSO", "Controle de acesso"),
    ("CADASTROS", "Cadastros operacionais"),
    ("ENTREGAS_DIARIAS", "Entregas diárias"),
    ("FEEDBACK_CLIENTES", "Reclamações e elogios"),
    ("PAINEL_GERENCIAL", "Painel gerencial"),
    ("AUDITORIA", "Auditoria administrativa"),
)

PERMISSION_DEFINITIONS: Final[tuple[tuple[str, str, str], ...]] = (
    ("CONTROLE_ACESSO", "ADMINISTRAR", "Administrar contas e acessos"),
    ("CADASTROS", "ADMINISTRAR", "Administrar lojas, pessoas e motivos"),
    ("ENTREGAS_DIARIAS", "VER", "Consultar lançamentos e catálogos"),
    ("ENTREGAS_DIARIAS", "CRIAR", "Criar lançamentos"),
    ("ENTREGAS_DIARIAS", "EDITAR_RASCUNHO", "Editar rascunhos"),
    ("ENTREGAS_DIARIAS", "CORRIGIR", "Criar uma revisão de correção"),
    ("ENTREGAS_DIARIAS", "CANCELAR", "Cancelar lançamentos confirmados"),
    ("FEEDBACK_CLIENTES", "ACESSAR", "Acessar reclamações e elogios"),
    ("FEEDBACK_CLIENTES", "VER", "Consultar manifestações de clientes"),
    ("FEEDBACK_CLIENTES", "CRIAR", "Registrar reclamações e elogios"),
    ("FEEDBACK_CLIENTES", "EXPORTAR", "Exportar manifestações de clientes"),
    ("PAINEL_GERENCIAL", "ACESSAR", "Consultar o painel gerencial"),
    ("AUDITORIA", "VER", "Consultar a trilha administrativa"),
)

BUILTIN_PERMISSION_CODES: Final[frozenset[str]] = frozenset(
    f"{resource}:{action}" for resource, action, _ in PERMISSION_DEFINITIONS
)

PROFILE_PERMISSION_CODES: Final[dict[str, frozenset[str]]] = {
    # Concessões conhecidas ficam explícitas no catálogo; em execução, DEV global
    # também recebe qualquer permissão ativa cadastrada no banco.
    "DEV": BUILTIN_PERMISSION_CODES,
    "GESTOR": BUILTIN_PERMISSION_CODES,
    "DIRETORIA": BUILTIN_PERMISSION_CODES,
    "OPERADOR": frozenset(
        {
            PermissionCode.DELIVERY_VIEW,
            PermissionCode.DELIVERY_CREATE,
            PermissionCode.DELIVERY_EDIT_DRAFT,
        }
    ),
}

# Um único tipo de lançamento está ativo. O nome fica provisoriamente como
# "Entregas" até a confirmação do nome definitivo do setor.
DELIVERY_SECTOR_CODE: Final[str] = "ENTREGAS"
DELIVERY_SECTOR_NAME: Final[str] = "Entregas"
