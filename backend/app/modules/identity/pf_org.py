"""Organization structure from ProjectFlow: SBU (company) > department > function.

ProjectFlow keeps companies, departments and functions as three separate lists; which department belongs to which
company, and which function to which department, is only known from the people and projects that use them. So the
structure is built from the combinations that are actually in use.

Rules
- Each ProjectFlow company is an SBU. An existing SBU with the same name (ignoring "Ltd", case, punctuation and
  "(…)") is linked instead of copied, keeps its name and gets type COMPANY, so it appears in the SBU lists.
- Known duplicates in ProjectFlow are folded into one SBU (see ALIASES).
- A department is created under each SBU that uses it; two departments with the same name become one.
- A function is created under the department it is used in, unless it has the department's own name.
- Every unit made here carries external_ref "pf:…", so running the sync again updates instead of duplicating.
- SBUs that are not in ProjectFlow are switched off only when no person, idea or challenge uses them.
Nothing is ever deleted, and nothing is written to ProjectFlow."""
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.challenges.models import ChallengeEligibilityRule
from app.modules.identity.models import Organization, OrgUnit, User
from app.modules.identity.sbu import GROUP_CODE, SBU_TYPES
from app.modules.initiatives.models import Initiative
from app.modules.projects import sources

# ProjectFlow name (normalised) -> the name it really means.
ALIASES = {"a1polymar": "aonepolymer", "a1polymer": "aonepolymer"}
GROUP_NAMES = {"anwargroup"}


def norm(name: str | None) -> str:
    s = re.sub(r"\(.*?\)", " ", (name or "").lower())
    s = re.sub(r"\b(ltd|limited|plc)\b\.?", " ", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return ALIASES.get(s, s)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40] or "unit"


def _code(name: str) -> str:
    return _slug(name).upper()[:50]


