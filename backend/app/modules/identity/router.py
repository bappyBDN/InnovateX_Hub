from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit, publish_event
from app.core.permissions import CurrentUser, get_current_user, load_roles, require_roles
from app.core.security import create_access_token, verify_password
from app.modules.admin.models import FeatureFlag
from app.modules.challenges.models import Team, TeamMember
from app.modules.delivery.models import Badge, PointsLedger, Reward, UserBadge
from app.modules.identity.models import OrgUnit, Role, User, UserRoleAssignment
from app.modules.masterdata.models import Skill, UserSkill
from app.modules.notifications.models import InAppNotification
from app.shared.models.base import row, utcnow
from app.shared.util import en, user_brief

router = APIRouter(tags=["identity"])


class LoginIn(BaseModel):
    email: str
    password: str


def _me(db: Session, cu: CurrentUser) -> dict:
    u = cu.user
    unit = db.get(OrgUnit, u.primary_org_unit_id) if u.primary_org_unit_id else None
    teams = db.execute(select(Team, TeamMember.member_role).join(TeamMember, TeamMember.team_id == Team.id)
                       .where(TeamMember.user_id == u.id, TeamMember.status == "ACTIVE")).all()
    unread = db.scalar(select(func.count()).select_from(InAppNotification)
                       .where(InAppNotification.user_id == u.id, InAppNotification.is_read.is_(False)))
    return {
        "id": u.id, "full_name": u.full_name, "email": u.email, "job_title": u.job_title, "locale": u.locale,
        "grade": u.grade, "employee_no": u.employee_no,
        "org_unit": {"id": unit.id, "name": en(unit.name_i18n), "path": unit.path} if unit else None,
        "roles": sorted(cu.roles), "permissions": sorted(cu.perms), "is_judge": _is_judge(db, cu),
        "teams": [{"id": t.id, "name": t.name, "role": role, "challenge_id": t.challenge_id} for t, role in teams],
        "feature_flags": {f.code: f.is_enabled for f in db.scalars(select(FeatureFlag)).all()},
        "unread_notifications": unread or 0, "server_time": row_time(),
    }


def _is_judge(db: Session, cu: CurrentUser) -> bool:
    from app.modules.evaluation.judging import is_judging
    return cu.has_role("JUDGE") or is_judging(db, cu.id)


def row_time() -> str:
    return utcnow().isoformat(timespec="seconds") + "Z"


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        # Same message for unknown and disabled accounts (no detail leaked).
        raise DomainError("INVALID_LOGIN", "Your account isn't set up yet or the password is wrong. "
                                           "Contact the innovation office.", 401)
    user.last_login_at = utcnow()
    audit(db, user.id, "LOGIN", "user", user.id, "Signed in")
    db.commit()
    roles, perms = load_roles(db, user.id)
    return {"access_token": create_access_token(user.id), "token_type": "bearer",
            "user": _me(db, CurrentUser(user=user, roles=roles, perms=perms))}


@router.get("/auth/demo-accounts")
def demo_accounts(db: Session = Depends(get_db)):
    """Only in demo mode: lets the login page offer one-click sign-in for each role."""
    if not settings.demo_mode:
        raise not_found("Page")
    out = []
    for u in db.scalars(select(User).where(User.has_corporate_login.is_(True), User.is_active.is_(True))
                        .order_by(User.employee_no)).all():
        roles, _ = load_roles(db, u.id)
        if "DMD" in roles:
            roles = {"DMD"}
        named = sorted(roles - {"EMPLOYEE"}) or ["EMPLOYEE"]
        lead = db.scalar(select(func.count()).select_from(TeamMember).where(
            TeamMember.user_id == u.id, TeamMember.status == "ACTIVE", TeamMember.member_role == "LEAD"))
        member = db.scalar(select(func.count()).select_from(TeamMember).where(
            TeamMember.user_id == u.id, TeamMember.status == "ACTIVE", TeamMember.member_role == "MEMBER"))
        note = "Team leader" if lead else "Team member" if member else ""
        out.append({"email": u.email, "full_name": u.full_name, "job_title": u.job_title, "roles": named, "note": note})
    order = ["DMD", "SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE", "JUDGE", "ADMIN", "HR", "FINANCE_VERIFIER", "SPONSOR", "EMPLOYEE"]
    out.sort(key=lambda a: (min(order.index(r) for r in a["roles"]), a["note"] == "", a["full_name"]))
    return {"password": settings.demo_password, "accounts": out}


