"""Testes de consulta para a trilha sem exposição de conteúdo livre."""

from datetime import date, datetime
from unittest import TestCase
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.orm import Base
from app.modules.access_control.models import AutorizacaoEvento
from app.modules.audit.repository import list_events
from app.modules.deliveries.models import LancamentoEvento
from app.modules.feedback.models import Feedback
from app.modules.auth.models import Usuario


class AuditRepositoryTests(TestCase):
    def test_paged_query_merges_sources_and_omits_free_text(self) -> None:
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(
            engine,
            tables=[
                AutorizacaoEvento.__table__,
                LancamentoEvento.__table__,
                Feedback.__table__,
                Usuario.__table__,
            ],
        )
        with Session(engine) as db:
            db.add_all(
                [
                    Usuario(
                        id_usuario=7,
                        username="operador",
                        nome_completo="Ana Operadora",
                        ativo=True,
                        criado_em=datetime(2026, 10, 1),
                        atualizado_em=datetime(2026, 10, 1),
                    ),
                    Usuario(
                        id_usuario=8,
                        username="admin",
                        nome_completo="Carlos Admin",
                        ativo=True,
                        criado_em=datetime(2026, 10, 1),
                        atualizado_em=datetime(2026, 10, 1),
                    ),
                    Usuario(
                        id_usuario=9,
                        username="suporte",
                        nome_completo="Beatriz Suporte",
                        ativo=True,
                        criado_em=datetime(2026, 10, 1),
                        atualizado_em=datetime(2026, 10, 1),
                    ),
                ]
            )
            db.add_all(
                [
                    LancamentoEvento(
                        id_evento=1,
                        id_lancamento=10,
                        id_lancamento_revisao=20,
                        chave_idempotencia=str(uuid4()),
                        tipo_evento="LANCAMENTO_CANCELADO",
                        estado_anterior="ENVIADA",
                        estado_novo="CANCELADA",
                        ator_usuario_id=7,
                        ocorrido_em=datetime(2026, 10, 21, 12, 0),
                        comentario="Justificativa confidencial",
                        campos_alterados={"estado": "CANCELADA"},
                    ),
                    AutorizacaoEvento(
                        id_evento_autorizacao=1,
                        tipo_evento="USUARIO_CRIADO",
                        id_usuario_ator=8,
                        ocorrido_em=datetime(2026, 10, 21, 11, 0),
                        motivo="Motivo privado",
                        detalhes={
                            "alvo_tipo": "USUARIO",
                            "id_usuario": 8,
                            "nome_completo": "Carlos Admin",
                            "username": "admin",
                        },
                    ),
                    Feedback(
                        id_feedback=1,
                        chave_idempotencia=str(uuid4()),
                        id_lancamento_revisao=20,
                        codigo_item_lancamento=str(uuid4()),
                        tipo="ELOGIO",
                        data_feedback=date(2026, 10, 21),
                        id_localidade=3,
                        id_entrega_diaria=30,
                        nome_cliente="Não deve ser exibido",
                        identificador_cliente=None,
                        relato="Relato confidencial",
                        criado_por=9,
                        criado_em=datetime(2026, 10, 21, 13, 0),
                        atualizado_em=datetime(2026, 10, 21, 13, 0),
                    ),
                ]
            )
            db.commit()

            rows, total = list_events(
                db,
                origem=None,
                tipo_evento=None,
                ator_usuario_id=None,
                ocorrido_de=None,
                ocorrido_ate=None,
                limit=2,
                offset=0,
            )
            next_page, next_total = list_events(
                db,
                origem=None,
                tipo_evento=None,
                ator_usuario_id=None,
                ocorrido_de=None,
                ocorrido_ate=None,
                limit=2,
                offset=2,
            )

        self.assertEqual(total, 3)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["origem"], "FEEDBACK")
        self.assertEqual(rows[0]["tipo_evento"], "FEEDBACK_CRIADO")
        self.assertEqual(rows[0]["ator_nome"], "Beatriz Suporte")
        self.assertEqual(rows[0]["ator_username"], "suporte")
        self.assertEqual(rows[1]["origem"], "ENTREGAS")
        self.assertEqual(rows[1]["ator_nome"], "Ana Operadora")
        self.assertEqual(rows[1]["ator_username"], "operador")
        self.assertNotIn("relato", rows[0])
        self.assertNotIn("nome_cliente", rows[0])
        self.assertNotIn("comentario", rows[1])

        self.assertEqual(next_total, 3)
        self.assertEqual(len(next_page), 1)
        self.assertEqual(next_page[0]["origem"], "ACESSOS")
        self.assertEqual(next_page[0]["ator_nome"], "Carlos Admin")
        self.assertEqual(next_page[0]["ator_username"], "admin")
        self.assertEqual(
            next_page[0]["alvo"], "Usuário · Carlos Admin (@admin)"
        )
        self.assertNotIn("motivo", next_page[0])
        self.assertNotIn("detalhes", next_page[0])
        engine.dispose()
