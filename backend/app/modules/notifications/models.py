from sqlalchemy import String
from sqlalchemy.orm import mapped_column

from app.shared.models.base import Base, StdColumns, sc, flag, integer, json_col, ref, text, ts


class NotificationTemplate(Base, StdColumns):
    __tablename__ = "notification_templates"
    code = sc(40, index=True)          # EM-01 …
    event_type = sc(80, index=True)
    channel = sc(20, default="EMAIL")
    locale = sc(10, default="en")
    subject_template = mapped_column(String)
    body_template = text()
    is_active = flag(True)
    version = integer(1)


class NotificationRule(Base, StdColumns):
    """Who gets what, without code. e.g. INITIATIVE_SUBMITTED -> designated reviewer mailbox."""
    __tablename__ = "notification_rules"
    event_type = sc(80, index=True)
    channel = sc(20, default="EMAIL")
    recipient_type = sc(30)            # ROLE, FIXED_EMAIL, SETTING
    recipient_value = sc(200)
    cc_value = sc(200, nullable=True)
    scope_type = sc(30, nullable=True)
    scope_id = ref()
    template_code = sc(40, nullable=True)
    delay_minutes = integer(0)
    is_active = flag(True)


class NotificationOutbox(Base, StdColumns):
    """Written in the same transaction as the business change (outbox pattern)."""
    __tablename__ = "notification_outbox"
    event_type = sc(80, index=True)
    payload = json_col()
    status = sc(20, default="PENDING", index=True)  # PENDING, DONE, FAILED
    attempts = integer(0)
    next_attempt_at = ts()
    last_error = text()


class NotificationDelivery(Base, StdColumns):
    __tablename__ = "notification_deliveries"
    outbox_id = ref()
    event_type = sc(80, nullable=True)
    recipient_user_id = ref()
    recipient_address = sc(200, nullable=True)
    channel = sc(20, default="EMAIL")
    template_code = sc(40, nullable=True)
    rendered_subject = mapped_column(String, nullable=True)
    rendered_body = text()
    status = sc(20, default="QUEUED", index=True)   # QUEUED, SENT, FAILED
    attempts = integer(0)
    sent_at = ts()
    error = text()


class InAppNotification(Base, StdColumns):
    __tablename__ = "in_app_notifications"
    user_id = ref(False)
    title = mapped_column(String)
    body = text()
    link_path = sc(300, nullable=True)
    entity_type = sc(60, nullable=True)
    entity_id = ref()
    event_type = sc(80, nullable=True)
    needs_action = flag(False)
    is_read = flag(False)
    read_at = ts()
