"""Outbox dispatcher: turns outbox rows into in-app notifications and email deliveries."""
import logging
import re
import smtplib
import ssl
from datetime import timedelta
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.identity.models import Role, User, UserRoleAssignment
from app.modules.notifications import mail
from app.modules.notifications.models import (InAppNotification, NotificationDelivery, NotificationOutbox,
                                              NotificationRule, NotificationTemplate)
from app.shared.models.base import utcnow
from app.shared.util import setting

log = logging.getLogger("notifications")
MAX_ATTEMPTS = 5


def render(template: str | None, variables: dict) -> str:
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda m: str(variables.get(m.group(1), "")), template or "")


def _send_email(to: str, subject: str, body: str, event_type: str | None = None) -> None:
    """Raises on failure. With no SMTP_HOST the email is only logged (delivery row still kept).
    The plain text goes out together with the branded HTML version built from it."""
    if not settings.smtp_host:
        log.info("EMAIL (not sent, no SMTP_HOST) to=%s subject=%s", to, subject)
        return
    if settings.smtp_user and not settings.smtp_password:   # never try to sign in without one: failed sign-ins can lock the mailbox
        raise RuntimeError("SMTP_PASSWORD is not set for " + settings.smtp_user)
    sender = settings.mail_from or settings.smtp_user
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = formataddr((settings.mail_from_name, sender)), to, subject
    msg["Date"], msg["Message-ID"] = formatdate(localtime=True), make_msgid(domain=sender.split("@")[-1])
    msg.set_content(body)
    msg.add_alternative(mail.html_email(subject, body, event_type), subtype="html")
    logo = mail.logo_bytes()
    if logo:    # travels inside the email, so it shows without loading remote images
        msg.get_payload()[1].add_related(logo, "image", "jpeg", cid=f"<{mail.LOGO_CID}>", filename="anwar-group.jpg",
                                         disposition="inline")
    mode = (settings.smtp_security or "auto").lower()
    if mode == "auto" and settings.smtp_port == 465:
        mode = "ssl"
    tls = ssl.create_default_context()
    if mode == "ssl":
        smtp = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15, context=tls)
    else:
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
    with smtp:
        smtp.ehlo()
        if mode == "starttls" or (mode == "auto" and smtp.has_extn("starttls")):
            smtp.starttls(context=tls)
            smtp.ehlo()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg, from_addr=sender)


def mail_ready() -> bool:
    """True when emails really leave the app (an SMTP server is set)."""
    return bool(settings.smtp_host)


def send_test_email(to: str) -> None:
    """Send one plain email now. Raises with the mail server's own message when it fails."""
    if not mail_ready():
        raise RuntimeError("SMTP_HOST is not set, so no email can be sent.")
    _send_email(to, f"[InnovateX] Test email from {settings.app_name}",
                f"This is a test email from {settings.app_name}.\n\nIf you can read it, email sending works.\n\n"
                f"Open: {settings.frontend_url}\n", "TEST")


def send_sample_emails(to: str) -> list[str]:
    """One of each main email with made-up details, to check how they look. Returns the subjects sent."""
    if not mail_ready():
        raise RuntimeError("SMTP_HOST is not set, so no email can be sent.")
    base, app = settings.frontend_url, settings.app_name
    variables = {"app_name": app, "secure_link": f"{base}/challenges"}
    welcome_subject, welcome_body = (render(t, variables) for t in mail.DEFAULT_TEMPLATES["USER_SIGNED_UP"])
    by_event = {event: (subject, body) for _, event, subject, body in _seed_templates()}

    def filled(event: str, link: str, **values) -> tuple[str, str]:
        values = {"app_name": app, "secure_link": f"{base}{link}", **values}
        return render(by_event[event][0], values), render(by_event[event][1], values)

    challenge, entry = "Cut rework at the finishing line", "ENT-2026-012-0007"
    samples = [
        ("JUDGE_INVITED", *judge_invite_text("Waeez Rahman", challenge, "methodology review and the final presentation",
                                             "We would value your experience on the shop floor.", "14 Oct 2026",
                                             f"{base}/signup?invite=SAMPLE-LINK")),
        ("USER_INVITED", *role_invite_text("Waeez Rahman", "Rezaul Karim", "Program Owner, Reviewer", None, "14 Oct 2026",
                                           f"{base}/signup?invite=SAMPLE-LINK")),
        ("USER_SIGNED_UP", welcome_subject, welcome_body),
        ("ENTRY_SHORTLISTED", *filled("ENTRY_SHORTLISTED", "/entries/sample/feedback", decision="Your entry is shortlisted",
                                      challenge=challenge, entry_code=entry,
                                      message="You are shortlisted! Start building. Share your demo link and how to use it by 30 Oct 2026 "
                                              "on the Demo & pilot page.")),
        ("ENTRY_NOT_SHORTLISTED", *filled("ENTRY_NOT_SHORTLISTED", "/entries/sample/feedback", decision="Shortlist result and your feedback",
                                          challenge=challenge, entry_code=entry,
                                          message="Your entry was not shortlisted this time. The judges wrote feedback to help you next time.")),
        ("AWARD_PUBLISHED", *filled("AWARD_PUBLISHED", "/entries/sample/feedback", headline="Congratulations, you are the champion",
                                    result="Winner", challenge=challenge, entry_code=entry,
                                    message="Your entry won the challenge. Thank you for the work you and your team put in.")),
    ]
    for event, subject, body in samples:
        _send_email(to, subject, body, event)
    return [subject for _, subject, _ in samples]


