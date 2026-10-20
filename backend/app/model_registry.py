"""Registro dos modelos ORM do schema operacional do portal.

Importar este módulo registra as tabelas em Base.metadata. A classificação
entre núcleo e opcionais é apenas organizacional; a migration inicial do
schema compartilhado cria as tabelas-base definidas no DBML, com as evoluções
incrementais registradas na cadeia do VilarejoBI.
"""

from app.core.orm import Base
from app.modules.access_control import models as access_control_models  # noqa: F401
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.catalogs import models as catalog_models  # noqa: F401
from app.modules.deliveries import models as delivery_models  # noqa: F401
from app.modules.feedback import models as feedback_models  # noqa: F401
from app.modules.publication import models as publication_models  # noqa: F401

OPTIONAL_OPERATIONAL_TABLES = frozenset(
    {
        "op_logistica_tipo_feedback",
        "op_logistica_feedback",
        "op_logistica_feedback_participante",
        "op_logistica_publicacao",
        "op_logistica_publicacao_lancamento",
    }
)

CORE_OPERATIONAL_TABLES = frozenset(Base.metadata.tables) - OPTIONAL_OPERATIONAL_TABLES
