"""Regras de acesso, cálculo e consolidação de Fretes."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from hashlib import sha256
from io import BytesIO
from zoneinfo import ZoneInfo
from uuid import UUID, uuid4

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.page import PageMargins
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ServiceUnavailableError,
)
from app.modules.access_control.catalog import FREIGHT_SECTOR_CODE
from app.modules.access_control.service import AuthorizationContext

from . import repository
from .calculator import FreightCalculation, calculate_freight
from .models import Frete, FreteEvento
from .schemas import (
    FreightAggregateDriverOption,
    FreightDeliverySummary,
    FreightInput,
    FreightPage,
    FreightPaymentOptions,
    FreightPaymentReport,
    FreightQuoteResponse,
    FreightResponse,
    FreightStatus,
    PaymentTransportType,
    TariffSource,
    TransportType,
    TruckType,
)


def _utc_now() -> datetime:
    """Fornece horário UTC sem timezone, compatível com as colunas DATETIME."""
    return datetime.now(UTC).replace(tzinfo=None)


def _request_fingerprint(payload: FreightInput) -> str:
    """Cria hash estável do pedido para validar reenvios com a mesma chave."""
    serialized = json.dumps(
        payload.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(serialized.encode("utf-8")).hexdigest()


def _database_unavailable(db: Session, exc: SQLAlchemyError) -> ServiceUnavailableError:
    """Desfaz a transação com erro e converte falha SQL em resposta controlada."""
    try:
        db.rollback()
    except SQLAlchemyError:
        pass
    return ServiceUnavailableError("O módulo de Fretes está temporariamente indisponível.")


def _transport_access(
    db: Session,
    access: AuthorizationContext,
) -> int:
    """Exige escopo global ou do setor Transporte e devolve o ID do setor."""
    sector = repository.get_active_sector_by_code(db, codigo=FREIGHT_SECTOR_CODE)
    if sector is None:
        raise NotFoundError("O setor Transporte não está ativo no Portal.")
    grants = tuple(
        grant
        for grant in access.grants
        if grant.tipo_escopo == "GLOBAL"
        or (grant.tipo_escopo == "SETOR" and grant.id_setor == sector.id_setor)
    )
    if not grants:
        raise PermissionDeniedError("Fretes exige acesso global ou acesso ao setor Transporte.")
    return sector.id_setor


def _quote_response(calculation: FreightCalculation) -> FreightQuoteResponse:
    """Converte o resultado interno da calculadora no contrato da API."""
    return FreightQuoteResponse(
        status_calculo=calculation.status,
        valor_frete_bruto=calculation.valor_frete_bruto,
        percentual_frete=calculation.percentual_frete,
        motivo_pendencia=calculation.motivo_pendencia,
        detalhe_calculo=calculation.detalhe,
    )


def _tariff_source(value: str | None) -> TariffSource | None:
    """Valida e tipa o código da tarifa lido de uma linha persistida."""
    if value is None:
        return None
    if value == "AGREGADOS_CD":
        return "AGREGADOS_CD"
    if value == "JUST_IN_TIME":
        return "JUST_IN_TIME"
    if value == "PAULO_CRUZ":
        return "PAULO_CRUZ"
    raise ValueError(f"Código de fonte de tarifa inválido no frete: {value!r}")


def _transport_type(value: str) -> TransportType:
    """Valida e tipa a modalidade do transporte persistida."""
    if value == "PROPRIO":
        return "PROPRIO"
    if value == "AGREGADO":
        return "AGREGADO"
    if value == "TRANSPORTADORA":
        return "TRANSPORTADORA"
    raise ValueError(f"Tipo de transporte inválido no frete: {value!r}")


def _freight_status(value: str) -> FreightStatus:
    """Valida e tipa o status do cálculo lido de uma linha persistida."""
    if value == "CALCULADO":
        return "CALCULADO"
    if value == "PENDENTE_CONFERENCIA":
        return "PENDENTE_CONFERENCIA"
    raise ValueError(f"Status de cálculo inválido no frete: {value!r}")


def _truck_type(value: str | None) -> TruckType:
    """Valida e tipa o modelo de caminhão armazenado no lançamento."""
    if value is None:
        return None
    if value == "SAVEIRO":
        return "SAVEIRO"
    if value == "KIA_BONGO":
        return "KIA_BONGO"
    if value == "CAMINHAO_3_4":
        return "CAMINHAO_3_4"
    if value == "CAMINHAO_TOCO":
        return "CAMINHAO_TOCO"
    raise ValueError(f"Tipo de caminhão inválido no frete: {value!r}")


def _freight_response(
    freight: Frete,
    *,
    cancellation: FreteEvento | None = None,
) -> FreightResponse:
    """Converte o registro operacional preservando dados e situação do frete."""
    calculation_detail = {
        key: value for key, value in freight.detalhe_calculo.items() if key != "request_fingerprint"
    }
    return FreightResponse(
        id_frete=freight.id_frete,
        codigo_frete=UUID(freight.codigo_frete),
        tipo_transporte=_transport_type(freight.tipo_transporte),
        nome_transportador=freight.nome_transportador,
        id_motorista_agregado=freight.id_motorista_agregado,
        id_motorista_transportadora=freight.id_motorista_transportadora,
        nome_motorista_transportadora=freight.nome_motorista_transportadora,
        codigo_fonte_tarifa=_tariff_source(freight.codigo_fonte_tarifa),
        data_servico=freight.data_servico,
        rota_cidade=freight.rota_cidade,
        km_inicial=freight.km_inicial,
        km_final=freight.km_final,
        km_rodado=freight.km_rodado,
        quantidade_entregas=freight.quantidade_entregas,
        peso_kg=freight.peso_kg,
        valor_nota=freight.valor_nota,
        tipo_caminhao=_truck_type(freight.tipo_caminhao),
        codigo_zona_jit=freight.codigo_zona_jit,
        adicionais_jit=freight.adicionais_jit,
        valor_frete_bruto=freight.valor_frete_bruto,
        valor_avaria=freight.valor_avaria,
        quantidade_avarias=freight.quantidade_avarias,
        valor_frete_pago=freight.valor_frete_pago,
        percentual_frete=freight.percentual_frete,
        status_calculo=_freight_status(freight.status_calculo),
        motivo_pendencia=freight.motivo_pendencia,
        detalhe_calculo=calculation_detail,
        criado_por=freight.criado_por,
        criado_em=freight.criado_em,
        cancelado=cancellation is not None,
        cancelado_em=cancellation.ocorrido_em if cancellation else None,
        cancelado_por=cancellation.id_usuario_ator if cancellation else None,
        justificativa_cancelamento=(
            str(cancellation.detalhes.get("justificativa", "")) or None
            if cancellation
            else None
        ),
    )


def _prepare_freight_payload(
    db: Session,
    payload: FreightInput,
    *,
    require_delivery_data: bool,
) -> tuple[FreightInput, dict[str, object] | None]:
    """Substitui os campos agregados pelos dados vigentes de equipe e Entregas."""
    if payload.tipo_transporte == "TRANSPORTADORA":
        driver_id = payload.id_motorista_transportadora
        if driver_id is None or payload.codigo_fonte_tarifa is None:
            raise ConflictError("Selecione o motorista da transportadora independente.")
        driver = repository.get_carrier_driver(
            db,
            id_motorista=driver_id,
            data_servico=payload.data_servico,
            codigo_transportadora=payload.codigo_fonte_tarifa,
        )
        if driver is None:
            raise NotFoundError(
                "O motorista não está ativo e vinculado à transportadora na data do serviço."
            )
        return (
            payload.model_copy(update={"quantidade_avarias": 0}),
            {
                "id_motorista_transportadora": driver.id_pessoa,
                "nome_motorista_transportadora": driver.nome_exibicao,
            },
        )
    if payload.tipo_transporte != "AGREGADO":
        return payload.model_copy(update={"quantidade_avarias": 0}), None

    driver_id = payload.id_motorista_agregado
    if driver_id is None:
        raise ConflictError("Selecione o motorista agregado no cadastro de equipes.")
    driver = repository.get_aggregate_driver(
        db,
        id_motorista=driver_id,
        data_servico=payload.data_servico,
    )
    if driver is None:
        raise NotFoundError(
            "O motorista não está ativo como agregado classificado na data do serviço."
        )

    route, cities, deliveries, damages, delivery_rows = repository.get_driver_delivery_summary(
        db,
        id_motorista=driver_id,
        data_servico=payload.data_servico,
    )
    if require_delivery_data and delivery_rows == 0:
        raise ConflictError(
            "Não há entregas confirmadas para esse motorista na data selecionada."
        )
    prepared = payload.model_copy(
        update={
            "nome_transportador": driver.nome_exibicao,
            "rota_cidade": route or payload.rota_cidade,
            "quantidade_entregas": deliveries,
            "quantidade_avarias": damages,
        }
    )
    source_detail: dict[str, object] = {
        "id_motorista_agregado": driver.id_pessoa,
        "nome_motorista_agregado": driver.nome_exibicao,
        "data_entregas_consultadas": payload.data_servico.isoformat(),
        "cidades_entregas": cities,
        "quantidade_entregas_origem": deliveries,
        "quantidade_avarias_origem": damages,
        "quantidade_registros_entrega": delivery_rows,
    }
    return prepared, source_detail


def _freight_calculation(
    db: Session,
    payload: FreightInput,
    *,
    require_delivery_data: bool,
) -> tuple[FreightInput, FreightCalculation]:
    """Prepara a origem dos dados e calcula a tarifa com valores confirmados."""
    prepared, source_detail = _prepare_freight_payload(
        db,
        payload,
        require_delivery_data=require_delivery_data,
    )
    calculation = calculate_freight(prepared)
    if source_detail is not None:
        detail_key = (
            "motorista_transportadora"
            if payload.tipo_transporte == "TRANSPORTADORA"
            else "origem_entregas"
        )
        calculation = replace(
            calculation,
            detalhe={**calculation.detalhe, detail_key: source_detail},
        )
    return prepared, calculation


def _carrier_driver_name(calculation: FreightCalculation) -> str | None:
    """Obtém o nome validado para guardar como fotografia do motorista."""
    value = calculation.detalhe.get("motorista_transportadora")
    if not isinstance(value, dict):
        return None
    name = value.get("nome_motorista_transportadora")
    return name if isinstance(name, str) else None


def get_tariff_options(
    db: Session,
    *,
    access: AuthorizationContext,
) -> dict[str, object]:
    """Entrega as opções da tarifa somente a usuários autorizados de Fretes."""
    from .tariff_catalog import tariff_options

    try:
        _transport_access(db, access)
        return tariff_options()
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_aggregate_drivers(
    db: Session,
    *,
    data_servico: date,
    access: AuthorizationContext,
) -> list[FreightAggregateDriverOption]:
    """Entrega motoristas terceiros vigentes para a data do serviço."""
    try:
        _transport_access(db, access)
        return [
            FreightAggregateDriverOption(
                id_motorista=driver.id_pessoa,
                nome_motorista=driver.nome_exibicao,
            )
            for driver in repository.list_aggregate_drivers(
                db,
                data_servico=data_servico,
            )
        ]
    except PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_carrier_drivers(
    db: Session,
    *,
    data_servico: date,
    codigo_transportadora: str,
    access: AuthorizationContext,
) -> list[FreightAggregateDriverOption]:
    """Lista os motoristas da transportadora independente selecionada."""
    try:
        _transport_access(db, access)
        return [
            FreightAggregateDriverOption(
                id_motorista=driver.id_pessoa,
                nome_motorista=driver.nome_exibicao,
            )
            for driver in repository.list_carrier_drivers(
                db,
                data_servico=data_servico,
                codigo_transportadora=codigo_transportadora,
            )
        ]
    except PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_delivery_summary(
    db: Session,
    *,
    data_servico: date,
    id_motorista: int,
    access: AuthorizationContext,
) -> FreightDeliverySummary:
    """Consulta a rota, o volume e as avarias confirmadas de um motorista."""
    try:
        _transport_access(db, access)
        driver = repository.get_aggregate_driver(
            db,
            id_motorista=id_motorista,
            data_servico=data_servico,
        )
        if driver is None:
            raise NotFoundError(
                "O motorista não está ativo como agregado classificado na data do serviço."
            )
        route, cities, deliveries, damages, delivery_rows = repository.get_driver_delivery_summary(
            db,
            id_motorista=id_motorista,
            data_servico=data_servico,
        )
        return FreightDeliverySummary(
            id_motorista=id_motorista,
            data_servico=data_servico,
            rota_cidade=route,
            cidades=cities,
            quantidade_entregas=deliveries,
            quantidade_avarias=damages,
            quantidade_registros=delivery_rows,
        )
    except PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def quote_freight(
    db: Session,
    *,
    payload: FreightInput,
    access: AuthorizationContext,
) -> FreightQuoteResponse:
    """Simula um lançamento sem persistir dados ou gerar evento de auditoria."""
    try:
        _transport_access(db, access)
        _, calculation = _freight_calculation(
            db,
            payload,
            require_delivery_data=True,
        )
        return _quote_response(calculation)
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def create_freight(
    db: Session,
    *,
    payload: FreightInput,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> FreightResponse:
    """Calcula e grava um frete com chave idempotente e evento de auditoria."""
    try:
        sector_id = _transport_access(db, access)
        previous = repository.get_freight_by_idempotency_key(
            db,
            idempotency_key=idempotency_key,
        )
        if previous is not None:
            if previous.id_setor != sector_id or previous.criado_por != access.id_usuario:
                raise ConflictError("A chave de idempotência já foi utilizada.")
            fingerprint = _request_fingerprint(payload)
            if previous.detalhe_calculo.get("request_fingerprint") != fingerprint:
                raise ConflictError(
                    "A chave de idempotência já foi usada com outros dados de frete."
                )
            return _freight_response(previous)

        prepared_payload, calculation = _freight_calculation(
            db,
            payload,
            require_delivery_data=True,
        )
        # A repetição idempotente compara o mesmo pedido recebido do cliente.
        # `prepared_payload` já contém o nome/rota/contagens recalculados do banco.
        request_fingerprint = _request_fingerprint(payload)
        calculation_detail = {
            **calculation.detalhe,
            "request_fingerprint": request_fingerprint,
        }
        gross = calculation.valor_frete_bruto
        paid: Decimal | None = None
        if gross is not None:
            if prepared_payload.valor_avaria > gross:
                raise ConflictError("O valor da avaria não pode superar o frete calculado.")
            paid = gross - prepared_payload.valor_avaria

        now = _utc_now()
        freight = Frete(
            codigo_frete=str(uuid4()),
            chave_idempotencia=str(idempotency_key),
            id_setor=sector_id,
            tipo_transporte=prepared_payload.tipo_transporte,
            nome_transportador=prepared_payload.nome_transportador,
            id_motorista_agregado=prepared_payload.id_motorista_agregado,
            id_motorista_transportadora=prepared_payload.id_motorista_transportadora,
            nome_motorista_transportadora=_carrier_driver_name(calculation),
            codigo_fonte_tarifa=prepared_payload.codigo_fonte_tarifa,
            data_servico=prepared_payload.data_servico,
            rota_cidade=prepared_payload.rota_cidade,
            km_inicial=prepared_payload.km_inicial,
            km_final=prepared_payload.km_final,
            km_rodado=prepared_payload.km_rodado,
            quantidade_entregas=prepared_payload.quantidade_entregas,
            peso_kg=prepared_payload.peso_kg,
            valor_nota=prepared_payload.valor_nota,
            tipo_caminhao=prepared_payload.tipo_caminhao,
            codigo_zona_jit=prepared_payload.codigo_zona_jit,
            adicionais_jit=prepared_payload.adicionais_jit,
            valor_frete_bruto=gross,
            valor_avaria=prepared_payload.valor_avaria,
            quantidade_avarias=prepared_payload.quantidade_avarias,
            valor_frete_pago=paid,
            percentual_frete=calculation.percentual_frete,
            status_calculo=calculation.status,
            motivo_pendencia=calculation.motivo_pendencia,
            detalhe_calculo=calculation_detail,
            criado_por=access.id_usuario,
            criado_em=now,
        )
        repository.save_freight(
            db,
            freight,
            actor_id=access.id_usuario,
            occurred_at=now,
        )
        db.commit()
        db.refresh(freight)
        return _freight_response(freight)
    except ConflictError, PermissionDeniedError, NotFoundError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(
            "A solicitação de lançamento foi repetida ou conflita com um registro."
        ) from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_freight(
    db: Session,
    *,
    codigo_frete: UUID,
    access: AuthorizationContext,
) -> FreightResponse:
    """Carrega os dados completos do frete selecionado dentro do setor permitido."""
    try:
        sector_id = _transport_access(db, access)
        freight = repository.get_freight_by_code(
            db,
            codigo_frete=codigo_frete,
            id_setor=sector_id,
        )
        if freight is None:
            raise NotFoundError("Lançamento de frete não encontrado.")
        cancellations = repository.list_freight_cancellations(
            db,
            freight_ids=[freight.id_frete],
        )
        return _freight_response(freight, cancellation=cancellations.get(freight.id_frete))
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def update_freight(
    db: Session,
    *,
    codigo_frete: UUID,
    payload: FreightInput,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> FreightResponse:
    """Atualiza o lançamento, recalcula a tarifa e guarda snapshots na auditoria."""
    try:
        sector_id = _transport_access(db, access)
        freight = repository.get_freight_by_code(
            db,
            codigo_frete=codigo_frete,
            id_setor=sector_id,
            lock=True,
        )
        if freight is None:
            raise NotFoundError("Lançamento de frete não encontrado.")

        events = repository.list_freight_events(db, id_frete=freight.id_frete)
        request_fingerprint = _request_fingerprint(payload)
        cancellation = next(
            (event for event in events if event.tipo_evento == "FRETE_CANCELADO"),
            None,
        )
        prior_event = next(
            (
                event
                for event in events
                if event.detalhes.get("idempotency_key") == str(idempotency_key)
            ),
            None,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "FRETE_ATUALIZADO"
                and prior_event.id_usuario_ator == access.id_usuario
                and prior_event.detalhes.get("request_fingerprint") == request_fingerprint
            ):
                return _freight_response(freight, cancellation=cancellation)
            raise ConflictError("A chave de idempotência já foi utilizada.")

        if cancellation is not None:
            raise ConflictError("Um frete cancelado não pode ser editado.")

        prepared_payload, calculation = _freight_calculation(
            db,
            payload,
            require_delivery_data=True,
        )
        gross = calculation.valor_frete_bruto
        paid: Decimal | None = None
        if gross is not None:
            if prepared_payload.valor_avaria > gross:
                raise ConflictError("O valor da avaria não pode superar o frete calculado.")
            paid = gross - prepared_payload.valor_avaria

        before = _freight_response(freight).model_dump(mode="json")
        freight.tipo_transporte = prepared_payload.tipo_transporte
        freight.nome_transportador = prepared_payload.nome_transportador
        freight.id_motorista_agregado = prepared_payload.id_motorista_agregado
        freight.id_motorista_transportadora = prepared_payload.id_motorista_transportadora
        freight.nome_motorista_transportadora = _carrier_driver_name(calculation)
        freight.codigo_fonte_tarifa = prepared_payload.codigo_fonte_tarifa
        freight.data_servico = prepared_payload.data_servico
        freight.rota_cidade = prepared_payload.rota_cidade
        freight.km_inicial = prepared_payload.km_inicial
        freight.km_final = prepared_payload.km_final
        freight.km_rodado = prepared_payload.km_rodado
        freight.quantidade_entregas = prepared_payload.quantidade_entregas
        freight.peso_kg = prepared_payload.peso_kg
        freight.valor_nota = prepared_payload.valor_nota
        freight.tipo_caminhao = prepared_payload.tipo_caminhao
        freight.codigo_zona_jit = prepared_payload.codigo_zona_jit
        freight.adicionais_jit = prepared_payload.adicionais_jit
        freight.valor_frete_bruto = gross
        freight.valor_avaria = prepared_payload.valor_avaria
        freight.quantidade_avarias = prepared_payload.quantidade_avarias
        freight.valor_frete_pago = paid
        freight.percentual_frete = calculation.percentual_frete
        freight.status_calculo = calculation.status
        freight.motivo_pendencia = calculation.motivo_pendencia
        freight.detalhe_calculo = {
            **calculation.detalhe,
            "request_fingerprint": request_fingerprint,
        }
        now = _utc_now()
        after = _freight_response(freight).model_dump(mode="json")
        db.add(
            FreteEvento(
                id_frete=freight.id_frete,
                id_usuario_ator=access.id_usuario,
                tipo_evento="FRETE_ATUALIZADO",
                ocorrido_em=now,
                detalhes={
                    "idempotency_key": str(idempotency_key),
                    "request_fingerprint": request_fingerprint,
                    "antes": before,
                    "depois": after,
                },
            )
        )
        db.commit()
        db.refresh(freight)
        return _freight_response(freight)
    except ConflictError, PermissionDeniedError, NotFoundError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A edição conflita com um evento já registrado.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def cancel_freight(
    db: Session,
    *,
    codigo_frete: UUID,
    justificativa: str,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> None:
    """Cancela sem apagar o frete e registra justificativa e snapshot na auditoria."""
    try:
        sector_id = _transport_access(db, access)
        freight = repository.get_freight_by_code(
            db,
            codigo_frete=codigo_frete,
            id_setor=sector_id,
            lock=True,
        )
        if freight is None:
            raise NotFoundError("Lançamento de frete não encontrado.")

        events = repository.list_freight_events(db, id_frete=freight.id_frete)
        prior_event = next(
            (
                event
                for event in events
                if event.detalhes.get("idempotency_key") == str(idempotency_key)
            ),
            None,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "FRETE_CANCELADO"
                and prior_event.id_usuario_ator == access.id_usuario
                and prior_event.detalhes.get("justificativa") == justificativa
            ):
                return
            raise ConflictError("A chave de idempotência já foi utilizada.")
        if any(event.tipo_evento == "FRETE_CANCELADO" for event in events):
            raise ConflictError("Este frete já está cancelado.")

        now = _utc_now()
        db.add(
            FreteEvento(
                id_frete=freight.id_frete,
                id_usuario_ator=access.id_usuario,
                tipo_evento="FRETE_CANCELADO",
                ocorrido_em=now,
                detalhes={
                    "idempotency_key": str(idempotency_key),
                    "justificativa": justificativa,
                    "frete": _freight_response(freight).model_dump(mode="json"),
                },
            )
        )
        db.commit()
    except ConflictError, PermissionDeniedError, NotFoundError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("O cancelamento conflita com uma ação já registrada.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_freights(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date | None,
    data_ate: date | None,
    tipo_transporte: TransportType | None,
    status_calculo: str | None,
    limit: int,
    offset: int,
) -> FreightPage:
    """Consulta lançamentos do setor com filtros de período e paginação."""
    try:
        sector_id = _transport_access(db, access)
        if data_de is not None and data_ate is not None and data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        rows, total = repository.list_freights(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            status_calculo=status_calculo,
            limit=limit,
            offset=offset,
        )
        cancellations = repository.list_freight_cancellations(
            db,
            freight_ids=[freight.id_frete for freight in rows],
        )
        return FreightPage(
            items=[
                _freight_response(freight, cancellation=cancellations.get(freight.id_frete))
                for freight in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def build_payment_report(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date,
    data_ate: date,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
) -> FreightPaymentReport:
    """Consolida por período, modalidade e responsável os fretes de terceiros."""
    try:
        sector_id = _transport_access(db, access)
        if data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        if sem_identificacao and tipo_transporte != "AGREGADO":
            raise ConflictError("A opção sem identificação só se aplica aos agregados.")
        if sem_identificacao and nome_transportador is not None:
            raise ConflictError("Escolha um nome ou a opção sem identificação, não ambos.")
        records = repository.list_payment_freights(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
            sem_identificacao=sem_identificacao,
        )
        return _payment_report_from_records(
            records,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
            sem_identificacao=sem_identificacao,
        )
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def build_payment_options(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date,
    data_ate: date,
) -> FreightPaymentOptions:
    """Lista os responsáveis que têm lançamentos de pagamento no período."""
    try:
        sector_id = _transport_access(db, access)
        if data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        records = repository.list_payment_freights(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
        )
        aggregate_names = {
            freight.nome_transportador
            for freight in records
            if freight.tipo_transporte == "AGREGADO" and freight.nome_transportador
        }
        carrier_names = {
            freight.nome_transportador
            for freight in records
            if freight.tipo_transporte == "TRANSPORTADORA" and freight.nome_transportador
        }
        return FreightPaymentOptions(
            agregados=sorted(aggregate_names, key=str.casefold),
            transportadoras=sorted(carrier_names, key=str.casefold),
            agregados_sem_identificacao=any(
                freight.tipo_transporte == "AGREGADO" and freight.nome_transportador is None
                for freight in records
            ),
        )
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def _payment_report_from_records(
    records: list[Frete],
    *,
    data_de: date,
    data_ate: date,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
) -> FreightPaymentReport:
    """Soma lançamentos já filtrados e registra os critérios no resultado."""
    pending_freights = 0
    gross_total = Decimal("0")
    damage_total = Decimal("0")
    net_total = Decimal("0")

    for freight in records:
        if freight.status_calculo != "CALCULADO" or freight.valor_frete_pago is None:
            pending_freights += 1
            continue

        gross = freight.valor_frete_bruto or Decimal("0")
        damage = freight.valor_avaria
        net = freight.valor_frete_pago
        gross_total += gross
        damage_total += damage
        net_total += net

    return FreightPaymentReport(
        data_de=data_de,
        data_ate=data_ate,
        tipo_transporte=tipo_transporte,
        nome_transportador=nome_transportador,
        sem_identificacao=sem_identificacao,
        quantidade_fretes=len(records),
        quantidade_pendentes=pending_freights,
        valor_frete_bruto=gross_total,
        valor_avarias=damage_total,
        valor_a_pagar=net_total,
    )


def export_payment_report(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date,
    data_ate: date,
    tipo_transporte: PaymentTransportType,
    nome_transportador: str | None,
    sem_identificacao: bool,
) -> bytes:
    """Gera a solicitação XLSX no formato da planilha usada pela operação."""
    try:
        sector_id = _transport_access(db, access)
        if data_de > data_ate:
            raise ConflictError("A data inicial deve ser anterior à data final.")
        if sem_identificacao and tipo_transporte != "AGREGADO":
            raise ConflictError("A opção sem identificação só se aplica aos agregados.")
        if sem_identificacao and nome_transportador is not None:
            raise ConflictError("Escolha um nome ou a opção sem identificação, não ambos.")
        records = repository.list_payment_freights(
            db,
            id_setor=sector_id,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
            sem_identificacao=sem_identificacao,
        )
        report = _payment_report_from_records(
            records,
            data_de=data_de,
            data_ate=data_ate,
            tipo_transporte=tipo_transporte,
            nome_transportador=nome_transportador,
            sem_identificacao=sem_identificacao,
        )
    except ConflictError, PermissionDeniedError, NotFoundError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc

    if report.quantidade_pendentes:
        raise ConflictError(
            "Resolva os fretes pendentes de conferência antes de exportar o pagamento."
        )

    grouped: dict[str, dict[str, object]] = {}
    for freight in records:
        # Pendências são bloqueadas acima; mantenha a proteção caso a regra mude.
        if freight.status_calculo != "CALCULADO" or freight.valor_frete_pago is None:
            continue
        responsible = freight.nome_transportador or "Sem identificação"
        row = grouped.setdefault(
            responsible,
            {
                "days": set(),
                "net": Decimal("0"),
            },
        )
        days = row["days"]
        assert isinstance(days, set)
        days.add(freight.data_servico)
        row["net"] = Decimal(row["net"]) + freight.valor_frete_pago

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Sheet1"
    worksheet.sheet_view.showGridLines = False
    workbook.properties.creator = "Portal de Logística"
    workbook.properties.title = "Solicitação de pagamento de Fretes"

    dark = "FF000000"
    dark_gray = "FF808080"
    medium_gray = "FF404040"
    white = "FFFFFFFF"
    black = "FF000000"
    thin = Side(style="thin", color=black)
    medium = Side(style="medium", color=black)
    currency_format = r'_-[$R$-416]\ * #,##0.00_-;\-[$R$-416]\ * #,##0.00_-;_-[$R$-416]\ * "-"??_-;_-@_-'

    widths = (28.140625, 28.7109375, 41.28515625, 20.140625, 19.140625, 40.7109375)
    for index, width in enumerate(widths, start=1):
        worksheet.column_dimensions[chr(64 + index)].width = width

    worksheet.merge_cells("A1:F1")
    title = worksheet["A1"]
    title.value = "Solicitação de pagamento Extra"
    title.font = Font(name="Calibri", size=24, bold=True, italic=True, color=white)
    title.fill = PatternFill("solid", fgColor=dark_gray)
    title.alignment = Alignment(horizontal="center", vertical="center")
    worksheet.row_dimensions[1].height = 32.25

    for cell in worksheet[2]:
        if cell.column <= 6:
            cell.fill = PatternFill("solid", fgColor=medium_gray)
            cell.border = Border(left=medium, right=medium, top=medium, bottom=medium)
    worksheet["A2"] = "Data"
    worksheet["A2"].font = Font(name="Calibri", size=11, bold=True, color=white)
    worksheet["A2"].alignment = Alignment(horizontal="center", vertical="center")
    worksheet["C2"] = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    worksheet["C2"].number_format = "dd/mm/yyyy"
    worksheet["C2"].font = Font(name="Calibri", size=14, bold=True, italic=True, color=white)
    worksheet["C2"].alignment = Alignment(horizontal="center", vertical="center")
    worksheet.row_dimensions[2].height = 21.75

    headers = ("Nome", "CPF", "Motivo", "Setor", "Valor Total", "Observações")
    for column, value in enumerate(headers, start=1):
        cell = worksheet.cell(row=3, column=column, value=value)
        cell.font = Font(name="Calibri", size=11, bold=True, color=white)
        cell.fill = PatternFill("solid", fgColor="FF0D0D0D")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = Border(
            left=medium if column == 1 else thin,
            right=thin,
            top=medium,
            bottom=thin,
        )

    data_start = 4
    data_end = data_start + len(grouped) - 1
    data_slot_end = max(23, data_end)
    payment_reason = "AGREGADO" if tipo_transporte == "AGREGADO" else "TRANSPORTADORA"

    for offset, (responsible, values) in enumerate(
        sorted(grouped.items(), key=lambda item: item[0].casefold())
    ):
        row_index = data_start + offset
        service_days = values["days"]
        assert isinstance(service_days, set)
        net = Decimal(values["net"])
        days_label = "DIA" if len(service_days) == 1 else "DIAS"
        values_for_row: tuple[object, ...] = (
            responsible,
            None,  # O cadastro de pessoas do Portal não armazena CPF.
            f"{payment_reason} TOTAL DE {len(service_days)} {days_label}",
            "TRANSPORTE",
            net,
            "",
        )
        for column, value in enumerate(values_for_row, start=1):
            cell = worksheet.cell(row=row_index, column=column, value=value)
            if isinstance(value, str):
                cell.data_type = "s"
            cell.font = Font(name="Calibri", size=16, color=black)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(
                left=medium if column == 1 else thin,
                right=thin,
                top=thin,
                bottom=medium if row_index == data_slot_end else thin,
            )
            if column == 5:
                cell.fill = PatternFill("solid", fgColor="FFD9D9D9")
                cell.number_format = currency_format
        worksheet.row_dimensions[row_index].height = 42

    for row_index in range(max(data_start, data_end + 1), data_slot_end + 1):
        worksheet.row_dimensions[row_index].height = 21
        for column in range(1, 7):
            cell = worksheet.cell(row=row_index, column=column)
            cell.font = Font(name="Calibri", size=16, color=black)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(
                left=medium if column == 1 else thin,
                right=thin,
                top=thin,
                bottom=medium if row_index == data_slot_end else thin,
            )
            if column == 5:
                cell.fill = PatternFill("solid", fgColor="FFD9D9D9")
                cell.number_format = currency_format

    if data_end < data_slot_end:
        worksheet.row_dimensions[data_slot_end].height = 21.75

    total_row = data_slot_end + 1
    for column in (4, 5):
        cell = worksheet.cell(row=total_row, column=column)
        cell.fill = PatternFill("solid", fgColor=dark)
        cell.font = Font(name="Calibri", size=16, bold=column == 4, color=white)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = Border(left=medium, right=medium, top=medium, bottom=medium)
    worksheet.cell(row=total_row, column=4, value="TOTAL GERAL")
    total = worksheet.cell(row=total_row, column=5)
    total.value = f"=SUM(E{data_start}:E{data_slot_end})"
    total.number_format = currency_format
    worksheet.row_dimensions[total_row].height = 21.75

    worksheet.page_setup.orientation = "landscape"
    worksheet.page_setup.paperSize = worksheet.PAPERSIZE_A4
    worksheet.page_setup.scale = 69
    worksheet.page_margins = PageMargins(
        left=0.7086614173228347,
        right=0.7086614173228347,
        top=0.7480314960629921,
        bottom=0.7480314960629921,
        header=0.3149606299212598,
        footer=0.3149606299212598,
    )
    worksheet.print_area = f"A1:F{total_row}"

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()
