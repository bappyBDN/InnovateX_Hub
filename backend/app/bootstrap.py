"""A clean start without demo data (SEED_ON_START=false).

On an empty database this adds only what the system needs to run (roles, permissions, forms, scorecards, settings,
the organization) and one Super Admin from ADMIN_EMAIL / ADMIN_PASSWORD. Everything else is created in the app.
Safe on every start: it does nothing once the reference data or the admin exists.
"""
import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.modules.identity.models import Organization, OrgUnit, Role, User, UserRoleAssignment
from app.modules.identity.sbu import GROUP_CODE, ensure_sbus
from app.seed_reference import seed_reference
from app.shared.models.base import utcnow

log = logging.getLogger("innovatex")


def bootstrap(db: Session) -> None:
    if not db.scalar(select(func.count()).select_from(Role)):
        log.info("Empty database: adding reference data (no demo data)…")
        seed_reference(db)
        db.commit()
    if not db.scalar(select(Organization)):
        db.add(Organization(code="ANWAR", name_i18n={"en": "Anwar Group of Industries", "bn": "আনোয়ার গ্রুপ অব ইন্ডাস্ট্রিজ"}))
        db.commit()
    ensure_sbus(db)

    email = (settings.admin_email or "").strip().lower()
    if not email or not settings.admin_password:
        return
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        return
    org = db.scalar(select(Organization))
    group = db.scalar(select(OrgUnit).where(OrgUnit.code == GROUP_CODE))
    role = db.scalar(select(Role).where(Role.code == "SUPER_ADMIN"))
    admin = User(organization_id=org.id, email=email, password_hash=hash_password(settings.admin_password),
                 full_name=settings.admin_name, job_title="Super Admin", primary_org_unit_id=group.id if group else None,
                 has_corporate_login=True, locale="en")
    db.add(admin)
    db.flush()
    db.add(UserRoleAssignment(user_id=admin.id, role_id=role.id, scope_type="GLOBAL", valid_from=utcnow()))
    db.commit()
    log.info("Super Admin %s created.", email)
