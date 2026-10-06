"""Open ideas: the configurable workflow engine, journey rail and serialisation."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import DomainError, not_found
from app.core.events import publish_event, record_history
from app.core.permissions import CurrentUser
from app.modules.admin.models import WorkflowDefinition, WorkflowState, WorkflowTransition
from app.modules.delivery.models import Kpi, KpiMeasurement
from app.modules.evaluation.models import Feedback
from app.modules.identity.models import OrgUnit
from app.modules.initiatives.models import Initiative, InitiativeMember
from app.modules.masterdata.models import Category
from app.shared import cache as tcache
from app.shared.models.base import iso, utcnow
from app.shared.util import en, user_brief

WORKFLOW = "INITIATIVE_STD"
REQUIRED_AT_SUBMIT = {
    "title": "Title", "problem_statement": "Problem statement", "current_process": "Current process",
    "proposed_solution": "Proposed innovation", "category_id": "Category", "innovation_type_code": "Innovation type",
    "expected_benefit": "Expected benefit", "primary_kpi": "Primary KPI", "scalability_level_code": "Scalability",
    "data_classification_code": "Data classification", "expected_timeline": "Expected timeline", "org_unit_id": "Organization unit",
}
EDITABLE = ["title", "summary", "problem_statement", "affected_users", "current_process", "proposed_solution",
            "technology_used", "differentiator", "category_id", "innovation_type_code", "org_unit_id", "sponsor_user_id",
            "data_classification_code", "scalability_level_code", "risk_flags", "benefit_types", "primary_kpi",
            "baseline_value", "target_value", "expected_benefit", "expected_timeline", "estimated_cost", "dependencies",
            "declaration_accepted", "on_behalf_of_user_id", "content"]

STAGES = [("DRAFT", "Draft"), ("SUBMITTED", "Submitted"), ("TRIAGE", "Triage"), ("REVIEW", "Review"),
          ("PROTOTYPE", "Prototype"), ("DEMO", "Demo"), ("PILOT", "Pilot"), ("PRODUCTION", "Production"),
          ("IMPACT", "Impact verified"), ("SCALED", "Scaled")]
STAGE_INDEX = {"DRAFT": 0, "SUBMITTED": 1, "TRIAGE": 2, "DUPLICATE": 2, "UNDER_REVIEW": 3, "CLARIFICATION_REQUESTED": 3,
               "ON_HOLD": 3, "NOT_SELECTED": 3, "SHORTLISTED": 3, "PROTOTYPE": 4, "DEMO_VALIDATION": 5, "PILOT": 6,
               "PRODUCTION": 7, "IMPACT_VERIFIED": 8, "SCALED": 9, "CLOSED": 9}
NOTES = {"ON_HOLD": "On hold", "NOT_SELECTED": "In the Idea Bank", "DUPLICATE": "Linked as duplicate",
         "CLARIFICATION_REQUESTED": "Question from the reviewer", "SHORTLISTED": "Shortlisted", "CLOSED": "Closed"}
NEXT = {
    "DRAFT": ("Finish and submit your idea.", "Continue idea", "edit"),
    "SUBMITTED": ("Submitted. The innovation office will check it within 5 working days.", None, None),
    "TRIAGE": ("The innovation office is checking completeness, duplicates and routing.", None, None),
    "UNDER_REVIEW": ("Your idea is with the reviewers.", None, None),
    "CLARIFICATION_REQUESTED": ("A reviewer asked a question. Reply so the review can continue.", "Reply", "detail"),
    "SHORTLISTED": ("Shortlisted. The innovation office will authorize your prototype.", None, None),
    "ON_HOLD": ("On hold. Read the note from the reviewers; it will be looked at again later.", "Read feedback", "detail"),
    "NOT_SELECTED": ("Not selected this time. Your idea stays in the Idea Bank and can be reopened.", "Read feedback", "detail"),
    "DUPLICATE": ("Linked to an earlier idea. You can join forces with that team.", "See details", "detail"),
    "PROTOTYPE": ("Build your prototype. Then fill the prototype form (link and how to use it) and send it for review.", "Open idea", "detail"),
    "DEMO_VALIDATION": ("Your prototype is with the judges. You'll be told when they decide.", "Open idea", "detail"),
    "PILOT": ("Run the pilot, record the results, then send the pilot report for review.", "Open idea", "detail"),
    "PRODUCTION": ("Live in production. Keep recording results so impact can be verified.", "Add measurement", "impact"),
    "IMPACT_VERIFIED": ("Impact verified. This idea can now be scaled and published to the catalogue.", None, None),
    "SCALED": ("Scaled and reusable. Thank you for the impact.", None, None),
    "CLOSED": ("This idea is closed.", None, None),
}


def journey(ini: Initiative) -> list[dict]:
    cur = STAGE_INDEX.get(ini.current_state_code, 0)
    out = []
    for i, (code, label) in enumerate(STAGES):
        stage = {"code": code, "label": label, "date": None, "note": None,
                 "state": "done" if i < cur else "current" if i == cur else "upcoming"}
        if i == cur:
            stage["note"] = NOTES.get(ini.current_state_code)
            stage["date"] = iso(ini.current_stage_entered_at)
            if ini.current_state_code in ("SCALED", "IMPACT_VERIFIED") or ini.is_awarded:
                stage["state"] = "won" if ini.is_awarded or ini.current_state_code == "SCALED" else "current"
        if code == "SUBMITTED" and ini.submitted_at:
            stage["date"] = iso(ini.submitted_at)
        out.append(stage)
    return out


def next_step(ini: Initiative) -> dict:
    text, label, target = NEXT.get(ini.current_state_code, ("", None, None))
    key = ini.code or ini.id
    path = {"edit": f"/ideas/{key}/edit", "detail": f"/ideas/{key}", "impact": "/impact"}.get(target)
    return {"text": text, "action_label": label, "action_path": path}


def card(db: Session, ini: Initiative, cache: dict | None = None) -> dict:
    cat = tcache.one(db, Category, ini.category_id)
    unit = tcache.one(db, OrgUnit, ini.org_unit_id)
    return {
        "id": ini.id, "code": ini.code, "key": ini.code or ini.id, "title": ini.title, "summary": ini.summary,
        "category": {"id": cat.id, "name_i18n": cat.name_i18n, "color": cat.color} if cat else None,
        "innovation_type_code": ini.innovation_type_code, "org_unit": en(unit.name_i18n) if unit else None,
        "current_state_code": ini.current_state_code, "stage_entered_at": iso(ini.current_stage_entered_at),
        "submitted_at": iso(ini.submitted_at), "updated_at": iso(ini.updated_at),
        "data_classification_code": ini.data_classification_code, "is_in_idea_bank": ini.is_in_idea_bank,
        "is_awarded": ini.is_awarded, "score_latest": ini.score_latest,
        "owner": user_brief(db, ini.owner_user_id, cache), "journey": journey(ini), "next_step": next_step(ini),
    }


def members(db: Session, ini: Initiative) -> list[dict]:
    out = []
    for m in db.scalars(select(InitiativeMember).where(InitiativeMember.initiative_id == ini.id,
                                                       InitiativeMember.left_at.is_(None))).all():
        out.append({**(user_brief(db, m.user_id) or {}), "user_id": m.user_id, "member_role": m.member_role,
                    "credit_share_pct": m.credit_share_pct})
    out.sort(key=lambda m: m["member_role"] != "OWNER")
    return out


def set_members(db: Session, ini: Initiative, contributors: list[dict]) -> None:
    """Exactly one accountable owner; credit shares total 100 (equal by default)."""
    for m in db.scalars(select(InitiativeMember).where(InitiativeMember.initiative_id == ini.id)).all():
        db.delete(m)
    db.flush()
    people = [c for c in contributors if c.get("user_id") and c["user_id"] != ini.owner_user_id]
    given = sum(c.get("credit_share_pct") or 0 for c in people)
    equal = round(100 / (len(people) + 1), 2)
    use_given = people and all(c.get("credit_share_pct") for c in people) and 0 < given < 100
    db.add(InitiativeMember(initiative_id=ini.id, user_id=ini.owner_user_id, member_role="OWNER", joined_at=utcnow(),
                            credit_share_pct=round(100 - given, 2) if use_given else round(100 - equal * len(people), 2)))
    for c in people:
        db.add(InitiativeMember(initiative_id=ini.id, user_id=c["user_id"], member_role="CONTRIBUTOR", joined_at=utcnow(),
                                credit_share_pct=c["credit_share_pct"] if use_given else equal))


def missing_fields(ini: Initiative) -> dict:
    missing = {k: f"{label} is required." for k, label in REQUIRED_AT_SUBMIT.items() if getattr(ini, k) in (None, "", [])}
    if not ini.declaration_accepted:
        missing["declaration_accepted"] = "Please accept the originality declaration."
    return missing


# ---- Workflow engine: states and transitions are rows, not code --------------------------------------------
def _definition_id(db: Session) -> str | None:
    return db.scalar(select(WorkflowDefinition.id).where(WorkflowDefinition.code == WORKFLOW))


def state_label(db: Session, code: str) -> str:
    s = db.scalar(select(WorkflowState).where(WorkflowState.workflow_definition_id == _definition_id(db),
                                              WorkflowState.code == code))
    return en(s.name_i18n) if s else code.replace("_", " ").title()


# Sending a prototype for review, approving it and asking for rework now happen in the prototype review.
GATED_ACTIONS = ("REQUEST_DEMO", "APPROVE_PILOT", "REQUEST_REWORK")


def _pilot_approved(db: Session, ini: Initiative) -> bool:
    from app.modules.evaluation.gates import approved
    return approved(db, "initiative", ini.id, "PILOT")


def allowed_actions(db: Session, cu: CurrentUser, ini: Initiative, role: str) -> list[dict]:
    out = []
    for t in db.scalars(select(WorkflowTransition).where(WorkflowTransition.workflow_definition_id == _definition_id(db),
                                                         WorkflowTransition.from_state == ini.current_state_code)
                        .order_by(WorkflowTransition.sort_order)).all():
        if t.action_code == "SUBMIT":
            continue   # submit has its own endpoint (validation + Innovation ID)
        if t.action_code in GATED_ACTIONS:
            continue   # decided by the prototype review (form + judges), not by a button
        if t.action_code == "GO_LIVE" and not _pilot_approved(db, ini):
            continue   # the pilot review must be approved first
        if t.allowed_permission is None:
            if role not in ("OWNER", "MEMBER"):
                continue
        elif not cu.can(t.allowed_permission):
            continue
        out.append({"action_code": t.action_code, "label": en(t.label_i18n), "to_state": t.to_state,
                    "requires_comment": t.requires_comment,
                    "tone": "danger" if t.to_state in ("NOT_SELECTED", "CLOSED", "DUPLICATE") else
                            "secondary" if t.to_state in ("ON_HOLD", "PROTOTYPE") and t.requires_comment else "primary"})
    return out


def _check_guards(db: Session, ini: Initiative, rules: dict) -> None:
    """RB-10: pilot/production can't be set without the required evidence."""
    problems = []
    if rules.get("requires_sponsor") and not ini.sponsor_user_id:
        problems.append("a business sponsor")
    kpis = db.scalars(select(Kpi).where(Kpi.entity_type == "initiative", Kpi.entity_id == ini.id)).all()
    primary = next((k for k in kpis if k.is_primary), kpis[0] if kpis else None)
    if rules.get("requires_kpi_baseline") and not (primary and primary.baseline_value is not None and primary.target_value is not None):
        problems.append("a primary KPI with baseline and target")
    kpi_ids = [k.id for k in kpis] or [""]
    if rules.get("requires_measurement") and not db.scalar(select(KpiMeasurement.id).where(KpiMeasurement.kpi_id.in_(kpi_ids))):
        problems.append("at least one actual KPI measurement")
    if rules.get("requires_verified_measurement") and not db.scalar(select(KpiMeasurement.id).where(
            KpiMeasurement.kpi_id.in_(kpi_ids), KpiMeasurement.verification_status.in_(["VERIFIED", "ADJUSTED"]))):
        problems.append("a verified KPI measurement")
    if problems:
        raise DomainError("STAGE_EVIDENCE_MISSING", "This step needs " + ", ".join(problems) + " first.", 409,
                          {"missing": problems})


