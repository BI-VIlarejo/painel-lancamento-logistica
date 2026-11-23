"""Testes de fechamento financeiro, baixas, NF, ajustes e endpoints de Pagamentos."""

from datetime import date
from decimal import Decimal
from io import BytesIO
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from freight_support import access, database, payload
from openpyxl import load_workbook

from app.api.v1.dependencies import get_current_auth_context
from app.core.config import Settings
from app.core.database import get_db
from app.core.exceptions import ConflictError, PermissionDeniedError, register_exception_handlers
from app.core.security import create_csrf_token
from app.modules.auth.schemas import AuthenticatedUser
from app.modules.auth.service import AuthenticatedSession
from app.modules.catalogs.admin_schemas import PersonCreateRequest
from app.modules.catalogs import admin_service as catalog_admin_service
from app.modules.catalogs.models import Pessoa
from app.modules.fretes import service
from app.modules.fretes.router import router
from app.modules.fretes.schemas import (
    FreightPaymentAdjustmentCreateRequest,
    FreightPaymentInvoiceUpdateRequest,
    FreightPaymentSettlementCreateRequest,
    FreightPaymentSettlementStatusRequest,
)


class FreightPaymentsControlTests(TestCase):
    def setUp(self):
        self.engine, self.db = database()
        self.delivery_patch = patch(
            "app.modules.fretes.repository.get_driver_delivery_summary",
            return_value=("Rio das Ostras", ["Rio das Ostras"], 10, 2, 1, 1000),
        )
        self.delivery_patch.start()
        self.addCleanup(self.delivery_patch.stop)
        self.period = {"data_de": date(2026, 11, 2), "data_ate": date(2026, 11, 8)}

        # Adiciona um segundo agregado com CPF/CNPJ, PIX e exigência de NF.
        person_one = self.db.get(Pessoa, 1)
        assert person_one is not None
        person_one.documento_fiscal = "123.456.789-01"
        person_one.chave_pix = "motorista1@pix.test"
        self.db.add(
            Pessoa(
                id_pessoa=4,
                codigo_pessoa="00000000-0000-0000-0000-000000000004",
                sistema_origem=None,
                codigo_pessoa_origem=None,
                nome_exibicao="Agregado Dois Teste",
                tipo_funcao="MOTORISTA",
                tipo_transporte_entrega="TERCEIRIZADA",
                modalidade_terceirizada="AGREGADO",
                codigo_transportadora_independente=None,
                documento_fiscal="987.654.321-00",
                chave_pix="agregado2@pix.test",
                exige_nota_fiscal=True,
                ativo=True,
                vigente_desde=date(2026, 1, 1),
                vigente_ate=None,
                criado_por=1,
                criado_em=person_one.criado_em,
                atualizado_em=person_one.atualizado_em,
            )
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _create_freight(self, **changes):
        return service.create_freight(
            self.db,
            payload=payload(**changes),
            idempotency_key=uuid4(),
            access=access("FRETES:CRIAR"),
        )

    def test_full_payment_lifecycle_partial_week_divergence_and_anti_duplication(self):
        first = self._create_freight(data_servico="2026-11-03", id_motorista_agregado=1)
        self._create_freight(data_servico="2026-11-04", id_motorista_agregado=4)

        # Relatório inicial mostra os dois responsáveis discriminados e em aberto.
        report = service.build_payment_report(
            self.db,
            access=access("AGREGADOS:VER"),
            tipo_transporte="AGREGADO",
            nome_transportador=None,
            sem_identificacao=False,
            **self.period,
        )
        self.assertEqual(report.resumo_execucao.total_responsaveis, 2)
        self.assertEqual(report.resumo_execucao.responsaveis_em_aberto, 2)
        self.assertEqual(report.resumo_execucao.nf_pendentes, 1)
        self.assertEqual(len(report.responsaveis), 2)

        # Solicita pagamento do Agregado 1 e verifica status SOLICITADO.
        requested = service.create_payment_settlements(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            payload=FreightPaymentSettlementCreateRequest(
                data_de=self.period["data_de"],
                data_ate=self.period["data_ate"],
                tipo_transporte="AGREGADO",
                acao="SOLICITAR",
                responsaveis=["Motorista Agregado Teste"],
                observacao="Lote semana 45",
            ),
        )
        self.assertEqual(len(requested), 1)
        self.assertEqual(requested[0].status_pagamento, "SOLICITADO")
        self.assertEqual(requested[0].documento_fiscal, "123.456.789-01")
        self.assertEqual(requested[0].chave_pix, "motorista1@pix.test")

        # Tentar solicitar novamente sem novos fretes em aberto deve falhar (trava contra duplicidade).
        with self.assertRaises(ConflictError):
            service.create_payment_settlements(
                self.db,
                access=access("AGREGADOS:EXPORTAR"),
                payload=FreightPaymentSettlementCreateRequest(
                    data_de=self.period["data_de"],
                    data_ate=self.period["data_ate"],
                    tipo_transporte="AGREGADO",
                    acao="SOLICITAR",
                    responsaveis=["Motorista Agregado Teste"],
                ),
            )

        # Marca como pago e verifica ordenação (em aberto no topo, pago no final).
        paid = service.update_payment_settlement_status(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            codigo_pagamento=requested[0].codigo_pagamento,
            payload=FreightPaymentSettlementStatusRequest(
                acao="MARCAR_PAGO",
                data_pagamento=date(2026, 11, 6),
            ),
        )
        self.assertEqual(paid.status_pagamento, "PAGO")
        self.assertEqual(paid.data_pagamento, date(2026, 11, 6))

        report_after_pay = service.build_payment_report(
            self.db,
            access=access("AGREGADOS:VER"),
            tipo_transporte="AGREGADO",
            nome_transportador=None,
            sem_identificacao=False,
            **self.period,
        )
        self.assertEqual(report_after_pay.resumo_execucao.responsaveis_pagos, 1)
        self.assertEqual(report_after_pay.resumo_execucao.responsaveis_em_aberto, 1)
        self.assertEqual(report_after_pay.responsaveis[0].nome_transportador, "Agregado Dois Teste")
        self.assertEqual(report_after_pay.responsaveis[1].nome_transportador, "Motorista Agregado Teste")
        self.assertEqual(report_after_pay.responsaveis[1].status_pagamento, "PAGO")

        # Adiciona um novo frete na sexta para o Agregado 1 -> vira PARCIAL (sem duplicar o de terça!).
        self._create_freight(data_servico="2026-11-06", id_motorista_agregado=1)
        partial_report = service.build_payment_report(
            self.db,
            access=access("AGREGADOS:VER"),
            tipo_transporte="AGREGADO",
            nome_transportador="Motorista Agregado Teste",
            sem_identificacao=False,
            **self.period,
        )
        resp = partial_report.responsaveis[0]
        self.assertEqual(resp.status_pagamento, "PARCIAL")
        self.assertEqual(resp.valor_pago, Decimal("477.00"))
        self.assertEqual(resp.valor_em_aberto, Decimal("477.00"))

        # Alterar o frete já pago dispara detecção possui_alteracao=True!
        service.update_freight(
            self.db,
            codigo_frete=first.codigo_frete,
            payload=payload(data_servico="2026-11-03", id_motorista_agregado=1, valor_avaria="50"),
            idempotency_key=uuid4(),
            access=access("FRETES:CRIAR"),
        )
        divergent_report = service.build_payment_report(
            self.db,
            access=access("AGREGADOS:VER"),
            tipo_transporte="AGREGADO",
            nome_transportador="Motorista Agregado Teste",
            sem_identificacao=False,
            **self.period,
        )
        self.assertTrue(divergent_report.responsaveis[0].possui_alteracao)

        # Estornar libera o frete e preserva histórico de estorno.
        reversed_pay = service.update_payment_settlement_status(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            codigo_pagamento=paid.codigo_pagamento,
            payload=FreightPaymentSettlementStatusRequest(
                acao="ESTORNAR",
                motivo_estorno="Avaria corrigida após fechamento",
            ),
        )
        self.assertEqual(reversed_pay.status_pagamento, "ESTORNADO")
        reopened = service.build_payment_report(
            self.db,
            access=access("AGREGADOS:VER"),
            tipo_transporte="AGREGADO",
            nome_transportador="Motorista Agregado Teste",
            sem_identificacao=False,
            **self.period,
        )
        self.assertEqual(reopened.responsaveis[0].status_pagamento, "A_PAGAR")
        self.assertFalse(reopened.responsaveis[0].possui_alteracao)
        self.assertEqual(reopened.responsaveis[0].valor_em_aberto, Decimal("920.00"))

    def test_adjustments_installments_invoice_and_selective_xlsx_export_with_cpf(self):
        self._create_freight(data_servico="2026-11-03", id_motorista_agregado=1)
        # Cria pendência só para o Agregado 2 (não deve bloquear exportar o Agregado 1!).
        self._create_freight(
            data_servico="2026-11-04",
            id_motorista_agregado=4,
            rota_cidade="Rota sem tarifa",
        )

        # Lança vale parcelado em 2x semanais (R$ 100,01 -> 50,01 e 50,00).
        created_adj = service.create_payment_adjustments(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            payload=FreightPaymentAdjustmentCreateRequest(
                tipo_transporte="AGREGADO",
                nome_transportador="Motorista Agregado Teste",
                data_referencia=date(2026, 11, 3),
                natureza="DESCONTO",
                categoria="VALE",
                descricao="Vale combustível",
                valor=Decimal("100.01"),
                parcelas=2,
                periodicidade="SEMANAL",
            ),
        )
        self.assertEqual(len(created_adj), 2)
        self.assertEqual(created_adj[0].data_referencia, date(2026, 11, 3))
        self.assertEqual(created_adj[1].data_referencia, date(2026, 11, 10))
        self.assertEqual(created_adj[0].valor + created_adj[1].valor, Decimal("100.01"))

        # Exporta XLSX seletivamente só para o Agregado 1 mesmo havendo pendência no Agregado 2.
        xlsx_bytes = service.export_payment_report(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            data_de=self.period["data_de"],
            data_ate=self.period["data_ate"],
            tipo_transporte="AGREGADO",
            responsaveis=["Motorista Agregado Teste"],
        )
        ws = load_workbook(BytesIO(xlsx_bytes), data_only=False)["Sheet1"]
        self.assertEqual(ws["A4"].value, "Motorista Agregado Teste")
        self.assertEqual(ws["B4"].value, "123.456.789-01")
        self.assertEqual(Decimal(str(ws["E4"].value)), Decimal("477.00") - created_adj[0].valor)
        self.assertIn("Ajustes:", ws["F4"].value)

        # Fecha pagamento do Agregado 1 vinculando a 1ª parcela do vale -> excluir ajuste bloqueado!
        settled = service.create_payment_settlements(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            payload=FreightPaymentSettlementCreateRequest(
                data_de=self.period["data_de"],
                data_ate=self.period["data_ate"],
                tipo_transporte="AGREGADO",
                acao="MARCAR_PAGO",
                responsaveis=["Motorista Agregado Teste"],
                data_pagamento=date(2026, 11, 7),
            ),
        )
        self.assertEqual(settled[0].valor_ajustes, -created_adj[0].valor)
        with self.assertRaises(ConflictError):
            service.delete_payment_adjustment(
                self.db,
                access=access("AGREGADOS:EXPORTAR"),
                codigo_ajuste=created_adj[0].codigo_ajuste,
            )

        # Atualiza NF no fechamento e reexporta XLSX pelo codigo_pagamento.
        updated_nf = service.update_payment_settlement_invoice(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            codigo_pagamento=settled[0].codigo_pagamento,
            payload=FreightPaymentInvoiceUpdateRequest(
                nf_numero="NF-9001",
                nf_data=date(2026, 11, 7),
                nf_recebida=True,
            ),
        )
        self.assertTrue(updated_nf.nf_recebida)
        self.assertEqual(updated_nf.nf_numero, "NF-9001")
        batch_xlsx = service.export_payment_report(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            data_de=None,
            data_ate=None,
            tipo_transporte="AGREGADO",
            codigo_pagamento=settled[0].codigo_pagamento,
        )
        batch_ws = load_workbook(BytesIO(batch_xlsx), data_only=False)["Sheet1"]
        self.assertEqual(batch_ws["A4"].value, "Motorista Agregado Teste")
        self.assertIn("NF NF-9001", batch_ws["F4"].value)

        # A 2ª parcela (ainda aberta na semana seguinte) pode ser excluída normalmente.
        service.delete_payment_adjustment(
            self.db,
            access=access("AGREGADOS:EXPORTAR"),
            codigo_ajuste=created_adj[1].codigo_ajuste,
        )

    def test_person_admin_normalizes_cpf_cnpj_pix_and_nf_flag(self):
        created = catalog_admin_service.create_person(
            self.db,
            payload=PersonCreateRequest(
                nome_exibicao="Novo Agregado",
                tipo_funcao="MOTORISTA",
                tipo_transporte_entrega="TERCEIRIZADA",
                modalidade_terceirizada="AGREGADO",
                documento_fiscal="11122233344",
                chave_pix="novo@pix.com",
                exige_nota_fiscal=True,
            ),
            actor_id=1,
        )
        self.assertEqual(created.documento_fiscal, "111.222.333-44")
        self.assertEqual(created.chave_pix, "novo@pix.com")
        self.assertTrue(created.exige_nota_fiscal)


class FreightPaymentsRouterTests(TestCase):
    def setUp(self):
        self.engine, self.db = database()
        self.settings = Settings(_env_file=None, app_env="test")
        self.allowed = {"FRETES:VER", "FRETES:CRIAR", "AGREGADOS:VER", "AGREGADOS:EXPORTAR"}
        app = FastAPI()
        register_exception_handlers(app)
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        self.auth = AuthenticatedSession(
            user=AuthenticatedUser(id_usuario=1, username="teste", nome_completo="Usuário teste"),
            session_id=1,
        )
        app.dependency_overrides[get_current_auth_context] = lambda: self.auth
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.client.cookies.set(self.settings.session_cookie_name, "test-session")
        self.headers = {
            "Origin": "http://localhost:5173",
            "X-CSRF-Token": create_csrf_token("test-session", self.settings.session_signing_key),
            "Idempotency-Key": str(uuid4()),
        }

        def authorize(db, *, id_usuario, permission_code):
            if permission_code not in self.allowed:
                raise PermissionDeniedError()
            return access(permission_code, user_id=id_usuario)

        self.auth_patch = patch(
            "app.api.v1.dependencies.access_control_service.require_permission",
            side_effect=authorize,
        )
        self.settings_patch = patch("app.api.v1.dependencies.get_settings", return_value=self.settings)
        self.delivery_patch = patch(
            "app.modules.fretes.repository.get_driver_delivery_summary",
            return_value=("Rio das Ostras", ["Rio das Ostras"], 10, 2, 1, 1000),
        )
        self.auth_patch.start()
        self.settings_patch.start()
        self.delivery_patch.start()
        self.addCleanup(self.auth_patch.stop)
        self.addCleanup(self.settings_patch.stop)
        self.addCleanup(self.delivery_patch.stop)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_payment_settlements_adjustments_and_pending_summary_endpoints(self):
        created = self.client.post("/freights", json=payload().model_dump(mode="json"), headers=self.headers)
        self.assertEqual(created.status_code, 201, created.text)

        adj_resp = self.client.post(
            "/freights/payments/adjustments",
            json={
                "tipo_transporte": "AGREGADO",
                "nome_transportador": "Motorista Agregado Teste",
                "data_referencia": "2026-11-03",
                "natureza": "ACRESCIMO",
                "categoria": "PEDAGIO",
                "descricao": "Reembolso pedágio",
                "valor": "30.00",
                "parcelas": 1,
                "periodicidade": "SEMANAL",
            },
            headers=self.headers,
        )
        self.assertEqual(adj_resp.status_code, 201, adj_resp.text)

        settle_resp = self.client.post(
            "/freights/payments/settlements",
            json={
                "data_de": "2026-11-01",
                "data_ate": "2026-11-30",
                "tipo_transporte": "AGREGADO",
                "acao": "MARCAR_PAGO",
                "responsaveis": ["Motorista Agregado Teste"],
                "data_pagamento": "2026-11-06",
            },
            headers=self.headers,
        )
        self.assertEqual(settle_resp.status_code, 201, settle_resp.text)
        code = settle_resp.json()[0]["codigo_pagamento"]
        self.assertEqual(settle_resp.json()[0]["valor_liquido_registrado"], "507.00")

        hist_resp = self.client.get("/freights/payments/settlements")
        self.assertEqual(hist_resp.status_code, 200, hist_resp.text)
        self.assertEqual(hist_resp.json()["total"], 1)

        inv_resp = self.client.patch(
            f"/freights/payments/settlements/{code}/invoice",
            json={"nf_numero": "1234", "nf_data": "2026-11-06", "nf_recebida": True},
            headers=self.headers,
        )
        self.assertEqual(inv_resp.status_code, 200, inv_resp.text)
        self.assertTrue(inv_resp.json()["nf_recebida"])

        summary_resp = self.client.get("/freights/payments/pending-summary")
        self.assertEqual(summary_resp.status_code, 200, summary_resp.text)
        self.assertIn("responsaveis_em_aberto", summary_resp.json())

        # Sem permissão de exportação, não pode fechar pagamento nem criar ajuste.
        self.allowed.remove("AGREGADOS:EXPORTAR")
        denied = self.client.post(
            "/freights/payments/settlements",
            json={
                "data_de": "2026-11-01",
                "data_ate": "2026-11-30",
                "tipo_transporte": "AGREGADO",
                "acao": "SOLICITAR",
            },
            headers=self.headers,
        )
        self.assertEqual(denied.status_code, 403)
