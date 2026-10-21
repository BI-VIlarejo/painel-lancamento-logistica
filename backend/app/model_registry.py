"""Registro dos modelos ORM do schema operacional do portal.

Importar este módulo registra em Base.metadata as tabelas que o Portal usa.
O histórico de migrations pode conter tabelas de recursos adiados, removidas
por revisões incrementais sem reescrever migrations já aplicadas.
"""

from app.core.orm import Base
from app.modules.access_control import models as access_control_models  # noqa: F401
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.catalogs import models as catalog_models  # noqa: F401
from app.modules.deliveries import models as delivery_models  # noqa: F401
from app.modules.feedback import models as feedback_models  # noqa: F401

OPTIONAL_OPERATIONAL_TABLES = frozenset(
    {
        "op_logistica_feedback",
    }
)

CORE_OPERATIONAL_TABLES = frozenset(Base.metadata.tables) - OPTIONAL_OPERATIONAL_TABLES
