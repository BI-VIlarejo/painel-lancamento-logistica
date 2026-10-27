"""Testes unitários das validações que sustentam Entregas."""

from datetime import date
from unittest import TestCase
from uuid import uuid4

from pydantic import ValidationError

from app.modules.analytics.service import _percentage, _rate
from app.modules.deliveries.schemas import (
    DeliveryItemInput,
    DeliveryLifecycleReasonRequest,
    DeliveryParticipantInput,
    DeliveryReasonInput,
)


class DeliveryRequestTests(TestCase):
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

    def test_collection_accepts_individual_repeated_reason_occurrences(self) -> None:
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
                DeliveryReasonInput(id_motivo_nao_entrega=5, observacao="Item 1"),
                DeliveryReasonInput(id_motivo_nao_entrega=5, observacao="Item 2"),
            ],
        )

        self.assertEqual(item.tipo_operacao, "COLETA")
        self.assertEqual(len(item.motivos), 2)
        self.assertEqual(item.motivos[0].id_motivo_nao_entrega, item.motivos[1].id_motivo_nao_entrega)
        self.assertEqual([reason.observacao for reason in item.motivos], ["Item 1", "Item 2"])

    def test_item_code_is_preserved_for_revision_lineage(self) -> None:
        item_code = uuid4()
        item = DeliveryItemInput(
            codigo_item_lancamento=item_code,
            data_entrega=date(2026, 10, 20),
            id_localidade=1,
            quantidade_realizada=4,
            quantidade_nao_realizada=0,
            participantes=[
                DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
            ],
        )

        self.assertEqual(item.codigo_item_lancamento, item_code)

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

