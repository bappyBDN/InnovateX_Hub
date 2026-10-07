"""Self sign-up, invitations for privileged roles, and the Super Admin panel (privileges, accounts)."""
import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit, publish_event
from app.core.permissions import CurrentUser, load_roles, require_roles
from app.core.security import create_access_token, hash_password, sha256
from app.modules.identity.models import (Organization, OrgUnit, Permission, Role, RolePermission, User, UserInvitation,
                                         UserRoleAssignment)
from app.modules.identity.sbu import department_units, is_sbu, sbu_of, sbu_units
from app.modules.notifications.models import NotificationDelivery
from app.modules.notifications.service import _attempt, mail_ready, role_invite_text
from app.shared.models.base import iso, utcnow
from app.shared.util import en, setting, user_brief

router = APIRouter(tags=["accounts & admin panel"])
SUPER = ("SUPER_ADMIN",)        # the DMD role counts as Super Admin (see core/permissions.py)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
LOCKED_ROLES = {"SUPER_ADMIN", "DMD", "EMPLOYEE"}   # their privileges can't be edited in the matrix


def _invitation(db: Session, token: str) -> UserInvitation | None:
    inv = db.scalar(select(UserInvitation).where(UserInvitation.token_hash == sha256(token)))
    if inv and inv.status == "PENDING" and inv.expires_at and inv.expires_at < utcnow():
        inv.status = "EXPIRED"
        db.commit()
    return inv


def _invited_as(db: Session, inv: UserInvitation) -> list[str]:
    """What the person is invited as. A judge invitation carries no role: judges are chosen per challenge or idea."""
    from app.modules.evaluation.judging import has_judge_invite
    names = _role_names(db, inv.role_codes or [])
    return names + (["Judge"] if has_judge_invite(db, inv.id) and "Judge" not in names else [])


def _role_names(db: Session, codes: list[str]) -> list[str]:
    roles = {r.code: en(r.name_i18n) for r in db.scalars(select(Role)).all()}
    return [roles.get(c, c) for c in codes]


# ---- Public: sign-up ----------------------------------------------------------------------------
@router.get("/auth/signup-options")
def signup_options(invite: str = "", db: Session = Depends(get_db)):
    """Everything the sign-up page needs. No sign-in required."""
    units = sbu_units(db)       # people sign up under an SBU
    out = {"signup_enabled": bool(setting(db, "signup_enabled", settings.signup_enabled)),
           "allowed_domains": setting(db, "signup_allowed_domains", "") or "",
           "org_units": [{"id": u.id, "name": en(u.name_i18n), "unit_type": u.unit_type, "depth": 0} for u in units],
           "departments": [{"id": d.id, "name": en(d.name_i18n), "sbu_id": s.id, "depth": d.path.count(".") - s.path.count(".") - 1}
                           for d, s in department_units(db)],
           "invitation": None}
    if invite:
        inv = _invitation(db, invite)
        if not inv or inv.status != "PENDING":
            out["invitation"] = {"valid": False, "message": "This invitation link no longer works. Ask the admin for a new one."}
        else:
            out["invitation"] = {"valid": True, "email": inv.email, "full_name": inv.full_name,
                                 "roles": _invited_as(db, inv), "expires_at": iso(inv.expires_at),
                                 "invited_by": (user_brief(db, inv.invited_by) or {}).get("full_name")}
    return out


class SignupIn(BaseModel):
    full_name: str
    email: str
    password: str
    job_title: str | None = None
    org_unit_id: str | None = None       # the SBU
    department_id: str | None = None     # a unit under that SBU
    employee_no: str | None = None
    phone: str | None = None
    invite_token: str | None = None


