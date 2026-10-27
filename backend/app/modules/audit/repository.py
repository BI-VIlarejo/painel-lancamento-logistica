"""Consultas paginadas de eventos sem carregar detalhes potencialmente sensíveis."""

from collections.abc import Mapping
from datetime import datetime
from typing import Literal

from sqlalchemy import JSON, BigInteger, cast, func, inspect, literal, null, select, union_all
from sqlalchemy.orm import Session

from app.modules.access_control.models import AutorizacaoEvento
from app.modules.auth.models import Usuario
from app.modules.deliveries.models import LancamentoEvento
from app.modules.feedback.models import Feedback


_CATALOG_FIELDS = {
    "nome_exibicao",
    "tipo_funcao",
    "tipo_transporte_entrega",
    "descricao_motivo",
    "grupo_motivo",
    "ativo",
    "vigente_ate",
    "nome_localidade",
    "tipo_localidade",
    "cidade",
    "uf",
    "tipo_escopo",
    "escopo",
    "perfil",
    "permissao",
}
_OTHER_SAFE_FIELDS = {
    "username",
    "nome_completo",
    "ativo",
    "nome",
    "codigo",
    "id_setor",
    "id_recurso",
    "descricao",
    "acao",
    "tipo_escopo",
    "escopo",
    "perfil",
    "permissao",
}


