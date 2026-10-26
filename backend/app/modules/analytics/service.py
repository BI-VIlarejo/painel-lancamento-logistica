"""Agrega o painel em consultas por período e respeita os escopos autorizados."""

from __future__ import annotations

import logging
from datetime import date
from time import perf_counter

from sqlalchemy import and_, case, exists, false, func, inspect, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, aliased

from app.core.exceptions import APIError, ServiceUnavailableError
from app.modules.access_control import service as access_control_service
from app.modules.access_control.service import AuthorizationContext
from app.modules.analytics.schemas import (
    DashboardResponse,
    DashboardSummary,
    FeedbackSummary,
    LocalityPerformance,
    PersonPerformance,
    ReasonPerformance,
    TeamPerformance,
    TrendPoint,
)
from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaMotivo,
    EntregaParticipante,
    Lancamento,
    LancamentoEvento,
    LancamentoRevisao,
)
from app.modules.feedback.models import Feedback

logger = logging.getLogger("lancamento.api.analytics")


def _log_dashboard_step(step: str, request_id: str | None, started_at: float) -> None:
    logger.info(
        "dashboard_step request_id=%s step=%s duration_ms=%.2f",
        request_id or "-",
        step,
        (perf_counter() - started_at) * 1000,
    )


def _scope_condition(*, sector_column, locality_column, access: AuthorizationContext):
    pairs = access_control_service.scope_pairs(access)
    if not pairs:
        return false()

    alternatives = []
    for id_setor, id_localidade in pairs:
        predicates = []
        if id_setor is not None:
            predicates.append(sector_column == id_setor)
        if id_localidade is not None:
            predicates.append(locality_column == id_localidade)
        alternatives.append(and_(*predicates) if predicates else True)
    return or_(*alternatives)


def _latest_revision_subquery():
    return (
        select(
            LancamentoRevisao.id_lancamento.label("id_lancamento"),
            func.max(LancamentoRevisao.numero_revisao).label("numero_revisao"),
        )
        .where(LancamentoRevisao.estado.in_(("ENVIADA", "APROVADA")))
        .group_by(LancamentoRevisao.id_lancamento)
        .subquery("ultima_revisao")
    )


def _feedback_tables_available(db: Session) -> bool:
    inspector = inspect(db.get_bind())
    required = {
        "op_logistica_feedback",
    }
    return all(inspector.has_table(table_name) for table_name in required)


def _rate(completed: int, not_completed: int) -> float | None:
    total = completed + not_completed
    return round((completed / total) * 100, 2) if total else None


def _percentage(count: int, total: int) -> float | None:
    return round((count / total) * 100, 2) if total else None


