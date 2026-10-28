"""Integração do fluxo de feedback com SQLite isolado."""

from datetime import date, datetime
import unittest
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.exceptions import ConflictError
from app.core.orm import Base
from app.modules.access_control.service import AuthorizationContext, EffectiveGrant
from app.modules.auth.models import Usuario
from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa, Setor
from app.modules.analytics.service import get_dashboard
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaMotivo,
    EntregaParticipante,
    FormularioVersao,
    Lancamento,
    LancamentoRevisao,
)
from app.modules.feedback.models import Feedback
from app.modules.feedback.schemas import FeedbackCreateRequest
from app.modules.feedback.service import (
    create_feedback,
    list_delivery_items,
    list_feedbacks,
)
from app.modules.deliveries.service import (
    cancel_confirmed_launch,
    list_launch_events,
    start_correction_draft,
)


class FeedbackServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.now = datetime(2026, 10, 21, 12, 0)
        self.delivery_date = date(2026, 10, 20)
        self.launch_code = uuid4()
        self.revision_code = uuid4()
        self.item_code = uuid4()
        self._seed()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _seed(self) -> None:
        self.db.add_all(
            [
                Usuario(
                    id_usuario=1,
                    username="dev",
                    nome_completo="Usuário DEV",
                    ativo=True,
                    criado_em=self.now,
                    atualizado_em=self.now,
                    hash_senha="hash",
                    senha_alterada_em=self.now,
                    troca_senha_obrigatoria=False,
                ),
                Setor(
                    id_setor=2,
                    codigo="SUPORTE",
                    nome="Suporte",
                    ativo=True,
                    criado_em=self.now,
                    atualizado_em=self.now,
                ),
                Localidade(
                    id_localidade=3,
                    codigo_localidade="LOJA-3",
                    nome_localidade="Loja de teste",
                    tipo_localidade="LOJA",
                    ativo=True,
                    sincronizado_em=self.now,
                ),
                Pessoa(
                    id_pessoa=4,
                    codigo_pessoa=str(uuid4()),
                    sistema_origem="TESTE",
                    codigo_pessoa_origem="MOTORISTA-4",
                    nome_exibicao="Motorista de teste",
                    tipo_funcao="MOTORISTA",
                    ativo=True,
                    vigente_desde=date(2020, 1, 1),
                    vigente_ate=None,
                    criado_por=1,
                    criado_em=self.now,
                    atualizado_em=self.now,
                ),
                Pessoa(
                    id_pessoa=5,
                    codigo_pessoa=str(uuid4()),
                    sistema_origem="TESTE",
                    codigo_pessoa_origem="AJUDANTE-5",
                    nome_exibicao="Ajudante de teste",
                    tipo_funcao="AJUDANTE",
                    ativo=True,
                    vigente_desde=date(2020, 1, 1),
                    vigente_ate=None,
                    criado_por=1,
                    criado_em=self.now,
                    atualizado_em=self.now,
                ),
                FormularioVersao(
                    id_formulario_versao=6,
                    id_setor=2,
                    codigo_formulario="ENTREGAS_DIARIAS",
                    versao=1,
                    hash_contrato="a" * 64,
                    status="PUBLICADO",
                    vigente_desde=self.now,
                    vigente_ate=None,
                    criado_por=1,
                    criado_em=self.now,
                    publicado_por=1,
                    publicado_em=self.now,
                ),
                Lancamento(
                    id_lancamento=7,
                    codigo_lancamento=str(self.launch_code),
                    id_setor=2,
                    chave_idempotencia=str(uuid4()),
                    criado_por=1,
                    criado_em=self.now,
                    atualizado_em=self.now,
                ),
                LancamentoRevisao(
                    id_lancamento_revisao=8,
                    id_lancamento=7,
                    codigo_revisao=str(self.revision_code),
                    id_formulario_versao=6,
                    numero_revisao=1,
                    chave_idempotencia=str(uuid4()),
                    estado="ENVIADA",
                    hash_conteudo="b" * 64,
                    criado_por=1,
                    criado_em=self.now,
                    enviado_por=1,
                    enviado_em=self.now,
                    aprovado_por=None,
                    aprovado_em=None,
                    devolvido_por=None,
                    devolvido_em=None,
                ),
                EntregaDiaria(
                    id_entrega_diaria=9,
                    id_lancamento_revisao=8,
                    codigo_item_lancamento=str(self.item_code),
                    data_entrega=self.delivery_date,
                    id_localidade=3,
                    quantidade_realizada=12,
                    quantidade_nao_realizada=0,
                    quantidade_entregas_no_prazo=10,
                    quantidade_entregas_completas=9,
                    observacao=None,
                    criado_em=self.now,
                    atualizado_em=self.now,
                ),
                EntregaParticipante(
                    id_entrega_diaria=9,
                    id_pessoa=4,
                    papel_participante="MOTORISTA",
                    ordem=1,
                ),
                EntregaParticipante(
                    id_entrega_diaria=9,
                    id_pessoa=5,
                    papel_participante="AJUDANTE",
                    ordem=1,
                ),
            ]
        )
        self.db.commit()

    def _access(
        self,
        *,
        permission: str = "FEEDBACK_CLIENTES:CRIAR",
        scope_type: str = "GLOBAL",
        locality_id: int | None = None,
        sector_id: int | None = None,
    ) -> AuthorizationContext:
        grant = EffectiveGrant(
            permission_code=permission,
            resource_code="FEEDBACK_CLIENTES",
            action=permission.split(":", 1)[1],
            resource_id_setor=None,
            id_perfil=1,
            codigo_perfil="DEV",
            id_escopo=1,
            codigo_escopo=(
                "GLOBAL"
                if scope_type == "GLOBAL"
                else f"SETOR:{sector_id}"
                if scope_type == "SETOR"
                else f"LOCALIDADE:{locality_id}"
            ),
            tipo_escopo=scope_type,
            id_setor=sector_id,
            id_localidade=locality_id,
        )
        return AuthorizationContext(
            id_usuario=1,
            permission_code=permission,
            grants=(grant,),
        )

    def _payload(self) -> FeedbackCreateRequest:
        return FeedbackCreateRequest(
            data_feedback=date(2026, 10, 21),
            tipo="ELOGIO",
            nome_cliente="Cliente de teste",
            codigo_lancamento=self.launch_code,
            codigo_revisao=self.revision_code,
            codigo_item_lancamento=self.item_code,
            relato="Atendimento muito bom.",
        )

    def test_feedback_is_bound_to_visible_confirmed_delivery_and_retries_idempotently(self) -> None:
        access = self._access()
        options = list_delivery_items(
            self.db,
            data_entrega=self.delivery_date,
            id_localidade=3,
            access=access,
        )
        self.assertEqual(len(options), 1)
        self.assertEqual(options[0].participantes[0].nome_exibicao, "Motorista de teste")

        idempotency_key = uuid4()
        with self.assertLogs("lancamento.feedback", level="INFO") as log:
            created = create_feedback(
                self.db,
                payload=self._payload(),
                idempotency_key=idempotency_key,
                access=access,
            )
        repeated = create_feedback(
            self.db,
            payload=self._payload(),
            idempotency_key=idempotency_key,
            access=access,
        )
        self.assertNotIn("Atendimento muito bom", "\n".join(log.output))
        self.assertEqual(created.id_feedback, repeated.id_feedback)
        self.assertEqual(created.data_entrega, self.delivery_date)
        self.assertEqual(len(created.participantes), 2)
        self.assertEqual(created.nome_cliente, "Cliente de teste")

        record = self.db.scalar(select(Feedback))
        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.criado_por, 1)
        self.assertEqual(record.nome_cliente, "Cliente de teste")
        self.assertIsNone(record.identificador_cliente)

        second = create_feedback(
            self.db,
            payload=self._payload().model_copy(
                update={
                    "nome_cliente": "Segundo cliente",
                    "relato": "Segunda manifestação.",
                }
            ),
            idempotency_key=uuid4(),
            access=access,
        )
        self.assertNotEqual(created.id_feedback, second.id_feedback)
        self.assertEqual(second.codigo_item_lancamento, created.codigo_item_lancamento)

        page = list_feedbacks(
            self.db,
            access=self._access(permission="FEEDBACK_CLIENTES:VER"),
            query="Cliente de teste",
            tipo="ELOGIO",
            id_localidade=3,
            data_de=date(2026, 10, 21),
            data_ate=date(2026, 10, 21),
            limit=10,
            offset=0,
        )
        self.assertEqual(page.total, 1)
        self.assertEqual(page.items[0].nome_cliente, "Cliente de teste")
        self.assertEqual(page.items[0].relato, "Atendimento muito bom.")

        all_feedbacks = list_feedbacks(
            self.db,
            access=self._access(permission="FEEDBACK_CLIENTES:VER"),
            query=None,
            tipo=None,
            id_localidade=3,
            data_de=None,
            data_ate=None,
            limit=10,
            offset=0,
        )
        self.assertEqual(all_feedbacks.total, 2)
        self.assertEqual(
            {item.nome_cliente for item in all_feedbacks.items},
            {"Cliente de teste", "Segundo cliente"},
        )

    def test_idempotency_key_cannot_be_reused_with_different_feedback(self) -> None:
        idempotency_key = uuid4()
        create_feedback(
            self.db,
            payload=self._payload(),
            idempotency_key=idempotency_key,
            access=self._access(),
        )
        with self.assertRaises(ConflictError):
            create_feedback(
                self.db,
                payload=self._payload().model_copy(
                    update={"relato": "Relato diferente para a mesma chave."}
                ),
                idempotency_key=idempotency_key,
                access=self._access(),
            )

    def test_feedback_delivery_options_respect_locality_scope(self) -> None:
        out_of_scope = list_delivery_items(
            self.db,
            data_entrega=self.delivery_date,
            id_localidade=3,
            access=self._access(scope_type="LOCALIDADE", locality_id=99),
        )
        sector_scope = list_delivery_items(
            self.db,
            data_entrega=self.delivery_date,
            id_localidade=3,
            access=self._access(scope_type="SETOR", sector_id=2),
        )
        self.assertEqual(out_of_scope, [])
        self.assertEqual(len(sector_scope), 1)

    def test_dashboard_calculates_otif_for_legacy_rows(self) -> None:
        delivery = self.db.get(EntregaDiaria, 9)
        assert delivery is not None
        delivery.quantidade_entregas_no_prazo = None
        delivery.quantidade_entregas_completas = None
        self.db.commit()

        dashboard = get_dashboard(
            self.db,
            access=self._access(permission="PAINEL_GERENCIAL:ACESSAR"),
            data_de=self.delivery_date,
            data_ate=self.delivery_date,
            id_localidade=3,
        )
        self.assertEqual(dashboard.resumo.otif_percentual, 0.0)

    def test_dashboard_splits_operation_totals_from_one_shared_route_item(self) -> None:
        for person_id in (4, 5):
            person = self.db.get(Pessoa, person_id)
            assert person is not None
            person.tipo_transporte_entrega = "PROPRIA"
        delivery = self.db.get(EntregaDiaria, 9)
        assert delivery is not None
        delivery.quantidade_coleta_realizada = 5
        delivery.quantidade_coleta_nao_realizada = 2
        self.db.add_all(
            [
                MotivoNaoEntrega(
                    id_motivo_nao_entrega=11,
                    codigo_motivo="AVARIA",
                    descricao_motivo="Avaria",
                    grupo_motivo="LOJA",
                    ativo=True,
                    vigente_desde=date(2020, 1, 1),
                    vigente_ate=None,
                    criado_por=1,
                    criado_em=self.now,
                    atualizado_em=self.now,
                ),
                EntregaMotivo(
                    id_entrega_motivo=21,
                    id_entrega_diaria=9,
                    id_motivo_nao_entrega=11,
                    tipo_operacao="COLETA",
                    quantidade=1,
                    observacao="Primeiro item",
                ),
                EntregaMotivo(
                    id_entrega_motivo=22,
                    id_entrega_diaria=9,
                    id_motivo_nao_entrega=11,
                    tipo_operacao="COLETA",
                    quantidade=1,
                    observacao="Segundo item",
                ),
            ]
        )
        self.db.commit()

        dashboard = get_dashboard(
            self.db,
            access=self._access(permission="PAINEL_GERENCIAL:ACESSAR"),
            data_de=self.delivery_date,
            data_ate=self.delivery_date,
            id_localidade=3,
            tipo_transporte_entrega="PROPRIA",
        )

        self.assertEqual(dashboard.resumo.entregas_realizadas, 12)
        self.assertEqual(dashboard.resumo.entregas_nao_realizadas, 0)
        self.assertEqual(dashboard.resumo.coletas_realizadas, 5)
        self.assertEqual(dashboard.resumo.coletas_nao_realizadas, 2)
        self.assertEqual(dashboard.resumo.itens_planejados, 19)
        self.assertEqual(dashboard.resumo.otif_percentual, 10.53)
        self.assertEqual(dashboard.tipo_transporte_entrega, "PROPRIA")
        self.assertEqual(len(dashboard.por_motivo), 1)
        self.assertEqual(dashboard.por_motivo[0].tipo_operacao, "COLETA")
        self.assertEqual(dashboard.por_motivo[0].quantidade, 2)
        self.assertEqual(dashboard.por_grupo_motivo[0].grupo_motivo, "LOJA")
        self.assertEqual(dashboard.por_tipo_entrega[0].registros_entrega, 1)
        self.assertEqual(dashboard.por_tipo_entrega[0].registros_coleta, 1)

    def test_api_requires_and_normalizes_customer_name(self) -> None:
        payload = self._payload().model_dump()
        payload["nome_cliente"] = "  Cliente teste  "
        self.assertEqual(
            FeedbackCreateRequest.model_validate(payload).nome_cliente,
            "Cliente teste",
        )
        payload["nome_cliente"] = "   "
        with self.assertRaises(ValidationError):
            FeedbackCreateRequest.model_validate(payload)

    def test_correction_preserves_confirmed_revision_and_cancel_is_audited(self) -> None:
        create_feedback(
            self.db,
            payload=self._payload(),
            idempotency_key=uuid4(),
            access=self._access(),
        )
        access = self._access(permission="ENTREGAS_DIARIAS:CORRIGIR")
        idempotency_key = uuid4()
        correction = start_correction_draft(
            self.db,
            codigo_lancamento=self.launch_code,
            justificativa="Ajustar informação da rota",
            idempotency_key=idempotency_key,
            access=access,
        )
        retry = start_correction_draft(
            self.db,
            codigo_lancamento=self.launch_code,
            justificativa="Ajustar informação da rota",
            idempotency_key=idempotency_key,
            access=access,
        )
        self.assertEqual(correction.numero_revisao, 2)
        self.assertEqual(correction.estado, "RASCUNHO")
        self.assertEqual(retry.codigo_revisao, correction.codigo_revisao)
        self.assertEqual(correction.itens[0].codigo_item_lancamento, self.item_code)
        visible_dashboard = get_dashboard(
            self.db,
            access=self._access(permission="PAINEL_GERENCIAL:ACESSAR"),
            data_de=self.delivery_date,
            data_ate=date(2026, 10, 21),
            id_localidade=None,
        )
        self.assertEqual(visible_dashboard.resumo.lancamentos_registrados, 1)
        self.assertEqual(visible_dashboard.resumo.itens_planejados, 12)
        self.assertEqual(visible_dashboard.resumo.otif_percentual, 0.0)
        self.assertEqual(visible_dashboard.por_localidade[0].otif_percentual, 0.0)
        self.assertEqual(visible_dashboard.por_equipe[0].otif_percentual, 0.0)
        self.assertEqual(visible_dashboard.feedback.elogios, 1)
        people = {person.nome: person for person in visible_dashboard.por_pessoa}
        self.assertEqual(people["Motorista de teste"].itens_planejados, 12)
        self.assertEqual(people["Motorista de teste"].otif_percentual, 0.0)
        self.assertEqual(people["Motorista de teste"].score_atendimento, 1)
        self.assertEqual(people["Ajudante de teste"].itens_planejados, 12)
        self.assertEqual(people["Ajudante de teste"].otif_percentual, 0.0)
        self.assertEqual(people["Ajudante de teste"].score_atendimento, 1)

        cancel_confirmed_launch(
            self.db,
            codigo_lancamento=self.launch_code,
            justificativa="Registro duplicado no fechamento",
            idempotency_key=uuid4(),
            access=self._access(permission="ENTREGAS_DIARIAS:CANCELAR"),
        )
        events = list_launch_events(
            self.db,
            codigo_lancamento=self.launch_code,
            access=self._access(permission="ENTREGAS_DIARIAS:VER"),
        )
        self.assertEqual(events[-1].tipo_evento, "LANCAMENTO_CANCELADO")
        self.assertEqual(events[-1].comentario, "Registro duplicado no fechamento")
        cancelled_dashboard = get_dashboard(
            self.db,
            access=self._access(permission="PAINEL_GERENCIAL:ACESSAR"),
            data_de=self.delivery_date,
            data_ate=date(2026, 10, 21),
            id_localidade=None,
        )
        self.assertEqual(cancelled_dashboard.resumo.lancamentos_registrados, 0)
        self.assertEqual(cancelled_dashboard.feedback.elogios, 0)


if __name__ == "__main__":
    unittest.main()