@router.post("/auth/signup")
def signup(body: SignupIn, request: Request, db: Session = Depends(get_db)):
    """Anyone can sign up as an employee. A privileged role comes only from an invitation or from the admin panel."""
    email = body.email.strip().lower()
    inv = _invitation(db, body.invite_token) if body.invite_token else None
    if body.invite_token and (not inv or inv.status != "PENDING"):
        raise DomainError("INVITATION_INVALID", "This invitation link no longer works. Ask the admin for a new one.")
    if not inv and not setting(db, "signup_enabled", settings.signup_enabled):
        raise DomainError("SIGNUP_CLOSED", "Sign-up is closed. Ask the innovation office for an invitation.")
    errors = {}
    if len(body.full_name.strip()) < 3:
        errors["full_name"] = "Enter your full name."
    if not EMAIL_RE.match(email):
        errors["email"] = "Enter a valid email address."
    if len(body.password) < 8 or body.password.isdigit() or body.password.isalpha():
        errors["password"] = "Use at least 8 characters with letters and numbers."
    domains = [d.strip().lower() for d in str(setting(db, "signup_allowed_domains", "") or "").split(",") if d.strip()]
    if not inv and domains and email.split("@")[-1] not in domains:
        errors["email"] = "Use your company email address (" + ", ".join("@" + d for d in domains) + ")."
    if inv and email != inv.email.lower():
        errors["email"] = "Sign up with the email address the invitation was sent to."
    employee_no = (body.employee_no or "").strip()
    if not employee_no:
        errors["employee_no"] = "Enter your employee number."
    unit = db.get(OrgUnit, body.org_unit_id) if body.org_unit_id else None
    if body.org_unit_id and not (is_sbu(unit) and unit.is_active):
        errors["org_unit_id"] = "Choose an SBU from the list."
    dept = db.get(OrgUnit, body.department_id) if body.department_id else None
    if body.department_id and not (dept and dept.is_active and unit and (sbu_of(db, dept) or dept).id == unit.id and dept.id != unit.id):
        errors["department_id"] = "Choose a department of your SBU."
    if errors:
        raise DomainError("VALIDATION_ERROR", "Some fields need attention.", 422, {"fields": errors})
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise DomainError("EMAIL_TAKEN", "An account with this email already exists. Sign in instead.", 409)
    org = db.scalar(select(Organization.id))
    user = User(organization_id=org, full_name=body.full_name.strip(), email=email, password_hash=hash_password(body.password),
                job_title=(body.job_title or "").strip() or None,
                primary_org_unit_id=(dept or unit).id if unit else None, employee_no=employee_no, phone=body.phone, grade=None,
                joined_on=utcnow().date(), has_corporate_login=True, is_active=True, last_login_at=utcnow())
    db.add(user)
    db.flush()
    granted = []
    if inv:
        for code in inv.role_codes or []:
            role = db.scalar(select(Role).where(Role.code == code))
            if role:
                db.add(UserRoleAssignment(user_id=user.id, role_id=role.id, scope_type="GLOBAL", valid_from=utcnow(),
                                          granted_by=inv.invited_by))
                granted.append(code)
        from app.modules.evaluation.judging import apply_invites
        apply_invites(db, user, inv)       # invited as a judge: they can start scoring straight away
        inv.status, inv.accepted_user_id, inv.accepted_at = "ACCEPTED", user.id, utcnow()
        publish_event(db, "INVITATION_ACCEPTED", "user", user.id, user.id, users=[inv.invited_by],
                      title=f"{user.full_name} accepted your invitation", body="Roles: " + ", ".join(_role_names(db, granted)),
                      link="/admin/invitations")
    audit(db, user.id, "CREATE", "user", user.id,
          f"Signed up as {'invited ' + ', '.join(granted) if granted else 'employee'}: {user.full_name}", {},
          request.state.request_id)
    publish_event(db, "USER_SIGNED_UP", "user", user.id, user.id, users=[user.id], title="Welcome to InnovateX Hub",
                  body="Join an open challenge or share an idea.", link="/challenges")
    db.commit()
    from app.modules.identity.router import _me
    roles, perms = load_roles(db, user.id)
    return {"access_token": create_access_token(user.id), "token_type": "bearer",
            "user": _me(db, CurrentUser(user=user, roles=roles, perms=perms))}