def _seed_templates():
    from app.seed_reference import TEMPLATES
    return TEMPLATES


def judge_invite_text(inviter: str, what: str, stages: str | None, message: str | None, expires: str, link: str) -> tuple[str, str]:
    """Subject and body of the email that invites someone without an account to be a judge."""
    body = (f"Hello,\n\n{inviter} has invited you to be a judge for {what} on {settings.app_name}.\n\n"
            "As a judge you read the entries, score them against the agreed criteria and give written feedback to the candidates.\n\n"
            + (f"You will judge: {stages}\n" if stages else "")
            + f"Invited by: {inviter}\nLink valid until: {expires}\n\n"
            + (f"A note from {inviter}:\n{message.strip()}\n\n" if message and message.strip() else "")
            + f"Create your account to accept. The link works once.\n{link}\n\n"
            "If you were not expecting this invitation, you can ignore this email.\n")
    return f"[InnovateX] You are invited to be a judge: {what}", body


def role_invite_text(inviter: str, name: str | None, roles: str, message: str | None, expires: str, link: str) -> tuple[str, str]:
    """Subject and body of the email that invites someone to sign up with a privileged role."""
    body = (f"Hello{' ' + name if name else ''},\n\n{inviter} has invited you to join {settings.app_name} with the access below.\n\n"
            f"Your role: {roles}\nInvited by: {inviter}\nLink valid until: {expires}\n\n"
            + (f"A note from {inviter}:\n{message.strip()}\n\n" if message and message.strip() else "")
            + f"Create your account to accept. The link works once, and your role is ready as soon as you sign up.\n{link}\n\n"
            "If you were not expecting this invitation, you can ignore this email.\n")
    return f"[InnovateX] You are invited to join {settings.app_name} as {roles}", body


def _attempt(delivery: NotificationDelivery) -> None:
    delivery.attempts = (delivery.attempts or 0) + 1
    try:
        _send_email(delivery.recipient_address, delivery.rendered_subject or "", delivery.rendered_body or "", delivery.event_type)
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
            variables = {**(p.get("vars") or {}), "title": p.get("title", ""), "message": p.get("body") or "",
                         "app_name": settings.app_name}
            link = p.get("link_path") or ""
            variables.setdefault("secure_link", f"{settings.frontend_url}{link}")
            tpl = db.scalar(select(NotificationTemplate).where(NotificationTemplate.event_type == ob.event_type,
                                                               NotificationTemplate.channel == "EMAIL",
                                                               NotificationTemplate.is_active.is_(True)))
            fallback = mail.DEFAULT_TEMPLATES.get(ob.event_type)     # wording kept in code for events with no template
            if tpl:
                subject, body = render(tpl.subject_template, variables), render(tpl.body_template, variables)
            elif fallback:
                subject, body = render(fallback[0], variables), render(fallback[1], variables)
            else:
                subject = f"[InnovateX] {p.get('title', ob.event_type)}"
                body = f"{p.get('body', '')}\n\nOpen: {variables['secure_link']}"

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
