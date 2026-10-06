"""Settings, feature flags, workflows, notification config, audit log, system health, my notifications."""
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import not_found
from app.core.events import audit
from app.core.permissions import CurrentUser, get_current_user, require_roles
from app.modules.admin.models import (AuditLog, FeatureFlag, SystemSetting, WorkflowDefinition, WorkflowState,
                                      WorkflowTransition)
from app.modules.notifications.models import (InAppNotification, NotificationDelivery, NotificationOutbox,
                                              NotificationRule, NotificationTemplate)
from app.modules.notifications.service import retry_delivery
from app.shared.models.base import row, utcnow
from app.shared.util import en, paginate, user_brief

router = APIRouter(tags=["admin & platform"])
SUPER = ("SUPER_ADMIN",)
NOTIFY_ADMINS = ("SUPER_ADMIN", "PROGRAM_OWNER")


# ---- My notifications ------------------------------------------------------------
@router.get("/me/notifications")
def my_notifications(filter: str = "all", limit: int = 100, cu: CurrentUser = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    stmt = select(InAppNotification).where(InAppNotification.user_id == cu.id)
    if filter == "action":
        stmt = stmt.where(InAppNotification.needs_action.is_(True))
    elif filter == "unread":
        stmt = stmt.where(InAppNotification.is_read.is_(False))
    elif filter == "updates":
        stmt = stmt.where(InAppNotification.needs_action.is_(False))
    items = db.scalars(stmt.order_by(InAppNotification.created_at.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count()).select_from(InAppNotification)
                       .where(InAppNotification.user_id == cu.id, InAppNotification.is_read.is_(False)))
    return {"items": [row(n, exclude=("created_by", "updated_by", "updated_at", "user_id")) for n in items],
            "unread": unread or 0}


@router.post("/me/notifications/read-all")
def read_all(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    for n in db.scalars(select(InAppNotification).where(InAppNotification.user_id == cu.id,
                                                        InAppNotification.is_read.is_(False))).all():
        n.is_read, n.read_at = True, utcnow()
    db.commit()
    return {"ok": True}


@router.post("/me/notifications/{notification_id}/read")
def read_one(notification_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.get(InAppNotification, notification_id)
    if not n or n.user_id != cu.id:
        raise not_found("Notification")
    n.is_read, n.read_at = True, utcnow()
    db.commit()
    return {"ok": True}


# ---- Settings & feature flags ----------------------------------------------------
def _editor(db: Session, o) -> dict:
    return {"updated_at": o.updated_at.isoformat() + "Z" if o.updated_at else None,
            "updated_by": (user_brief(db, o.updated_by) or {}).get("full_name")}


@router.get("/settings")
def get_settings_list(cu: CurrentUser = Depends(require_roles(*SUPER)), db: Session = Depends(get_db)):
    return [{"id": s.id, "key": s.key, "value": s.value, "description": s.description, **_editor(db, s)}
            for s in db.scalars(select(SystemSetting).order_by(SystemSetting.key)).all()]


class ValueIn(BaseModel):
    value: Any = None


@router.patch("/settings/{key}")
def update_setting(key: str, body: ValueIn, request: Request, cu: CurrentUser = Depends(require_roles(*SUPER)),
                   db: Session = Depends(get_db)):
    s = db.scalar(select(SystemSetting).where(SystemSetting.key == key))
    if not s:
        raise not_found("Setting")
    before = s.value
    s.value, s.updated_by = body.value, cu.id
    audit(db, cu.id, "CONFIG_CHANGE", "system_setting", s.id, f"Changed setting {key}", {key: [before, body.value]},
          request.state.request_id)
    db.commit()
    return {"key": key, "value": s.value}


@router.get("/feature-flags")
def feature_flags(cu: CurrentUser = Depends(require_roles(*SUPER)), db: Session = Depends(get_db)):
    return [{"id": f.id, "code": f.code, "is_enabled": f.is_enabled, "description": f.description, **_editor(db, f)}
            for f in db.scalars(select(FeatureFlag).order_by(FeatureFlag.code)).all()]


class FlagIn(BaseModel):
    is_enabled: bool


@router.patch("/feature-flags/{code}")
def update_flag(code: str, body: FlagIn, request: Request, cu: CurrentUser = Depends(require_roles(*SUPER)),
                db: Session = Depends(get_db)):
    f = db.scalar(select(FeatureFlag).where(FeatureFlag.code == code))
    if not f:
        raise not_found("Feature flag")
    before = f.is_enabled
    f.is_enabled, f.updated_by = body.is_enabled, cu.id
    audit(db, cu.id, "CONFIG_CHANGE", "feature_flag", f.id, f"Turned {code} {'on' if body.is_enabled else 'off'}",
          {code: [before, body.is_enabled]}, request.state.request_id)
    db.commit()
    return {"code": code, "is_enabled": f.is_enabled}


# ---- Workflows (read + label/SLA edit) ---------------------------------------------
@router.get("/workflows")
def workflows(cu: CurrentUser = Depends(require_roles(*SUPER)), db: Session = Depends(get_db)):
    out = []
    for d in db.scalars(select(WorkflowDefinition).order_by(WorkflowDefinition.code)).all():
        states = db.scalars(select(WorkflowState).where(WorkflowState.workflow_definition_id == d.id)
                            .order_by(WorkflowState.sort_order)).all()
        transitions = db.scalars(select(WorkflowTransition).where(WorkflowTransition.workflow_definition_id == d.id)
                                 .order_by(WorkflowTransition.sort_order)).all()
        out.append({"id": d.id, "code": d.code, "entity_type": d.entity_type, "description": d.description,
                    "states": [{"id": s.id, "code": s.code, "name": en(s.name_i18n), "state_group": s.state_group,
                                "is_initial": s.is_initial, "is_terminal": s.is_terminal, "sla_hours": s.sla_hours,
                                "owner_label": en(s.visible_to_owner_as_i18n)} for s in states],
                    "transitions": [{"id": t.id, "from_state": t.from_state, "to_state": t.to_state,
                                     "action_code": t.action_code, "label": en(t.label_i18n),
                                     "allowed_permission": t.allowed_permission, "requires_comment": t.requires_comment,
                                     "guard_rules": t.guard_rules} for t in transitions]})
    return out


class StateIn(BaseModel):
    name: str
    sla_hours: int | None = None


@router.patch("/workflows/states/{state_id}")
def edit_state(state_id: str, body: StateIn, request: Request, cu: CurrentUser = Depends(require_roles(*SUPER)),
               db: Session = Depends(get_db)):
    s = db.get(WorkflowState, state_id)
    if not s:
        raise not_found("State")
    before = [en(s.name_i18n), s.sla_hours]
    s.name_i18n = {**(s.name_i18n or {}), "en": body.name}
    s.sla_hours = body.sla_hours
    audit(db, cu.id, "CONFIG_CHANGE", "workflow_state", s.id, f"Edited workflow state {s.code}",
          {"name": [before[0], body.name], "sla_hours": [before[1], body.sla_hours]}, request.state.request_id)
    db.commit()
    return {"id": s.id}


# ---- Notification templates, rules and delivery log ----------------------------------
@router.get("/notification-templates")
def templates(cu: CurrentUser = Depends(require_roles(*NOTIFY_ADMINS)), db: Session = Depends(get_db)):
    return [{**row(t, exclude=("created_by",)), **_editor(db, t)}
            for t in db.scalars(select(NotificationTemplate).order_by(NotificationTemplate.code)).all()]


class TemplateIn(BaseModel):
    subject_template: str
    body_template: str
    is_active: bool = True


@router.put("/notification-templates/{template_id}")
def save_template(template_id: str, body: TemplateIn, request: Request,
                  cu: CurrentUser = Depends(require_roles(*NOTIFY_ADMINS)), db: Session = Depends(get_db)):
    t = db.get(NotificationTemplate, template_id)
    if not t:
        raise not_found("Template")
    before = t.subject_template
    t.subject_template, t.body_template, t.is_active = body.subject_template, body.body_template, body.is_active
    t.version, t.updated_by = (t.version or 1) + 1, cu.id
    audit(db, cu.id, "CONFIG_CHANGE", "notification_template", t.id, f"Edited email template {t.code}",
          {"subject": [before, body.subject_template]}, request.state.request_id)
    db.commit()
    return row(t)


@router.get("/notification-rules")
def rules(cu: CurrentUser = Depends(require_roles(*NOTIFY_ADMINS)), db: Session = Depends(get_db)):
    return [{**row(r, exclude=("created_by",)), **_editor(db, r)}
            for r in db.scalars(select(NotificationRule).order_by(NotificationRule.event_type)).all()]


class RuleIn(BaseModel):
    event_type: str
    recipient_type: str = "FIXED_EMAIL"
    recipient_value: str
    cc_value: str | None = None
    is_active: bool = True


@router.post("/notification-rules")
def add_rule(body: RuleIn, request: Request, cu: CurrentUser = Depends(require_roles(*NOTIFY_ADMINS)),
             db: Session = Depends(get_db)):
    r = NotificationRule(**body.model_dump(), created_by=cu.id, updated_by=cu.id)
    db.add(r)
    audit(db, cu.id, "CONFIG_CHANGE", "notification_rule", r.id,
          f"Added notification rule {body.event_type} -> {body.recipient_value}", {}, request.state.request_id)
    db.commit()
    return row(r)


@router.put("/notification-rules/{rule_id}")
def save_rule(rule_id: str, body: RuleIn, request: Request, cu: CurrentUser = Depends(require_roles(*NOTIFY_ADMINS)),
              db: Session = Depends(get_db)):
    r = db.get(NotificationRule, rule_id)
    if not r:
        raise not_found("Rule")
    before = r.recipient_value
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    r.updated_by = cu.id
    audit(db, cu.id, "CONFIG_CHANGE", "notification_rule", r.id, f"Changed recipient for {r.event_type}",
          {"recipient": [before, body.recipient_value]}, request.state.request_id)
    db.commit()
    return row(r)


@router.delete("/notification-rules/{rule_id}")
def delete_rule(rule_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*NOTIFY_ADMINS)),
                db: Session = Depends(get_db)):
    r = db.get(NotificationRule, rule_id)
    if not r:
        raise not_found("Rule")
    audit(db, cu.id, "CONFIG_CHANGE", "notification_rule", r.id, f"Removed notification rule {r.event_type}", {},
          request.state.request_id)
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.get("/notification-deliveries")
def deliveries(status: str = "", page: int = 1, cu: CurrentUser = Depends(require_roles(*NOTIFY_ADMINS)),
               db: Session = Depends(get_db)):
    stmt = select(NotificationDelivery)
    if status:
        stmt = stmt.where(NotificationDelivery.status == status)
    items = db.scalars(stmt.order_by(NotificationDelivery.created_at.desc()).limit(500)).all()
    return paginate([row(d, exclude=("created_by", "updated_by")) for d in items], page, 50)


@router.post("/notification-deliveries/{delivery_id}/retry")
def retry(delivery_id: str, cu: CurrentUser = Depends(require_roles(*NOTIFY_ADMINS)), db: Session = Depends(get_db)):
    d = db.get(NotificationDelivery, delivery_id)
    if not d:
        raise not_found("Delivery")
    return row(retry_delivery(db, d))


# ---- Audit log and system health -----------------------------------------------------
@router.get("/audit-logs")
def audit_logs(q: str = "", action: str = "", entity_type: str = "", page: int = 1, page_size: int = 50,
               cu: CurrentUser = Depends(require_roles(*SUPER)), db: Session = Depends(get_db)):
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if q:
        stmt = stmt.where(or_(AuditLog.summary.ilike(f"%{q}%"), AuditLog.entity_type.ilike(f"%{q}%")))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    cache: dict = {}
    items = [{**row(a), "actor": (user_brief(db, a.actor_user_id, cache) or {}).get("full_name") or "System"} for a in rows]
    actions = sorted(db.scalars(select(AuditLog.action).distinct()).all())
    return {"items": items, "total": total, "page": page, "actions": actions}


@router.get("/admin/system-health")
def system_health(cu: CurrentUser = Depends(require_roles(*SUPER)), db: Session = Depends(get_db)):
    def count(model, *where):
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0
    return {
        "failed_emails": count(NotificationDelivery, NotificationDelivery.status == "FAILED"),
        "sent_emails": count(NotificationDelivery, NotificationDelivery.status == "SENT"),
        "pending_outbox": count(NotificationOutbox, NotificationOutbox.status == "PENDING"),
        "failed_outbox": count(NotificationOutbox, NotificationOutbox.status == "FAILED"),
        "audit_rows": count(AuditLog),
        "database": "ok",
    }
