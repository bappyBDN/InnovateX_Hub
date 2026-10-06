"""One place that answers 'may this user see / change this record?' for polymorphic content."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import not_found
from app.core.permissions import CurrentUser, get_entry_or_404, is_entry_member
from app.modules.challenges.models import ChallengeEntry, EntrySubmission
from app.modules.evaluation.models import ReviewAssignment
from app.modules.initiatives.models import Initiative, InitiativeMember
from app.shared import cache

IMPACT_STATES = {"PILOT", "PRODUCTION", "IMPACT_VERIFIED", "SCALED"}


def initiative_role(db: Session, cu: CurrentUser, ini: Initiative) -> str | None:
    """OWNER, MEMBER, REVIEWER, STAFF (privileged / read-all) or None (no access -> 404)."""
    if cu.id in (ini.owner_user_id, ini.submitted_by_user_id):
        return "OWNER"
    if any(m.user_id == cu.id and m.left_at is None for m in cache.by(db, InitiativeMember, "initiative_id").get(ini.id, [])):
        return "MEMBER"
    if ini.current_state_code == "DRAFT":
        return None                      # drafts are visible to the team only
    if cu.privileged:
        return "STAFF"
    if any(a.reviewer_user_id == cu.id and a.status != "DECLINED_COI" and a.entity_type == "initiative"
           for a in cache.by(db, ReviewAssignment, "entity_id").get(ini.id, [])):
        return "REVIEWER"
    if cu.has_role("JUDGE"):
        return "STAFF"                   # judges can view all participant documents and information
    confidential = ini.data_classification_code in ("CONFIDENTIAL", "RESTRICTED")
    if confidential:
        return None                      # restricted panel only
    if cu.has_role("EXECUTIVE"):
        return "STAFF"
    if ini.sponsor_user_id == cu.id:
        return "STAFF"
    if cu.has_role("FINANCE_VERIFIER", "SPONSOR", "HR") and ini.current_state_code in IMPACT_STATES:
        return "STAFF"
    return None


def get_initiative_or_404(db: Session, cu: CurrentUser, key: str) -> tuple[Initiative, str]:
    ini = db.get(Initiative, key) or db.scalar(select(Initiative).where(Initiative.code == key))
    if not ini or ini.deleted_at:
        raise not_found("Idea")
    role = initiative_role(db, cu, ini)
    if not role:
        raise not_found("Idea")
    return ini, role


def check_entity_access(db: Session, cu: CurrentUser, entity_type: str, entity_id: str, write: bool = False) -> None:
    """Raises 404 when the user may not see (or, with write=True, change) the record."""
    if entity_type == "challenge_entry":
        entry = get_entry_or_404(db, cu, entity_id)
        if write and not is_entry_member(db, entry, cu.id) and not cu.privileged:
            raise not_found("Entry")
    elif entity_type == "entry_submission":
        sub = db.get(EntrySubmission, entity_id)
        if not sub:
            raise not_found("Submission")
        check_entity_access(db, cu, "challenge_entry", sub.challenge_entry_id, write)
    elif entity_type == "initiative":
        _, role = get_initiative_or_404(db, cu, entity_id)
        if write and role not in ("OWNER", "MEMBER") and not cu.privileged:
            raise not_found("Idea")
    elif not cu.privileged:
        raise not_found("Record")


def entry_for(db: Session, entity_type: str, entity_id: str) -> ChallengeEntry | None:
    if entity_type == "challenge_entry":
        return db.get(ChallengeEntry, entity_id)
    return None