# ---- Super Admin panel: invitations ---------------------------------------------------------------
def _inv_row(db: Session, inv: UserInvitation) -> dict:
    return {"id": inv.id, "email": inv.email, "full_name": inv.full_name, "role_codes": inv.role_codes or [],
            "roles": _invited_as(db, inv), "status": inv.status, "message": inv.message,
            "created_at": iso(inv.created_at), "expires_at": iso(inv.expires_at), "accepted_at": iso(inv.accepted_at),
            "invited_by": (user_brief(db, inv.invited_by) or {}).get("full_name"),
            "accepted_user": (user_brief(db, inv.accepted_user_id) or {}).get("full_name")}


def _send_invite(db: Session, inv: UserInvitation, token: str, inviter: str) -> tuple[str, str]:
    link = f"{settings.frontend_url}/signup?invite={token}"
    roles = ", ".join(_invited_as(db, inv)) or "a member"
    subject, body = role_invite_text(inviter, inv.full_name, roles, inv.message, f"{inv.expires_at:%d %b %Y}", link)
    d = NotificationDelivery(event_type="USER_INVITED", recipient_address=inv.email, channel="EMAIL", template_code="INVITE",
                             rendered_subject=subject, rendered_body=body, attempts=0)
    _attempt(d)
    db.add(d)
    return link, d.status if mail_ready() else "NOT_SET_UP"


class InviteIn(BaseModel):
    email: str
    full_name: str | None = None
    role_codes: list[str]
    message: str | None = None
    expires_in_days: int | None = None


@router.get("/admin/invitations")
def list_invitations(cu: CurrentUser = Depends(require_roles(*SUPER)), db: Session = Depends(get_db)):
    now = utcnow()
    rows = db.scalars(select(UserInvitation).order_by(UserInvitation.created_at.desc())).all()
    for inv in rows:
        if inv.status == "PENDING" and inv.expires_at and inv.expires_at < now:
            inv.status = "EXPIRED"
    db.commit()
    return {"items": [_inv_row(db, i) for i in rows], "total": len(rows), "page": 1,
            "default_expiry_days": settings.invitation_expiry_days}


@router.post("/admin/invitations")
def create_invitation(body: InviteIn, request: Request, cu: CurrentUser = Depends(require_roles(*SUPER)),
                      db: Session = Depends(get_db)):
    """Invite someone to sign up as a Judge or another privileged role. The full link is returned once."""
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise DomainError("VALIDATION_ERROR", "Enter a valid email address.", 422, {"fields": {"email": "Enter a valid email address."}})
    roles = db.scalars(select(Role).where(Role.code.in_(body.role_codes or [""]))).all()
    if not roles or len(roles) != len(set(body.role_codes)) or any(not r.is_assignable for r in roles):
        raise DomainError("ROLE_NOT_ASSIGNABLE", "Choose at least one role that can be assigned.")
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise DomainError("EMAIL_TAKEN", "This person already has an account. Give them the role from Users and roles.", 409)
    for old in db.scalars(select(UserInvitation).where(UserInvitation.email == email, UserInvitation.status == "PENDING")).all():
        old.status = "REVOKED"       # only the newest invitation works
    token = secrets.token_urlsafe(32)
    days = body.expires_in_days or settings.invitation_expiry_days
    inv = UserInvitation(email=email, full_name=(body.full_name or "").strip() or None, role_codes=[r.code for r in roles],
                         token_hash=sha256(token), message=(body.message or "").strip() or None, invited_by=cu.id,
                         expires_at=utcnow() + timedelta(days=days), status="PENDING", created_by=cu.id)
    db.add(inv)
    db.flush()
    link, mail = _send_invite(db, inv, token, cu.user.full_name)
    audit(db, cu.id, "CONFIG_CHANGE", "user_invitation", inv.id,
          f"Invited {email} as {', '.join(inv.role_codes)}", {"roles": [None, inv.role_codes]}, request.state.request_id)
    db.commit()
    return {**_inv_row(db, inv), "invite_url": link, "email_status": mail}


