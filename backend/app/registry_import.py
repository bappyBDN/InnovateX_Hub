"""Step 2 of filling InovaRegistry from an Excel workbook: load the JSON bundle made by
scripts/registry_excel_to_json.py.

    python -m app.registry_import /path/registry_bundle.json [--dry-run] [--refresh]

Safe to run again: a record already in the registry (same website, or same title + institution) is not duplicated;
only its empty fields are filled and its missing business cards added. Records belong to the Super Admin set in
ADMIN_EMAIL (or the first Super Admin), so admins can edit or delete them in the app.
"""
import base64
import json
import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.events import audit
from app.modules.identity.models import Role, User, UserRoleAssignment
from app.modules.registry.models import AI_CATEGORIES, AI_INTENSITIES, COLLECTED_AT, CREATOR_TYPES, INSTITUTION_TYPES, BusinessCard, Project
from app.modules.registry.router import MANUAL, _clean_stack, _creator, _dedup_key, _institution, _next_code, _pick

FILL_FIELDS = ("summary", "description", "contact_phone", "contact_address", "ai_unique_point", "ai_work",
               "ai_category", "ai_intensity", "event_name", "collected_at", "tagline", "services", "projects_products",
               "ai_tags")


def _owner(db) -> User | None:
    email = (settings.admin_email or "").strip().lower()
    if email:
        user = db.scalar(select(User).where(User.email == email))
        if user:
            return user
    return db.scalar(select(User).join(UserRoleAssignment, UserRoleAssignment.user_id == User.id)
                     .join(Role, Role.id == UserRoleAssignment.role_id).where(Role.code == "SUPER_ADMIN").limit(1))


def load(path: str, dry_run: bool = False, refresh: bool = False) -> dict:
    """refresh=True: records this import created earlier (same "Via" label) get the file's text again;
    records anyone else logged are still only filled where empty."""
    bundle = json.load(open(path, encoding="utf-8"))
    db = SessionLocal()
    try:
        owner = _owner(db)
        label = f"Anwar Group team · {bundle.get('event') or 'Excel import'}"
        created = updated = cards_added = 0
        for rec in bundle["records"]:
            key = _dedup_key(rec["title"], rec["institution"], rec.get("source_url"))
            inst = _institution(db, rec["institution"], _pick(rec.get("institution_type"), INSTITUTION_TYPES, "Company"),
                                rec.get("institution_website"))
            person = _creator(db, rec.get("creator"), rec.get("creator_email"),
                              _pick(rec.get("creator_type"), CREATOR_TYPES, None), inst, MANUAL, rec.get("source_url"))
            values = {
                "summary": rec.get("summary"), "description": rec.get("description"),
                "contact_phone": rec.get("contact_phone"), "contact_address": rec.get("contact_address"),
                "ai_unique_point": rec.get("ai_unique_point"), "ai_work": rec.get("ai_work"),
                "ai_category": _pick(rec.get("ai_category"), AI_CATEGORIES, None),
                "ai_intensity": _pick(rec.get("ai_intensity"), AI_INTENSITIES, None),
                "event_name": rec.get("event_name"), "collected_at": _pick(rec.get("collected_at"), COLLECTED_AT, None),
                "tagline": (rec.get("tagline") or "")[:300] or None, "services": rec.get("services"),
                "projects_products": rec.get("projects_products"), "ai_tags": _clean_stack(rec.get("ai_tags")),
            }
            p = db.scalar(select(Project).where(Project.dedup_key == key))
            if p:
                changed = False
                ours = refresh and p.submitted_by_label == label
                for field in FILL_FIELDS:
                    if values[field] and (not getattr(p, field) or (ours and getattr(p, field) != values[field])):
                        setattr(p, field, values[field])
                        changed = True
                if not p.tech_stack and rec.get("tech_stack"):
                    p.tech_stack, changed = _clean_stack(rec["tech_stack"]), True
                elif ours and p.tech_stack and p.tech_stack == values["ai_tags"] and not rec.get("tech_stack"):
                    p.tech_stack, changed = [], True       # older imports put the AI areas in the tech stack
                if not p.institution_id and inst:
                    p.institution_id, changed = inst.id, True
                if person and not p.creator_id:
                    p.creator_id, changed = person.id, True
                if rec.get("extra") and not p.extra:
                    p.extra, changed = rec["extra"], True
                updated += changed
            else:
                p = Project(code=_next_code(db), title=rec["title"].strip()[:300], tech_stack=_clean_stack(rec.get("tech_stack")),
                            creator_id=person.id if person else None, institution_id=inst.id, source_type=MANUAL,
                            source_url=rec.get("source_url"), submitted_by_user_id=owner.id if owner else None,
                            submitted_by_label=label, dedup_key=key, extra=rec.get("extra") or {},
                            created_by=owner.id if owner else None, **values)
                db.add(p)
                db.flush()
                created += 1

            have = set(db.scalars(select(BusinessCard.match_key).where(BusinessCard.project_id == p.id)).all())
            for c in rec.get("cards", []):
                if c["match_key"] in have:
                    continue
                db.add(BusinessCard(project_id=p.id, contact_name=c.get("contact_name"), designation=c.get("designation"),
                                    phone=c.get("phone"), email=c.get("email"), details=c.get("details") or {},
                                    image=base64.b64decode(c["image"]) if c.get("image") else None,
                                    thumb=base64.b64decode(c["thumb"]) if c.get("thumb") else None,
                                    content_type="image/webp", width=c.get("width"), height=c.get("height"),
                                    sort_order=c.get("sort_order", 0), match_key=c["match_key"]))
                have.add(c["match_key"])
                cards_added += 1
            db.flush()

        result = {"records_in_file": len(bundle["records"]), "created": created, "updated": updated,
                  "business_cards_added": cards_added}
        if dry_run:
            db.rollback()
            result["dry_run"] = True
        elif created or updated or cards_added:
            audit(db, owner.id if owner else None, "CREATE", "registry_project", None,
                  f"Imported {created} new record(s) and {cards_added} business card(s) into InovaRegistry from "
                  f"{bundle.get('event') or 'an Excel file'}", result)
            db.commit()
        return result
    finally:
        db.close()


if __name__ == "__main__":
    import app.main  # noqa: F401  (registers every model and creates the new table if needed)
    from app.core.db import engine
    from app.shared.models.base import Base
    Base.metadata.create_all(engine)
    print(load(sys.argv[1], dry_run="--dry-run" in sys.argv, refresh="--refresh" in sys.argv))
