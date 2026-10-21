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
                quantidade_entregas_no_prazo=3,
                quantidade_entregas_completas=4,
                participantes=[
                    DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
                ],
                motivos=[DeliveryReasonInput(id_motivo_nao_entrega=5, quantidade=1)],
            )

    def test_item_code_is_preserved_for_revision_lineage(self) -> None:
        item_code = uuid4()
        item = DeliveryItemInput(
            codigo_item_lancamento=item_code,
            data_entrega=date(2026, 10, 20),
            id_localidade=1,
            quantidade_realizada=4,
            quantidade_nao_realizada=0,
            quantidade_entregas_no_prazo=3,
            quantidade_entregas_completas=2,
            participantes=[
                DeliveryParticipantInput(id_pessoa=10, papel_participante="MOTORISTA")
            ],
        )

        self.assertEqual(item.codigo_item_lancamento, item_code)

    def test_otif_counts_must_be_both_known_and_not_exceed_completed_deliveries(self) -> None:
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
                quantidade_entregas_completas=None,
            )
        with self.assertRaises(ValidationError):
            DeliveryItemInput(
                **base,
                quantidade_entregas_no_prazo=5,
                quantidade_entregas_completas=3,
            )

        legacy_item = DeliveryItemInput(
            **base,
            quantidade_entregas_no_prazo=None,
            quantidade_entregas_completas=None,
        )
        self.assertIsNone(legacy_item.quantidade_entregas_no_prazo)


class DashboardRuleTests(TestCase):
    def test_rate_uses_realized_over_total_registered(self) -> None:
        self.assertEqual(_rate(8, 2), 80.0)
        self.assertIsNone(_rate(0, 0))

    def test_otif_percentages_use_all_recorded_deliveries_as_denominator(self) -> None:
        on_time = _percentage(90, 100)
        complete = _percentage(80, 100)
        self.assertEqual(on_time, 90.0)
        self.assertEqual(complete, 80.0)
        self.assertEqual(round(on_time * complete / 100, 2), 72.0)

