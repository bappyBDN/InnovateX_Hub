"""Single sign-on from ProjectFlow (one way: ProjectFlow -> InnovateX Hub).

ProjectFlow signs a 5-minute, single-use token with SHARED_SSO_SECRET (HS256, iss "projectflow", aud "innovatex-hub").
POST /auth/sso-login checks it, finds the person (by ProjectFlow user id, then by email), creates the account on the
first visit, brings their role up to date and returns a normal InnovateX Hub session token.

Role rules
- ProjectFlow group_executive (the DMD)   -> DMD (every feature, same as Super Admin)  (SSO_DMD_ROLES)
- ProjectFlow admin / COO / MD / director -> Super Admin (SSO_ADMIN_ROLES)
- anyone else                             -> Participant / Employee
Roles a Hub admin gave by hand are never touched; only the roles this sign-on granted are taken away again when the
person's ProjectFlow role changes. The reverse direction does not exist: a Hub account never gets into ProjectFlow.
"""
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import DomainError
from app.core.events import audit
from app.core.permissions import CurrentUser, load_roles
from app.core.security import create_access_token
from app.modules.identity.models import Organization, OrgUnit, Role, SsoTokenUse, User, UserRoleAssignment
from app.modules.identity.pf_org import norm
from app.modules.identity.sbu import GROUP_CODE, SBU_TYPES
from app.shared.models.base import utcnow

router = APIRouter(tags=["identity"])

ISSUER = "projectflow"
AUDIENCE = "innovatex-hub"
MAX_LIFETIME_SECONDS = 10 * 60      # refuse tokens issued for longer than this, whatever they claim
REQUIRED_CLAIMS = ["exp", "iat", "iss", "aud", "jti", "sub"]


class SsoIn(BaseModel):
    token: str


def _fail(code: str, message: str, status: int = 401) -> DomainError:
    return DomainError(code, message, status)


def _roles_for(pf_role: str) -> list[str]:
    """Hub roles that a ProjectFlow role brings with it (EMPLOYEE is implicit for everyone)."""
    split = lambda s: {r.strip().lower() for r in s.split(",") if r.strip()}   # noqa: E731
    role = (pf_role or "").strip().lower().replace(" ", "_")
    if role in split(settings.sso_dmd_roles):
        return ["DMD"]
    if role in split(settings.sso_admin_roles):
        return ["SUPER_ADMIN"]
    return []


def verify_sso_token(token: str) -> dict:
    secret = settings.shared_sso_secret.strip()
    if len(secret) < 32:
        raise _fail("SSO_DISABLED", "Sign-in from ProjectFlow is not set up on InnovateX Hub.", 503)
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], audience=AUDIENCE, issuer=ISSUER, leeway=30,
                            options={"require": REQUIRED_CLAIMS})
    except jwt.ExpiredSignatureError:
        raise _fail("SSO_EXPIRED", "This sign-in link has expired. Open InnovateX Hub from ProjectFlow again.")
    except jwt.PyJWTError:
        raise _fail("SSO_INVALID", "This sign-in link is not valid. Open InnovateX Hub from ProjectFlow again.")
    if claims["exp"] - claims["iat"] > MAX_LIFETIME_SECONDS:
        raise _fail("SSO_INVALID", "This sign-in link is not valid. Open InnovateX Hub from ProjectFlow again.")
    email = str(claims.get("email") or "").strip().lower()
    try:
        pf_id = int(claims.get("user_id", claims["sub"]))
    except (TypeError, ValueError):
        pf_id = None
    if not email or "@" not in email or pf_id is None or str(pf_id) != str(claims["sub"]):
        raise _fail("SSO_INVALID", "This sign-in link is not valid. Open InnovateX Hub from ProjectFlow again.")
    claims["email"], claims["user_id"] = email, pf_id
    return claims


def _use_once(db: Session, claims: dict) -> None:
    """Records the token id; a second use of the same token is refused (replay)."""
    now = utcnow()
    db.execute(delete(SsoTokenUse).where(SsoTokenUse.expires_at < now))
    db.add(SsoTokenUse(jti=str(claims["jti"])[:64], projectflow_user_id=claims["user_id"],
                       expires_at=datetime.fromtimestamp(claims["exp"], timezone.utc).replace(tzinfo=None)))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _fail("SSO_USED", "This sign-in link was already used. Open InnovateX Hub from ProjectFlow again.")