def sync(db: Session, actor_id: str | None) -> dict:
    t = sources.read_tables({
        "companies": "id,name,is_active",
        "departments": "id,name",
        "functions": "id,name",
        "users": "company_id,department_id,function_id,is_active",
        "projects": "company_id,department_id,function_id",
    })
    companies = {c["id"]: c["name"].strip() for c in t["companies"] if c["is_active"] is not False and (c["name"] or "").strip()}
    depts = {d["id"]: d["name"].strip() for d in t["departments"] if (d["name"] or "").strip()}
    funcs = {f["id"]: f["name"].strip() for f in t["functions"] if (f["name"] or "").strip()}

    # company -> {department key: name}, (company, department key) -> {function key: name}
    uses: dict[str, dict[str, str]] = {}
    fn_uses: dict[tuple[str, str], dict[str, str]] = {}
    company_names: dict[str, str] = {}
    for row in [*t["users"], *t["projects"]]:
        if row.get("is_active") is False:
            continue
        cname = companies.get(row["company_id"])
        if not cname:
            continue
        ck = norm(cname)
        company_names.setdefault(ck, cname)
        uses.setdefault(ck, {})
        dname = depts.get(row["department_id"])
        if not dname:
            continue
        dk = norm(dname)
        uses[ck].setdefault(dk, dname)
        fname = funcs.get(row["function_id"])
        if fname and norm(fname) != dk:
            fn_uses.setdefault((ck, dk), {}).setdefault(norm(fname), fname)
    for cname in companies.values():               # a company nobody uses yet is still an SBU
        company_names.setdefault(norm(cname), cname)
        uses.setdefault(norm(cname), {})

    org = db.scalar(select(Organization))
    units = list(db.scalars(select(OrgUnit)).all())
    group = next((u for u in units if u.code == GROUP_CODE), None) or next((u for u in units if u.unit_type == "GROUP"), None)
    if not group:
        group = OrgUnit(organization_id=org.id if org else None, unit_type="GROUP", code=GROUP_CODE,
                        name_i18n={"en": "Anwar Group"}, path="anwar", created_by=actor_id)
        db.add(group)
        db.flush()
        units.append(group)
    # Candidates for matching a ProjectFlow company: the units directly under the group, and any SBU.
    top = [u for u in units if u.id != group.id and (u.parent_id == group.id or u.unit_type in SBU_TYPES)]
    by_ref = {u.external_ref: u for u in units if u.external_ref}
    by_name = {}
    for u in top:
        by_name.setdefault(norm((u.name_i18n or {}).get("en")), u)

    report = {"sbus_linked": [], "sbus_created": [], "sbus_switched_off": [], "sbus_kept": [],
              "departments_created": 0, "functions_created": 0, "fixed_types": []}

    def child(parent: OrgUnit, ref: str, name: str, unit_type: str) -> tuple[OrgUnit, bool]:
        unit = by_ref.get(ref)
        if not unit:   # an admin may have added it by hand already: reuse a same-named child
            unit = next((u for u in units if u.parent_id == parent.id and norm((u.name_i18n or {}).get("en")) == norm(name)), None)
        created = False
        if not unit:
            unit = OrgUnit(organization_id=parent.organization_id, parent_id=parent.id, unit_type=unit_type,
                           code=_code(name), name_i18n={"en": name}, path=f"{parent.path}.{_slug(name)}",
                           created_by=actor_id)
            db.add(unit)
            db.flush()
            units.append(unit)
            created = True
        unit.external_ref, unit.is_active = ref, True
        by_ref[ref] = unit
        return unit, created

    linked_sbus = set()
    for ck, cname in sorted(company_names.items(), key=lambda kv: kv[1].lower()):
        if ck in GROUP_NAMES:
            sbu = group
            sbu.external_ref = f"pf:company:{ck}"
        else:
            ref = f"pf:company:{ck}"
            sbu = by_ref.get(ref) or by_name.get(ck)
            if sbu:
                if sbu.unit_type not in SBU_TYPES:
                    report["fixed_types"].append((sbu.name_i18n or {}).get("en"))
                    sbu.unit_type = "COMPANY"           # BUSINESS units were not counted as SBUs
                sbu.external_ref, sbu.is_active = ref, True
                report["sbus_linked"].append((sbu.name_i18n or {}).get("en"))
            else:
                sbu, _ = child(group, ref, cname, "COMPANY")
                report["sbus_created"].append(cname)
            by_ref[ref] = sbu
        linked_sbus.add(sbu.id)
        for dk, dname in sorted(uses.get(ck, {}).items(), key=lambda kv: kv[1].lower()):
            dept, made = child(sbu, f"pf:company:{ck}:dept:{dk}", dname, "DEPARTMENT")
            report["departments_created"] += made
            for fk, fname in sorted(fn_uses.get((ck, dk), {}).items(), key=lambda kv: kv[1].lower()):
                _, made = child(dept, f"pf:company:{ck}:dept:{dk}:fn:{fk}", fname, "FUNCTION")
                report["functions_created"] += made

    # SBUs that are not in ProjectFlow: switch off only the unused ones, so nothing that points at them breaks.
    used_rules = {r.rule_value.get("org_unit_id") for r in db.scalars(select(ChallengeEligibilityRule)
                                                                         .where(ChallengeEligibilityRule.rule_type == "ORG_UNIT")).all()}
    for u in units:
        if u.unit_type != "COMPANY" or u.id in linked_sbus or not u.is_active or u.parent_id != group.id:
            continue
        subtree = [x.id for x in units if x.path == u.path or x.path.startswith(u.path + ".")]
        in_use = (db.scalar(select(func.count()).select_from(User).where(User.primary_org_unit_id.in_(subtree)))
                  or db.scalar(select(func.count()).select_from(Initiative).where(Initiative.org_unit_id.in_(subtree)))
                  or any(x in used_rules for x in subtree))
        name = (u.name_i18n or {}).get("en")
        if in_use:
            report["sbus_kept"].append(name)
        else:
            u.is_active = False
            report["sbus_switched_off"].append(name)
    db.flush()
    return report
