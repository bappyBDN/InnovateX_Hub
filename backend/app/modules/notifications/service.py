"""Outbox dispatcher: turns outbox rows into in-app notifications and email deliveries."""
import logging
import re
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.identity.models import Role, User, UserRoleAssignment
from app.modules.notifications.models import (InAppNotification, NotificationDelivery, NotificationOutbox,
                                              NotificationRule, NotificationTemplate)
from app.shared.models.base import utcnow
from app.shared.util import setting

log = logging.getLogger("notifications")
MAX_ATTEMPTS = 5


def render(template: str | None, variables: dict) -> str:
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda m: str(variables.get(m.group(1), "")), template or "")


def _send_email(to: str, subject: str, body: str) -> None:
    """Raises on failure. With no SMTP_HOST the email is only logged (delivery row still kept)."""
    if not settings.smtp_host:
        log.info("EMAIL (not sent, no SMTP_HOST) to=%s subject=%s", to, subject)
        return
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.mail_from, to, subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.send_message(msg)


def _attempt(delivery: NotificationDelivery) -> None:
    delivery.attempts = (delivery.attempts or 0) + 1
    try:
        _send_email(delivery.recipient_address, delivery.rendered_subject or "", delivery.rendered_body or "")
        delivery.status, delivery.sent_at, delivery.error = "SENT", utcnow(), None
    except Exception as exc:  # the business change is already committed; we only log and retry
        delivery.status, delivery.error = "FAILED", str(exc)[:500]


def _rule_addresses(db: Session, event_type: str) -> list[tuple[str | None, str]]:
    """Extra recipients configured in Admin (e.g. the designated reviewer mailbox)."""
    out: list[tuple[str | None, str]] = []
    rules = db.scalars(select(NotificationRule).where(NotificationRule.event_type == event_type,
                                                      NotificationRule.is_active.is_(True))).all()
    for rule in rules:
        if rule.recipient_type == "FIXED_EMAIL":
            out.append((None, rule.recipient_value))
        elif rule.recipient_type == "SETTING":
            address = setting(db, rule.recipient_value)
            if address:
                out.append((None, address))
        elif rule.recipient_type == "ROLE":
            users = db.scalars(select(User).join(UserRoleAssignment, UserRoleAssignment.user_id == User.id)
                               .join(Role, Role.id == UserRoleAssignment.role_id)
                               .where(Role.code == rule.recipient_value, User.is_active.is_(True))).all()
            out.extend((u.id, u.email) for u in users if u.email)
        if rule.cc_value:
            out.append((None, rule.cc_value))
    return out


def process_outbox(db: Session, limit: int = 50) -> int:
    now = utcnow()
    rows = db.scalars(select(NotificationOutbox).where(NotificationOutbox.status == "PENDING")
                      .order_by(NotificationOutbox.created_at).limit(limit)).all()
    for ob in rows:
        try:
            p = ob.payload or {}
            variables = {**(p.get("vars") or {}), "title": p.get("title", ""), "app_name": settings.app_name}
            link = p.get("link_path") or ""
            variables.setdefault("secure_link", f"{settings.frontend_url}{link}")
            tpl = db.scalar(select(NotificationTemplate).where(NotificationTemplate.event_type == ob.event_type,
                                                               NotificationTemplate.channel == "EMAIL",
                                                               NotificationTemplate.is_active.is_(True)))
            subject = render(tpl.subject_template, variables) if tpl else f"[InnovateX] {p.get('title', ob.event_type)}"
            body = render(tpl.body_template, variables) if tpl else f"{p.get('body', '')}\n\nOpen: {variables['secure_link']}"

            targets: dict[str, str | None] = {}
            for uid in p.get("recipient_user_ids") or []:
                user = db.get(User, uid)
                if not user:
                    continue
                db.add(InAppNotification(user_id=uid, title=p.get("title") or subject, body=p.get("body"),
                                         link_path=link, entity_type=p.get("entity_type"), entity_id=p.get("entity_id"),
                                         event_type=ob.event_type, needs_action=bool(p.get("needs_action"))))
                if user.email:
                    targets[user.email] = uid
            for uid, address in _rule_addresses(db, ob.event_type):
                targets.setdefault(address, uid)

            for address, uid in targets.items():
                delivery = NotificationDelivery(outbox_id=ob.id, event_type=ob.event_type, recipient_user_id=uid,
                                                recipient_address=address, template_code=tpl.code if tpl else None,
                                                rendered_subject=subject, rendered_body=body, attempts=0)
                _attempt(delivery)
                db.add(delivery)
            ob.status, ob.attempts = "DONE", (ob.attempts or 0) + 1
        except Exception as exc:
            ob.attempts = (ob.attempts or 0) + 1
            ob.last_error = str(exc)[:500]
            ob.status = "FAILED" if ob.attempts >= MAX_ATTEMPTS else "PENDING"
            ob.next_attempt_at = now + timedelta(minutes=ob.attempts)
            log.exception("outbox row %s failed", ob.id)
        db.commit()
    return len(rows)


def retry_failed_deliveries(db: Session) -> int:
    rows = db.scalars(select(NotificationDelivery).where(NotificationDelivery.status == "FAILED",
                                                         NotificationDelivery.attempts < MAX_ATTEMPTS).limit(25)).all()
    for d in rows:
        _attempt(d)
    db.commit()
    return len(rows)


def retry_delivery(db: Session, delivery: NotificationDelivery) -> NotificationDelivery:
    _attempt(delivery)
    db.commit()
    return delivery