def get_dashboard(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date | None,
    data_ate: date | None,
    id_localidade: int | None,
    request_id: str | None = None,
) -> DashboardResponse:
    if data_de is not None and data_ate is not None and data_de > data_ate:
        raise APIError(
            status_code=422,
            code="validation_error",
            message="A data inicial não pode ser posterior à data final.",
        )

    latest_revision = _latest_revision_subquery()
    predicates = [
        LancamentoRevisao.id_lancamento == Lancamento.id_lancamento,
        LancamentoRevisao.numero_revisao == latest_revision.c.numero_revisao,
        # ENVIADA is the final confirmation state; APROVADA remains for legacy records.
        LancamentoRevisao.estado.in_(("ENVIADA", "APROVADA")),
        ~exists(
            select(LancamentoEvento.id_evento).where(
                LancamentoEvento.id_lancamento == Lancamento.id_lancamento,
                LancamentoEvento.tipo_evento == "LANCAMENTO_CANCELADO",
            )
        ),
        _scope_condition(
            sector_column=Lancamento.id_setor,
            locality_column=EntregaDiaria.id_localidade,
            access=access,
        ),
    ]
    if data_de is not None:
        predicates.append(EntregaDiaria.data_entrega >= data_de)
    if data_ate is not None:
        predicates.append(EntregaDiaria.data_entrega <= data_ate)
    if id_localidade is not None:
        predicates.append(EntregaDiaria.id_localidade == id_localidade)

    registered_items = (
        select(
            EntregaDiaria.id_entrega_diaria.label("id_entrega_diaria"),
            EntregaDiaria.id_lancamento_revisao.label("id_lancamento_revisao"),
            EntregaDiaria.codigo_item_lancamento.label("codigo_item_lancamento"),
            Lancamento.id_lancamento.label("id_lancamento"),
            EntregaDiaria.data_entrega.label("data_entrega"),
            EntregaDiaria.id_localidade.label("id_localidade"),
            Localidade.nome_localidade.label("nome_localidade"),
            EntregaDiaria.quantidade_realizada.label("realizadas"),
            EntregaDiaria.quantidade_nao_realizada.label("nao_realizadas"),
        )
        .select_from(EntregaDiaria)
        .join(
            LancamentoRevisao,
            LancamentoRevisao.id_lancamento_revisao
            == EntregaDiaria.id_lancamento_revisao,
        )
        .join(Lancamento, Lancamento.id_lancamento == LancamentoRevisao.id_lancamento)
        .join(
            latest_revision,
            and_(
                latest_revision.c.id_lancamento == Lancamento.id_lancamento,
                latest_revision.c.numero_revisao == LancamentoRevisao.numero_revisao,
            ),
        )
        .join(Localidade, Localidade.id_localidade == EntregaDiaria.id_localidade)
        .where(*predicates)
        .subquery("entregas_registradas_no_escopo")
    )

    try:
        query_started_at = perf_counter()
        summary_row = db.execute(
            select(
                func.count(func.distinct(registered_items.c.id_lancamento)).label(
                    "launch_count"
                ),
                func.coalesce(func.sum(registered_items.c.realizadas), 0).label(
                    "completed_total"
                ),
                func.coalesce(func.sum(registered_items.c.nao_realizadas), 0).label(
                    "not_completed_total"
                ),
            )
            .select_from(registered_items)
        ).one()
        _log_dashboard_step("summary", request_id, query_started_at)
        launch_count = int(summary_row.launch_count)
        completed_total = int(summary_row.completed_total)
        not_completed_total = int(summary_row.not_completed_total)
        planned_total = completed_total + not_completed_total

        otif_percentual = _percentage(not_completed_total, planned_total)

        query_started_at = perf_counter()
        daily_rows = db.execute(
            select(
                registered_items.c.data_entrega,
                func.sum(registered_items.c.realizadas).label("completed"),
                func.sum(registered_items.c.nao_realizadas).label("not_completed"),
            )
            .select_from(registered_items)
            .group_by(registered_items.c.data_entrega)
            .order_by(registered_items.c.data_entrega)
        ).all()
        _log_dashboard_step("daily", request_id, query_started_at)
        query_started_at = perf_counter()
        locality_rows = db.execute(
            select(
                registered_items.c.id_localidade,
                registered_items.c.nome_localidade,
                func.count(
                    func.distinct(registered_items.c.id_lancamento)
                ).label("launch_count"),
                func.sum(registered_items.c.realizadas).label("completed"),
                func.sum(registered_items.c.nao_realizadas).label("not_completed"),
            )
            .select_from(registered_items)
            .group_by(
                registered_items.c.id_localidade,
                registered_items.c.nome_localidade,
            )
        ).all()
        _log_dashboard_step("localities", request_id, query_started_at)
        locality_totals: dict[int, dict[str, object]] = {}
        for row in locality_rows:
            locality_totals[row.id_localidade] = {
                "name": row.nome_localidade,
                "launch_count": int(row.launch_count),
                "planned": int(row.completed) + int(row.not_completed),
                "completed": int(row.completed),
                "not_completed": int(row.not_completed),
                "praise": 0,
                "complaint": 0,
            }

        query_started_at = perf_counter()
        reason_rows = db.execute(
            select(
                MotivoNaoEntrega.id_motivo_nao_entrega,
                MotivoNaoEntrega.descricao_motivo,
                func.sum(EntregaMotivo.quantidade),
            )
            .join(
                registered_items,
                registered_items.c.id_entrega_diaria == EntregaMotivo.id_entrega_diaria,
            )
            .join(
                MotivoNaoEntrega,
                MotivoNaoEntrega.id_motivo_nao_entrega
                == EntregaMotivo.id_motivo_nao_entrega,
            )
            .group_by(
                MotivoNaoEntrega.id_motivo_nao_entrega,
                MotivoNaoEntrega.descricao_motivo,
            )
            .order_by(func.sum(EntregaMotivo.quantidade).desc(), MotivoNaoEntrega.descricao_motivo)
        ).all()
        _log_dashboard_step("reasons", request_id, query_started_at)

        team_members = (
            select(
                EntregaParticipante.id_entrega_diaria.label("id_entrega_diaria"),
                func.max(
                    case(
                        (
                            EntregaParticipante.papel_participante == "MOTORISTA",
                            EntregaParticipante.id_pessoa,
                        ),
                        else_=None,
                    )
                ).label("driver_id"),
                func.max(
                    case(
                        (
                            and_(
                                EntregaParticipante.papel_participante == "AJUDANTE",
                                EntregaParticipante.ordem == 1,
                            ),
                            EntregaParticipante.id_pessoa,
                        ),
                        else_=None,
                    )
                ).label("helper_1_id"),
                func.max(
                    case(
                        (
                            and_(
                                EntregaParticipante.papel_participante == "AJUDANTE",
                                EntregaParticipante.ordem == 2,
                            ),
                            EntregaParticipante.id_pessoa,
                        ),
                        else_=None,
                    )
                ).label("helper_2_id"),
            )
            .select_from(EntregaParticipante)
            .join(
                registered_items,
                registered_items.c.id_entrega_diaria
                == EntregaParticipante.id_entrega_diaria,
            )
            .group_by(EntregaParticipante.id_entrega_diaria)
            .subquery("entrega_equipe")
        )

        query_started_at = perf_counter()
        team_rows = db.execute(
            select(
                team_members.c.driver_id,
                team_members.c.helper_1_id,
                team_members.c.helper_2_id,
                func.count(func.distinct(registered_items.c.id_lancamento)).label(
                    "launch_count"
                ),
                func.sum(
                    registered_items.c.realizadas
                    + registered_items.c.nao_realizadas
                ).label("planned"),
                func.sum(registered_items.c.realizadas).label("completed"),
                func.sum(registered_items.c.nao_realizadas).label("not_completed"),
            )
            .select_from(team_members)
            .join(
                registered_items,
                registered_items.c.id_entrega_diaria
                == team_members.c.id_entrega_diaria,
            )
            .group_by(
                team_members.c.driver_id,
                team_members.c.helper_1_id,
                team_members.c.helper_2_id,
            )
        ).all()
        _log_dashboard_step("teams", request_id, query_started_at)

        participant_ids = {
            int(person_id)
            for row in team_rows
            for person_id in (row.driver_id, row.helper_1_id, row.helper_2_id)
            if person_id is not None
        }
        if participant_ids:
            query_started_at = perf_counter()
            people_by_id = {
                person.id_pessoa: person
                for person in db.scalars(
                    select(Pessoa).where(Pessoa.id_pessoa.in_(participant_ids))
                ).all()
            }
            _log_dashboard_step("people", request_id, query_started_at)
        else:
            people_by_id = {}

        person_totals: dict[int, dict[str, object]] = {
            person_id: {
                "name": person.nome_exibicao,
                "role": person.tipo_funcao,
                "active": person.ativo,
                "teams": set(),
                "planned": 0,
                "completed": 0,
                "not_completed": 0,
                "praise": 0,
                "complaint": 0,
            }
            for person_id, person in people_by_id.items()
        }

        team_totals: dict[str, dict[str, object]] = {}
        for row in team_rows:
            member_ids = [
                int(person_id)
                for person_id in (row.driver_id, row.helper_1_id, row.helper_2_id)
                if person_id is not None
            ]
            team_key = ":".join(str(person_id) for person_id in member_ids)
            team_totals[team_key] = {
                "name": " · ".join(
                    people_by_id[person_id].nome_exibicao
                    for person_id in member_ids
                    if person_id in people_by_id
                ),
                "launch_count": int(row.launch_count or 0),
                "planned": int(row.planned or 0),
                "completed": int(row.completed or 0),
                "not_completed": int(row.not_completed or 0),
                "praise": 0,
                "complaint": 0,
            }
            for person_id in member_ids:
                person = person_totals.get(person_id)
                if person is not None:
                    person["teams"].add(team_key)
                    # O formulário registra quantidades por equipe. Para permitir
                    # ranking conjunto, cada participante recebe o resultado das
                    # equipes em que trabalhou; totais pessoais não são somáveis.
                    person["planned"] = int(person["planned"]) + int(row.planned or 0)
                    person["completed"] = int(person["completed"]) + int(row.completed or 0)
                    person["not_completed"] = int(person["not_completed"]) + int(row.not_completed or 0)

        query_started_at = perf_counter()
        feedback_available = _feedback_tables_available(db)
        _log_dashboard_step("feedback_schema", request_id, query_started_at)
        feedback_totals = {"praise": 0, "complaint": 0}
        if feedback_available:
            feedback_delivery = aliased(EntregaDiaria)
            feedback_revision = aliased(LancamentoRevisao)
            feedback_launch = aliased(Lancamento)
            feedback_team_members = (
                select(
                    EntregaParticipante.id_entrega_diaria.label("id_entrega_diaria"),
                    func.max(
                        case(
                            (
                                EntregaParticipante.papel_participante == "MOTORISTA",
                                EntregaParticipante.id_pessoa,
                            ),
                            else_=None,
                        )
                    ).label("driver_id"),
                    func.max(
                        case(
                            (
                                and_(
                                    EntregaParticipante.papel_participante == "AJUDANTE",
                                    EntregaParticipante.ordem == 1,
                                ),
                                EntregaParticipante.id_pessoa,
                            ),
                            else_=None,
                        )
                    ).label("helper_1_id"),
                    func.max(
                        case(
                            (
                                and_(
                                    EntregaParticipante.papel_participante == "AJUDANTE",
                                    EntregaParticipante.ordem == 2,
                                ),
                                EntregaParticipante.id_pessoa,
                            ),
                            else_=None,
                        )
                    ).label("helper_2_id"),
                )
                .group_by(EntregaParticipante.id_entrega_diaria)
                .subquery("equipe_da_entrega_do_feedback")
            )
            feedback_context = (
                select(
                    Feedback.id_feedback.label("id_feedback"),
                    feedback_delivery.id_entrega_diaria.label("id_entrega_diaria"),
                    func.upper(Feedback.tipo).label("codigo_tipo"),
                    feedback_delivery.id_localidade.label("id_localidade"),
                    feedback_team_members.c.driver_id.label("driver_id"),
                    feedback_team_members.c.helper_1_id.label("helper_1_id"),
                    feedback_team_members.c.helper_2_id.label("helper_2_id"),
                )
                .select_from(Feedback)
                .join(
                    feedback_delivery,
                    feedback_delivery.id_entrega_diaria == Feedback.id_entrega_diaria,
                )
                .join(
                    feedback_revision,
                    and_(
                        feedback_revision.id_lancamento_revisao
                        == feedback_delivery.id_lancamento_revisao,
                        feedback_revision.id_lancamento_revisao
                        == Feedback.id_lancamento_revisao,
                    ),
                )
                .join(
                    feedback_launch,
                    feedback_launch.id_lancamento == feedback_revision.id_lancamento,
                )
                .join(
                    feedback_team_members,
                    feedback_team_members.c.id_entrega_diaria
                    == feedback_delivery.id_entrega_diaria,
                )
                .where(
                    Feedback.tipo.in_(("ELOGIO", "RECLAMACAO")),
                    feedback_revision.estado.in_(("ENVIADA", "APROVADA")),
                    _scope_condition(
                        sector_column=feedback_launch.id_setor,
                        locality_column=feedback_delivery.id_localidade,
                        access=access,
                    ),
                    ~exists(
                        select(LancamentoEvento.id_evento).where(
                            LancamentoEvento.id_lancamento
                            == feedback_launch.id_lancamento,
                            LancamentoEvento.tipo_evento == "LANCAMENTO_CANCELADO",
                        )
                    ),
                    feedback_delivery.id_localidade == id_localidade
                    if id_localidade is not None
                    else True,
                    Feedback.data_feedback >= data_de if data_de is not None else True,
                    Feedback.data_feedback <= data_ate if data_ate is not None else True,
                )
                .subquery("feedback_no_recorte")
            )
            query_started_at = perf_counter()
            feedback_count_rows = db.execute(
                select(
                    feedback_context.c.codigo_tipo,
                    func.count(func.distinct(feedback_context.c.id_feedback)).label(
                        "feedback_count"
                    ),
                ).group_by(feedback_context.c.codigo_tipo)
            ).all()
            _log_dashboard_step("feedback_summary", request_id, query_started_at)
            for row in feedback_count_rows:
                metric = "praise" if row.codigo_tipo == "ELOGIO" else "complaint"
                feedback_totals[metric] = int(row.feedback_count or 0)

            query_started_at = perf_counter()
            locality_feedback_rows = db.execute(
                select(
                    feedback_context.c.id_localidade,
                    feedback_context.c.codigo_tipo,
                    func.count(func.distinct(feedback_context.c.id_feedback)).label(
                        "feedback_count"
                    ),
                ).group_by(
                    feedback_context.c.id_localidade,
                    feedback_context.c.codigo_tipo,
                )
            ).all()
            _log_dashboard_step("feedback_localities", request_id, query_started_at)
            for row in locality_feedback_rows:
                locality = locality_totals.get(row.id_localidade)
                if locality is not None:
                    metric = "praise" if row.codigo_tipo == "ELOGIO" else "complaint"
                    locality[metric] = int(row.feedback_count or 0)

            query_started_at = perf_counter()
            person_feedback_rows = db.execute(
                select(
                    EntregaParticipante.id_pessoa,
                    feedback_context.c.codigo_tipo,
                    func.count(func.distinct(feedback_context.c.id_feedback)).label(
                        "feedback_count"
                    ),
                )
                .join(
                    feedback_context,
                    feedback_context.c.id_entrega_diaria
                    == EntregaParticipante.id_entrega_diaria,
                )
                .group_by(
                    EntregaParticipante.id_pessoa,
                    feedback_context.c.codigo_tipo,
                )
            ).all()
            _log_dashboard_step("feedback_people", request_id, query_started_at)
            for row in person_feedback_rows:
                person = person_totals.get(row.id_pessoa)
                if person is not None:
                    metric = "praise" if row.codigo_tipo == "ELOGIO" else "complaint"
                    person[metric] = int(row.feedback_count or 0)

            query_started_at = perf_counter()
            team_feedback_rows = db.execute(
                select(
                    feedback_context.c.driver_id,
                    feedback_context.c.helper_1_id,
                    feedback_context.c.helper_2_id,
                    feedback_context.c.codigo_tipo,
                    func.count(func.distinct(feedback_context.c.id_feedback)).label(
                        "feedback_count"
                    ),
                )
                .group_by(
                    feedback_context.c.driver_id,
                    feedback_context.c.helper_1_id,
                    feedback_context.c.helper_2_id,
                    feedback_context.c.codigo_tipo,
                )
            ).all()
            _log_dashboard_step("feedback_teams", request_id, query_started_at)
            for row in team_feedback_rows:
                member_ids = [
                    int(person_id)
                    for person_id in (row.driver_id, row.helper_1_id, row.helper_2_id)
                    if person_id is not None
                ]
                team_key = ":".join(str(person_id) for person_id in member_ids)
                team = team_totals.get(team_key)
                if team is not None:
                    metric = "praise" if row.codigo_tipo == "ELOGIO" else "complaint"
                    team[metric] = int(row.feedback_count or 0)

        by_locality = [
            LocalityPerformance(
                id_localidade=id_locality,
                nome=str(values["name"]),
                lancamentos=int(values["launch_count"]),
                itens_planejados=int(values["planned"]),
                realizadas=int(values["completed"]),
                nao_realizadas=int(values["not_completed"]),
                taxa_realizacao=_rate(int(values["completed"]), int(values["not_completed"])),
                otif_percentual=_percentage(
                    int(values["not_completed"]), int(values["planned"])
                ),
                elogios=int(values["praise"]) if feedback_available else None,
                reclamacoes=int(values["complaint"]) if feedback_available else None,
            )
            for id_locality, values in locality_totals.items()
        ]
        by_locality.sort(key=lambda item: (-item.itens_planejados, item.nome.casefold()))

        by_people = [
            PersonPerformance(
                id_pessoa=id_person,
                nome=str(values["name"]),
                funcao=str(values["role"]),
                ativo=bool(values["active"]),
                equipes=len(values["teams"]),
                itens_planejados=int(values["planned"]),
                realizadas=int(values["completed"]),
                nao_realizadas=int(values["not_completed"]),
                taxa_realizacao=_rate(int(values["completed"]), int(values["not_completed"])),
                otif_percentual=_percentage(
                    int(values["not_completed"]), int(values["planned"])
                ),
                elogios=int(values["praise"]) if feedback_available else None,
                reclamacoes=int(values["complaint"]) if feedback_available else None,
                score_atendimento=int(values["praise"]) - int(values["complaint"]),
            )
            for id_person, values in person_totals.items()
        ]
        by_people.sort(
            key=lambda item: (
                -(item.taxa_realizacao if item.taxa_realizacao is not None else -1),
                -item.score_atendimento,
                -item.realizadas,
                item.nome.casefold(),
            )
        )

        by_teams = [
            TeamPerformance(
                chave=key,
                equipe=str(values["name"]),
                itens_planejados=int(values["planned"]),
                realizadas=int(values["completed"]),
                nao_realizadas=int(values["not_completed"]),
                taxa_realizacao=_rate(int(values["completed"]), int(values["not_completed"])),
                otif_percentual=_percentage(
                    int(values["not_completed"]), int(values["planned"])
                ),
                lancamentos=int(values["launch_count"]),
                elogios=int(values["praise"]) if feedback_available else None,
                reclamacoes=int(values["complaint"]) if feedback_available else None,
            )
            for key, values in team_totals.items()
        ]
        by_teams.sort(
            key=lambda item: (
                -(item.taxa_realizacao if item.taxa_realizacao is not None else -1),
                -item.itens_planejados,
                item.equipe.casefold(),
            )
        )

        daily = [
            TrendPoint(
                data=row.data_entrega,
                planejadas=int(row.completed) + int(row.not_completed),
                realizadas=int(row.completed),
                nao_realizadas=int(row.not_completed),
                taxa_realizacao=_rate(int(row.completed), int(row.not_completed)),
                otif_percentual=_percentage(
                    int(row.not_completed), int(row.completed) + int(row.not_completed)
                ),
            )
            for row in daily_rows
        ]
        reasons = [
            ReasonPerformance(
                id_motivo=row[0],
                motivo=row[1],
                quantidade=int(row[2] or 0),
            )
            for row in reason_rows
        ]
        return DashboardResponse(
            data_de=data_de,
            data_ate=data_ate,
            id_localidade=id_localidade,
            resumo=DashboardSummary(
                lancamentos_registrados=launch_count,
                itens_planejados=planned_total,
                entregas_realizadas=completed_total,
                entregas_nao_realizadas=not_completed_total,
                taxa_realizacao=_rate(completed_total, not_completed_total),
                otif_percentual=otif_percentual,
            ),
            feedback=FeedbackSummary(
                disponivel=feedback_available,
                elogios=feedback_totals["praise"] if feedback_available else None,
                reclamacoes=feedback_totals["complaint"] if feedback_available else None,
            ),
            evolucao=daily,
            por_localidade=by_locality,
            por_motivo=reasons,
            por_pessoa=by_people,
            por_equipe=by_teams,
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise ServiceUnavailableError("Indicadores temporariamente indisponíveis.") from exc
