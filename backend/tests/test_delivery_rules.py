"""Testes unitários das validações que sustentam Entregas."""

from datetime import date, datetime
from decimal import Decimal
from unittest import TestCase
from uuid import uuid4

from pydantic import ValidationError

from app.modules.analytics.service import _percentage, _rate
from app.modules.catalogs.models import Localidade
from app.modules.deliveries import service as delivery_service
from app.modules.deliveries.models import (
    EntregaDiaria,
    FormularioVersao,
    Lancamento,
    LancamentoRevisao,
)
from app.modules.deliveries.schemas import (
    DeliveryItemInput,
    DeliveryLifecycleReasonRequest,
    DeliveryParticipantInput,
    DeliveryReasonInput,
    DeliveryDraftCreateRequest,
    DeliveryDraftUpdateRequest,
)
from tests.freight_support import access, database


class DeliveryRequestTests(TestCase):
    def test_customer_code_is_required_for_each_delivery_and_collection_occurrence(self):
        for request_type in (DeliveryDraftCreateRequest, DeliveryDraftUpdateRequest):
            for operation in ("ENTREGA", "COLETA"):
                for code in (None, "", "   "):
                    with self.subTest(request=request_type.__name__, operation=operation, code=code):
                        item = dict(
                            data_entrega="2026-11-03", id_localidade=1,
                            quantidade_realizada=1, quantidade_nao_realizada=int(operation == "ENTREGA"),
                            quantidade_coleta_nao_realizada=int(operation == "COLETA"),
                            peso_total_kg="10.250",
                            participantes=[dict(id_pessoa=10, papel_participante="MOTORISTA")],
                            motivos=[dict(id_motivo_nao_entrega=5, tipo_operacao=operation, codigo_cliente=code)],
                        )
                        with self.assertRaises(ValidationError):
                            request_type(itens=[item])
                        item["motivos"][0]["codigo_cliente"] = "  000123  "
                        request = request_type(itens=[item])
                        self.assertEqual(request.itens[0].motivos[0].codigo_cliente, "000123")

    def test_justification_is_trimmed_and_requires_content(self) -> None:
        request = DeliveryLifecycleReasonRequest(justificativa="  Ajuste de contagem  ")

        self.assertEqual(request.justificativa, "Ajuste de contagem")
        with self.assertRaises(ValidationError):
            DeliveryLifecycleReasonRequest(justificativa="     ")

    def test_item_requires_reasons_to_match_uncompleted_quantity(self) -> None:
        with self.assertRaises(ValidationError):
            DeliveryItemInput(
                data_entrega=date(2026, 10, 20),
                id_localidade=1,
                quantidade_realizada=4,
                quantidade_nao_realizada=2,
                participantes=[
                    DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
                ],
                motivos=[DeliveryReasonInput(id_motivo_nao_entrega=5)],
            )

    def test_same_item_accepts_delivery_and_collection_reason_occurrences(self) -> None:
        item = DeliveryItemInput(
            data_entrega=date(2026, 10, 20),
            id_localidade=1,
            quantidade_realizada=4,
            quantidade_nao_realizada=2,
            peso_total_kg="125.500",
            quantidade_coleta_realizada=1,
            quantidade_coleta_nao_realizada=2,
            participantes=[
                DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
            ],
            motivos=[
                DeliveryReasonInput(id_motivo_nao_entrega=5, tipo_operacao="ENTREGA", observacao="Entrega 1"),
                DeliveryReasonInput(id_motivo_nao_entrega=5, tipo_operacao="ENTREGA", observacao="Entrega 2"),
                DeliveryReasonInput(id_motivo_nao_entrega=5, tipo_operacao="COLETA", observacao="Coleta 1"),
                DeliveryReasonInput(id_motivo_nao_entrega=5, tipo_operacao="COLETA", observacao="Coleta 2"),
            ],
        )

        self.assertEqual(item.quantidade_realizada, 4)
        self.assertEqual(item.quantidade_coleta_realizada, 1)
        self.assertEqual(len(item.motivos), 4)
        self.assertEqual(
            [reason.tipo_operacao for reason in item.motivos],
            ["ENTREGA", "ENTREGA", "COLETA", "COLETA"],
        )
        self.assertEqual(
            [reason.observacao for reason in item.motivos],
            ["Entrega 1", "Entrega 2", "Coleta 1", "Coleta 2"],
        )

    def test_legacy_collection_row_is_normalized_into_collection_fields(self) -> None:
        item = DeliveryItemInput(
            tipo_operacao="COLETA",
            data_entrega=date(2026, 10, 20),
            id_localidade=1,
            quantidade_realizada=1,
            quantidade_nao_realizada=2,
            participantes=[
                DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
            ],
            motivos=[
                DeliveryReasonInput(id_motivo_nao_entrega=5, observacao="Coleta 1"),
                DeliveryReasonInput(id_motivo_nao_entrega=5, observacao="Coleta 2"),
            ],
        )

        self.assertEqual(item.tipo_operacao, "ENTREGA")
        self.assertEqual((item.quantidade_realizada, item.quantidade_nao_realizada), (0, 0))
        self.assertEqual((item.quantidade_coleta_realizada, item.quantidade_coleta_nao_realizada), (1, 2))
        self.assertEqual([reason.tipo_operacao for reason in item.motivos], ["COLETA", "COLETA"])

    def test_item_code_is_preserved_for_revision_lineage(self) -> None:
        item_code = uuid4()
        item = DeliveryItemInput(
            codigo_item_lancamento=item_code,
            data_entrega=date(2026, 10, 20),
            id_localidade=1,
            quantidade_realizada=4,
            quantidade_nao_realizada=0,
            peso_total_kg="10.000",
            participantes=[
                DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
            ],
        )

        self.assertEqual(item.codigo_item_lancamento, item_code)

    def test_new_delivery_request_requires_weight_and_collection_only_uses_zero(self) -> None:
        item = {
            "data_entrega": date(2026, 10, 20),
            "id_localidade": 1,
            "quantidade_realizada": 1,
            "quantidade_nao_realizada": 0,
            "quantidade_coleta_realizada": 0,
            "quantidade_coleta_nao_realizada": 0,
            "participantes": [
                DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
            ],
        }
        with self.assertRaises(ValidationError):
            DeliveryDraftCreateRequest(itens=[item])
        with self.assertRaises(ValidationError):
            DeliveryDraftCreateRequest(itens=[item | {"peso_total_kg": 0}])
        request = DeliveryDraftCreateRequest(itens=[item | {"peso_total_kg": "75.125"}])
        self.assertEqual(request.itens[0].peso_total_kg, Decimal("75.125"))

        collection = item | {
            "quantidade_realizada": 0,
            "quantidade_coleta_realizada": 1,
            "peso_total_kg": 0,
        }
        self.assertEqual(DeliveryDraftCreateRequest(itens=[collection]).itens[0].peso_total_kg, 0)
        with self.assertRaises(ValidationError):
            DeliveryDraftCreateRequest(itens=[collection | {"peso_total_kg": 1}])

    def test_request_rejects_legacy_otif_count_fields(self) -> None:
        base = {
            "data_entrega": date(2026, 10, 20),
            "id_localidade": 1,
            "quantidade_realizada": 4,
            "quantidade_nao_realizada": 0,
            "participantes": [
                DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
            ],
        }
        with self.assertRaises(ValidationError):
            DeliveryItemInput(
                **base,
                quantidade_entregas_no_prazo=3,
                quantidade_entregas_completas=3,
            )


