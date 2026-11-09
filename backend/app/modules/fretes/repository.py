"""Persistência do módulo de Fretes."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.modules.access_control.catalog import DELIVERY_SECTOR_CODE
from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa, Setor
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaMotivo,
    EntregaParticipante,
    FormularioVersao,
    Lancamento,
    LancamentoRevisao,
)

from .models import Frete, FreteEvento


def get_active_sector_by_code(db: Session, *, codigo: str) -> Setor | None:
    """Busca setor ativo pelo código usado nas regras de autorização."""
    return db.scalar(select(Setor).where(Setor.codigo == codigo, Setor.ativo.is_(True)))


def list_aggregate_drivers(db: Session, *, data_servico: date) -> list[Pessoa]:
    """Lista motoristas ativos e vigentes cadastrados para entregas terceirizadas."""
    statement = (
        select(Pessoa)
        .where(
            Pessoa.tipo_funcao == "MOTORISTA",
            Pessoa.tipo_transporte_entrega == "TERCEIRIZADA",
            Pessoa.modalidade_terceirizada == "AGREGADO",
            Pessoa.ativo.is_(True),
            Pessoa.vigente_desde <= data_servico,
            (Pessoa.vigente_ate.is_(None) | (Pessoa.vigente_ate > data_servico)),
        )
        .order_by(Pessoa.nome_exibicao, Pessoa.id_pessoa)
    )
    return list(db.scalars(statement).all())


def get_aggregate_driver(
    db: Session,
    *,
    id_motorista: int,
    data_servico: date,
) -> Pessoa | None:
    """Confirma que o ID selecionado ainda é um motorista terceiro elegível."""
    statement = select(Pessoa).where(
        Pessoa.id_pessoa == id_motorista,
        Pessoa.tipo_funcao == "MOTORISTA",
        Pessoa.tipo_transporte_entrega == "TERCEIRIZADA",
        Pessoa.modalidade_terceirizada == "AGREGADO",
        Pessoa.ativo.is_(True),
        Pessoa.vigente_desde <= data_servico,
        (Pessoa.vigente_ate.is_(None) | (Pessoa.vigente_ate > data_servico)),
    )
    return db.scalar(statement)


def list_carrier_drivers(
    db: Session,
    *,
    data_servico: date,
    codigo_transportadora: str,
) -> list[Pessoa]:
    """Lista motoristas vigentes vinculados à transportadora escolhida."""
    statement = (
        select(Pessoa)
        .where(
            Pessoa.tipo_funcao == "MOTORISTA",
            Pessoa.tipo_transporte_entrega == "TERCEIRIZADA",
            Pessoa.modalidade_terceirizada == "TRANSPORTADORA_INDEPENDENTE",
            Pessoa.codigo_transportadora_independente == codigo_transportadora,
            Pessoa.ativo.is_(True),
            Pessoa.vigente_desde <= data_servico,
            (Pessoa.vigente_ate.is_(None) | (Pessoa.vigente_ate > data_servico)),
        )
        .order_by(Pessoa.nome_exibicao, Pessoa.id_pessoa)
    )
    return list(db.scalars(statement).all())


def get_carrier_driver(
    db: Session,
    *,
    id_motorista: int,
    data_servico: date,
    codigo_transportadora: str,
) -> Pessoa | None:
    """Valida que o motorista pertence à transportadora escolhida na data."""
    statement = select(Pessoa).where(
        Pessoa.id_pessoa == id_motorista,
        Pessoa.tipo_funcao == "MOTORISTA",
        Pessoa.tipo_transporte_entrega == "TERCEIRIZADA",
        Pessoa.modalidade_terceirizada == "TRANSPORTADORA_INDEPENDENTE",
        Pessoa.codigo_transportadora_independente == codigo_transportadora,
        Pessoa.ativo.is_(True),
        Pessoa.vigente_desde <= data_servico,
        (Pessoa.vigente_ate.is_(None) | (Pessoa.vigente_ate > data_servico)),
    )
    return db.scalar(statement)


def _confirmed_delivery_rows_statement(*, id_motorista: int, data_servico: date):
    """Monta a consulta base apenas com itens da revisão vigente e confirmada."""
    current_revision = aliased(LancamentoRevisao)
    any_revision = aliased(LancamentoRevisao)
    latest_revision_number = (
        select(func.max(any_revision.numero_revisao))
        .where(any_revision.id_lancamento == Lancamento.id_lancamento)
        .correlate(Lancamento)
        .scalar_subquery()
    )
    city = func.coalesce(func.nullif(func.trim(Localidade.cidade), ""), Localidade.nome_localidade)
    delivery_quantity = EntregaDiaria.quantidade_realizada
    return (
        select(
            EntregaDiaria.id_entrega_diaria.label("id_entrega_diaria"),
            city.label("cidade"),
            delivery_quantity.label("quantidade_entregas"),
        )
        .select_from(EntregaDiaria)
        .join(
            EntregaParticipante,
            EntregaParticipante.id_entrega_diaria == EntregaDiaria.id_entrega_diaria,
        )
        .join(
            current_revision,
            current_revision.id_lancamento_revisao == EntregaDiaria.id_lancamento_revisao,
        )
        .join(Lancamento, Lancamento.id_lancamento == current_revision.id_lancamento)
        .join(
            FormularioVersao,
            FormularioVersao.id_formulario_versao == current_revision.id_formulario_versao,
        )
        .join(Setor, Setor.id_setor == Lancamento.id_setor)
        .join(Localidade, Localidade.id_localidade == EntregaDiaria.id_localidade)
        .where(
            EntregaParticipante.id_pessoa == id_motorista,
            EntregaParticipante.papel_participante == "MOTORISTA",
            EntregaDiaria.data_entrega == data_servico,
            EntregaDiaria.tipo_operacao == "ENTREGA",
            current_revision.numero_revisao == latest_revision_number,
            current_revision.estado.in_(("ENVIADA", "APROVADA")),
            FormularioVersao.codigo_formulario == "ENTREGAS_DIARIAS",
            FormularioVersao.id_setor == Lancamento.id_setor,
            Setor.codigo == DELIVERY_SECTOR_CODE,
            Setor.ativo.is_(True),
        )
        .distinct()
    )


def get_driver_delivery_summary(
    db: Session,
    *,
    id_motorista: int,
    data_servico: date,
) -> tuple[str, list[str], int, int, int]:
    """Soma entregas e avarias e retorna as cidades das revisões confirmadas."""
    delivery_rows = _confirmed_delivery_rows_statement(
        id_motorista=id_motorista,
        data_servico=data_servico,
    ).subquery()
    city_column = delivery_rows.c.cidade
    city_rows = db.execute(
        select(city_column, func.sum(delivery_rows.c.quantidade_entregas))
        .group_by(city_column)
        .order_by(city_column)
    ).all()
    cities = [str(row[0]) for row in city_rows if row[0]]
    quantity = sum(int(row[1] or 0) for row in city_rows)
    delivery_count = int(
        db.scalar(select(func.count()).select_from(delivery_rows)) or 0
    )

    damage_count = int(
        db.scalar(
            select(func.coalesce(func.sum(EntregaMotivo.quantidade), 0))
            .select_from(EntregaMotivo)
            .join(
                MotivoNaoEntrega,
                MotivoNaoEntrega.id_motivo_nao_entrega
                == EntregaMotivo.id_motivo_nao_entrega,
            )
            .where(
                EntregaMotivo.id_entrega_diaria.in_(
                    select(delivery_rows.c.id_entrega_diaria)
                ),
                EntregaMotivo.tipo_operacao == "ENTREGA",
                MotivoNaoEntrega.codigo_motivo == "AVARIA",
            )
        )
        or 0
    )

    route = " / ".join(cities)
    if len(route) > 160:
        route = f"Múltiplas cidades ({len(cities)})"
    return route, cities, quantity, damage_count, delivery_count


def get_freight_by_idempotency_key(
    db: Session,
    *,
    idempotency_key: UUID,
) -> Frete | None:
    """Busca a chave globalmente, conforme a restrição única da tabela."""
    return db.scalar(
        select(Frete).where(
            Frete.chave_idempotencia == str(idempotency_key),
        )
    )


def get_freight_by_code(
    db: Session,
    *,
    codigo_frete: UUID,
    id_setor: int,
    lock: bool = False,
) -> Frete | None:
    """Busca um frete dentro do setor e opcionalmente bloqueia alterações concorrentes."""
    statement = select(Frete).where(
        Frete.codigo_frete == str(codigo_frete),
        Frete.id_setor == id_setor,
    )
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement)


def list_freight_events(db: Session, *, id_frete: int) -> list[FreteEvento]:
    """Retorna os eventos auditáveis de um frete em ordem cronológica."""
    statement = (
        select(FreteEvento)
        .where(FreteEvento.id_frete == id_frete)
        .order_by(FreteEvento.ocorrido_em, FreteEvento.id_frete_evento)
    )
    return list(db.scalars(statement).all())


def list_freight_cancellations(
    db: Session,
    *,
    freight_ids: list[int],
) -> dict[int, FreteEvento]:
    """Carrega em lote os eventos de cancelamento usados pelo histórico."""
    if not freight_ids:
        return {}
    statement = (
        select(FreteEvento)
        .where(
            FreteEvento.id_frete.in_(freight_ids),
            FreteEvento.tipo_evento == "FRETE_CANCELADO",
        )
        .order_by(FreteEvento.ocorrido_em, FreteEvento.id_frete_evento)
    )
    cancellations: dict[int, FreteEvento] = {}
    for event in db.scalars(statement).all():
        cancellations.setdefault(event.id_frete, event)
    return cancellations


def list_freights(
    db: Session,
    *,
    id_setor: int,
    data_de: date | None,
    data_ate: date | None,
    tipo_transporte: str | None,
    status_calculo: str | None,
    limit: int,
    offset: int,
) -> tuple[list[Frete], int]:
    """Retorna lançamentos filtrados e total geral para a paginação da API."""
    statement = select(Frete).where(Frete.id_setor == id_setor)
    count_statement = select(func.count()).select_from(Frete).where(Frete.id_setor == id_setor)
    if data_de is not None:
        statement = statement.where(Frete.data_servico >= data_de)
        count_statement = count_statement.where(Frete.data_servico >= data_de)
    if data_ate is not None:
        statement = statement.where(Frete.data_servico <= data_ate)
        count_statement = count_statement.where(Frete.data_servico <= data_ate)
    if tipo_transporte is not None:
        statement = statement.where(Frete.tipo_transporte == tipo_transporte)
        count_statement = count_statement.where(Frete.tipo_transporte == tipo_transporte)
    if status_calculo is not None:
        statement = statement.where(Frete.status_calculo == status_calculo)
        count_statement = count_statement.where(Frete.status_calculo == status_calculo)
    total = db.scalar(count_statement) or 0
    statement = (
        statement.order_by(Frete.data_servico.desc(), Frete.id_frete.desc())
        .offset(offset)
        .limit(limit)
    )
    records = list(db.scalars(statement).all())
    return records, total


def list_payment_freights(
    db: Session,
    *,
    id_setor: int,
    data_de: date,
    data_ate: date,
    tipo_transporte: str | None = None,
    nome_transportador: str | None = None,
    sem_identificacao: bool = False,
) -> list[Frete]:
    """Busca fretes de terceiros com os filtros do fechamento financeiro."""
    statement = (
        select(Frete)
        .where(
            Frete.id_setor == id_setor,
            Frete.tipo_transporte.in_(("AGREGADO", "TRANSPORTADORA")),
            Frete.data_servico >= data_de,
            Frete.data_servico <= data_ate,
            Frete.id_frete.not_in(
                select(FreteEvento.id_frete).where(
                    FreteEvento.tipo_evento == "FRETE_CANCELADO"
                )
            ),
        )
    )
    if tipo_transporte is not None:
        statement = statement.where(Frete.tipo_transporte == tipo_transporte)
    if sem_identificacao:
        statement = statement.where(Frete.nome_transportador.is_(None))
    elif nome_transportador is not None:
        statement = statement.where(Frete.nome_transportador == nome_transportador)
    statement = statement.order_by(Frete.data_servico, Frete.id_frete)
    return list(db.scalars(statement).all())


def save_freight(
    db: Session,
    freight: Frete,
    *,
    actor_id: int,
    occurred_at: datetime,
) -> Frete:
    """Grava frete e evento de auditoria na mesma transação do chamador."""
    db.add(freight)
    db.flush()
    event = FreteEvento(
        id_frete=freight.id_frete,
        id_usuario_ator=actor_id,
        tipo_evento="FRETE_CRIADO",
        ocorrido_em=occurred_at,
        detalhes={
            "codigo_frete": freight.codigo_frete,
            "status_calculo": freight.status_calculo,
            "tipo_transporte": freight.tipo_transporte,
            "codigo_fonte_tarifa": freight.codigo_fonte_tarifa,
        },
    )
    db.add(event)
    db.flush()
    return freight
