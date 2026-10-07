"""Strategic business units (SBUs): the group and its companies. People sign up under an SBU, a challenge is opened
to SBUs and an idea belongs to one. They are ordinary org units, picked out by code."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity.models import Organization, OrgUnit

GROUP_CODE = "ANWAR"
# (code, name, Bangla name) in the order they are shown.
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
SBU_CODES = tuple(code for code, _, _ in SBUS)


def is_sbu(unit: OrgUnit | None) -> bool:
    return bool(unit) and unit.code in SBU_CODES


def sbu_units(db: Session) -> list[OrgUnit]:
    """The active SBUs, in display order."""
    rows = db.scalars(select(OrgUnit).where(OrgUnit.code.in_(SBU_CODES), OrgUnit.is_active.is_(True))).all()
    return sorted(rows, key=lambda u: SBU_CODES.index(u.code))


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
    """Create the SBUs that are missing and keep their names in step with the list above. Safe to run at every start."""
    org = db.scalar(select(Organization))
    if not org:
        return
    have = {u.code: u for u in db.scalars(select(OrgUnit).where(OrgUnit.code.in_(SBU_CODES))).all()}
    group = have.get(GROUP_CODE)
    for code, name, bn in SBUS:
        names = {"en": name, "bn": bn}
        unit = have.get(code)
        if unit:
            if unit.name_i18n != names:
                unit.name_i18n = names
            continue
        is_group = code == GROUP_CODE
        slug = code.lower()
        unit = OrgUnit(organization_id=org.id, parent_id=None if is_group else group.id, unit_type="GROUP" if is_group else "COMPANY",
                       code=code, name_i18n=names, path=slug if is_group else f"{group.path}.{slug}")
        db.add(unit)
        db.flush()
        if is_group:
            group = unit
    db.commit()
