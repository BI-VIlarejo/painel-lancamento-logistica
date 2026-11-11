"""Contratos HTTP, autorização por ação e proteção CSRF de Fretes."""

from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from freight_support import access, database, payload

from app.api.v1.dependencies import get_current_auth_context
from app.core.config import Settings
from app.core.database import get_db
from app.core.exceptions import PermissionDeniedError, register_exception_handlers
from app.core.security import create_csrf_token
from app.modules.auth.schemas import AuthenticatedUser
from app.modules.auth.service import AuthenticatedSession
from app.modules.fretes.router import router


class FreightRouterTests(TestCase):
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
        self.app = app
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

        auth_patch = patch(
            "app.api.v1.dependencies.access_control_service.require_permission",
            side_effect=authorize,
        )
        settings_patch = patch("app.api.v1.dependencies.get_settings", return_value=self.settings)
        delivery_summary_patch = patch(
            "app.modules.fretes.repository.get_driver_delivery_summary",
            return_value=("Rio das Ostras", ["Rio das Ostras"], 10, 2, 1, 1000),
        )
        auth_patch.start()
        settings_patch.start()
        delivery_summary_patch.start()
        self.addCleanup(auth_patch.stop)
        self.addCleanup(settings_patch.stop)
        self.addCleanup(delivery_summary_patch.stop)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_quote_and_create_return_decimal_contract_and_prevent_duplicate_retry(self):
        body = payload().model_dump(mode="json")
        quote = self.client.post("/freights/quote", json=body)
        self.assertEqual(quote.status_code, 200)
        self.assertEqual(quote.json()["valor_frete_bruto"], "493.00")
        created = self.client.post("/freights", json=body, headers=self.headers)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.headers["cache-control"], "no-store")
        again = self.client.post("/freights", json=body, headers=self.headers)
        self.assertEqual(again.json()["codigo_frete"], created.json()["codigo_frete"])

    def test_carrier_driver_options_include_driver_and_company_together(self):
        response = self.client.get(
            "/freights/carrier-drivers", params={"data_servico": "2026-11-03"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json(),
            [
                {
                    "id_motorista": 3,
                    "nome_motorista": "Motorista Just In Time Teste",
                    "codigo_transportadora": "JUST_IN_TIME",
                    "nome_transportadora": "JUST IN TIME",
                },
                {
                    "id_motorista": 2,
                    "nome_motorista": "Motorista Paulo Cruz Teste",
                    "codigo_transportadora": "PAULO_CRUZ",
                    "nome_transportadora": "Paulo Cruz",
                },
            ],
        )

    def test_create_requires_csrf_and_trusted_origin(self):
        for changes in ({"X-CSRF-Token": "invalid"}, {"Origin": "https://untrusted.invalid"}):
            with self.subTest(changes=changes):
                response = self.client.post(
                    "/freights",
                    json=payload().model_dump(mode="json"),
                    headers=self.headers | changes,
                )
                self.assertEqual(response.status_code, 403)

    def test_create_requires_idempotency_key_and_valid_odometer(self):
        headers = {key: value for key, value in self.headers.items() if key != "Idempotency-Key"}
        response = self.client.post(
            "/freights", json=payload().model_dump(mode="json"), headers=headers
        )
        self.assertEqual(response.status_code, 422)
        response = self.client.post(
            "/freights",
            json=payload().model_dump(mode="json") | {"km_final": "99"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)

    def test_each_endpoint_requires_its_own_permission(self):
        cases = [
            ("GET", "/freights", "FRETES:VER"),
            ("GET", "/freights/tariff-options", "FRETES:CRIAR"),
            ("GET", "/freights/carrier-drivers", "FRETES:CRIAR"),
            ("POST", "/freights/quote", "FRETES:CRIAR"),
            ("POST", "/freights", "FRETES:CRIAR"),
            ("GET", "/freights/payments/report", "AGREGADOS:VER"),
            ("GET", "/freights/payments/export.xlsx", "AGREGADOS:EXPORTAR"),
        ]
        for method, path, permission in cases:
            with self.subTest(path=path):
                self.allowed.remove(permission)
                params = (
                    {"data_servico": "2026-11-03"}
                    if path == "/freights/carrier-drivers"
                    else {"data_de": "2026-11-01", "data_ate": "2026-11-30"}
                )
                response = self.client.request(
                    method,
                    path,
                    headers=self.headers,
                    params=params,
                    json=payload().model_dump(mode="json") if method == "POST" else None,
                )
                self.assertEqual(response.status_code, 403, response.text)
                self.allowed.add(permission)

    def test_unauthenticated_request_is_rejected_before_query(self):
        del self.app.dependency_overrides[get_current_auth_context]
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/freights").status_code, 401)

    def test_export_has_download_and_no_cache_headers(self):
        response = self.client.get(
            "/freights/payments/export.xlsx",
            params={"data_de": "2026-11-01", "data_ate": "2026-11-30"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("attachment", response.headers["content-disposition"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(
            response.headers["content-type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertTrue(response.content.startswith(b"PK\x03\x04"))

    def test_invalid_filter_and_inverted_period_are_rejected(self):
        self.assertEqual(self.client.get("/freights?limit=101").status_code, 422)
        response = self.client.get(
            "/freights/payments/report", params={"data_de": "2026-11-30", "data_ate": "2026-11-01"}
        )
        self.assertEqual(response.status_code, 409)
