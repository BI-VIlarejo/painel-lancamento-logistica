"""Testes isolados do ciclo de troca de senha e sessões."""

from datetime import datetime, timedelta
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.exceptions import AuthenticationError
from app.core.orm import Base
from app.core.security import hash_password, verify_password
from app.model_registry import CORE_OPERATIONAL_TABLES  # noqa: F401
from app.modules.access_control.models import AutorizacaoEvento
from app.modules.auth.models import Usuario, UsuarioSessao
from app.modules.auth.service import change_password


class AuthServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.now = datetime(2026, 10, 21, 12, 0)
        self.old_password = "SenhaInicial#123"
        self.user = Usuario(
            id_usuario=1,
            username="dev",
            nome_completo="Usuário DEV",
            ativo=True,
            criado_em=self.now,
            atualizado_em=self.now,
            hash_senha=hash_password(self.old_password),
            senha_alterada_em=self.now,
            troca_senha_obrigatoria=True,
        )
        self.db.add_all(
            [
                self.user,
                UsuarioSessao(
                    id_sessao=10,
                    id_usuario=1,
                    hash_token="a" * 64,
                    criado_em=self.now,
                    expira_em=self.now + timedelta(hours=12),
                ),
                UsuarioSessao(
                    id_sessao=11,
                    id_usuario=1,
                    hash_token="b" * 64,
                    criado_em=self.now,
                    expira_em=self.now + timedelta(hours=12),
                ),
            ]
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_password_change_clears_first_login_revokes_sessions_and_is_audited(self) -> None:
        new_password = "SenhaNova#456"

        change_password(
            self.db,
            id_usuario=1,
            id_sessao_atual=11,
            senha_atual=self.old_password,
            nova_senha=new_password,
        )

        self.assertTrue(verify_password(new_password, self.user.hash_senha or ""))
        self.assertFalse(bool(self.user.troca_senha_obrigatoria))
        revoked_session = self.db.get(UsuarioSessao, 10)
        active_session = self.db.get(UsuarioSessao, 11)
        self.assertIsNotNone(revoked_session)
        self.assertIsNotNone(active_session)
        assert revoked_session is not None
        assert active_session is not None
        self.assertIsNotNone(revoked_session.revogado_em)
        self.assertIsNone(active_session.revogado_em)
        event = self.db.scalar(
            select(AutorizacaoEvento).where(
                AutorizacaoEvento.tipo_evento == "USUARIO_SENHA_ALTERADA"
            )
        )
        self.assertIsNotNone(event)

    def test_password_change_rejects_wrong_current_password_without_mutation(self) -> None:
        with self.assertRaises(AuthenticationError):
            change_password(
                self.db,
                id_usuario=1,
                id_sessao_atual=11,
                senha_atual="SenhaErrada#123",
                nova_senha="SenhaNova#456",
            )

        self.assertTrue(verify_password(self.old_password, self.user.hash_senha or ""))
        self.assertTrue(self.user.troca_senha_obrigatoria)
        self.assertIsNone(
            self.db.scalar(
                select(AutorizacaoEvento).where(
                    AutorizacaoEvento.tipo_evento == "USUARIO_SENHA_ALTERADA"
                )
            )
        )


if __name__ == "__main__":
    unittest.main()
