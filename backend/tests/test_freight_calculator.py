"""Exemplos financeiros, limites das planilhas e contratos de entrada."""

from copy import deepcopy
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch

from freight_support import payload
from pydantic import ValidationError

from app.modules.fretes.calculator import calculate_freight
from app.modules.fretes.tariff_catalog import tariff_data, tariff_options


class FreightCalculatorTests(TestCase):
    def test_approved_aggregate_rates_and_odometer_distance(self):
        for city, expected in (("Rio das Ostras", "493.00"), ("  Macaé  ", "355.00")):
            with self.subTest(city=city):
                result = calculate_freight(payload(rota_cidade=city))
                self.assertEqual(result.status, "CALCULADO")
                self.assertEqual(result.valor_frete_bruto, Decimal(expected))
                self.assertEqual(result.detalhe["parametros"]["percentual_nota"], "0.0117")
                self.assertEqual(len(result.detalhe["hash_retrato_tarifas"]), 64)

    def test_macae_matches_simulator_for_reported_freight(self):
        result = calculate_freight(payload(
            rota_cidade="Macaé", peso_kg="2275", valor_nota="14727.57",
            km_inicial="0", km_final="134",
        ))
        self.assertEqual(result.valor_frete_bruto, Decimal("785.85"))
        self.assertEqual(result.detalhe["parametros"]["percentual_nota"], "0.0117")

    def test_cabo_frio_table_covers_three_cities(self):
        for city in ("Cabo Frio", "Armação dos Búzios", "Armação de Búzios", "Búzios", "São Pedro da Aldeia"):
            with self.subTest(city=city):
                result = calculate_freight(payload(rota_cidade=city))
                self.assertEqual(result.detalhe["aba_tarifa"], "CF")
                self.assertEqual(result.valor_frete_bruto, Decimal("377.50"))

    def test_rounds_sum_to_cents_without_inventing_minimum(self):
        result = calculate_freight(payload(km_final="100", peso_kg="0.25", valor_nota="0"))
        self.assertEqual(result.valor_frete_bruto, Decimal("0.02"))
        self.assertIsNone(result.percentual_frete)

    def test_unknown_or_composite_route_and_missing_invoice_stay_pending(self):
        for changes in ({"rota_cidade": "Macaé / Cabo Frio"}, {"valor_nota": None}):
            with self.subTest(changes=changes):
                result = calculate_freight(payload(**changes))
                self.assertEqual(result.status, "PENDENTE_CONFERENCIA")
                self.assertIsNone(result.valor_frete_bruto)

    def test_new_launch_rejects_own_fleet_modality(self):
        with self.assertRaises(ValidationError):
            payload(
                tipo_transporte="PROPRIO",
                codigo_fonte_tarifa=None,
                nome_transportador="Veículo de teste",
            )

    def test_paulo_cruz_uses_fixed_vehicle_price_for_any_route_and_weight(self):
        for truck, expected in (("SAVEIRO", "300.00"), ("KIA_BONGO", "500.00"),
                                ("CAMINHAO_3_4", "950.00"), ("CAMINHAO_TOCO", "1100.00")):
            for route, weight in (("Macaé", "0"), ("Cabo Frio", "12000")):
                with self.subTest(truck=truck, route=route, weight=weight):
                    result = calculate_freight(payload(
                        tipo_transporte="TRANSPORTADORA", nome_transportador="Paulo Cruz",
                        codigo_fonte_tarifa="PAULO_CRUZ", tipo_caminhao=truck,
                        peso_kg=weight, rota_cidade=route,
                    ))
                    self.assertEqual(result.status, "CALCULADO")
                    self.assertEqual(result.valor_frete_bruto, Decimal(expected))

    def test_paulo_cruz_support_vehicle_is_added_to_truck_freight(self):
        for support, gross, addition in ((None, "950.00", "0.00"), ("SAVEIRO", "1250.00", "300.00"), ("KIA_BONGO", "1450.00", "500.00")):
            with self.subTest(support=support):
                result = calculate_freight(payload(
                    tipo_transporte="TRANSPORTADORA", nome_transportador="Paulo Cruz",
                    codigo_fonte_tarifa="PAULO_CRUZ", tipo_caminhao="CAMINHAO_3_4",
                    peso_kg="2000", carro_apoio=support,
                ))
                self.assertEqual(result.valor_frete_bruto, Decimal(gross))
                self.assertEqual(result.detalhe["carro_apoio"], support)
                self.assertEqual(result.detalhe["valor_carro_apoio"], addition)

    def test_support_vehicle_requires_paulo_cruz(self):
        with self.assertRaises(ValidationError):
            payload(carro_apoio="SAVEIRO")

    def jit(self, **changes):
        values = dict(
            tipo_transporte="TRANSPORTADORA",
            nome_transportador="JUST IN TIME",
            codigo_fonte_tarifa="JUST_IN_TIME",
            codigo_zona_jit="ZONA_OESTE_1",
            peso_kg="60",
        )
        return payload(**(values | changes))

    def test_jit_calculates_unique_tier_and_invoice_ratio(self):
        result = calculate_freight(self.jit())
        self.assertEqual(result.valor_frete_bruto, Decimal("120.00"))
        self.assertEqual(result.percentual_frete, Decimal("0.012000"))

    def test_jit_catalog_exposes_all_regions_and_keeps_tariff_subzones(self):
        regions = tariff_options()["zonas_just_in_time"]
        self.assertEqual(
            [region["nome"] for region in regions],
            [
                "Rio de Janeiro",
                "Região Serrana",
                "Baixada Fluminense",
                "Norte Fluminense",
                "Noroeste Fluminense",
                "Niterói e região",
                "Região dos Lagos",
                "Costa Verde",
                "Vale do Paraíba",
            ],
        )
        self.assertEqual(
            [zone["codigo"] for zone in regions[0]["subzonas"]],
            ["ZONA_OESTE_1", "ZONA_OESTE_2", "ZONA_SUL", "ZONA_NORTE_1", "ZONA_NORTE_2"],
        )
        self.assertEqual(
            [zone["codigo"] for zone in regions[1]["subzonas"]],
            ["REGI_O_SERRANA_1", "REGI_O_SERRANA_2"],
        )
        niteroi = next(region for region in regions if region["nome"] == "Niterói e região")
        self.assertEqual(
            [zone["codigo"] for zone in niteroi["subzonas"]],
            ["NITEROI_1", "NITEROI_2"],
        )

    def test_jit_calculates_niteroi_zone_and_rejects_unknown_zone(self):
        result = calculate_freight(
            self.jit(codigo_zona_jit="NITEROI_1", peso_kg="5604")
        )
        self.assertEqual(result.status, "CALCULADO")
        self.assertEqual(result.valor_frete_bruto, Decimal("1216.17"))

        result = calculate_freight(self.jit(codigo_zona_jit="NAO_EXISTE"))
        self.assertEqual(result.status, "PENDENTE_CONFERENCIA")
        self.assertIsNone(result.valor_frete_bruto)

    def test_jit_overlapping_limits_and_gaps_are_pending(self):
        for weight in ("50.5", "100", "500", "3500", "12001"):
            with self.subTest(weight=weight):
                result = calculate_freight(self.jit(peso_kg=weight))
                self.assertEqual(result.status, "PENDENTE_CONFERENCIA")

    def test_jit_multiple_additions_unknown_additions_and_missing_tiers_are_pending(self):
        for changes in (
            {"adicionais_jit": ["ESCADA", "RAMPA"]},
            {"adicionais_jit": ["INEXISTENTE"]},
            {"adicionais_jit": ["ESCADA"], "peso_kg": "1100"},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(
                    calculate_freight(self.jit(**changes)).status, "PENDENTE_CONFERENCIA"
                )

    def test_jit_empty_price_is_pending_instead_of_an_exception(self):
        tariffs = deepcopy(tariff_data())
        tariffs["just_in_time"]["zones"][0]["tiers"][1]["price"] = None
        with patch("app.modules.fretes.calculator.tariff_data", return_value=tariffs):
            self.assertEqual(calculate_freight(self.jit()).status, "PENDENTE_CONFERENCIA")

    def test_invalid_readings_precision_and_modalities_are_rejected(self):
        for changes in (
            {"km_final": "99"},
            {"km_inicial": "-1"},
            {"peso_kg": "NaN"},
            {"peso_kg": "1.0001"},
            {"valor_nota": "1.001"},
            {"quantidade_entregas": -1},
            {"id_motorista_agregado": None},
            {"codigo_fonte_tarifa": "PAULO_CRUZ"},
            {"adicionais_jit": ["ESCADA", " escada "]},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                payload(**changes)
