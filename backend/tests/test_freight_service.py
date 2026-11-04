"""Persistência, autorização, idempotência e consolidação financeira isoladas."""

import csv
import io
from datetime import date
from decimal import Decimal
from unittest import TestCase
from uuid import uuid4

from freight_support import access, database, payload
from sqlalchemy import func, select

from app.core.exceptions import ConflictError, PermissionDeniedError
from app.modules.fretes import service
from app.modules.fretes.models import Frete, FreteEvento


class FreightServiceTests(TestCase):
    def setUp(self):
        self.engine, self.db = database()
        self.period = dict(data_de=date(2026, 11, 1), data_ate=date(2026, 11, 30))

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def create(self, **changes):
        return service.create_freight(
            self.db, payload=payload(**changes), idempotency_key=uuid4(), access=access()
        )

    def test_create_is_audited_and_retry_does_not_duplicate_freight(self):
        key = uuid4()
        first = service.create_freight(
            self.db, payload=payload(), idempotency_key=key, access=access()
        )
        second = service.create_freight(
            self.db, payload=payload(), idempotency_key=key, access=access()
        )
        self.assertEqual(first.id_frete, second.id_frete)
        self.assertEqual(first.km_rodado, Decimal("50.000"))
        self.assertEqual(first.valor_frete_pago, Decimal("480.00"))
        self.assertNotIn("request_fingerprint", first.detalhe_calculo)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Frete)), 1)
        events = self.db.scalars(select(FreteEvento)).all()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].id_usuario_ator, 1)

    def test_idempotency_conflicts_on_different_content_or_author(self):
        key = uuid4()
        service.create_freight(self.db, payload=payload(), idempotency_key=key, access=access())
        for request, actor in ((payload(peso_kg="2000"), access()), (payload(), access(user_id=2))):
            with self.subTest(actor=actor.id_usuario), self.assertRaises(ConflictError):
                service.create_freight(self.db, payload=request, idempotency_key=key, access=actor)

    def test_only_global_or_transport_sector_can_quote_or_read(self):
        for scope, sector in (("LOCALIDADE", None), ("SETOR", 99)):
            with self.subTest(scope=scope), self.assertRaises(PermissionDeniedError):
                service.quote_freight(
                    self.db, payload=payload(), access=access(scope=scope, sector_id=sector)
                )
        result = service.quote_freight(
            self.db, payload=payload(), access=access(scope="SETOR", sector_id=10)
        )
        self.assertEqual(result.status_calculo, "CALCULADO")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Frete)), 0)

    def test_damage_above_gross_rolls_back_without_event(self):
        with self.assertRaises(ConflictError):
            self.create(valor_avaria="497")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Frete)), 0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(FreteEvento)), 0)

    def test_report_uses_service_date_and_only_aggregates(self):
        self.create()
        self.create(data_servico="2026-10-31")
        self.create(
            tipo_transporte="PROPRIO", codigo_fonte_tarifa=None, nome_transportador="Frota 1"
        )
        self.create(
            tipo_transporte="TRANSPORTADORA",
            codigo_fonte_tarifa="PAULO_CRUZ",
            nome_transportador="Paulo Cruz",
            tipo_caminhao="CAMINHAO_3_4",
            peso_kg="2000",
        )
        report = service.build_payment_report(self.db, access=access(), **self.period)
        self.assertEqual(report.quantidade_fretes, 1)
        self.assertEqual(report.valor_frete_bruto, Decimal("496.00"))
        self.assertEqual(report.valor_avarias, Decimal("16.00"))
        self.assertEqual(report.valor_a_pagar, Decimal("480.00"))
        rows = list(
            csv.reader(
                io.StringIO(
                    service.export_payment_report(self.db, access=access(), **self.period).decode(
                        "utf-8-sig"
                    )
                ),
                delimiter=";",
            )
        )
        self.assertEqual(len(rows), 2)
        self.assertNotIn("CPF", ";".join(rows[0]).upper())
        self.assertIn("480,00", rows[1])

    def test_pending_freights_are_counted_and_block_payment_export(self):
        self.create(rota_cidade="Rota sem tarifa")
        report = service.build_payment_report(self.db, access=access(), **self.period)
        self.assertEqual((report.quantidade_fretes, report.quantidade_pendentes), (1, 1))
        self.assertEqual(report.valor_a_pagar, 0)
        with self.assertRaises(ConflictError):
            service.export_payment_report(self.db, access=access(), **self.period)

    def test_history_filters_and_pagination_keep_total(self):
        self.create()
        self.create(data_servico="2026-11-04")
        self.create(rota_cidade="Rota sem tarifa")
        page = service.list_freights(
            self.db,
            access=access(),
            **self.period,
            tipo_transporte="AGREGADO",
            status_calculo="CALCULADO",
            limit=1,
            offset=1,
        )
        self.assertEqual(page.total, 2)
        self.assertEqual(len(page.items), 1)
        self.assertEqual(page.items[0].data_servico, date(2026, 11, 3))

    def test_inverted_period_rejected_for_report_and_export(self):
        for operation in (service.build_payment_report, service.export_payment_report):
            with self.subTest(operation=operation.__name__), self.assertRaises(ConflictError):
                operation(
                    self.db, access=access(), data_de=date(2026, 11, 30), data_ate=date(2026, 11, 1)
                )