@router.post("/admin/invitations/{invitation_id}/actions/{action}")
def invitation_action(invitation_id: str, action: str, request: Request, cu: CurrentUser = Depends(require_roles(*SUPER)),
                      db: Session = Depends(get_db)):
    inv = db.get(UserInvitation, invitation_id)
    if not inv:
        raise not_found("Invitation")
    if inv.status == "ACCEPTED":
        raise DomainError("INVITATION_ACCEPTED", "This invitation was already used.", 409)
    if action == "revoke":
        inv.status = "REVOKED"
        audit(db, cu.id, "CONFIG_CHANGE", "user_invitation", inv.id, f"Revoked invitation for {inv.email}", {}, request.state.request_id)
        db.commit()
        return _inv_row(db, inv)
    if action == "resend":      # a new link; the old one stops working
        token = secrets.token_urlsafe(32)
        inv.token_hash, inv.status = sha256(token), "PENDING"
        inv.expires_at = utcnow() + timedelta(days=settings.invitation_expiry_days)
        link, mail = _send_invite(db, inv, token, cu.user.full_name)
        audit(db, cu.id, "CONFIG_CHANGE", "user_invitation", inv.id, f"Re-sent invitation to {inv.email}", {}, request.state.request_id)
        db.commit()
        return {**_inv_row(db, inv), "invite_url": link, "email_status": mail}
    raise not_found("Action")


# ---- Super Admin panel: privileges (role x permission matrix) ------------------------------------------
@router.get("/admin/privileges")
def privileges(cu: CurrentUser = Depends(require_roles(*SUPER)), db: Session = Depends(get_db)):
    roles = db.scalars(select(Role).order_by(Role.hierarchy_level, Role.code)).all()
    perms = db.scalars(select(Permission).order_by(Permission.module, Permission.code)).all()
    by_id = {p.id: p.code for p in perms}
    granted: dict[str, list[str]] = {r.id: [] for r in roles}
    for rp in db.scalars(select(RolePermission)).all():
        if rp.role_id in granted and rp.permission_id in by_id:
            granted[rp.role_id].append(by_id[rp.permission_id])
    holders = dict(db.execute(select(UserRoleAssignment.role_id, func.count(func.distinct(UserRoleAssignment.user_id)))
                              .group_by(UserRoleAssignment.role_id)).all())
    return {
        "roles": [{"code": r.code, "name": en(r.name_i18n), "description": r.description, "hierarchy_level": r.hierarchy_level,
                   "sees_all_submissions": r.sees_all_submissions, "is_assignable": r.is_assignable,
                   "locked": r.code in LOCKED_ROLES, "full_access": r.code in ("SUPER_ADMIN", "DMD"),
                   "holders": holders.get(r.id, 0),
                   "permissions": [p.code for p in perms] if r.code in ("SUPER_ADMIN", "DMD") else sorted(granted[r.id])}
                  for r in roles],
        "permissions": [{"code": p.code, "module": p.module, "description": p.description} for p in perms],
    }


class PrivilegesIn(BaseModel):
    permissions: list[str]


@router.put("/admin/privileges/{role_code}")
def set_privileges(role_code: str, body: PrivilegesIn, request: Request, cu: CurrentUser = Depends(require_roles(*SUPER)),
                   db: Session = Depends(get_db)):
    role = db.scalar(select(Role).where(Role.code == role_code))
    if not role:
        raise not_found("Role")
    if role.code in LOCKED_ROLES:
        raise DomainError("ROLE_LOCKED", "The privileges of this role are fixed.")
    perms = {p.code: p for p in db.scalars(select(Permission)).all()}
    wanted = {c for c in body.permissions if c in perms}
    current = {}
    for rp in db.scalars(select(RolePermission).where(RolePermission.role_id == role.id)).all():
        code = next((c for c, p in perms.items() if p.id == rp.permission_id), None)
        current[code] = rp
    added, removed = sorted(wanted - set(current)), sorted(set(current) - wanted)
    for code in removed:
        db.delete(current[code])
    for code in added:
        db.add(RolePermission(role_id=role.id, permission_id=perms[code].id))
    from app.shared import cache
    cache.forget("role_matrix")
    audit(db, cu.id, "CONFIG_CHANGE", "role", role.id, f"Changed privileges of {role.code}",
          {"added": [None, added], "removed": [removed, None]}, request.state.request_id)
    db.commit()
    return {"code": role.code, "permissions": sorted(wanted)}


