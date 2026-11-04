"""Regras de acesso, cálculo e consolidação de Fretes."""

from __future__ import annotations

import csv
import io
import json
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from hashlib import sha256
from uuid import UUID, uuid4

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
from .models import Frete
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


def _freight_response(freight: Frete) -> FreightResponse:
    """Converte o registro operacional preservando o nome do responsável."""
    calculation_detail = {
        key: value for key, value in freight.detalhe_calculo.items() if key != "request_fingerprint"
    }
    return FreightResponse(
        id_frete=freight.id_frete,
        codigo_frete=UUID(freight.codigo_frete),
        tipo_transporte=_transport_type(freight.tipo_transporte),
        nome_transportador=freight.nome_transportador,
        id_motorista_agregado=freight.id_motorista_agregado,
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
    )


def _prepare_freight_payload(
    db: Session,
    payload: FreightInput,
    *,
    require_delivery_data: bool,
) -> tuple[FreightInput, dict[str, object] | None]:
    """Substitui os campos agregados pelos dados vigentes de equipe e Entregas."""
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
            "O motorista não está ativo como entrega terceirizada na data do serviço."
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
        calculation = replace(
            calculation,
            detalhe={**calculation.detalhe, "origem_entregas": source_detail},
        )
    return prepared, calculation


def _csv_text_cell(value: str) -> str:
    """Impede que um nome digitado seja interpretado como fórmula na planilha."""
    return f"'{value}" if value.lstrip().startswith(("=", "+", "-", "@")) else value


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
                "O motorista não está ativo como entrega terceirizada na data do serviço."
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
        return FreightPage(
            items=[_freight_response(freight) for freight in rows],
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
    """Gera o CSV do responsável selecionado após exigir cálculos resolvidos."""
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

    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", lineterminator="\r\n")
    writer.writerow(
        [
            "Data inicial",
            "Data final",
            "Tipo de transporte",
            "Responsável",
            "Fretes no período",
            "Fretes pendentes",
            "Frete bruto calculado",
            "Valor das avarias (R$)",
            "Total a pagar",
        ]
    )
    writer.writerow(
        [
            data_de.strftime("%d/%m/%Y"),
            data_ate.strftime("%d/%m/%Y"),
            "Agregado" if tipo_transporte == "AGREGADO" else "Transportadora independente",
            _csv_text_cell(
                "Sem identificação"
                if sem_identificacao
                else nome_transportador
                or ("Todos os agregados" if tipo_transporte == "AGREGADO" else "Todas as transportadoras")
            ),
            report.quantidade_fretes,
            report.quantidade_pendentes,
            f"{report.valor_frete_bruto:.2f}".replace(".", ","),
            f"{report.valor_avarias:.2f}".replace(".", ","),
            f"{report.valor_a_pagar:.2f}".replace(".", ","),
        ]
    )
    return ("\ufeff" + output.getvalue()).encode("utf-8")
