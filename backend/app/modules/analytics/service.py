"""Agrega o painel em consultas por período e respeita os escopos autorizados."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import and_, false, func, inspect, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

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
from app.modules.catalogs.models import Localidade, MotivoNaoEntrega, Pessoa, TipoFeedback
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaMotivo,
    EntregaParticipante,
    Lancamento,
    LancamentoRevisao,
)
from app.modules.feedback.models import Feedback, FeedbackParticipante


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
        .group_by(LancamentoRevisao.id_lancamento)
        .subquery("ultima_revisao")
    )


def _feedback_tables_available(db: Session) -> bool:
    inspector = inspect(db.get_bind())
    required = {
        "op_logistica_tipo_feedback",
        "op_logistica_feedback",
        "op_logistica_feedback_participante",
    }
    return all(inspector.has_table(table_name) for table_name in required)


def _rate(completed: int, not_completed: int) -> float | None:
    total = completed + not_completed
    return round((completed / total) * 100, 2) if total else None


def get_dashboard(
    db: Session,
    *,
    access: AuthorizationContext,
    data_de: date | None,
    data_ate: date | None,
    id_localidade: int | None,
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
        rows = db.execute(select(registered_items)).all()
        item_count = len(rows)
        launch_ids = {row.id_lancamento for row in rows}
        locality_totals: dict[int, dict[str, object]] = {}
        daily_totals: dict[date, list[int]] = defaultdict(lambda: [0, 0])
        item_data: dict[int, object] = {}
        planned_total = completed_total = not_completed_total = 0

        for row in rows:
            planned = row.realizadas + row.nao_realizadas
            planned_total += planned
            completed_total += row.realizadas
            not_completed_total += row.nao_realizadas
            daily_totals[row.data_entrega][0] += row.realizadas
            daily_totals[row.data_entrega][1] += row.nao_realizadas
            item_data[row.id_entrega_diaria] = row

            locality = locality_totals.setdefault(
                row.id_localidade,
                {
                    "name": row.nome_localidade,
                    "launch_ids": set(),
                    "planned": 0,
                    "completed": 0,
                    "not_completed": 0,
                    "praise": 0,
                    "complaint": 0,
                },
            )
            locality["launch_ids"].add(row.id_lancamento)
            locality["planned"] += planned
            locality["completed"] += row.realizadas
            locality["not_completed"] += row.nao_realizadas

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

        participants_by_item: dict[int, list[tuple[int, str, str, int]]] = defaultdict(list)
        person_totals: dict[int, dict[str, object]] = {}
        if item_count:
            participant_rows = db.execute(
                select(
                    EntregaParticipante.id_entrega_diaria,
                    Pessoa.id_pessoa,
                    Pessoa.nome_exibicao,
                    Pessoa.tipo_funcao,
                    EntregaParticipante.papel_participante,
                    EntregaParticipante.ordem,
                )
                .join(
                    registered_items,
                    registered_items.c.id_entrega_diaria
                    == EntregaParticipante.id_entrega_diaria,
                )
                .join(Pessoa, Pessoa.id_pessoa == EntregaParticipante.id_pessoa)
                .order_by(
                    EntregaParticipante.id_entrega_diaria,
                    EntregaParticipante.papel_participante,
                    EntregaParticipante.ordem,
                )
            ).all()

            for row in participant_rows:
                participants_by_item[row.id_entrega_diaria].append(
                    (row.id_pessoa, row.nome_exibicao, row.tipo_funcao, row.ordem)
                )
                person = person_totals.setdefault(
                    row.id_pessoa,
                    {
                        "name": row.nome_exibicao,
                        "role": row.tipo_funcao,
                        "items": set(),
                        "teams": set(),
                        "planned": 0,
                        "completed": 0,
                        "not_completed": 0,
                        "praise": 0,
                        "complaint": 0,
                    },
                )
                item = item_data[row.id_entrega_diaria]
                if row.id_entrega_diaria not in person["items"]:
                    person["items"].add(row.id_entrega_diaria)
                    person["planned"] += item.realizadas + item.nao_realizadas
                    person["completed"] += item.realizadas
                    person["not_completed"] += item.nao_realizadas

        team_totals: dict[str, dict[str, object]] = {}
        team_key_by_item: dict[int, str] = {}
        for item_id, members in participants_by_item.items():
            ordered_members = sorted(
                members,
                key=lambda member: (0 if member[2] == "MOTORISTA" else 1, member[3], member[0]),
            )
            team_key = ":".join(str(member[0]) for member in ordered_members)
            team_key_by_item[item_id] = team_key
            team = team_totals.setdefault(
                team_key,
                {
                    "name": " · ".join(member[1] for member in ordered_members),
                    "member_ids": [member[0] for member in ordered_members],
                    "items": set(),
                    "launch_ids": set(),
                    "planned": 0,
                    "completed": 0,
                    "not_completed": 0,
                    "praise": 0,
                    "complaint": 0,
                },
            )
            item = item_data[item_id]
            if item_id not in team["items"]:
                team["items"].add(item_id)
                team["launch_ids"].add(item.id_lancamento)
                team["planned"] += item.realizadas + item.nao_realizadas
                team["completed"] += item.realizadas
                team["not_completed"] += item.nao_realizadas
            for member_id, _, _, _ in ordered_members:
                person_totals[member_id]["teams"].add(team_key)

        feedback_available = _feedback_tables_available(db)
        feedback_totals = {"praise": 0, "complaint": 0}
        if feedback_available:
            feedback_rows = db.execute(
                select(
                    registered_items.c.id_entrega_diaria,
                    Feedback.id_feedback,
                    TipoFeedback.codigo_tipo,
                    registered_items.c.id_localidade,
                )
                .join(
                    Feedback,
                    and_(
                        Feedback.id_lancamento_revisao
                        == registered_items.c.id_lancamento_revisao,
                        Feedback.codigo_item_lancamento
                        == registered_items.c.codigo_item_lancamento,
                    ),
                )
                .join(
                    TipoFeedback,
                    TipoFeedback.id_tipo_feedback == Feedback.id_tipo_feedback,
                )
                .where(
                    Feedback.data_feedback >= data_de if data_de is not None else True,
                    Feedback.data_feedback <= data_ate if data_ate is not None else True,
                )
            ).all()
            feedback_item_by_id: dict[int, int] = {}
            feedback_member_codes: dict[int, str] = {}
            for row in feedback_rows:
                code = row.codigo_tipo.upper()
                metric = "praise" if code == "ELOGIO" else "complaint" if code == "RECLAMACAO" else None
                if metric is None:
                    continue
                feedback_totals[metric] += 1
                locality = locality_totals.get(row.id_localidade)
                if locality is not None:
                    locality[metric] += 1
                feedback_item_by_id[row.id_feedback] = row.id_entrega_diaria
                feedback_member_codes[row.id_feedback] = metric

            if feedback_member_codes:
                feedback_participant_rows = db.execute(
                    select(
                        FeedbackParticipante.id_feedback,
                        Pessoa.id_pessoa,
                    )
                    .join(Pessoa, Pessoa.id_pessoa == FeedbackParticipante.id_pessoa)
                    .where(FeedbackParticipante.id_feedback.in_(feedback_member_codes.keys()))
                ).all()
                counted_team_feedback: set[tuple[str, int]] = set()
                for row in feedback_participant_rows:
                    metric = feedback_member_codes[row.id_feedback]
                    person = person_totals.get(row.id_pessoa)
                    if person is not None:
                        person[metric] += 1
                    item_id = feedback_item_by_id[row.id_feedback]
                    team_key = team_key_by_item.get(item_id)
                    team_feedback_key = (team_key, row.id_feedback) if team_key is not None else None
                    if team_key is not None and team_feedback_key not in counted_team_feedback:
                        team_totals[team_key][metric] += 1
                        counted_team_feedback.add((team_key, row.id_feedback))

        by_locality = [
            LocalityPerformance(
                id_localidade=id_locality,
                nome=str(values["name"]),
                lancamentos=len(values["launch_ids"]),
                itens_planejados=int(values["planned"]),
                realizadas=int(values["completed"]),
                nao_realizadas=int(values["not_completed"]),
                taxa_realizacao=_rate(int(values["completed"]), int(values["not_completed"])),
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
                equipes=len(values["teams"]),
                itens_planejados=int(values["planned"]),
                realizadas=int(values["completed"]),
                nao_realizadas=int(values["not_completed"]),
                taxa_realizacao=_rate(int(values["completed"]), int(values["not_completed"])),
                elogios=int(values["praise"]) if feedback_available else None,
                reclamacoes=int(values["complaint"]) if feedback_available else None,
            )
            for id_person, values in person_totals.items()
        ]
        by_people.sort(
            key=lambda item: (
                -(item.taxa_realizacao if item.taxa_realizacao is not None else -1),
                -item.itens_planejados,
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
                lancamentos=len(values["launch_ids"]),
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
                data=day,
                planejadas=values[0] + values[1],
                realizadas=values[0],
                nao_realizadas=values[1],
                taxa_realizacao=_rate(values[0], values[1]),
            )
            for day, values in sorted(daily_totals.items())
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
                lancamentos_registrados=len(launch_ids),
                itens_planejados=planned_total,
                entregas_realizadas=completed_total,
                entregas_nao_realizadas=not_completed_total,
                taxa_realizacao=_rate(completed_total, not_completed_total),
                otif_percentual=None,
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
