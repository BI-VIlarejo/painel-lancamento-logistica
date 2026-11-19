"""Testes de agregação, permissões, detalhamento paginado e O(1) queries do Painel de Transportes."""

from datetime import date, datetime
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from freight_support import access, database
from sqlalchemy import event

from app.api.v1.dependencies import get_current_auth_context
from app.core.config import Settings
from app.core.database import get_db
from app.core.exceptions import PermissionDeniedError, register_exception_handlers
from app.modules.analytics.router import router as analytics_router
from app.modules.auth.schemas import AuthenticatedUser
from app.modules.auth.service import AuthenticatedSession
from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa, Setor
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaMotivo,
    EntregaParticipante,
    FormularioVersao,
    Lancamento,
    LancamentoEvento,
    LancamentoRevisao,
)
from app.modules.feedback.models import Feedback
from app.modules.fretes.models import Frete, FreteEvento


class TransportAnalyticsTests(TestCase):
    def setUp(self) -> None:
        self.engine, self.db = database()
        self.settings = Settings(_env_file=None, app_env="test")
        self.allowed = {"PAINEL_GERENCIAL:ACESSAR", "FRETES:VER"}
        self.scope_mode = "GLOBAL"
        self.scope_sector_id = None

        app = FastAPI()
        register_exception_handlers(app)
        app.include_router(analytics_router)
        app.dependency_overrides[get_db] = lambda: self.db
        self.auth = AuthenticatedSession(
            user=AuthenticatedUser(id_usuario=1, username="teste", nome_completo="Usuário teste"),
            session_id=1,
        )
        app.dependency_overrides[get_current_auth_context] = lambda: self.auth
        self.app = app
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

        def authorize(_db, *, id_usuario, permission_code):
            if permission_code not in self.allowed:
                raise PermissionDeniedError()
            return access(
                permission_code,
                scope=self.scope_mode,
                sector_id=self.scope_sector_id,
                user_id=id_usuario,
            )

        auth_patch = patch(
            "app.api.v1.dependencies.access_control_service.require_permission",
            side_effect=authorize,
        )
        settings_patch = patch("app.api.v1.dependencies.get_settings", return_value=self.settings)
        auth_patch.start()
        settings_patch.start()
        self.addCleanup(auth_patch.stop)
        self.addCleanup(settings_patch.stop)

        self._seed_domain_data()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _seed_domain_data(self) -> None:
        now = datetime(2026, 11, 10, 10, 0, 0)
        support_sector = Setor(
            id_setor=1,
            codigo="SUPORTE",
            nome="Suporte",
            ativo=True,
            criado_em=now,
            atualizado_em=now,
        )
        self.db.add(support_sector)

        loc1 = Localidade(
            id_localidade=1,
            codigo_localidade="RO",
            nome_localidade="Loja Rio das Ostras",
            tipo_localidade="LOJA",
            cidade="Rio das Ostras",
            uf="RJ",
            ativo=True,
            sincronizado_em=now,
        )
        loc2 = Localidade(
            id_localidade=2,
            codigo_localidade="MAC",
            nome_localidade="Loja Macaé",
            tipo_localidade="LOJA",
            cidade="Macaé",
            uf="RJ",
            ativo=True,
            sincronizado_em=now,
        )
        self.db.add_all([loc1, loc2])

        own_driver = Pessoa(
            id_pessoa=4,
            codigo_pessoa=str(uuid4()),
            nome_exibicao="Motorista Frota Própria",
            tipo_funcao="MOTORISTA",
            tipo_transporte_entrega="PROPRIA",
            modalidade_terceirizada=None,
            codigo_transportadora_independente=None,
            ativo=True,
            vigente_desde=date(2026, 1, 1),
            criado_por=1,
            criado_em=now,
            atualizado_em=now,
        )
        helper = Pessoa(
            id_pessoa=5,
            codigo_pessoa=str(uuid4()),
            nome_exibicao="Ajudante Teste",
            tipo_funcao="AJUDANTE",
            tipo_transporte_entrega="TERCEIRIZADA",
            modalidade_terceirizada=None,
            codigo_transportadora_independente=None,
            ativo=True,
            vigente_desde=date(2026, 1, 1),
            criado_por=1,
            criado_em=now,
            atualizado_em=now,
        )
        self.db.add_all([own_driver, helper])

        reason_delivery = MotivoNaoEntrega(
            id_motivo_nao_entrega=1,
            codigo_motivo="AUSENTE",
            descricao_motivo="Cliente ausente",
            grupo_motivo="LOJA",
            ativo=True,
            vigente_desde=date(2026, 1, 1),
            criado_por=1,
            criado_em=now,
            atualizado_em=now,
        )
        self.db.add(reason_delivery)

        form = FormularioVersao(
            id_formulario_versao=1,
            id_setor=1,
            codigo_formulario="ENTREGAS_DIARIAS",
            versao=1,
            hash_contrato="0" * 64,
            status="PUBLICADO",
            vigente_desde=datetime(2026, 1, 1),
            criado_por=1,
            criado_em=now,
            publicado_por=1,
            publicado_em=now,
        )
        self.db.add(form)
        self.db.flush()

        # 1) Active AGREGADO freight (CALCULADO)
        f1 = Frete(
            id_frete=1,
            codigo_frete=str(uuid4()),
            chave_idempotencia=str(uuid4()),
            id_setor=10,
            tipo_transporte="AGREGADO",
            nome_transportador="Motorista Agregado Teste",
            id_motorista_agregado=1,
            codigo_fonte_tarifa="AGREGADOS_CD",
            data_servico=date(2026, 11, 5),
            rota_cidade="Rio das Ostras",
            km_inicial=Decimal("100.000"),
            km_final=Decimal("150.000"),
            km_rodado=Decimal("50.000"),
            quantidade_entregas=10,
            peso_kg=Decimal("1000.000"),
            valor_nota=Decimal("10000.00"),
            adicionais_jit=[],
            valor_frete_bruto=Decimal("500.00"),
            valor_avaria=Decimal("20.00"),
            quantidade_avarias=1,
            valor_frete_pago=Decimal("480.00"),
            percentual_frete=Decimal("0.050000"),
            status_calculo="CALCULADO",
            detalhe_calculo={},
            criado_por=1,
            criado_em=now,
        )
        # 2) Historical imported AGREGADO freight (PENDENTE_CONFERENCIA, but clear imported responsible & spreadsheet KM)
        f2 = Frete(
            id_frete=2,
            codigo_frete=str(uuid4()),
            chave_idempotencia=str(uuid4()),
            id_setor=10,
            tipo_transporte="AGREGADO",
            nome_transportador="Motorista Agregado Teste",
            id_motorista_agregado=1,
            codigo_fonte_tarifa="AGREGADOS_CD",
            data_servico=date(2026, 11, 6),
            rota_cidade="Macaé",
            km_inicial=None,
            km_final=None,
            km_rodado=None,
            quantidade_entregas=5,
            peso_kg=None,
            valor_nota=Decimal("5000.00"),
            adicionais_jit=[],
            valor_frete_bruto=Decimal("300.00"),
            valor_avaria=Decimal("0.00"),
            quantidade_avarias=0,
            valor_frete_pago=Decimal("300.00"),
            percentual_frete=Decimal("0.060000"),
            status_calculo="PENDENTE_CONFERENCIA",
            motivo_pendencia="Falta peso na planilha",
            detalhe_calculo={
                "metodo_calculo": "VALOR_HISTORICO_IMPORTADO",
                "importacao_planilha": {
                    "tipo_transporte_identificado": True,
                    "vinculo_responsavel_status": "VINCULADO",
                    "km_rodado_planilha": "35,5",
                },
            },
            criado_por=1,
            criado_em=now,
        )
        # 3) Cancelled freight (must be excluded)
        f3_cancelled = Frete(
            id_frete=3,
            codigo_frete=str(uuid4()),
            chave_idempotencia=str(uuid4()),
            id_setor=10,
            tipo_transporte="TRANSPORTADORA",
            nome_transportador="Paulo Cruz",
            id_motorista_transportadora=2,
            nome_motorista_transportadora="Motorista Paulo Cruz Teste",
            codigo_fonte_tarifa="PAULO_CRUZ",
            data_servico=date(2026, 11, 7),
            rota_cidade="Cabo Frio",
            quantidade_entregas=4,
            peso_kg=Decimal("500.000"),
            valor_nota=Decimal("2000.00"),
            tipo_caminhao="CAMINHAO_TOCO",
            adicionais_jit=[],
            valor_frete_bruto=Decimal("999.00"),
            valor_avaria=Decimal("0.00"),
            quantidade_avarias=0,
            valor_frete_pago=Decimal("999.00"),
            status_calculo="CALCULADO",
            detalhe_calculo={},
            criado_por=1,
            criado_em=now,
        )
        # 4) Active TRANSPORTADORA freight
        f4 = Frete(
            id_frete=4,
            codigo_frete=str(uuid4()),
            chave_idempotencia=str(uuid4()),
            id_setor=10,
            tipo_transporte="TRANSPORTADORA",
            nome_transportador="JUST IN TIME",
            id_motorista_transportadora=3,
            nome_motorista_transportadora="Motorista Just In Time Teste",
            codigo_fonte_tarifa="JUST_IN_TIME",
            data_servico=date(2026, 11, 8),
            rota_cidade="Rio de Janeiro",
            quantidade_entregas=6,
            peso_kg=Decimal("800.000"),
            valor_nota=Decimal("10000.00"),
            codigo_zona_jit="ZONA_SUL",
            adicionais_jit=[],
            valor_frete_bruto=Decimal("400.00"),
            valor_avaria=Decimal("0.00"),
            quantidade_avarias=0,
            valor_frete_pago=Decimal("400.00"),
            status_calculo="CALCULADO",
            detalhe_calculo={},
            criado_por=1,
            criado_em=now,
        )
        self.db.add_all([f1, f2, f3_cancelled, f4])
        self.db.flush()
        self.db.add(
            FreteEvento(
                id_frete=3,
                id_usuario_ator=1,
                tipo_evento="FRETE_CANCELADO",
                ocorrido_em=now,
                detalhes={"justificativa": "Teste cancelado"},
            )
        )

        # Deliveries:
        # Launch 1: Confirmed rev 1 + open draft rev 2 (correction) -> rev 1 must still count!
        l1 = Lancamento(
            id_lancamento=1,
            codigo_lancamento=str(uuid4()),
            id_setor=1,
            chave_idempotencia=str(uuid4()),
            criado_por=1,
            criado_em=now,
            atualizado_em=now,
        )
        self.db.add(l1)
        self.db.flush()

        rev1 = LancamentoRevisao(
            id_lancamento_revisao=1,
            id_lancamento=1,
            codigo_revisao=str(uuid4()),
            id_formulario_versao=1,
            numero_revisao=1,
            chave_idempotencia=str(uuid4()),
            estado="ENVIADA",
            hash_conteudo="a" * 64,
            criado_por=1,
            criado_em=now,
            enviado_por=1,
            enviado_em=now,
        )
        rev1_draft_correction = LancamentoRevisao(
            id_lancamento_revisao=2,
            id_lancamento=1,
            codigo_revisao=str(uuid4()),
            id_formulario_versao=1,
            numero_revisao=2,
            chave_idempotencia=str(uuid4()),
            estado="RASCUNHO",
            hash_conteudo=None,
            criado_por=1,
            criado_em=now,
        )
        self.db.add_all([rev1, rev1_draft_correction])
        self.db.flush()

        item_code_1 = str(uuid4())
        item_code_2 = str(uuid4())
        d1 = EntregaDiaria(
            id_entrega_diaria=1,
            id_lancamento_revisao=1,
            codigo_item_lancamento=item_code_1,
            tipo_operacao="ENTREGA",
            data_entrega=date(2026, 11, 5),
            id_localidade=1,
            quantidade_realizada=8,
            quantidade_nao_realizada=2,
            quantidade_coleta_realizada=3,
            quantidade_coleta_nao_realizada=1,
            peso_total_kg=Decimal("500.000"),
            criado_em=now,
            atualizado_em=now,
        )
        # Collection-only item -> must NOT count in transport delivery indicators!
        d2_collection_only = EntregaDiaria(
            id_entrega_diaria=2,
            id_lancamento_revisao=1,
            codigo_item_lancamento=item_code_2,
            tipo_operacao="ENTREGA",
            data_entrega=date(2026, 11, 5),
            id_localidade=2,
            quantidade_realizada=0,
            quantidade_nao_realizada=0,
            quantidade_coleta_realizada=2,
            quantidade_coleta_nao_realizada=0,
            peso_total_kg=Decimal("0.000"),
            criado_em=now,
            atualizado_em=now,
        )
        # Out-of-period item in same launch -> must NOT count when querying Nov 1..10
        d3_out_of_range = EntregaDiaria(
            id_entrega_diaria=3,
            id_lancamento_revisao=1,
            codigo_item_lancamento=str(uuid4()),
            tipo_operacao="ENTREGA",
            data_entrega=date(2026, 10, 25),
            id_localidade=2,
            quantidade_realizada=50,
            quantidade_nao_realizada=0,
            quantidade_coleta_realizada=0,
            quantidade_coleta_nao_realizada=0,
            peso_total_kg=Decimal("500.000"),
            criado_em=now,
            atualizado_em=now,
        )
        self.db.add_all([d1, d2_collection_only, d3_out_of_range])
        self.db.flush()

        # Participants for d1: Aggregate Driver (id=1) + Helper (id=5)
        self.db.add_all(
            [
                EntregaParticipante(
                    id_entrega_diaria=1, id_pessoa=1, papel_participante="MOTORISTA", ordem=1
                ),
                EntregaParticipante(
                    id_entrega_diaria=1, id_pessoa=5, papel_participante="AJUDANTE", ordem=2
                ),
            ]
        )
        # Reasons for d1: 2 ENTREGA occurrences + 1 COLETA occurrence (must ignore COLETA!)
        self.db.add_all(
            [
                EntregaMotivo(
                    id_entrega_diaria=1,
                    id_motivo_nao_entrega=1,
                    tipo_operacao="ENTREGA",
                    quantidade=2,
                    codigo_cliente="CLI-01",
                ),
                EntregaMotivo(
                    id_entrega_diaria=1,
                    id_motivo_nao_entrega=1,
                    tipo_operacao="COLETA",
                    quantidade=1,
                    codigo_cliente="CLI-02",
                ),
            ]
        )
        # Feedback for d1 (should NOT break summary and SHOULD appear in detail dialog)
        self.db.add(
            Feedback(
                chave_idempotencia=str(uuid4()),
                id_lancamento_revisao=1,
                codigo_item_lancamento=item_code_1,
                tipo="ELOGIO",
                data_feedback=date(2026, 11, 5),
                id_localidade=1,
                id_entrega_diaria=1,
                nome_cliente="Cliente Feliz",
                relato="Entrega rápida",
                criado_por=1,
                criado_em=now,
                atualizado_em=now,
            )
        )

        # Launch 2: Cancelled confirmed launch -> must NOT count
        l2_cancelled = Lancamento(
            id_lancamento=2,
            codigo_lancamento=str(uuid4()),
            id_setor=1,
            chave_idempotencia=str(uuid4()),
            criado_por=1,
            criado_em=now,
            atualizado_em=now,
        )
        self.db.add(l2_cancelled)
        self.db.flush()
        rev2 = LancamentoRevisao(
            id_lancamento_revisao=3,
            id_lancamento=2,
            codigo_revisao=str(uuid4()),
            id_formulario_versao=1,
            numero_revisao=1,
            chave_idempotencia=str(uuid4()),
            estado="APROVADA",
            hash_conteudo="b" * 64,
            criado_por=1,
            criado_em=now,
            enviado_por=1,
            enviado_em=now,
            aprovado_por=1,
            aprovado_em=now,
        )
        self.db.add(rev2)
        self.db.flush()
        self.db.add(
            EntregaDiaria(
                id_entrega_diaria=4,
                id_lancamento_revisao=3,
                codigo_item_lancamento=str(uuid4()),
                tipo_operacao="ENTREGA",
                data_entrega=date(2026, 11, 6),
                id_localidade=2,
                quantidade_realizada=99,
                quantidade_nao_realizada=1,
                peso_total_kg=Decimal("100.000"),
                criado_em=now,
                atualizado_em=now,
            )
        )
        self.db.add(
            LancamentoEvento(
                id_lancamento=2,
                id_lancamento_revisao=3,
                chave_idempotencia=str(uuid4()),
                tipo_evento="LANCAMENTO_CANCELADO",
                estado_anterior="APROVADA",
                estado_novo="CANCELADA",
                ator_usuario_id=1,
                ocorrido_em=now,
                comentario="Cancelado",
            )
        )
        self.db.commit()

    def test_permissions_and_period_validation(self) -> None:
        # Missing DASHBOARD_ACCESS
        self.allowed.remove("PAINEL_GERENCIAL:ACESSAR")
        self.assertEqual(
            self.client.get(
                "/analytics/transport",
                params={"data_de": "2026-11-01", "data_ate": "2026-11-30"},
            ).status_code,
            403,
        )
        self.allowed.add("PAINEL_GERENCIAL:ACESSAR")

        # Missing FRETES:VER
        self.allowed.remove("FRETES:VER")
        self.assertEqual(
            self.client.get(
                "/analytics/transport",
                params={"data_de": "2026-11-01", "data_ate": "2026-11-30"},
            ).status_code,
            403,
        )
        self.allowed.add("FRETES:VER")

        # LOCALIDADE-only scope is rejected
        self.scope_mode = "LOCALIDADE"
        self.assertEqual(
            self.client.get(
                "/analytics/transport",
                params={"data_de": "2026-11-01", "data_ate": "2026-11-30"},
            ).status_code,
            403,
        )

        # TRANSPORTE sector scope (without SUPORTE) is accepted
        self.scope_mode = "SETOR"
        self.scope_sector_id = 10
        ok_resp = self.client.get(
            "/analytics/transport",
            params={"data_de": "2026-11-01", "data_ate": "2026-11-30"},
        )
        self.assertEqual(ok_resp.status_code, 200, ok_resp.text)

        # Inverted period rejected
        self.scope_mode = "GLOBAL"
        self.scope_sector_id = None
        bad_resp = self.client.get(
            "/analytics/transport",
            params={"data_de": "2026-11-30", "data_ate": "2026-11-01"},
        )
        self.assertEqual(bad_resp.status_code, 422)

    def test_transport_dashboard_aggregates_all_indicators_accurately(self) -> None:
        response = self.client.get(
            "/analytics/transport",
            params={"data_de": "2026-11-01", "data_ate": "2026-11-10"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()

        # 3 active freights (f1, f2, f4; f3 cancelled excluded)
        self.assertEqual(data["total_fretes"], 3)
        # 1 active in-period delivery row (d1; d2 collection-only, d3 out-of-range, d4 cancelled)
        self.assertEqual(data["total_registros_entrega"], 1)

        payments = {item["key"]: item for item in data["pagamentos"]}
        self.assertEqual(payments["AGREGADO::motorista-agregado-teste"]["total"], 780.0)
        self.assertEqual(payments["AGREGADO::motorista-agregado-teste"]["fretes_count"], 2)
        self.assertEqual(payments["AGREGADO::motorista-agregado-teste"]["known_count"], 2)
        self.assertEqual(payments["TRANSPORTADORA::JUST_IN_TIME"]["total"], 400.0)
        self.assertNotIn("TRANSPORTADORA::PAULO_CRUZ", payments)

        rates = {item["key"]: item for item in data["percentuais_frete"]}
        # (500 + 300) / (10000 + 5000) * 100 = 5.3333...%
        self.assertAlmostEqual(rates["AGREGADO::motorista-agregado-teste"]["percentual"], 800 / 15000 * 100, places=4)
        self.assertAlmostEqual(rates["TRANSPORTADORA::JUST_IN_TIME"]["percentual"], 4.0, places=4)

        kms = {item["key"]: item for item in data["km_rodado"]}
        # 50.0 + 35.5 = 85.5
        self.assertAlmostEqual(kms["AGREGADO::motorista-agregado-teste"]["total_km"], 85.5, places=3)
        self.assertEqual(kms["AGREGADO::motorista-agregado-teste"]["known_count"], 2)

        deliveries = {item["key"]: item for item in data["entregas_transportadora"]}
        agg_del = deliveries["AGREGADO::motorista-agregado-teste"]
        self.assertEqual(agg_del["planned"], 10)
        self.assertEqual(agg_del["realized"], 8)
        self.assertEqual(agg_del["not_realized"], 2)
        self.assertEqual(agg_del["occurrences"], 2)
        self.assertAlmostEqual(agg_del["accuracy"], 80.0, places=3)

        cities = {item["city"]: item for item in data["entregas_cidade"]}
        self.assertEqual(list(cities.keys()), ["Rio das Ostras / RJ"])
        self.assertEqual(cities["Rio das Ostras / RJ"]["planned"], 10)
        self.assertEqual(cities["Rio das Ostras / RJ"]["occurrences"], 2)

    def test_transport_details_lazy_loads_and_paginates_carrier_and_city(self) -> None:
        carrier_resp = self.client.get(
            "/analytics/transport/details",
            params={
                "kind": "carrier",
                "key": "AGREGADO::motorista-agregado-teste",
                "data_de": "2026-11-01",
                "data_ate": "2026-11-10",
                "freight_limit": 1,
                "freight_offset": 0,
                "delivery_limit": 10,
                "delivery_offset": 0,
            },
        )
        self.assertEqual(carrier_resp.status_code, 200, carrier_resp.text)
        detail = carrier_resp.json()
        self.assertEqual(detail["totals"]["fretes_count"], 2)
        self.assertEqual(detail["totals"]["pagamento_total"], 780.0)
        self.assertAlmostEqual(detail["totals"]["km_total"], 85.5, places=3)
        self.assertEqual(detail["totals"]["entregas_planejadas"], 10)
        self.assertEqual(detail["totals"]["ocorrencias"], 2)
        self.assertEqual(detail["fretes"]["total"], 2)
        self.assertEqual(len(detail["fretes"]["items"]), 1)
        self.assertEqual(detail["fretes"]["items"][0]["data_servico"], "2026-11-06")

        self.assertEqual(detail["entregas"]["total"], 1)
        d_item = detail["entregas"]["items"][0]
        self.assertEqual(d_item["quantidade_elogios"], 1)
        self.assertEqual(d_item["quantidade_reclamacoes"], 0)
        self.assertEqual(len(d_item["participantes"]), 2)
        self.assertEqual(d_item["motivos"], [{"descricao_motivo": "Cliente ausente", "quantidade": 2}])

        city_resp = self.client.get(
            "/analytics/transport/details",
            params={
                "kind": "city",
                "key": "Rio das Ostras / RJ",
                "data_de": "2026-11-01",
                "data_ate": "2026-11-10",
            },
        )
        self.assertEqual(city_resp.status_code, 200, city_resp.text)
        city_detail = city_resp.json()
        self.assertEqual(city_detail["fretes"]["total"], 0)
        self.assertEqual(city_detail["fretes"]["items"], [])
        self.assertEqual(city_detail["entregas"]["total"], 1)
        self.assertEqual(city_detail["totals"]["entregas_realizadas"], 8)

    def test_transport_dashboard_uses_constant_query_count(self) -> None:
        now = datetime(2026, 11, 10, 12, 0, 0)
        # Seed 250 more freights and 150 more delivery items across many launches
        for idx in range(10, 260):
            self.db.add(
                Frete(
                    id_frete=idx,
                    codigo_frete=str(uuid4()),
                    chave_idempotencia=str(uuid4()),
                    id_setor=10,
                    tipo_transporte="AGREGADO",
                    nome_transportador="Motorista Agregado Teste",
                    id_motorista_agregado=1,
                    codigo_fonte_tarifa="AGREGADOS_CD",
                    data_servico=date(2026, 11, 9),
                    rota_cidade="Rio das Ostras",
                    km_inicial=Decimal("0.000"),
                    km_final=Decimal("10.000"),
                    km_rodado=Decimal("10.000"),
                    quantidade_entregas=1,
                    peso_kg=Decimal("100.000"),
                    valor_nota=Decimal("1000.00"),
                    adicionais_jit=[],
                    valor_frete_bruto=Decimal("100.00"),
                    valor_avaria=Decimal("0.00"),
                    quantidade_avarias=0,
                    valor_frete_pago=Decimal("100.00"),
                    status_calculo="CALCULADO",
                    detalhe_calculo={},
                    criado_por=1,
                    criado_em=now,
                )
            )
        self.db.commit()

        executed_queries: list[str] = []

        def count_query(_conn, _cursor, statement, _parameters, _context, _executemany):
            executed_queries.append(statement)

        event.listen(self.engine, "before_cursor_execute", count_query)
        try:
            response = self.client.get(
                "/analytics/transport",
                params={"data_de": "2026-11-01", "data_ate": "2026-11-30"},
            )
        finally:
            event.remove(self.engine, "before_cursor_execute", count_query)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_fretes"], 253)
        # Only sector lookups + 1 freights query + 1 deliveries query (no N+1 or pagination loops)
        self.assertLessEqual(len(executed_queries), 5, f"Too many queries: {len(executed_queries)}")


if __name__ == "__main__":
    import unittest

    unittest.main()
