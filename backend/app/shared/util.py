"""Small helpers used by many routers."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.admin.models import FeatureFlag, SystemSetting
from app.modules.identity.models import OrgUnit, User
from app.shared import cache
from app.shared.models.base import iso


def en(value, fallback: str = "") -> str:
    if isinstance(value, dict):
        return value.get("en") or next(iter(value.values()), fallback) or fallback
    return value or fallback


def i18n(text_en: str, text_bn: str | None = None) -> dict:
    return {"en": text_en, "bn": text_bn} if text_bn else {"en": text_en}


def user_brief(db: Session, user_id: str | None, memo: dict | None = None) -> dict | None:
    if not user_id:
        return None
    u = cache.one(db, User, user_id)
    if not u:
        return None
    unit = cache.one(db, OrgUnit, u.primary_org_unit_id)
    return {"id": u.id, "full_name": u.full_name, "job_title": u.job_title, "email": u.email,
            "org_unit": en(unit.name_i18n) if unit else None}


def setting(db: Session, key: str, default=None):
    for row in cache.by(db, SystemSetting, "key").get(key, []):
        if row.scope_type == "GLOBAL" and row.value is not None:
            return row.value
    return default


def flag_on(db: Session, code: str) -> bool:
    rows = cache.by(db, FeatureFlag, "code").get(code, [])
    return bool(rows and rows[0].is_enabled)


def paginate(items: list, page: int = 1, page_size: int = 25) -> dict:
    total = len(items)
    start = max(page - 1, 0) * page_size
    return {"items": items[start:start + page_size], "total": total, "page": page}


def dt(v):
    return iso(v)