def transition(db: Session, cu: CurrentUser, ini: Initiative, role: str, action: str, comment: str | None,
               duplicate_of: str | None = None) -> None:
    t = db.scalar(select(WorkflowTransition).where(WorkflowTransition.workflow_definition_id == _definition_id(db),
                                                   WorkflowTransition.from_state == ini.current_state_code,
                                                   WorkflowTransition.action_code == action))
    if not t:
        raise DomainError("ACTION_NOT_ALLOWED", "This action is not possible at the idea's current stage.", 409)
    if action in GATED_ACTIONS:
        raise DomainError("USE_PROTOTYPE_REVIEW", "This step is decided in the prototype review: the candidate sends the "
                                                  "prototype form and the judges approve it.", 409)
    if action == "GO_LIVE" and not _pilot_approved(db, ini):
        raise DomainError("PILOT_REVIEW_NEEDED", "The pilot review must be approved before the idea moves to production.", 409)
    if t.allowed_permission is None:
        if role not in ("OWNER", "MEMBER"):
            raise not_found("Idea")
    elif not cu.can(t.allowed_permission):
        raise not_found("Idea")
    if t.requires_comment and not (comment or "").strip():
        raise DomainError("COMMENT_REQUIRED", "Write a short reason. It is shared with the idea owner.")
    _check_guards(db, ini, t.guard_rules or {})

    before, now = ini.current_state_code, utcnow()
    if t.to_state == "DUPLICATE":
        original = db.get(Initiative, duplicate_of) or db.scalar(select(Initiative).where(Initiative.code == duplicate_of))
        if not original or original.id == ini.id:
            raise DomainError("DUPLICATE_TARGET_REQUIRED", "Choose the earlier idea this one duplicates.")
        ini.duplicate_of_id = original.id        # RB-08: linked, never silently deleted
    ini.current_state_code, ini.current_stage_entered_at, ini.updated_by = t.to_state, now, cu.id
    ini.is_in_idea_bank = t.to_state == "NOT_SELECTED"
    if t.to_state == "CLOSED":
        ini.closed_at = now
    if t.to_state == "PRODUCTION":
        ini.implemented_on = now
    record_history(db, "initiative", ini.id, before, t.to_state, action, cu.id, comment)

    if t.to_state in ("SHORTLISTED", "NOT_SELECTED", "ON_HOLD", "DUPLICATE"):
        db.add(Feedback(entity_type="initiative", entity_id=ini.id, decision_code=t.to_state, decision_reason=comment,
                        strengths="", improvements="", written_by=cu.id, published_at=now, score_shared=ini.score_latest,
                        next_steps=NEXT.get(t.to_state, ("",))[0]))
    people = list(db.scalars(select(InitiativeMember.user_id).where(InitiativeMember.initiative_id == ini.id)).all())
    people = list(dict.fromkeys([ini.owner_user_id, *people]))
    if t.to_state in ("SHORTLISTED", "PILOT", "IMPACT_VERIFIED", "SCALED"):
        from app.modules.evaluation.service import award_points
        points, badge = {"SHORTLISTED": (50, "SHORTLISTED"), "PILOT": (80, "PILOT_STARTED"),
                         "IMPACT_VERIFIED": (150, "IMPACT_VERIFIED"), "SCALED": (200, "REUSABLE_ASSET")}[t.to_state]
        award_points(db, people, points, t.to_state, badge, "initiative", ini.id)
    label = state_label(db, t.to_state)
    publish_event(db, t.emits_event or "INITIATIVE_STATE_CHANGED", "initiative", ini.id, cu.id, users=people,
                  title=f"{ini.code}: now {label}", body=comment or NEXT.get(t.to_state, ("",))[0],
                  link=f"/ideas/{ini.code or ini.id}", needs_action=t.to_state in ("PROTOTYPE", "PILOT"),
                  vars={"innovation_id": ini.code, "title": ini.title, "old_status": state_label(db, before),
                        "new_status": label, "comment": comment or ""})


