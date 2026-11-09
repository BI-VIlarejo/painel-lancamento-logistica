"""Dados fictícios compartilhados pelos testes de Fretes."""

from datetime import date, datetime

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.model_registry  # noqa: F401
from app.core.orm import Base
from app.modules.access_control.service import AuthorizationContext, EffectiveGrant
from app.modules.auth.models import Usuario
from app.modules.catalogs.models import Pessoa, Setor
from app.modules.fretes.schemas import FreightInput


def payload(**changes) -> FreightInput:
    values = dict(
        data_servico=date(2026, 11, 3),
        tipo_transporte="AGREGADO",
        codigo_fonte_tarifa="AGREGADOS_CD",
        rota_cidade="Rio das Ostras",
        km_inicial="100",
        km_final="150",
        quantidade_entregas=10,
        peso_kg="1000",
        valor_nota="10000",
        valor_avaria="16",
    )
    values.update(changes)
    if "id_motorista_agregado" not in changes:
        values["id_motorista_agregado"] = (
            1 if values["tipo_transporte"] == "AGREGADO" else None
        )
    if "id_motorista_transportadora" not in changes:
        values["id_motorista_transportadora"] = (
            2 if values["tipo_transporte"] == "TRANSPORTADORA" else None
        )
    return FreightInput.model_validate(values)


def access(permission="FRETES:CRIAR", *, scope="GLOBAL", sector_id=None, user_id=1):
    resource, action = permission.split(":")
    return AuthorizationContext(
        id_usuario=user_id,
        permission_code=permission,
        grants=(
            EffectiveGrant(
                permission_code=permission,
                resource_code=resource,
                action=action,
                resource_id_setor=None,
                id_perfil=1,
                codigo_perfil="DEV",
                id_escopo=1,
                codigo_escopo=scope,
                tipo_escopo=scope,
                id_setor=sector_id,
                id_localidade=3 if scope == "LOCALIDADE" else None,
            ),
        ),
    )


def database():
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    db = Session(engine)
    now = datetime(2026, 11, 3, 12)
    for number in (1, 2):
        db.add(
            Usuario(
                id_usuario=number,
                username=f"teste{number}",
                nome_completo="Usuário teste",
                ativo=True,
                criado_em=now,
                atualizado_em=now,
                hash_senha="test-only",
                senha_alterada_em=now,
                troca_senha_obrigatoria=False,
            )
        )
    db.add(
        Setor(
            id_setor=10,
            codigo="TRANSPORTE",
            nome="Transporte",
            ativo=True,
            criado_em=now,
            atualizado_em=now,
        )
    )
    db.add(
        Pessoa(
            id_pessoa=1,
            codigo_pessoa="00000000-0000-0000-0000-000000000001",
            sistema_origem=None,
            codigo_pessoa_origem=None,
            nome_exibicao="Motorista Agregado Teste",
            tipo_funcao="MOTORISTA",
            tipo_transporte_entrega="TERCEIRIZADA",
            modalidade_terceirizada="AGREGADO",
            codigo_transportadora_independente=None,
            ativo=True,
            vigente_desde=date(2026, 1, 1),
            vigente_ate=None,
            criado_por=1,
            criado_em=now,
            atualizado_em=now,
        )
    )
    db.add(
        Pessoa(
            id_pessoa=2,
            codigo_pessoa="00000000-0000-0000-0000-000000000002",
            sistema_origem=None,
            codigo_pessoa_origem=None,
            nome_exibicao="Motorista Paulo Cruz Teste",
            tipo_funcao="MOTORISTA",
            tipo_transporte_entrega="TERCEIRIZADA",
            modalidade_terceirizada="TRANSPORTADORA_INDEPENDENTE",
            codigo_transportadora_independente="PAULO_CRUZ",
            ativo=True,
            vigente_desde=date(2026, 1, 1),
            vigente_ate=None,
            criado_por=1,
            criado_em=now,
            atualizado_em=now,
        )
    )
    db.add(
        Pessoa(
            id_pessoa=3,
            codigo_pessoa="00000000-0000-0000-0000-000000000003",
            sistema_origem=None,
            codigo_pessoa_origem=None,
            nome_exibicao="Motorista Just In Time Teste",
            tipo_funcao="MOTORISTA",
            tipo_transporte_entrega="TERCEIRIZADA",
            modalidade_terceirizada="TRANSPORTADORA_INDEPENDENTE",
            codigo_transportadora_independente="JUST_IN_TIME",
            ativo=True,
            vigente_desde=date(2026, 1, 1),
            vigente_ate=None,
            criado_por=1,
            criado_em=now,
            atualizado_em=now,
        )
    )
    db.commit()
    return engine, db