class DashboardRuleTests(TestCase):
    def test_rate_uses_realized_over_total_registered(self) -> None:
        self.assertEqual(_rate(8, 2), 80.0)
        self.assertIsNone(_rate(0, 0))

    def test_otif_uses_not_completed_over_total_registered(self) -> None:
        self.assertEqual(_percentage(20, 100), 20.0)
        self.assertIsNone(_percentage(0, 0))


class DeliveryHistorySortingTests(TestCase):
    def test_list_drafts_sorts_by_delivery_date_asc_desc_and_creation(self) -> None:
        engine, db = database()
        try:
            now = datetime(2026, 11, 20, 10, 0, 0)
            db.add(
                Localidade(
                    id_localidade=1,
                    codigo_localidade="MACAE",
                    nome_localidade="Macaé",
                    tipo_localidade="LOJA",
                    cidade="Macaé",
                    uf="RJ",
                    ativo=True,
                    sincronizado_em=now,
                )
            )
            db.add(
                FormularioVersao(
                    id_formulario_versao=1,
                    id_setor=10,
                    codigo_formulario="ENTREGAS_DIARIAS",
                    versao=1,
                    hash_contrato="a" * 64,
                    status="PUBLICADO",
                    vigente_desde=datetime(2026, 1, 1, 0, 0, 0),
                    criado_por=1,
                    criado_em=now,
                    publicado_por=1,
                    publicado_em=now,
                )
            )
            fixtures = [
                (1, datetime(2026, 11, 20, 8, 0, 0), date(2026, 11, 15)),
                (2, datetime(2026, 11, 20, 9, 0, 0), date(2026, 11, 10)),
                (3, datetime(2026, 11, 20, 10, 0, 0), date(2026, 11, 18)),
            ]
            for launch_id, created_at, delivery_date in fixtures:
                launch = Lancamento(
                    id_lancamento=launch_id,
                    codigo_lancamento=str(uuid4()),
                    id_setor=10,
                    chave_idempotencia=str(uuid4()),
                    criado_por=1,
                    criado_em=created_at,
                    atualizado_em=created_at,
                )
                db.add(launch)
                db.flush()
                revision = LancamentoRevisao(
                    id_lancamento=launch.id_lancamento,
                    codigo_revisao=str(uuid4()),
                    id_formulario_versao=1,
                    numero_revisao=1,
                    chave_idempotencia=str(uuid4()),
                    estado="ENVIADA",
                    hash_conteudo="b" * 64,
                    criado_por=1,
                    criado_em=created_at,
                    enviado_por=1,
                    enviado_em=created_at,
                )
                db.add(revision)
                db.flush()
                db.add(
                    EntregaDiaria(
                        id_lancamento_revisao=revision.id_lancamento_revisao,
                        codigo_item_lancamento=str(uuid4()),
                        tipo_operacao="ENTREGA",
                        data_entrega=delivery_date,
                        id_localidade=1,
                        quantidade_realizada=5,
                        quantidade_nao_realizada=0,
                        quantidade_coleta_realizada=0,
                        quantidade_coleta_nao_realizada=0,
                        peso_total_kg=Decimal("10.000"),
                        criado_em=created_at,
                        atualizado_em=created_at,
                    )
                )
            db.commit()

            ctx = access("ENTREGAS_DIARIAS:VER")
            common_kwargs = dict(
                access=ctx,
                estado=None,
                data_de=None,
                data_ate=None,
                id_localidade=None,
                id_motorista=None,
                id_motivo_nao_entrega=None,
                grupo_motivo=None,
                tipo_operacao=None,
                criado_por=None,
                limit=50,
                offset=0,
            )

            desc_page = delivery_service.list_drafts(db, ordenacao="data_desc", **common_kwargs)
            self.assertEqual(
                [item.data_final for item in desc_page.items],
                [date(2026, 11, 18), date(2026, 11, 15), date(2026, 11, 10)],
            )

            asc_page = delivery_service.list_drafts(db, ordenacao="data_asc", **common_kwargs)
            self.assertEqual(
                [item.data_inicial for item in asc_page.items],
                [date(2026, 11, 10), date(2026, 11, 15), date(2026, 11, 18)],
            )

            created_page = delivery_service.list_drafts(db, ordenacao="criacao_desc", **common_kwargs)
            self.assertEqual(
                [item.data_final for item in created_page.items],
                [date(2026, 11, 18), date(2026, 11, 10), date(2026, 11, 15)],
            )
        finally:
            db.close()
            engine.dispose()

