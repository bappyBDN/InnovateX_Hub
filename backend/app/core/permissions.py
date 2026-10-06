"""Authentication dependency, role/permission checks and the visibility (scope) filters.

Visibility rule (data-model doc §4.6): Super Admin, privileged roles and judges see all submissions.
Everyone else sees only their own entries and their team's entries while they are an active member.
Anything outside that returns 404, never 403, so a record's existence is not revealed.
"""
from dataclasses import dataclass, field

from fastapi import Depends, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.security import decode_access_token
from app.modules.challenges.models import ChallengeEntry, Team, TeamMember
from app.modules.identity.models import Permission, Role, RolePermission, User, UserRoleAssignment
from app.shared import cache
from app.shared.models.base import utcnow

SEES_ALL = {"SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE", "JUDGE"}
PRIVILEGED = {"SUPER_ADMIN", "PROGRAM_OWNER"}


@dataclass
class CurrentUser:
    user: User
    roles: set[str] = field(default_factory=set)
    perms: set[str] = field(default_factory=set)

    @property
    def id(self) -> str:
        return self.user.id

    def has_role(self, *codes: str) -> bool:
        return any(c in self.roles for c in codes)

    def can(self, perm: str) -> bool:
        return perm in self.perms

    @property
    def sees_all(self) -> bool:
        return bool(self.roles & SEES_ALL)

    @property
    def privileged(self) -> bool:
        return bool(self.roles & PRIVILEGED)


_cache: dict = {}


def _employee_role_id(db: Session):
    if "employee" not in _cache:
        _cache["employee"] = db.scalar(select(Role.id).where(Role.code == "EMPLOYEE"))
    return _cache["employee"]


def _role_matrix(db: Session) -> dict:
    """Roles and their permissions change rarely, so they are kept in memory for a minute."""
    def load():
        roles = {r.id: r.code for r in db.scalars(select(Role)).all()}
        perms = {p.id: p.code for p in db.scalars(select(Permission)).all()}
        granted: dict[str, set[str]] = {code: set() for code in roles.values()}
        for rp in db.scalars(select(RolePermission)).all():
            if rp.role_id in roles and rp.permission_id in perms:
                granted[roles[rp.role_id]].add(perms[rp.permission_id])
        return {"roles": roles, "all": set(perms.values()), "granted": granted}
    return cache.shared("role_matrix", load, ttl=60)


def load_roles(db: Session, user_id: str) -> tuple[set[str], set[str]]:
    now = utcnow()
    matrix = _role_matrix(db)
    rows = db.scalars(select(UserRoleAssignment).where(UserRoleAssignment.user_id == user_id)).all()
    roles = {matrix["roles"][a.role_id] for a in rows
             if a.role_id in matrix["roles"] and (a.valid_to is None or a.valid_to > now)} | {"EMPLOYEE"}
    if "DMD" in roles:
        roles.add("SUPER_ADMIN")       # the DMD gets every feature the Super Admin has
    if "SUPER_ADMIN" in roles:
        return roles, set(matrix["all"])   # full access, whatever the matrix says
    perms: set[str] = set()
    for code in roles:
        perms |= matrix["granted"].get(code, set())
    return roles, perms


def get_current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else None
    user_id = decode_access_token(token) if token else None
    user = db.get(User, user_id) if user_id else None
    if not user or not user.is_active:
        raise DomainError("UNAUTHENTICATED", "Please sign in again.", 401)
    roles, perms = load_roles(db, user.id)
    return CurrentUser(user=user, roles=roles, perms=perms)


def require_roles(*codes: str):
    def dep(cu: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not cu.has_role(*codes):
            raise not_found("Page")
        return cu
    return dep


def require_perm(perm: str):
    def dep(cu: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not cu.can(perm):
            raise not_found("Page")
        return cu
    return dep


# ---- scope filters -----------------------------------------------------------
def my_team_ids(db: Session, user_id: str) -> list[str]:
    return [m.team_id for m in cache.by(db, TeamMember, "user_id").get(user_id, []) if m.status == "ACTIVE"]


def visible_entries_filter(db: Session, cu: CurrentUser):
    if cu.sees_all:
        return None
    return or_(ChallengeEntry.lead_user_id == cu.id, ChallengeEntry.team_id.in_(my_team_ids(db, cu.id) or [""]))


def is_entry_member(db: Session, entry: ChallengeEntry, user_id: str) -> bool:
    if entry.team_id:
        return entry.team_id in my_team_ids(db, user_id)
    return entry.lead_user_id == user_id


def judges_entry(db: Session, entry: ChallengeEntry, user_id: str) -> bool:
    """A person chosen as a judge (no Judge role needed) can open the entries of that challenge and anything given to them."""
    from app.modules.evaluation.models import Panel, PanelMember, ReviewAssignment
    for panel in cache.by(db, Panel, "challenge_id").get(entry.challenge_id, []):
        if any(m.user_id == user_id for m in cache.by(db, PanelMember, "panel_id").get(panel.id, [])):
            return True
    return any(a.reviewer_user_id == user_id and a.status != "DECLINED_COI"
               for a in cache.by(db, ReviewAssignment, "entity_id").get(entry.id, []))


def get_entry_or_404(db: Session, cu: CurrentUser, entry_id: str, members_only: bool = False) -> ChallengeEntry:
    entry = db.get(ChallengeEntry, entry_id)
    if not entry or entry.deleted_at:
        raise not_found("Entry")
    member = is_entry_member(db, entry, cu.id)
    if members_only and not member:
        raise not_found("Entry")
    if not member and not cu.sees_all and not judges_entry(db, entry, cu.id):
        raise not_found("Entry")
    return entry


def get_team_or_404(db: Session, cu: CurrentUser, team_id: str, leader_only: bool = False) -> Team:
    team = db.get(Team, team_id)
    if not team:
        raise not_found("Team")
    is_member = team.id in my_team_ids(db, cu.id)
    if leader_only:
        if team.lead_user_id != cu.id:
            raise not_found("Team")
    elif not is_member and not cu.sees_all:
        raise not_found("Team")
    return team