@router.get("/me")
def me(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return _me(db, cu)


class MePatch(BaseModel):
    locale: str | None = None
    phone: str | None = None
    skill_ids: list[str] | None = None


@router.patch("/me")
def update_me(body: MePatch, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.locale in ("en", "bn"):
        cu.user.locale = body.locale
    if body.phone is not None:
        cu.user.phone = body.phone
    if body.skill_ids is not None:
        for us in db.scalars(select(UserSkill).where(UserSkill.user_id == cu.id)).all():
            db.delete(us)
        for sid in body.skill_ids:
            db.add(UserSkill(user_id=cu.id, skill_id=sid))
    db.commit()
    return _me(db, cu)


@router.get("/me/profile")
def my_profile(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    skills = db.execute(select(Skill, UserSkill.level).join(UserSkill, UserSkill.skill_id == Skill.id)
                        .where(UserSkill.user_id == cu.id)).all()
    badges = db.execute(select(Badge, UserBadge.awarded_at).join(UserBadge, UserBadge.badge_id == Badge.id)
                        .where(UserBadge.user_id == cu.id).order_by(UserBadge.awarded_at.desc())).all()
    rewards = db.scalars(select(Reward).where(Reward.recipient_user_id == cu.id).order_by(Reward.created_at.desc())).all()
    points = db.scalars(select(PointsLedger).where(PointsLedger.user_id == cu.id).order_by(PointsLedger.created_at.desc())).all()
    manager = user_brief(db, cu.user.manager_id)
    return {
        "user": _me(db, cu), "manager": manager, "joined_on": cu.user.joined_on.isoformat() if cu.user.joined_on else None,
        "skills": [{"id": s.id, "code": s.code, "name": en(s.name_i18n), "level": lvl} for s, lvl in skills],
        "all_skills": [{"id": s.id, "name": en(s.name_i18n), "category": s.category}
                       for s in db.scalars(select(Skill).order_by(Skill.category, Skill.code)).all()],
        "badges": [{"code": b.code, "name": en(b.name_i18n), "description": en(b.description_i18n), "icon": b.icon,
                    "awarded_at": at.isoformat() + "Z" if at else None} for b, at in badges],
        "rewards": [row(r) for r in rewards],
        "points_total": sum(p.points or 0 for p in points),
        "points": [row(p) for p in points],
    }


@router.get("/users")
def search_users(q: str = "", role: str = "", limit: int = 20, cu: CurrentUser = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    """People picker: name and department only — never anyone's entries. `role=JUDGE` lists people holding a role."""
    stmt = select(User).where(User.is_active.is_(True))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(like), func.lower(User.email).like(like)))
    if role:
        holders = select(UserRoleAssignment.user_id).join(Role, Role.id == UserRoleAssignment.role_id).where(Role.code == role)
        stmt = stmt.where(User.id.in_(holders))
    users = db.scalars(stmt.order_by(User.full_name).limit(min(limit, 100))).all()
    return {"items": [user_brief(db, u.id) for u in users], "total": len(users), "page": 1}


# ---- Admin: users and fixed roles -------------------------------------------
@router.get("/roles")
def list_roles(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return [{"id": r.id, "code": r.code, "name": en(r.name_i18n), "name_i18n": r.name_i18n, "description": r.description,
             "hierarchy_level": r.hierarchy_level, "sees_all_submissions": r.sees_all_submissions,
             "is_assignable": r.is_assignable}
            for r in db.scalars(select(Role).order_by(Role.hierarchy_level, Role.code)).all()]


@router.get("/admin/users")
def admin_users(q: str = "", role: str = "", cu: CurrentUser = Depends(require_roles("SUPER_ADMIN")),
                db: Session = Depends(get_db)):
    roles = {r.id: r for r in db.scalars(select(Role)).all()}
    assignments: dict[str, list] = {}
    for a in db.scalars(select(UserRoleAssignment)).all():
        r = roles.get(a.role_id)
        if r:
            assignments.setdefault(a.user_id, []).append({
                "id": a.id, "role": r.code, "role_name": en(r.name_i18n), "scope_type": a.scope_type,
                "scope_id": a.scope_id, "valid_to": a.valid_to.isoformat() + "Z" if a.valid_to else None})
    items = []
    for u in db.scalars(select(User).order_by(User.full_name)).all():
        if q and q.lower() not in f"{u.full_name} {u.email}".lower():
            continue
        mine = assignments.get(u.id, [])
        if role and role not in [m["role"] for m in mine]:
            continue
        b = user_brief(db, u.id)
        items.append({**b, "employee_no": u.employee_no, "grade": u.grade, "is_active": u.is_active,
                      "has_corporate_login": u.has_corporate_login, "created_at": u.created_at.isoformat() + "Z" if u.created_at else None, "manager": user_brief(db, u.manager_id),
                      "last_login_at": u.last_login_at.isoformat() + "Z" if u.last_login_at else None,
                      "assignments": mine})
    return {"items": items, "total": len(items), "page": 1}


class RoleAssignIn(BaseModel):
    user_id: str
    role: str
    scope_type: str = "GLOBAL"
    scope_id: str | None = None
    valid_to: datetime | None = None


@router.post("/admin/role-assignments")
def assign_role(body: RoleAssignIn, request: Request, cu: CurrentUser = Depends(require_roles("SUPER_ADMIN")),
                db: Session = Depends(get_db)):
    role = db.scalar(select(Role).where(Role.code == body.role))
    user = db.get(User, body.user_id)
    if not role or not user or not role.is_assignable:
        raise DomainError("ROLE_NOT_ASSIGNABLE", "This role can't be assigned.")
    exists = db.scalar(select(UserRoleAssignment).where(
        UserRoleAssignment.user_id == user.id, UserRoleAssignment.role_id == role.id,
        UserRoleAssignment.scope_type == body.scope_type, UserRoleAssignment.scope_id == body.scope_id))
    if exists:
        raise DomainError("ROLE_ALREADY_ASSIGNED", f"{user.full_name} already has this role.")
    a = UserRoleAssignment(user_id=user.id, role_id=role.id, scope_type=body.scope_type, scope_id=body.scope_id,
                           valid_to=body.valid_to.replace(tzinfo=None) if body.valid_to else None,
                           granted_by=cu.id, valid_from=utcnow())
    db.add(a)
    audit(db, cu.id, "CONFIG_CHANGE", "user", user.id, f"Assigned role {role.code} to {user.full_name}",
          {"role": [None, role.code]}, request.state.request_id)
    publish_event(db, "ROLE_ASSIGNED", "user", user.id, cu.id, users=[user.id],
                  title=f"You now have the {en(role.name_i18n)} role", body="Your menu has been updated.", link="/")
    db.commit()
    return {"id": a.id}


@router.delete("/admin/role-assignments/{assignment_id}")
def remove_role(assignment_id: str, request: Request, cu: CurrentUser = Depends(require_roles("SUPER_ADMIN")),
                db: Session = Depends(get_db)):
    a = db.get(UserRoleAssignment, assignment_id)
    if not a:
        raise not_found("Role assignment")
    role = db.get(Role, a.role_id)
    if role.code == "SUPER_ADMIN":
        count = db.scalar(select(func.count()).select_from(UserRoleAssignment).where(UserRoleAssignment.role_id == role.id))
        if count <= 1:
            raise DomainError("LAST_SUPER_ADMIN", "You can't remove the last Super Admin.")
    user = db.get(User, a.user_id)
    db.delete(a)
    audit(db, cu.id, "CONFIG_CHANGE", "user", a.user_id, f"Removed role {role.code} from {user.full_name}",
          {"role": [role.code, None]}, request.state.request_id)
    db.commit()
    return {"ok": True}


# ---- Organization tree ---------------------------------------------------------
def _unit(u: OrgUnit, db: Session) -> dict:
    return {"id": u.id, "parent_id": u.parent_id, "unit_type": u.unit_type, "code": u.code, "name": en(u.name_i18n),
            "name_i18n": u.name_i18n, "path": u.path, "is_active": u.is_active,
            "head": user_brief(db, u.head_user_id),
            "members": db.scalar(select(func.count()).select_from(User).where(User.primary_org_unit_id == u.id))}


@router.get("/org-units")
def org_units(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_unit(u, db) for u in db.scalars(select(OrgUnit).order_by(OrgUnit.path)).all()]


class OrgUnitIn(BaseModel):
    parent_id: str | None = None
    unit_type: str = "DEPARTMENT"
    code: str
    name: str
    name_bn: str | None = None
    is_active: bool = True


@router.post("/org-units")
def create_org_unit(body: OrgUnitIn, request: Request, cu: CurrentUser = Depends(require_roles("SUPER_ADMIN", "ADMIN")),
                    db: Session = Depends(get_db)):
    parent = db.get(OrgUnit, body.parent_id) if body.parent_id else None
    slug = body.code.lower().replace(" ", "_")
    unit = OrgUnit(organization_id=parent.organization_id if parent else None, parent_id=body.parent_id,
                   unit_type=body.unit_type, code=body.code.upper(), is_active=body.is_active,
                   name_i18n={"en": body.name, **({"bn": body.name_bn} if body.name_bn else {})},
                   path=f"{parent.path}.{slug}" if parent else slug, created_by=cu.id)
    db.add(unit)
    audit(db, cu.id, "CONFIG_CHANGE", "org_unit", unit.id, f"Added org unit {body.name}", {}, request.state.request_id)
    db.commit()
    return _unit(unit, db)


@router.patch("/org-units/{unit_id}")
def update_org_unit(unit_id: str, body: OrgUnitIn, request: Request,
                    cu: CurrentUser = Depends(require_roles("SUPER_ADMIN", "ADMIN")), db: Session = Depends(get_db)):
    unit = db.get(OrgUnit, unit_id)
    if not unit:
        raise not_found("Org unit")
    before = en(unit.name_i18n)
    unit.name_i18n = {"en": body.name, **({"bn": body.name_bn} if body.name_bn else {})}
    unit.unit_type, unit.is_active, unit.updated_by = body.unit_type, body.is_active, cu.id
    audit(db, cu.id, "CONFIG_CHANGE", "org_unit", unit.id, f"Edited org unit {body.name}",
          {"name": [before, body.name]}, request.state.request_id)
    db.commit()
    return _unit(unit, db)