def initiative_as_form(db: Session, ini: Initiative) -> tuple[dict, dict]:
    """Lets the scoring workspace render an idea with the same read-only form view as a methodology."""
    def section(code, title, fields, scored_on=()):
        return {"id": code, "code": code, "title_i18n": {"en": title}, "help_i18n": {}, "scored_on": list(scored_on),
                "fields": [{"id": k, "field_key": k, "label_i18n": {"en": label}, "help_i18n": {}, "placeholder_i18n": {},
                            "field_type": kind, "options": [], "is_required": False, "validation": {}}
                           for k, label, kind in fields]}
    form = {"id": "initiative", "code": "INITIATIVE_VIEW", "name_i18n": {"en": "Idea"}, "name": "Idea", "purpose": "INITIATIVE",
            "version": 1, "status": "PUBLISHED", "sections": [
                section("problem", "Problem", [("problem_statement", "Problem statement", "LONG_TEXT"),
                                               ("affected_users", "Who is affected", "LONG_TEXT"),
                                               ("current_process", "Current process and baseline", "LONG_TEXT")],
                        ["Problem importance"]),
                section("solution", "Proposed innovation", [("proposed_solution", "Proposed innovation", "LONG_TEXT"),
                                                           ("technology_used", "Technology or method used", "LONG_TEXT"),
                                                           ("differentiator", "What is different", "LONG_TEXT")],
                        ["Originality", "Feasibility"]),
                section("value", "Value and impact", [("expected_benefit", "Expected benefit", "LONG_TEXT"),
                                                      ("primary_kpi", "Primary KPI", "TEXT"), ("baseline_value", "Baseline", "TEXT"),
                                                      ("target_value", "Target", "TEXT"),
                                                      ("scalability_level_code", "Scalability", "TEXT"),
                                                      ("expected_timeline", "Expected timeline", "TEXT"),
                                                      ("dependencies", "Dependencies", "LONG_TEXT")],
                        ["Expected value", "Reuse potential"])]}
    content = {f["field_key"]: getattr(ini, f["field_key"]) for s in form["sections"] for f in s["fields"]}
    return form, content