def _unit_for(db: Session, company: str | None, department: str | None) -> OrgUnit | None:
    """The person's department (or SBU) here, matched by name to their ProjectFlow company and department."""
    units = db.scalars(select(OrgUnit).where(OrgUnit.is_active.is_(True))).all()
    sbu = next((u for u in units if u.unit_type in SBU_TYPES and company and norm((u.name_i18n or {}).get("en")) == norm(company)), None)
    if sbu and department:
        dept = next((u for u in units if u.parent_id == sbu.id and norm((u.name_i18n or {}).get("en")) == norm(department)), None)
        if dept:
            return dept
    return sbu or next((u for u in units if u.code == GROUP_CODE), None)


def _sync_roles(db: Session, user: User) -> None:
    wanted = set(_roles_for(user.projectflow_role or ""))
    granted_before = set(user.sso_roles or [])
    roles = {r.code: r for r in db.scalars(select(Role)).all()}
    have = {a.role_id: a for a in db.scalars(select(UserRoleAssignment).where(UserRoleAssignment.user_id == user.id)).all()}
    for code in wanted:
        role = roles.get(code)
        if role and role.id not in have:
            db.add(UserRoleAssignment(user_id=user.id, role_id=role.id, scope_type="GLOBAL", valid_from=utcnow()))
    for code in granted_before - wanted:          # promoted away or demoted in ProjectFlow
        role = roles.get(code)
        if role and role.id in have:
            db.delete(have[role.id])
    user.sso_roles = sorted(wanted)


@router.post("/auth/sso-login")
def sso_login(body: SsoIn, db: Session = Depends(get_db)):
    from app.modules.identity.router import _me   # shared /me shape; imported here to avoid a cycle

    claims = verify_sso_token(body.token.strip())
    _use_once(db, claims)
    pf_id, email = claims["user_id"], claims["email"]
    full_name = (str(claims.get("full_name") or "").strip() or email.split("@")[0])[:150]
    pf_role = str(claims.get("role") or "employee").strip()[:40]

    user = db.scalar(select(User).where(User.projectflow_user_id == pf_id)) \
        or db.scalar(select(User).where(func.lower(User.email) == email))
    created = user is None
    if created:
        org = db.scalar(select(Organization))
        if not org:
            raise _fail("SSO_NOT_READY", "InnovateX Hub is still being set up. Please try again later.", 503)
        unit = _unit_for(db, claims.get("company"), claims.get("department"))
        user = User(organization_id=org.id, email=email, password_hash=None, full_name=full_name,
                    employee_no=(str(claims.get("employee_id") or "").strip() or None),
                    job_title=(str(claims.get("designation") or "").strip() or None),
                    primary_org_unit_id=unit.id if unit else None,
                    department_name=(str(claims.get("department") or "").strip() or None),
                    has_corporate_login=True, is_active=True, locale="en", is_projectflow_native=True)
        db.add(user)
        db.flush()
    elif not user.is_active:
        # A Hub admin switched this account off: ProjectFlow can't switch it back on.
        raise _fail("SSO_ACCOUNT_DISABLED", "Your InnovateX Hub account is switched off. Contact the innovation office.", 403)
    else:
        if user.projectflow_user_id not in (None, pf_id):
            # The email now belongs to a different ProjectFlow person: never merge two people silently.
            raise _fail("SSO_CONFLICT", "This email is linked to another ProjectFlow account. Contact the innovation office.", 409)
        if (user.email or "").lower() != email and not db.scalar(select(User.id).where(func.lower(User.email) == email)):
            user.email = email                     # email changed in ProjectFlow
        user.full_name = full_name or user.full_name
        if claims.get("designation"):
            user.job_title = str(claims["designation"]).strip()[:150]

    user.projectflow_user_id = pf_id
    user.projectflow_role = pf_role
    user.last_login_at = utcnow()
    db.flush()
    _sync_roles(db, user)
    audit(db, user.id, "LOGIN", "user", user.id,
          "Signed in from ProjectFlow" + (" (account created)" if created else ""),
          {"projectflow_user_id": pf_id, "projectflow_role": pf_role, "hub_roles": user.sso_roles})
    db.commit()

    roles, perms = load_roles(db, user.id)
    return {"access_token": create_access_token(user.id), "token_type": "bearer", "created": created,
            "user": _me(db, CurrentUser(user=user, roles=roles, perms=perms))}


@router.get("/auth/sso-config")
def sso_config():
    """Public: lets the sign-on page offer a way back to ProjectFlow."""
    return {"enabled": len(settings.shared_sso_secret.strip()) >= 32, "projectflow_url": settings.projectflow_url or None}
