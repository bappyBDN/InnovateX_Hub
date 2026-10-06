"""Platform tables: settings, flags, id sequences, audit, events and the workflow engine."""
from sqlalchemy import DateTime, String
from sqlalchemy.orm import mapped_column

from app.shared.models.base import Base, StdColumns, sc, flag, i18n, integer, json_col, ref, text, ts, utcnow


class SystemSetting(Base, StdColumns):
    __tablename__ = "system_settings"
    key = sc(80, index=True)
    value = json_col(lambda: None)
    scope_type = sc(30, default="GLOBAL")
    scope_id = ref()
    description = text()


class FeatureFlag(Base, StdColumns):
    __tablename__ = "feature_flags"
    code = sc(60, unique=True)
    is_enabled = flag(False)
    rules = json_col()
    description = text()


class IdSequence(Base, StdColumns):
    __tablename__ = "id_sequences"
    prefix = sc(40, index=True)
    year = integer()
    last_value = integer(0)


class AuditLog(Base):
    """Append-only with a hash chain; the API never updates or deletes rows."""
    __tablename__ = "audit_logs"
    id = mapped_column(String(36), primary_key=True)
    entity_type = sc(60, index=True)
    entity_id = ref()
    action = sc(40, index=True)
    actor_user_id = ref()
    changes = json_col()
    summary = text()
    ip_address = sc(60, nullable=True)
    request_id = sc(64, nullable=True)
    occurred_at = mapped_column(DateTime, default=utcnow, index=True)
    prev_hash = sc(64, nullable=True)
    row_hash = sc(64, nullable=True)


class DomainEvent(Base):
    __tablename__ = "domain_events"
    id = mapped_column(String(36), primary_key=True)
    event_type = sc(80, index=True)
    event_version = integer(1)
    entity_type = sc(60)
    entity_id = ref()
    actor_user_id = ref()
    payload = json_col()
    occurred_at = mapped_column(DateTime, default=utcnow, index=True)
    correlation_id = sc(64, nullable=True)


class WorkflowDefinition(Base, StdColumns):
    __tablename__ = "workflow_definitions"
    code = sc(60, unique=True)
    entity_type = sc(60)
    version = integer(1)
    status = sc(20, default="PUBLISHED")
    description = text()


class WorkflowState(Base, StdColumns):
    __tablename__ = "workflow_states"
    workflow_definition_id = ref(False)
    code = sc(40)
    name_i18n = i18n()
    state_group = sc(30)  # DRAFT, ACTIVE, WAITING, SUCCESS, CLOSED
    is_initial = flag(False)
    is_terminal = flag(False)
    sla_hours = integer()
    visible_to_owner_as_i18n = i18n()
    sort_order = integer(0)


class WorkflowTransition(Base, StdColumns):
    __tablename__ = "workflow_transitions"
    workflow_definition_id = ref(False)
    from_state = sc(40)
    to_state = sc(40)
    action_code = sc(40)
    label_i18n = i18n()
    allowed_permission = sc(80, nullable=True)  # None = owner action
    requires_comment = flag(False)
    guard_rules = json_col()
    emits_event = sc(80, nullable=True)
    sort_order = integer(0)


class WorkflowHistory(Base, StdColumns):
    """Append-only history of every state change for any entity."""
    __tablename__ = "workflow_history"
    entity_type = sc(60, index=True)
    entity_id = ref()
    from_state = sc(40, nullable=True)
    to_state = sc(40)
    action_code = sc(40)
    actor_user_id = ref()
    comment = text()
    meta = json_col()
    occurred_at = mapped_column(DateTime, default=utcnow)
