"""Domain events, the notification outbox, the audit log and human-readable codes.

publish_event() writes the event and an outbox row in the SAME transaction as the business change.
A background worker sends the notifications later, so an email failure never loses the change.
"""
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.admin.models import AuditLog, DomainEvent, IdSequence, WorkflowHistory
from app.modules.notifications.models import NotificationOutbox
from app.shared.models.base import utcnow, uuid7


def publish_event(db: Session, event_type: str, entity_type: str, entity_id: str | None, actor_id: str | None = None,
                  *, users: list[str] | None = None, title: str = "", body: str = "", link: str = "",
                  vars: dict | None = None, needs_action: bool = False, data: dict | None = None) -> None:
    """users = people to notify; title/body = in-app text; vars = values for the email template."""
    db.add(DomainEvent(id=uuid7(), event_type=event_type, entity_type=entity_type, entity_id=entity_id,
                       actor_user_id=actor_id, payload=data or {}))
    recipients = [u for u in dict.fromkeys(users or []) if u]
    db.add(NotificationOutbox(event_type=event_type, payload={
        "entity_type": entity_type, "entity_id": entity_id, "recipient_user_ids": recipients,
        "title": title, "body": body, "link_path": link, "vars": vars or {}, "needs_action": needs_action,
    }))


def audit(db: Session, actor_id: str | None, action: str, entity_type: str, entity_id: str | None,
          summary: str = "", changes: dict | None = None, request_id: str | None = None) -> None:
    prev = db.scalar(select(AuditLog.row_hash).order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc()).limit(1))
    now = utcnow()
    raw = json.dumps([prev, entity_type, entity_id, action, actor_id, changes or {}, summary, now.isoformat()],
                     sort_keys=True, default=str)
    db.add(AuditLog(id=uuid7(), entity_type=entity_type, entity_id=entity_id, action=action, actor_user_id=actor_id,
                    changes=changes or {}, summary=summary, occurred_at=now, request_id=request_id, prev_hash=prev,
                    row_hash=hashlib.sha256(raw.encode()).hexdigest()))
    db.flush()


def record_history(db: Session, entity_type: str, entity_id: str, from_state: str | None, to_state: str,
                   action: str, actor_id: str | None, comment: str | None = None, at=None) -> None:
    db.add(WorkflowHistory(entity_type=entity_type, entity_id=entity_id, from_state=from_state, to_state=to_state,
                           action_code=action, actor_user_id=actor_id, comment=comment, occurred_at=at or utcnow()))


def next_code(db: Session, prefix: str, width: int = 6, year: int | None = None) -> str:
    """INNO-2026-000123 / CHL-2026-007 / ENT-2026-007-0042."""
    year = year or utcnow().year
    seq = db.scalar(select(IdSequence).where(IdSequence.prefix == prefix, IdSequence.year == year))
    if not seq:
        seq = IdSequence(prefix=prefix, year=year, last_value=0)
        db.add(seq)
    seq.last_value = (seq.last_value or 0) + 1
    db.flush()
    return f"{prefix}-{year}-{seq.last_value:0{width}d}" if not prefix.startswith("ENT-") else f"{prefix}-{seq.last_value:0{width}d}"