# ---- Super Admin panel: accounts ---------------------------------------------------------------------
class AccountIn(BaseModel):
    is_active: bool | None = None
    full_name: str | None = None
    job_title: str | None = None
    org_unit_id: str | None = None
    new_password: str | None = None


@router.patch("/admin/users/{user_id}")
def update_account(user_id: str, body: AccountIn, request: Request, cu: CurrentUser = Depends(require_roles(*SUPER)),
                   db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise not_found("User")
    changes = {}
    if body.is_active is not None and body.is_active != user.is_active:
        if user.id == cu.id:
            raise DomainError("CANNOT_DEACTIVATE_SELF", "You can't deactivate your own account.")
        changes["is_active"] = [user.is_active, body.is_active]
        user.is_active = body.is_active
    if body.full_name and body.full_name.strip() != user.full_name:
        changes["full_name"] = [user.full_name, body.full_name.strip()]
        user.full_name = body.full_name.strip()
    if body.job_title is not None and body.job_title != user.job_title:
        changes["job_title"] = [user.job_title, body.job_title]
        user.job_title = body.job_title
    if body.org_unit_id and body.org_unit_id != user.primary_org_unit_id and db.get(OrgUnit, body.org_unit_id):
        changes["org_unit"] = [user.primary_org_unit_id, body.org_unit_id]
        user.primary_org_unit_id = body.org_unit_id
    if body.new_password:
        if len(body.new_password) < 8:
            raise DomainError("VALIDATION_ERROR", "Use at least 8 characters.", 422, {"fields": {"new_password": "Use at least 8 characters."}})
        user.password_hash = hash_password(body.new_password)
        changes["password"] = ["***", "reset"]
    if changes:
        audit(db, cu.id, "CONFIG_CHANGE", "user", user.id, f"Updated account of {user.full_name}: {', '.join(changes)}", changes,
              request.state.request_id)
    db.commit()
    return {"id": user.id, "is_active": user.is_active}


@router.get("/admin/overview")
def admin_overview(cu: CurrentUser = Depends(require_roles(*SUPER)), db: Session = Depends(get_db)):
    """Numbers for the admin panel landing page."""
    now = utcnow()
    week = now - timedelta(days=7)
    roles = {r.id: r for r in db.scalars(select(Role)).all()}
    by_role: dict[str, int] = {}
    for role_id, n in db.execute(select(UserRoleAssignment.role_id, func.count(func.distinct(UserRoleAssignment.user_id)))
                                 .group_by(UserRoleAssignment.role_id)).all():
        if role_id in roles:
            by_role[roles[role_id].code] = n
    recent = db.scalars(select(User).order_by(User.created_at.desc()).limit(6)).all()
    return {
        "users_total": db.scalar(select(func.count()).select_from(User)) or 0,
        "users_active": db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True))) or 0,
        "signups_this_week": db.scalar(select(func.count()).select_from(User).where(User.created_at >= week)) or 0,
        "invitations_pending": db.scalar(select(func.count()).select_from(UserInvitation).where(
            UserInvitation.status == "PENDING", UserInvitation.expires_at > now)) or 0,
        "by_role": [{"code": r.code, "name": en(r.name_i18n), "count": by_role.get(r.code, 0)}
                    for r in sorted(roles.values(), key=lambda r: (r.hierarchy_level, r.code)) if r.code != "EMPLOYEE"],
        "recent_signups": [{**(user_brief(db, u.id) or {}), "created_at": iso(u.created_at), "is_active": u.is_active} for u in recent],
        "signup_enabled": bool(setting(db, "signup_enabled", settings.signup_enabled)),
    }
