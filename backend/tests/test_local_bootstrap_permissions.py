"""Testes da matriz local de permissões carregada pelo bootstrap DEV."""

import unittest

from app.modules.access_control.models import Permissao
from scripts.local_dev_bootstrap import PERMISSION_SEED, _profile_permissions


class LocalBootstrapPermissionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.permissions = [
            Permissao(
                id_permissao=index,
                codigo=f"{resource}:{action}",
            )
            for index, (resource, action, _description) in enumerate(
                PERMISSION_SEED,
                start=1,
            )
        ]

    def test_managers_directors_and_developers_receive_all_local_actions(self) -> None:
        all_codes = {permission.codigo for permission in self.permissions}

        for profile_code in ("DEV", "GESTOR", "DIRETORIA"):
            with self.subTest(profile=profile_code):
                granted = {
                    permission.codigo
                    for permission in _profile_permissions(
                        profile_code=profile_code,
                        permissions=self.permissions,
                    )
                }
                self.assertEqual(granted, all_codes)

    def test_operator_receives_expected_pilot_permissions(self) -> None:
        granted = {
            permission.codigo
            for permission in _profile_permissions(
                profile_code="OPERADOR",
                permissions=self.permissions,
            )
        }

        self.assertEqual(
            granted,
            {
                "CADASTROS:ADMINISTRAR",
                "ENTREGAS_DIARIAS:VER",
                "ENTREGAS_DIARIAS:CRIAR",
                "ENTREGAS_DIARIAS:EDITAR_RASCUNHO",
                "FEEDBACK_CLIENTES:ACESSAR",
                "FEEDBACK_CLIENTES:VER",
                "FEEDBACK_CLIENTES:CRIAR",
                "FEEDBACK_CLIENTES:EXPORTAR",
            },
        )


if __name__ == "__main__":
    unittest.main()
