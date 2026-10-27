"""Validação, autorização por escopo e transações do módulo de Entregas."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, date, datetime
from hashlib import sha256
from uuid import UUID, uuid4

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    APIError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
)
from app.modules.access_control import service as access_control_service
from app.modules.access_control.catalog import DELIVERY_SECTOR_CODE, DELIVERY_SECTOR_NAME
from app.modules.access_control.service import AuthorizationContext
from app.modules.catalogs.models import MotivoNaoEntrega, Pessoa, Setor
from app.modules.deliveries import repository
from app.modules.deliveries.models import (
    EntregaDiaria,
    EntregaMotivo,
    EntregaParticipante,
    Lancamento,
    LancamentoEvento,
    LancamentoRevisao,
)
from app.modules.deliveries.schemas import (
    DeliveryDraftCreateRequest,
    DeliveryDraftUpdateRequest,
    DeliveryEventResponse,
    DeliveryItemInput,
    DeliveryItemResponse,
    DeliveryLaunchDetail,
    DeliveryLaunchPage,
    DeliveryLaunchSummary,
    DeliveryParticipantInput,
    DeliveryReasonInput,
    DeliveryParticipantResponse,
    DeliveryReasonResponse,
)


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _database_unavailable(db: Session, exc: SQLAlchemyError) -> ServiceUnavailableError:
    try:
        db.rollback()
    except SQLAlchemyError:
        pass
    return ServiceUnavailableError("Entregas temporariamente indisponíveis.")


def _validate_references(
    db: Session,
    *,
    items: list[DeliveryItemInput],
) -> None:
    locality_ids = {item.id_localidade for item in items}
    active_localities = repository.get_active_localities(
        db,
        id_localidades=locality_ids,
    )
    if {item.id_localidade for item in active_localities} != locality_ids:
        raise NotFoundError("Uma ou mais localidades ativas não foram encontradas.")

    person_ids = {
        participant.id_pessoa
        for item in items
        for participant in item.participantes
    }
    people = {
        person.id_pessoa: person
        for person in repository.get_people_by_ids(db, id_pessoas=person_ids)
    }
    reason_ids = {
        reason.id_motivo_nao_entrega
        for item in items
        for reason in item.motivos
    }
    reasons = {
        reason.id_motivo_nao_entrega: reason
        for reason in repository.get_reasons_by_ids(db, id_motivos=reason_ids)
    }

    for item in items:
        transport_types: set[str] = set()
        for participant in item.participantes:
            person = people.get(participant.id_pessoa)
            if person is None:
                raise NotFoundError("Uma ou mais pessoas não foram encontradas.")
            _validate_person_for_item(person, participant.papel_participante, item.data_entrega)
            if person.tipo_transporte_entrega is None:
                raise ConflictError(
                    "Classifique como Entregas próprias ou terceirizadas todas as pessoas da equipe."
                )
            transport_types.add(person.tipo_transporte_entrega)
        if len(transport_types) != 1:
            raise ConflictError(
                "Motorista e ajudantes precisam pertencer ao mesmo tipo de entrega."
            )
        for reason_input in item.motivos:
            reason = reasons.get(reason_input.id_motivo_nao_entrega)
            if reason is None:
                raise NotFoundError("Um ou mais motivos não foram encontrados.")
            _validate_reason_for_item(reason, item.data_entrega)
            if reason.grupo_motivo is None:
                raise ConflictError(
                    "Classifique o grupo de todos os motivos antes de usá-los em novos lançamentos."
                )


def _validate_person_for_item(person: Pessoa, role: str, reference_date: date) -> None:
    if (
        not person.ativo
        or person.vigente_desde > reference_date
        or (person.vigente_ate is not None and person.vigente_ate <= reference_date)
    ):
        raise ConflictError("A pessoa não estava ativa na data da entrega.")
    expected_function = "MOTORISTA" if role == "MOTORISTA" else "AJUDANTE"
    if person.tipo_funcao != expected_function:
        raise ConflictError("A função cadastrada da pessoa não corresponde ao papel informado.")


def _validate_reason_for_item(reason: MotivoNaoEntrega, reference_date: date) -> None:
    if (
        not reason.ativo
        or reason.vigente_desde > reference_date
        or (reason.vigente_ate is not None and reason.vigente_ate <= reference_date)
    ):
        raise ConflictError("O motivo não estava ativo na data da entrega.")


def _require_item_scopes(
    access: AuthorizationContext,
    *,
    id_setor: int,
    items: list[DeliveryItemInput],
) -> None:
    for item in items:
        access_control_service.require_scope(
            access,
            id_setor=id_setor,
            id_localidade=item.id_localidade,
        )


def _build_details(
    db: Session,
    *,
    launch_rows: list[repository.LaunchRevisionRow],
) -> list[DeliveryLaunchDetail]:
    if not launch_rows:
        return []

    revision_ids = {revision.id_lancamento_revisao for _, revision, _ in launch_rows}
    item_rows = repository.list_delivery_rows(db, id_revisoes=revision_ids)
    delivery_ids = {delivery.id_entrega_diaria for delivery, _ in item_rows}
    participants_by_item: dict[int, list[DeliveryParticipantResponse]] = defaultdict(list)
    for participant, person in repository.list_participant_rows(
        db,
        id_entregas=delivery_ids,
    ):
        participants_by_item[participant.id_entrega_diaria].append(
            DeliveryParticipantResponse(
                id_pessoa=person.id_pessoa,
                codigo_pessoa=UUID(person.codigo_pessoa),
                nome_exibicao=person.nome_exibicao,
                papel_participante=participant.papel_participante,
                ordem=participant.ordem,
                tipo_transporte_entrega=person.tipo_transporte_entrega,
            )
        )

    reasons_by_item: dict[int, list[DeliveryReasonResponse]] = defaultdict(list)
    for reason_link, reason in repository.list_reason_rows(
        db,
        id_entregas=delivery_ids,
    ):
        for _ in range(reason_link.quantidade):
            reasons_by_item[reason_link.id_entrega_diaria].append(
                DeliveryReasonResponse(
                    id_motivo_nao_entrega=reason.id_motivo_nao_entrega,
                    codigo_motivo=reason.codigo_motivo,
                    descricao_motivo=reason.descricao_motivo,
                    grupo_motivo=reason.grupo_motivo,
                    quantidade=1,
                    observacao=reason_link.observacao,
                )
            )

    items_by_revision: dict[int, list[DeliveryItemResponse]] = defaultdict(list)
    for delivery, locality in item_rows:
        items_by_revision[delivery.id_lancamento_revisao].append(
            DeliveryItemResponse(
                codigo_item_lancamento=UUID(delivery.codigo_item_lancamento),
                tipo_operacao=delivery.tipo_operacao,
                data_entrega=delivery.data_entrega,
                id_localidade=locality.id_localidade,
                codigo_localidade=locality.codigo_localidade,
                nome_localidade=locality.nome_localidade,
                quantidade_realizada=delivery.quantidade_realizada,
                quantidade_nao_realizada=delivery.quantidade_nao_realizada,
                observacao=delivery.observacao,
                participantes=participants_by_item[delivery.id_entrega_diaria],
                motivos=reasons_by_item[delivery.id_entrega_diaria],
            )
        )

    details = []
    for launch, revision, sector in launch_rows:
        details.append(
            DeliveryLaunchDetail(
                codigo_lancamento=UUID(launch.codigo_lancamento),
                id_setor=sector.id_setor,
                codigo_setor=sector.codigo,
                nome_setor=sector.nome,
                codigo_revisao=UUID(revision.codigo_revisao),
                numero_revisao=revision.numero_revisao,
                estado=revision.estado,
                criado_por=launch.criado_por,
                criado_em=launch.criado_em,
                atualizado_em=launch.atualizado_em,
                itens=items_by_revision[revision.id_lancamento_revisao],
            )
        )
    return details


def _copy_detail_items(detail: DeliveryLaunchDetail) -> list[DeliveryItemInput]:
    copied_items = []
    for item in detail.itens:
        copied = DeliveryItemInput(
            codigo_item_lancamento=item.codigo_item_lancamento,
            tipo_operacao=item.tipo_operacao,
            data_entrega=item.data_entrega,
            id_localidade=item.id_localidade,
            quantidade_realizada=item.quantidade_realizada,
            quantidade_nao_realizada=item.quantidade_nao_realizada,
            participantes=[
                DeliveryParticipantInput(
                    id_pessoa=participant.id_pessoa,
                    papel_participante=participant.papel_participante,
                )
                for participant in item.participantes
            ],
            motivos=[
                DeliveryReasonInput(
                    id_motivo_nao_entrega=reason.id_motivo_nao_entrega,
                    observacao=reason.observacao,
                )
                for reason in item.motivos
            ],
        )
        copied._legacy_observation = item.observacao
        copied_items.append(copied)
    return copied_items


def _require_visible_launch(
    db: Session,
    *,
    codigo_lancamento: UUID,
    access: AuthorizationContext,
    lock: bool = False,
) -> tuple[Lancamento, LancamentoRevisao, Setor]:
    row = repository.get_visible_launch(
        db,
        codigo_lancamento=codigo_lancamento,
        scope_pairs=access_control_service.scope_pairs(access),
        lock=lock,
    )
    if row is None:
        raise NotFoundError("Lançamento não encontrado.")
    return row


def _create_item_rows(
    db: Session,
    *,
    revision: LancamentoRevisao,
    items: list[DeliveryItemInput],
    now: datetime,
) -> None:
    used_codes: set[str] = set()
    for item in items:
        item_code = str(item.codigo_item_lancamento or uuid4())
        if item_code in used_codes:
            raise ConflictError("O código de item aparece mais de uma vez no lançamento.")
        used_codes.add(item_code)
        delivery = EntregaDiaria(
            id_lancamento_revisao=revision.id_lancamento_revisao,
            codigo_item_lancamento=item_code,
            tipo_operacao=item.tipo_operacao,
            data_entrega=item.data_entrega,
            id_localidade=item.id_localidade,
            quantidade_realizada=item.quantidade_realizada,
            quantidade_nao_realizada=item.quantidade_nao_realizada,
            observacao=item._legacy_observation,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(delivery)
        db.flush()
        for order, participant in enumerate(item.participantes, start=1):
            db.add(
                EntregaParticipante(
                    id_entrega_diaria=delivery.id_entrega_diaria,
                    id_pessoa=participant.id_pessoa,
                    papel_participante=participant.papel_participante,
                    ordem=order,
                )
            )
        for reason in item.motivos:
            db.add(
                EntregaMotivo(
                    id_entrega_diaria=delivery.id_entrega_diaria,
                    id_motivo_nao_entrega=reason.id_motivo_nao_entrega,
                    quantidade=1,
                    observacao=reason.observacao,
                )
            )


def create_draft(
    db: Session,
    *,
    payload: DeliveryDraftCreateRequest,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> DeliveryLaunchDetail:
    now = _utc_now()
    try:
        existing = repository.get_launch_by_idempotency_key(
            db,
            idempotency_key=idempotency_key,
        )
        if existing is not None:
            if existing.criado_por != access.id_usuario:
                raise ConflictError("A chave de idempotência já foi utilizada.")
            visible = _require_visible_launch(
                db,
                codigo_lancamento=UUID(existing.codigo_lancamento),
                access=access,
            )
            return _build_details(db, launch_rows=[visible])[0]

        if any(item.codigo_item_lancamento is not None for item in payload.itens):
            raise ConflictError("O código do item é gerado pelo servidor ao criar o rascunho.")
        sector = repository.get_active_sector_by_code(db, codigo=DELIVERY_SECTOR_CODE)
        if sector is None:
            raise NotFoundError(f"O setor {DELIVERY_SECTOR_NAME} não está ativo no Portal.")
        _require_item_scopes(access, id_setor=sector.id_setor, items=payload.itens)
        _validate_references(db, items=payload.itens)
        form = repository.get_current_published_form(
            db,
            id_setor=sector.id_setor,
            agora=now,
        )
        if form is None:
            raise ConflictError("Não há formulário publicado e vigente para este setor.")

        launch = Lancamento(
            codigo_lancamento=str(uuid4()),
            id_setor=sector.id_setor,
            chave_idempotencia=str(idempotency_key),
            criado_por=access.id_usuario,
            criado_em=now,
            atualizado_em=now,
        )
        db.add(launch)
        db.flush()
        revision = LancamentoRevisao(
            id_lancamento=launch.id_lancamento,
            codigo_revisao=str(uuid4()),
            id_formulario_versao=form.id_formulario_versao,
            numero_revisao=1,
            chave_idempotencia=str(idempotency_key),
            estado="RASCUNHO",
            hash_conteudo=None,
            criado_por=access.id_usuario,
            criado_em=now,
        )
        db.add(revision)
        db.flush()
        _create_item_rows(db, revision=revision, items=payload.itens, now=now)
        db.add(
            LancamentoEvento(
                id_lancamento=launch.id_lancamento,
                id_lancamento_revisao=revision.id_lancamento_revisao,
                chave_idempotencia=str(idempotency_key),
                tipo_evento="RASCUNHO_CRIADO",
                estado_anterior=None,
                estado_novo="RASCUNHO",
                ator_usuario_id=access.id_usuario,
                ocorrido_em=now,
                campos_alterados={"itens": "criados"},
            )
        )
        db.commit()
        row = _require_visible_launch(
            db,
            codigo_lancamento=UUID(launch.codigo_lancamento),
            access=access,
        )
        return _build_details(db, launch_rows=[row])[0]
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("O lançamento conflita com uma chave já cadastrada.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def get_draft(
    db: Session,
    *,
    codigo_lancamento: UUID,
    access: AuthorizationContext,
) -> DeliveryLaunchDetail:
    try:
        row = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
        )
        return _build_details(db, launch_rows=[row])[0]
    except APIError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_drafts(
    db: Session,
    *,
    access: AuthorizationContext,
    estado: str | None,
    data_de: date | None,
    data_ate: date | None,
    id_localidade: int | None,
    criado_por: int | None,
    limit: int,
    offset: int,
) -> DeliveryLaunchPage:
    if data_de is not None and data_ate is not None and data_de > data_ate:
        raise ConflictError("A data inicial deve ser anterior ou igual à data final.")
    try:
        if id_localidade is not None:
            access_control_service.require_scope(access, id_localidade=id_localidade)
        rows, total = repository.list_visible_launches(
            db,
            scope_pairs=access_control_service.scope_pairs(access),
            estado=estado,
            data_de=data_de,
            data_ate=data_ate,
            id_localidade=id_localidade,
            criado_por=criado_por,
            limit=limit,
            offset=offset,
        )
        details = _build_details(db, launch_rows=rows)
        summaries = []
        for detail in details:
            dates = [item.data_entrega for item in detail.itens]
            delivery_items = [
                item for item in detail.itens if item.tipo_operacao == "ENTREGA"
            ]
            collection_items = [
                item for item in detail.itens if item.tipo_operacao == "COLETA"
            ]
            summaries.append(
                DeliveryLaunchSummary(
                    codigo_lancamento=detail.codigo_lancamento,
                    id_setor=detail.id_setor,
                    codigo_setor=detail.codigo_setor,
                    nome_setor=detail.nome_setor,
                    codigo_revisao=detail.codigo_revisao,
                    numero_revisao=detail.numero_revisao,
                    estado=detail.estado,
                    criado_por=detail.criado_por,
                    criado_em=detail.criado_em,
                    atualizado_em=detail.atualizado_em,
                    data_inicial=min(dates),
                    data_final=max(dates),
                    quantidade_itens=len(detail.itens),
                    quantidade_realizada=sum(
                        item.quantidade_realizada for item in detail.itens
                    ),
                    quantidade_nao_realizada=sum(
                        item.quantidade_nao_realizada for item in detail.itens
                    ),
                    entregas_realizadas=sum(
                        item.quantidade_realizada for item in delivery_items
                    ),
                    entregas_nao_realizadas=sum(
                        item.quantidade_nao_realizada for item in delivery_items
                    ),
                    coletas_realizadas=sum(
                        item.quantidade_realizada for item in collection_items
                    ),
                    coletas_nao_realizadas=sum(
                        item.quantidade_nao_realizada for item in collection_items
                    ),
                    itens=detail.itens,
                )
            )
        return DeliveryLaunchPage(
            items=summaries,
            total=total,
            limit=limit,
            offset=offset,
        )
    except APIError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def update_draft(
    db: Session,
    *,
    codigo_lancamento: UUID,
    payload: DeliveryDraftUpdateRequest,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> DeliveryLaunchDetail:
    now = _utc_now()
    try:
        launch, revision, sector = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
            lock=True,
        )
        prior_event = repository.get_launch_event_by_idempotency_key(
            db,
            idempotency_key=idempotency_key,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "RASCUNHO_ATUALIZADO"
                and prior_event.ator_usuario_id == access.id_usuario
                and prior_event.id_lancamento == launch.id_lancamento
                and prior_event.id_lancamento_revisao == revision.id_lancamento_revisao
            ):
                return _build_details(
                    db,
                    launch_rows=[(launch, revision, sector)],
                )[0]
            raise ConflictError("A chave de idempotência já foi utilizada.")
        if revision.estado != "RASCUNHO":
            raise ConflictError("Somente rascunhos podem ser editados.")

        _require_item_scopes(access, id_setor=launch.id_setor, items=payload.itens)
        _validate_references(db, items=payload.itens)
        old_item_rows = repository.list_delivery_rows(
            db,
            id_revisoes={revision.id_lancamento_revisao},
        )
        old_observations_by_code = {
            delivery.codigo_item_lancamento: delivery.observacao
            for delivery, _ in old_item_rows
        }
        old_codes = set(old_observations_by_code)
        requested_codes = [
            str(item.codigo_item_lancamento)
            for item in payload.itens
            if item.codigo_item_lancamento is not None
        ]
        if len(requested_codes) != len(set(requested_codes)):
            raise ConflictError("O código de item aparece mais de uma vez no lançamento.")
        if any(code not in old_codes for code in requested_codes):
            raise ConflictError("O código de item não pertence a este rascunho.")

        for item in payload.itens:
            if item.codigo_item_lancamento is not None:
                item._legacy_observation = old_observations_by_code.get(
                    str(item.codigo_item_lancamento)
                )

        delivery_ids = {delivery.id_entrega_diaria for delivery, _ in old_item_rows}
        if delivery_ids:
            db.execute(
                delete(EntregaParticipante).where(
                    EntregaParticipante.id_entrega_diaria.in_(delivery_ids)
                )
            )
            db.execute(
                delete(EntregaMotivo).where(
                    EntregaMotivo.id_entrega_diaria.in_(delivery_ids)
                )
            )
            db.execute(
                delete(EntregaDiaria).where(
                    EntregaDiaria.id_entrega_diaria.in_(delivery_ids)
                )
            )
        _create_item_rows(db, revision=revision, items=payload.itens, now=now)
        launch.atualizado_em = now
        db.add(
            LancamentoEvento(
                id_lancamento=launch.id_lancamento,
                id_lancamento_revisao=revision.id_lancamento_revisao,
                chave_idempotencia=str(idempotency_key),
                tipo_evento="RASCUNHO_ATUALIZADO",
                estado_anterior="RASCUNHO",
                estado_novo="RASCUNHO",
                ator_usuario_id=access.id_usuario,
                ocorrido_em=now,
                campos_alterados={"itens": "substituídos"},
            )
        )
        db.commit()
        row = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
        )
        return _build_details(db, launch_rows=[row])[0]
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A atualização conflita com um registro existente.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def start_correction_draft(
    db: Session,
    *,
    codigo_lancamento: UUID,
    justificativa: str | None,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> DeliveryLaunchDetail:
    """Abre uma nova revisão editável sem alterar a revisão confirmada."""
    now = _utc_now()
    try:
        launch, revision, sector = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
            lock=True,
        )
        prior_event = repository.get_launch_event_by_idempotency_key(
            db,
            idempotency_key=idempotency_key,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "CORRECAO_INICIADA"
                and prior_event.ator_usuario_id == access.id_usuario
                and prior_event.id_lancamento == launch.id_lancamento
            ):
                revision_row = repository.get_revision_for_launch(
                    db,
                    id_lancamento=launch.id_lancamento,
                    id_lancamento_revisao=prior_event.id_lancamento_revisao,
                )
                if revision_row is not None:
                    return _build_details(
                        db,
                        launch_rows=[(launch, revision_row[0], revision_row[1])],
                    )[0]
            raise ConflictError("A chave de idempotência já foi utilizada.")

        if revision.estado not in {"ENVIADA", "APROVADA"}:
            raise ConflictError("Só é possível corrigir um lançamento confirmado.")
        detail = _build_details(db, launch_rows=[(launch, revision, sector)])[0]
        items = _copy_detail_items(detail)
        new_revision = LancamentoRevisao(
            id_lancamento=launch.id_lancamento,
            codigo_revisao=str(uuid4()),
            id_formulario_versao=revision.id_formulario_versao,
            numero_revisao=revision.numero_revisao + 1,
            chave_idempotencia=str(idempotency_key),
            estado="RASCUNHO",
            hash_conteudo=None,
            criado_por=access.id_usuario,
            criado_em=now,
        )
        db.add(new_revision)
        db.flush()
        _create_item_rows(db, revision=new_revision, items=items, now=now)
        launch.atualizado_em = now
        db.add(
            LancamentoEvento(
                id_lancamento=launch.id_lancamento,
                id_lancamento_revisao=new_revision.id_lancamento_revisao,
                chave_idempotencia=str(idempotency_key),
                tipo_evento="CORRECAO_INICIADA",
                estado_anterior=revision.estado,
                estado_novo="RASCUNHO",
                ator_usuario_id=access.id_usuario,
                ocorrido_em=now,
                comentario=justificativa,
                campos_alterados={"revisao": "nova revisão de correção"},
            )
        )
        db.commit()
        row = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
        )
        return _build_details(db, launch_rows=[row])[0]
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("Já existe uma ação concorrente para este lançamento.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def cancel_confirmed_launch(
    db: Session,
    *,
    codigo_lancamento: UUID,
    justificativa: str,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> None:
    """Cancela um lançamento confirmado sem apagar revisões ou eventos anteriores."""
    now = _utc_now()
    try:
        launch, revision, _ = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
            lock=True,
        )
        prior_event = repository.get_launch_event_by_idempotency_key(
            db,
            idempotency_key=idempotency_key,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "LANCAMENTO_CANCELADO"
                and prior_event.ator_usuario_id == access.id_usuario
                and prior_event.id_lancamento == launch.id_lancamento
            ):
                return
            raise ConflictError("A chave de idempotência já foi utilizada.")

        if revision.estado not in {"ENVIADA", "APROVADA", "RASCUNHO"}:
            raise ConflictError("O lançamento não está em um estado que permita cancelamento.")
        confirmed = repository.get_latest_confirmed_revision(
            db,
            id_lancamento=launch.id_lancamento,
            before_revision=(
                revision.numero_revisao
                if revision.estado == "RASCUNHO"
                else revision.numero_revisao + 1
            ),
        )
        if confirmed is None:
            raise ConflictError("Somente lançamentos já confirmados podem ser cancelados.")

        prior_state = revision.estado
        revision.estado = "CANCELADA"
        launch.atualizado_em = now
        db.add(
            LancamentoEvento(
                id_lancamento=launch.id_lancamento,
                id_lancamento_revisao=revision.id_lancamento_revisao,
                chave_idempotencia=str(idempotency_key),
                tipo_evento="LANCAMENTO_CANCELADO",
                estado_anterior=prior_state,
                estado_novo="CANCELADA",
                ator_usuario_id=access.id_usuario,
                ocorrido_em=now,
                comentario=justificativa,
                campos_alterados={"estado": "CANCELADA"},
            )
        )
        db.commit()
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("O cancelamento conflita com uma ação já registrada.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def list_launch_events(
    db: Session,
    *,
    codigo_lancamento: UUID,
    access: AuthorizationContext,
) -> list[DeliveryEventResponse]:
    try:
        launch, _, _ = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
        )
        rows = repository.list_launch_events(db, id_lancamento=launch.id_lancamento)
        return [
            DeliveryEventResponse(
                id_evento=event.id_evento,
                codigo_revisao=UUID(revision.codigo_revisao),
                numero_revisao=revision.numero_revisao,
                tipo_evento=event.tipo_evento,
                estado_anterior=event.estado_anterior,
                estado_novo=event.estado_novo,
                ator_usuario_id=event.ator_usuario_id,
                ocorrido_em=event.ocorrido_em,
                comentario=event.comentario,
            )
            for event, revision in rows
        ]
    except APIError:
        raise
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def discard_draft(
    db: Session,
    *,
    codigo_lancamento: UUID,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> None:
    """Descarta um rascunho sem remover o registro da trilha de auditoria."""
    now = _utc_now()
    try:
        launch, revision, _ = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
            lock=True,
        )
        prior_event = repository.get_launch_event_by_idempotency_key(
            db,
            idempotency_key=idempotency_key,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento == "RASCUNHO_DESCARTADO"
                and prior_event.ator_usuario_id == access.id_usuario
                and prior_event.id_lancamento == launch.id_lancamento
                and prior_event.id_lancamento_revisao == revision.id_lancamento_revisao
            ):
                return
            raise ConflictError("A chave de idempotência já foi utilizada.")
        if revision.estado != "RASCUNHO":
            raise ConflictError("Somente rascunhos podem ser descartados.")

        revision.estado = "CANCELADA"
        launch.atualizado_em = now
        db.add(
            LancamentoEvento(
                id_lancamento=launch.id_lancamento,
                id_lancamento_revisao=revision.id_lancamento_revisao,
                chave_idempotencia=str(idempotency_key),
                tipo_evento="RASCUNHO_DESCARTADO",
                estado_anterior="RASCUNHO",
                estado_novo="CANCELADA",
                ator_usuario_id=access.id_usuario,
                ocorrido_em=now,
                comentario="Rascunho descartado pelo usuário.",
                campos_alterados={"estado": "CANCELADA"},
            )
        )
        db.commit()
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("O rascunho conflita com uma ação já registrada.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc


def confirm_draft(
    db: Session,
    *,
    codigo_lancamento: UUID,
    idempotency_key: UUID,
    access: AuthorizationContext,
) -> DeliveryLaunchDetail:
    """Valida e registra definitivamente o rascunho confirmado pelo próprio autor."""
    now = _utc_now()
    try:
        launch, revision, sector = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
            lock=True,
        )
        prior_event = repository.get_launch_event_by_idempotency_key(
            db,
            idempotency_key=idempotency_key,
        )
        if prior_event is not None:
            if (
                prior_event.tipo_evento in {"RASCUNHO_CONFIRMADO", "RASCUNHO_ENVIADO"}
                and prior_event.ator_usuario_id == access.id_usuario
                and prior_event.id_lancamento == launch.id_lancamento
                and prior_event.id_lancamento_revisao == revision.id_lancamento_revisao
            ):
                return _build_details(db, launch_rows=[(launch, revision, sector)])[0]
            raise ConflictError("A chave de idempotência já foi utilizada.")

        if revision.estado != "RASCUNHO":
            raise ConflictError("Somente rascunhos podem ser confirmados como lançamentos.")
        if revision.criado_por != access.id_usuario:
            raise ConflictError(
                "Somente quem criou este rascunho pode confirmar o lançamento."
            )

        detail = _build_details(db, launch_rows=[(launch, revision, sector)])[0]
        canonical_content = json.dumps(
            detail.model_dump(mode="json", include={"id_setor", "itens"}),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
        # ENVIADA é o estado final de um lançamento confirmado; não há fila de aprovação.
        revision.estado = "ENVIADA"
        revision.hash_conteudo = sha256(canonical_content.encode("utf-8")).hexdigest()
        revision.enviado_por = access.id_usuario
        revision.enviado_em = now
        launch.atualizado_em = now
        db.add(
            LancamentoEvento(
                id_lancamento=launch.id_lancamento,
                id_lancamento_revisao=revision.id_lancamento_revisao,
                chave_idempotencia=str(idempotency_key),
                tipo_evento="RASCUNHO_CONFIRMADO",
                estado_anterior="RASCUNHO",
                estado_novo="ENVIADA",
                ator_usuario_id=access.id_usuario,
                ocorrido_em=now,
                campos_alterados={
                    "estado": "ENVIADA",
                    "hash_conteudo": revision.hash_conteudo,
                },
            )
        )
        db.commit()
        row = _require_visible_launch(
            db,
            codigo_lancamento=codigo_lancamento,
            access=access,
        )
        return _build_details(db, launch_rows=[row])[0]
    except APIError:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A confirmação conflita com uma ação já registrada.") from exc
    except SQLAlchemyError as exc:
        raise _database_unavailable(db, exc) from exc
