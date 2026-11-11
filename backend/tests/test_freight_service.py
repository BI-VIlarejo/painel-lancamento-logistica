"""Persistência, autorização, idempotência e consolidação financeira isoladas."""

from io import BytesIO
from datetime import date
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from openpyxl import load_workbook
from freight_support import access, database, payload
from sqlalchemy import func, select

from app.core.exceptions import ConflictError, PermissionDeniedError
from app.modules.fretes import service
from app.modules.fretes.models import Frete, FreteEvento
from app.modules.catalogs.models import Pessoa
from app.modules.fretes.schemas import HistoricalFreightImportRequest


class FreightServiceTests(TestCase):
    def test_import_links_vitor_and_both_compound_driver_names(self):
        aggregate = self.db.get(Pessoa, 1)
        carrier_driver = self.db.get(Pessoa, 2)
        aggregate.nome_exibicao = "Sebastião/Adão"
        carrier_driver.nome_exibicao = "Victor Transportadora Niterói"
        self.db.flush()
        request = HistoricalFreightImportRequest.model_validate({
            "nome_arquivo": "fretes.xlsx",
            "sha256_arquivo": "a" * 64,
            "aba_origem": "LANÇAMENTO",
            "itens": [
                {"linha_planilha": line, "data_servico": "2026-11-03", "nome_transportador": name, "valor_frete_bruto": "100"}
                for line, name in enumerate(("VITOR", "SEBASTIÃO", "ADÃO"), 4)
            ],
        })
        result = service.import_historical_freights(self.db, payload=request, access=access())
        self.assertEqual(result.importados, 3)
        rows = list(self.db.scalars(select(Frete).order_by(Frete.id_frete)))
        self.assertEqual(rows[0].id_motorista_transportadora, 2)
        self.assertEqual(rows[0].codigo_fonte_tarifa, "PAULO_CRUZ")
        self.assertEqual([row.id_motorista_agregado for row in rows[1:]], [1, 1])

    def test_unmatched_historical_route_does_not_create_pending_status(self):
        request = HistoricalFreightImportRequest.model_validate({
            "nome_arquivo": "fretes.xlsx", "sha256_arquivo": "a" * 64, "aba_origem": "LANÇAMENTO",
            "itens": [{"linha_planilha": 4, "data_servico": "2026-11-03",
                       "nome_transportador": "Motorista Agregado Teste", "rota_cidade": "Rota desconhecida",
                       "valor_frete_bruto": "100"}],
        })
        service.import_historical_freights(self.db, payload=request, access=access())
        freight = self.db.scalar(select(Frete))
        self.assertEqual(freight.status_calculo, "CALCULADO")
        self.assertEqual(freight.rota_cidade, "Rota desconhecida")

        freight.status_calculo = "PENDENTE_CONFERENCIA"
        freight.motivo_pendencia = "Rota/cidade não vinculada de forma única ao catálogo do portal."
        self.db.flush()
        self.assertEqual(service._freight_response(freight).status_calculo, "CALCULADO")
        page = service.list_freights(self.db, access=access(), data_de=None, data_ate=None,
                                     tipo_transporte=None, status_calculo="PENDENTE_CONFERENCIA",
                                     limit=50, offset=0)
        self.assertEqual(page.total, 0)
        report = service._payment_report_from_records([freight], data_de=date(2026, 11, 1),
                 data_ate=date(2026, 11, 30), tipo_transporte="AGREGADO",
                 nome_transportador=freight.nome_transportador, sem_identificacao=False)
        self.assertEqual(report.quantidade_pendentes, 0)
        self.assertEqual(report.valor_a_pagar, Decimal("100"))
        freight.motivo_pendencia = "Responsável não encontrado. " + freight.motivo_pendencia
        self.assertEqual(service._freight_response(freight).motivo_pendencia, "Responsável não encontrado.")
        self.assertEqual(service._freight_response(freight).status_calculo, "PENDENTE_CONFERENCIA")

    def test_numbered_historical_routes_are_not_collapsed_to_base_city(self):
        index = {"NITEROI": {"Niterói"}, "NITEROI1": {"Niterói 1"}}
        self.assertEqual(service._route_alias_target(index, "NITEROI 1"), "Niterói 1")
        self.assertIsNone(service._route_alias_target(index, "NITEROI 2"))
        self.assertIsNone(service._route_alias_target({"MARICA": {"Maricá"}}, "MARICA 1"))

    def setUp(self):
        self.engine, self.db = database()
        self.period = dict(data_de=date(2026, 11, 1), data_ate=date(2026, 11, 30))
        delivery_summary_patch = patch(
            "app.modules.fretes.repository.get_driver_delivery_summary",
            return_value=("Rio das Ostras", ["Rio das Ostras"], 10, 2, 1, Decimal("1000.000")),
        )
        delivery_summary_patch.start()
        self.addCleanup(delivery_summary_patch.stop)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def create(self, **changes):
        return service.create_freight(
            self.db, payload=payload(**changes), idempotency_key=uuid4(), access=access()
        )

    def create_transporter(self, **changes):
        values = {
            "tipo_transporte": "TRANSPORTADORA",
            "nome_transportador": "Paulo Cruz",
            "id_motorista_agregado": None,
            "codigo_fonte_tarifa": "PAULO_CRUZ",
            "km_inicial": None,
            "km_final": None,
            "tipo_caminhao": "CAMINHAO_3_4",
            "peso_kg": "2000",
        }
        return service.create_freight(
            self.db,
            payload=payload(**(values | changes)),
            idempotency_key=uuid4(),
            access=access(),
        )

    def test_create_is_audited_and_retry_does_not_duplicate_freight(self):
        key = uuid4()
        first = service.create_freight(
            self.db, payload=payload(quantidade_avarias=2), idempotency_key=key, access=access()
        )
        second = service.create_freight(
            self.db, payload=payload(quantidade_avarias=2), idempotency_key=key, access=access()
        )
        self.assertEqual(first.id_frete, second.id_frete)
        self.assertEqual(first.km_rodado, Decimal("50.000"))
        self.assertEqual(first.nome_transportador, "Motorista Agregado Teste")
        self.assertEqual(first.rota_cidade, "Rio das Ostras")
        self.assertEqual(first.quantidade_entregas, 10)
        self.assertEqual(first.quantidade_avarias, 2)
        self.assertEqual(first.peso_kg, Decimal("1000.000"))
        self.assertEqual(first.valor_frete_pago, Decimal("477.00"))
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

    def test_aggregate_without_deliveries_uses_manual_values(self):
        with patch(
            "app.modules.fretes.repository.get_driver_delivery_summary",
            return_value=("", [], 0, 0, 0, None),
        ):
            manual = payload(rota_cidade="Rio das Ostras", quantidade_entregas=7,
                             quantidade_avarias=3, peso_kg="1500")
            quote = service.quote_freight(self.db, payload=manual, access=access())
            self.assertEqual(quote.status_calculo, "CALCULADO")
            self.assertTrue(quote.detalhe_calculo["origem_entregas"]["dados_informados_manualmente"])
            freight = service.create_freight(self.db, payload=manual, idempotency_key=uuid4(), access=access())
            self.assertEqual((freight.rota_cidade, freight.quantidade_entregas, freight.quantidade_avarias),
                             ("Rio das Ostras", 7, 3))
            self.assertEqual(freight.peso_kg, Decimal("1500"))

    def test_aggregate_freight_uses_manual_weight_when_delivery_weight_is_missing(self):
        with patch(
            "app.modules.fretes.repository.get_driver_delivery_summary",
            return_value=("Rio das Ostras", ["Rio das Ostras"], 10, 2, 1, None),
        ):
            manual_quote = service.quote_freight(
                self.db,
                payload=payload(peso_kg="1500"),
                access=access(scope="SETOR", sector_id=10),
            )
            self.assertEqual(manual_quote.status_calculo, "CALCULADO")
            origin = manual_quote.detalhe_calculo["origem_entregas"]
            self.assertEqual(origin["peso_total_kg_origem"], None)
            self.assertEqual(origin["peso_total_kg_usado"], "1500")
            self.assertTrue(origin["peso_informado_manualmente"])

            with self.assertRaisesRegex(ConflictError, "informe um peso maior que zero"):
                service.quote_freight(
                    self.db,
                    payload=payload(peso_kg="0"),
                    access=access(scope="SETOR", sector_id=10),
                )

    def test_aggregate_freight_allows_editing_delivery_weight(self):
        with patch(
            "app.modules.fretes.repository.get_driver_delivery_summary",
            return_value=("Rio das Ostras", ["Rio das Ostras"], 10, 2, 1, Decimal("1000")),
        ):
            quote = service.quote_freight(
                self.db,
                payload=payload(peso_kg="1500"),
                access=access(scope="SETOR", sector_id=10),
            )
        origin = quote.detalhe_calculo["origem_entregas"]
        self.assertEqual(origin["peso_total_kg_usado"], "1500")
        self.assertTrue(origin["peso_informado_manualmente"])
        self.assertTrue(origin["dados_alterados_no_frete"])

    def test_aggregate_saves_manager_changes_to_delivery_fields(self):
        request = payload(rota_cidade="Cabo Frio", quantidade_entregas=7,
                          quantidade_avarias=3, peso_kg="1500")
        quote = service.quote_freight(self.db, payload=request, access=access())
        self.assertEqual(quote.detalhe_calculo["aba_tarifa"], "CF")
        self.assertTrue(quote.detalhe_calculo["origem_entregas"]["dados_alterados_no_frete"])
        saved = service.create_freight(self.db, payload=request, idempotency_key=uuid4(), access=access())
        self.assertEqual((saved.rota_cidade, saved.quantidade_entregas, saved.quantidade_avarias, saved.peso_kg),
                         ("Cabo Frio", 7, 3, Decimal("1500")))

    def test_carrier_driver_options_include_one_named_driver_per_company(self):
        options = service.get_carrier_drivers(
            self.db, data_servico=date(2026, 11, 3), access=access()
        )
        self.assertEqual(
            [
                (
                    option.codigo_transportadora,
                    option.nome_transportadora,
                    option.nome_motorista,
                )
                for option in options
            ],
            [
                (
                    "JUST_IN_TIME",
                    "JUST IN TIME",
                    "Motorista Just In Time Teste",
                ),
                ("PAULO_CRUZ", "Paulo Cruz", "Motorista Paulo Cruz Teste"),
            ],
        )

    def test_damage_above_gross_rolls_back_without_event(self):
        with self.assertRaises(ConflictError):
            self.create(valor_avaria="497")
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Frete)), 0)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(FreteEvento)), 0)

    def test_report_filters_by_service_date_modality_and_responsible(self):
        self.create()
        self.create(data_servico="2026-10-31")
        self.create_transporter()
        filters = {
            **self.period,
            "tipo_transporte": "AGREGADO",
            "nome_transportador": "Motorista Agregado Teste",
            "sem_identificacao": False,
        }
        report = service.build_payment_report(self.db, access=access(), **filters)
        self.assertEqual(report.quantidade_fretes, 1)
        self.assertEqual(report.valor_frete_bruto, Decimal("493.00"))
        self.assertEqual(report.valor_avarias, Decimal("16.00"))
        self.assertEqual(report.valor_a_pagar, Decimal("477.00"))
        workbook = load_workbook(
            BytesIO(service.export_payment_report(self.db, access=access(), **filters)),
            data_only=False,
        )
        worksheet = workbook["Sheet1"]
        self.assertEqual([worksheet.cell(3, column).value for column in range(1, 7)], [
            "Nome", "CPF", "Motivo", "Setor", "Valor Total", "Observações"
        ])
        self.assertEqual(worksheet["A4"].value, "Motorista Agregado Teste")
        self.assertIsNone(worksheet["B4"].value)
        self.assertEqual(worksheet["C4"].value, "AGREGADO TOTAL DE 1 DIA")
        self.assertEqual(worksheet["D4"].value, "TRANSPORTE")
        self.assertEqual(worksheet["E4"].value, Decimal("477.00"))
        self.assertEqual(worksheet["D24"].value, "TOTAL GERAL")
        self.assertEqual(worksheet["E24"].value, "=SUM(E4:E23)")

    def test_pending_freights_are_counted_and_block_payment_export(self):
        self.create_transporter(tipo_caminhao="SAVEIRO")
        filters = {
            **self.period,
            "tipo_transporte": "TRANSPORTADORA",
            "nome_transportador": "Paulo Cruz",
            "sem_identificacao": False,
        }
        report = service.build_payment_report(self.db, access=access(), **filters)
        self.assertEqual((report.quantidade_fretes, report.quantidade_pendentes), (1, 1))
        self.assertEqual(report.valor_a_pagar, 0)
        with self.assertRaises(ConflictError):
            service.export_payment_report(self.db, access=access(), **filters)

    def test_history_filters_and_pagination_keep_total(self):
        self.create()
        self.create(data_servico="2026-11-04")
        self.create_transporter(tipo_caminhao="SAVEIRO")
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
                    self.db,
                    access=access(),
                    data_de=date(2026, 11, 30),
                    data_ate=date(2026, 11, 1),
                    tipo_transporte="AGREGADO",
                    nome_transportador="Motorista Agregado Teste",
                    sem_identificacao=False,
                )