def _as_display_value(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    return None


def _safe_changes(value: object) -> list[dict[str, str | None]]:
    changes: list[dict[str, str | None]] = []
    if isinstance(value, list):
        for entry in value:
            if not isinstance(entry, Mapping):
                continue
            field = entry.get("campo")
            if not isinstance(field, str) or field not in _CATALOG_FIELDS:
                continue
            changes.append(
                {
                    "campo": field,
                    "anterior": _as_display_value(entry.get("anterior")),
                    "novo": _as_display_value(entry.get("novo")),
                }
            )
    elif isinstance(value, Mapping):
        for field, entry in value.items():
            if not isinstance(field, str) or field not in _CATALOG_FIELDS | _OTHER_SAFE_FIELDS:
                continue
            if not isinstance(entry, Mapping):
                continue
            changes.append(
                {
                    "campo": field,
                    "anterior": _as_display_value(
                        entry.get("anterior", entry.get("de"))
                    ),
                    "novo": _as_display_value(
                        entry.get("novo", entry.get("para"))
                    ),
                }
            )
    return changes


def _access_summary(
    event_type: str,
    details: object,
    target_ids: Mapping[str, object],
) -> tuple[str | None, list[dict[str, str | None]]]:
    data = details if isinstance(details, Mapping) else {}
    kind = data.get("alvo_tipo")
    identifier = data.get("alvo_id")
    code = data.get("alvo_codigo")
    name = data.get("alvo_nome")

    prefixes = (
        ("PESSOA_", "Pessoa", "id_pessoa", "codigo_pessoa"),
        ("MOTIVO_", "Motivo", "id_motivo_nao_entrega", "codigo"),
        ("LOCALIDADE_", "Localidade", "id_localidade", "codigo_localidade"),
    )
    for prefix, label, legacy_id, legacy_code in prefixes:
        if event_type.startswith(prefix):
            identifier = identifier or data.get(legacy_id)
            code = code or data.get(legacy_code)
            name = name or data.get("nome") or data.get("descricao_motivo")
            kind = kind or label.upper()
            break

    if kind == "PESSOA" or event_type.startswith("PESSOA_"):
        label = "Pessoa"
    elif kind == "MOTIVO" or event_type.startswith("MOTIVO_"):
        label = "Motivo"
    elif kind == "LOCALIDADE" or event_type.startswith("LOCALIDADE_"):
        label = "Localidade"
    elif event_type.startswith("USUARIO_") and not event_type.startswith(
        "USUARIO_ESCOPO_"
    ):
        identifier = identifier or data.get("id_usuario")
        name = name or data.get("nome_completo") or data.get("username")
        username = data.get("username")
        if name and username and name != username:
            name = f"{name} (@{username})"
        label = "Usuário"
    elif event_type.startswith("PERFIL_PERMISSAO_"):
        profile = data.get("perfil") or target_ids.get("id_perfil")
        permission = data.get("permissao") or target_ids.get("id_permissao")
        label = "Permissão do perfil"
        name = name or " · ".join(
            str(value) for value in (profile, permission, data.get("recurso")) if value
        )
    elif event_type.startswith("USUARIO_ESCOPO_"):
        identifier = identifier or target_ids.get("id_usuario_escopo")
        label = "Acesso de usuário"
        username = data.get("username")
        profile = data.get("perfil")
        scope = data.get("escopo")
        description = " · ".join(
            str(value)
            for value in (
                f"{data.get('nome_completo')} (@{username})"
                if data.get("nome_completo") and username
                else username,
                profile,
                scope,
            )
            if value
        )
        name = description or name
    elif event_type.startswith("PERFIL_"):
        identifier = identifier or target_ids.get("id_perfil")
        label = "Perfil"
        name = name or data.get("nome") or data.get("codigo")
    elif event_type.startswith("RECURSO_"):
        identifier = identifier or target_ids.get("id_recurso")
        label = "Recurso"
        name = name or data.get("nome") or data.get("codigo")
    elif event_type.startswith("PERMISSAO_"):
        identifier = identifier or target_ids.get("id_permissao")
        label = "Permissão"
        name = name or data.get("descricao") or data.get("codigo")
        if name and data.get("recurso"):
            name = f"{name} · {data['recurso']}"
    else:
        label = str(kind) if kind else "Registro"

    target_parts = [label]
    if name:
        target_parts.append(str(name))
    elif identifier is not None:
        target_parts.append(f"#{identifier}")
    if code and str(code) not in target_parts:
        target_parts.append(f"código {code}")

    changes = _safe_changes(data.get("alteracoes"))
    if not changes:
        changes = _safe_changes(data.get("campos_alterados"))
    return " · ".join(target_parts), changes


def list_events(
    db: Session,
    *,
    origem: Literal["ENTREGAS", "ACESSOS", "FEEDBACK"] | None,
    tipo_evento: str | None,
    ator_usuario_id: int | None,
    ocorrido_de: datetime | None,
    ocorrido_ate: datetime | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, object]], int]:
    delivery_events = select(
        literal("ENTREGAS").label("origem"),
        LancamentoEvento.id_evento.label("id_evento"),
        LancamentoEvento.tipo_evento.label("tipo_evento"),
        LancamentoEvento.ator_usuario_id.label("ator_usuario_id"),
        LancamentoEvento.ocorrido_em.label("ocorrido_em"),
        LancamentoEvento.id_lancamento.label("referencia_id"),
        cast(null(), JSON).label("_dados_internos"),
        cast(null(), BigInteger).label("_id_perfil"),
        cast(null(), BigInteger).label("_id_permissao"),
        cast(null(), BigInteger).label("_id_recurso"),
        cast(null(), BigInteger).label("_id_usuario_escopo"),
        LancamentoEvento.estado_anterior.label("_estado_anterior"),
        LancamentoEvento.estado_novo.label("_estado_novo"),
        LancamentoEvento.campos_alterados.label("_campos_entrega"),
    )
    access_events = select(
        literal("ACESSOS").label("origem"),
        AutorizacaoEvento.id_evento_autorizacao.label("id_evento"),
        AutorizacaoEvento.tipo_evento.label("tipo_evento"),
        AutorizacaoEvento.id_usuario_ator.label("ator_usuario_id"),
        AutorizacaoEvento.ocorrido_em.label("ocorrido_em"),
        cast(null(), BigInteger).label("referencia_id"),
        AutorizacaoEvento.detalhes.label("_dados_internos"),
        AutorizacaoEvento.id_perfil.label("_id_perfil"),
        AutorizacaoEvento.id_permissao.label("_id_permissao"),
        AutorizacaoEvento.id_recurso.label("_id_recurso"),
        AutorizacaoEvento.id_usuario_escopo.label("_id_usuario_escopo"),
        cast(null(), JSON).label("_estado_anterior"),
        cast(null(), JSON).label("_estado_novo"),
        cast(null(), JSON).label("_campos_entrega"),
    )
    event_sources = [delivery_events, access_events]
    inspector = inspect(db.get_bind())
    if inspector.has_table(Feedback.__tablename__):
        feedback_columns = {
            column["name"]
            for column in inspector.get_columns(Feedback.__tablename__)
        }
        if "criado_por" in feedback_columns:
            feedback_events = select(
                literal("FEEDBACK").label("origem"),
                Feedback.id_feedback.label("id_evento"),
                literal("FEEDBACK_CRIADO").label("tipo_evento"),
                Feedback.criado_por.label("ator_usuario_id"),
                Feedback.criado_em.label("ocorrido_em"),
                cast(Feedback.id_feedback, BigInteger).label("referencia_id"),
                cast(null(), JSON).label("_dados_internos"),
                cast(null(), BigInteger).label("_id_perfil"),
                cast(null(), BigInteger).label("_id_permissao"),
                cast(null(), BigInteger).label("_id_recurso"),
                cast(null(), BigInteger).label("_id_usuario_escopo"),
                cast(null(), JSON).label("_estado_anterior"),
                cast(null(), JSON).label("_estado_novo"),
                cast(null(), JSON).label("_campos_entrega"),
            )
            event_sources.append(feedback_events)
    events = union_all(*event_sources).subquery("audit_eventos")
    conditions = []
    if origem is not None:
        conditions.append(events.c.origem == origem)
    if tipo_evento is not None:
        conditions.append(events.c.tipo_evento == tipo_evento)
    if ator_usuario_id is not None:
        conditions.append(events.c.ator_usuario_id == ator_usuario_id)
    if ocorrido_de is not None:
        conditions.append(events.c.ocorrido_em >= ocorrido_de)
    if ocorrido_ate is not None:
        conditions.append(events.c.ocorrido_em <= ocorrido_ate)

    total = db.scalar(
        select(func.count()).select_from(events).where(*conditions)
    ) or 0
    rows = db.execute(
        select(
            events,
            Usuario.nome_completo.label("ator_nome"),
            Usuario.username.label("ator_username"),
        )
        .outerjoin(Usuario, Usuario.id_usuario == events.c.ator_usuario_id)
        .where(*conditions)
        .order_by(
            events.c.ocorrido_em.desc(),
            events.c.origem,
            events.c.id_evento.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).mappings().all()
    safe_rows: list[dict[str, object]] = []
    for stored_row in rows:
        row = dict(stored_row)
        details = row.pop("_dados_internos", None)
        target_ids = {
            "id_perfil": row.pop("_id_perfil", None),
            "id_permissao": row.pop("_id_permissao", None),
            "id_recurso": row.pop("_id_recurso", None),
            "id_usuario_escopo": row.pop("_id_usuario_escopo", None),
        }
        event_type = str(row["tipo_evento"])
        origin = row["origem"]
        if origin == "ACESSOS":
            target, changes = _access_summary(event_type, details, target_ids)
        elif origin == "ENTREGAS":
            target = f"Lançamento #{row['referencia_id']}"
            changes = []
            previous = row.pop("_estado_anterior", None)
            current = row.pop("_estado_novo", None)
            if previous is not None or current is not None:
                changes.append(
                    {
                        "campo": "estado",
                        "anterior": _as_display_value(previous),
                        "novo": _as_display_value(current),
                    }
                )
            changed_fields = row.pop("_campos_entrega", None)
            if isinstance(changed_fields, Mapping):
                for field in changed_fields:
                    if isinstance(field, str) and field not in {"estado"}:
                        changes.append(
                            {"campo": field, "anterior": None, "novo": None}
                        )
        else:
            target = (
                f"Feedback #{row['referencia_id']}"
                if row["referencia_id"] is not None
                else None
            )
            changes = []
        for internal_field in (
            "_id_perfil",
            "_id_permissao",
            "_id_recurso",
            "_id_usuario_escopo",
            "_estado_anterior",
            "_estado_novo",
            "_campos_entrega",
        ):
            row.pop(internal_field, None)
        row["alvo"] = target
        row["alteracoes"] = changes
        safe_rows.append(row)
    return safe_rows, total
