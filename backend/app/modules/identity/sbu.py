"""Strategic business units (SBUs): the group and its companies. People sign up under an SBU, a challenge is opened
to SBUs and an idea belongs to one. An SBU is an org unit of type GROUP or COMPANY; the units under it are its
departments. The admin adds and edits both on the Organization page."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity.models import Organization, OrgUnit

SBU_TYPES = ("GROUP", "COMPANY")
GROUP_CODE = "ANWAR"
# The SBUs every database starts with: (code, name, Bangla name). After that the admin owns the list.
SBUS = (
    (GROUP_CODE, "Anwar Group", "আনোয়ার গ্রুপ"),
    ("CEMENT", "Anwar Cement LTD", "আনোয়ার সিমেন্ট লিমিটেড"),
    ("ISPAT", "Anwar Ispat LTD", "আনোয়ার ইস্পাত লিমিটেড"),
    ("TEXTILE", "Anwar Textile LTD", "আনোয়ার টেক্সটাইল লিমিটেড"),
    ("SILK", "Anwar Silk LTD", "আনোয়ার সিল্ক লিমিটেড"),
    ("JUTE", "Anwar Jute LTD", "আনোয়ার জুট লিমিটেড"),
    ("LANDMARK", "Anwar Landmark LTD", "আনোয়ার ল্যান্ডমার্ক লিমিটেড"),
    ("GALVANIZING", "Anwar Galvanizing LTD", "আনোয়ার গ্যালভানাইজিং লিমিটেড"),
    ("AONE_POLYMER", "A One Polymer LTD", "এ ওয়ান পলিমার লিমিটেড"),
    ("DENIM", "Anwar Denim LTD", "আনোয়ার ডেনিম লিমিটেড"),
)
# Names from the first demo data, replaced once by the names above. A name the admin typed is never touched.
OLD_NAMES = {"CEMENT": "Anwar Cement", "ISPAT": "Anwar Ispat (Steel)", "TEXTILE": "Anwar Textiles"}


def is_sbu(unit: OrgUnit | None) -> bool:
    return bool(unit) and unit.unit_type in SBU_TYPES


def _in_order(units: list[OrgUnit]) -> list[OrgUnit]:
    """The group first, then the starting companies in their usual order, then the ones the admin added, by name."""
    start = [code for code, _, _ in SBUS]
    return sorted(units, key=lambda u: (u.path.count("."), start.index(u.code) if u.code in start else len(start),
                                        (u.name_i18n or {}).get("en") or ""))


def sbu_units(db: Session) -> list[OrgUnit]:
    """The active SBUs, in display order."""
    return _in_order(db.scalars(select(OrgUnit).where(OrgUnit.unit_type.in_(SBU_TYPES), OrgUnit.is_active.is_(True))).all())


def department_units(db: Session) -> list[tuple[OrgUnit, OrgUnit]]:
    """Every active unit below an SBU, with that SBU: the departments a person can pick at sign-up."""
    rows = db.scalars(select(OrgUnit).where(OrgUnit.unit_type.notin_(SBU_TYPES), OrgUnit.is_active.is_(True))
                      .order_by(OrgUnit.path)).all()
    return [(u, s) for u, s in ((u, sbu_of(db, u)) for u in rows) if s]


def sbu_of(db: Session, unit: OrgUnit | None) -> OrgUnit | None:
    """The SBU a unit sits in: itself, or its nearest parent that is an SBU."""
    seen = set()
    while unit and unit.id not in seen:
        if is_sbu(unit):
            return unit
        seen.add(unit.id)
        unit = db.get(OrgUnit, unit.parent_id) if unit.parent_id else None
    return None


def ensure_sbus(db: Session) -> None:
    """Add the starting SBUs once. After that the list is the admin's: a unit they renamed or deleted stays that way."""
    org = db.scalar(select(Organization))
    if not org or (org.settings or {}).get("sbus_added"):
        return
    codes = [code for code, _, _ in SBUS]
    have = {u.code: u for u in db.scalars(select(OrgUnit).where(OrgUnit.code.in_(codes))).all()}
    group = have.get(GROUP_CODE)
    for code, name, bn in SBUS:
        unit = have.get(code)
        if unit:
            if (unit.name_i18n or {}).get("en") == OLD_NAMES.get(code):
                unit.name_i18n = {"en": name, "bn": bn}
            continue
        is_group = code == GROUP_CODE
        slug = code.lower()
        unit = OrgUnit(organization_id=org.id, parent_id=None if is_group else group.id, unit_type="GROUP" if is_group else "COMPANY",
                       code=code, name_i18n={"en": name, "bn": bn}, path=slug if is_group else f"{group.path}.{slug}")
        db.add(unit)
        db.flush()
        if is_group:
            group = unit
    org.settings = {**(org.settings or {}), "sbus_added": True}
    db.commit()
