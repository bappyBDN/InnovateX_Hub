"""Open ideas (initiatives): draft, submit, workflow actions, reviewers, clarifications, comments, export."""
import csv
import io
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit, next_code, publish_event, record_history
from app.core.permissions import CurrentUser, get_current_user, require_roles
from app.modules.admin.models import WorkflowHistory
from app.modules.delivery.models import ReusableAsset
from app.modules.evaluation import service as esvc
from app.modules.evaluation.models import Feedback, ReviewAssignment, ReviewRound, ReviewSummary
from app.modules.identity.models import OrgUnit
from app.modules.initiatives import service as svc
from app.modules.initiatives.models import ClarificationRequest, Comment, Initiative, InitiativeMember, InitiativeVersion
from app.shared.access import check_entity_access, get_initiative_or_404, initiative_role
from app.shared.models.base import iso, row, utcnow
from app.shared.util import en, paginate, setting, user_brief

router = APIRouter(tags=["ideas"])
STAFF = ("SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE", "JUDGE")
MANAGERS = ("SUPER_ADMIN", "PROGRAM_OWNER")


class IdeaIn(BaseModel):
    title: str | None = None
    summary: str | None = None
    problem_statement: str | None = None
    affected_users: str | None = None
    current_process: str | None = None
    proposed_solution: str | None = None
    technology_used: str | None = None
    differentiator: str | None = None
    category_id: str | None = None
    innovation_type_code: str | None = None
    org_unit_id: str | None = None
    sponsor_user_id: str | None = None
    data_classification_code: str | None = None
    scalability_level_code: str | None = None
    risk_flags: list[str] | None = None
    benefit_types: list[str] | None = None
    primary_kpi: str | None = None
    baseline_value: str | None = None
    target_value: str | None = None
    expected_benefit: str | None = None
    expected_timeline: str | None = None
    estimated_cost: float | None = None
    dependencies: str | None = None
    declaration_accepted: bool | None = None
    on_behalf_of_user_id: str | None = None
    content: dict | None = None
    members: list[dict] | None = None
    row_version: int | None = None


def _apply(db: Session, ini: Initiative, body: IdeaIn, cu: CurrentUser) -> None:
    data = body.model_dump(exclude_unset=True)
    for key in svc.EDITABLE:
        if key in data:
            setattr(ini, key, data[key])
    if "on_behalf_of_user_id" in data:
        # Proxy submission: the colleague is the owner and gets the credit.
        ini.owner_user_id = data["on_behalf_of_user_id"] or ini.submitted_by_user_id
    if not ini.summary and ini.proposed_solution:
        ini.summary = ini.proposed_solution[:280]
    ini.updated_by, ini.row_version = cu.id, (ini.row_version or 1) + 1
    db.flush()
    if "members" in data or "on_behalf_of_user_id" in data:
        current = [{"user_id": m["user_id"], "credit_share_pct": m["credit_share_pct"]} for m in svc.members(db, ini)
                   if m["member_role"] != "OWNER"]
        svc.set_members(db, ini, data.get("members") if data.get("members") is not None else current)


@router.get("/initiatives")
def list_initiatives(scope: str = "mine", state: str = "", category: str = "", q: str = "", classification: str = "",
                     org_unit: str = "", page: int = 1, page_size: int = 50,
                     cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Initiative).where(Initiative.deleted_at.is_(None))
    if scope == "mine":
        mine = db.scalars(select(InitiativeMember.initiative_id).where(InitiativeMember.user_id == cu.id,
                                                                       InitiativeMember.left_at.is_(None))).all()
        stmt = stmt.where(or_(Initiative.owner_user_id == cu.id, Initiative.submitted_by_user_id == cu.id,
                              Initiative.id.in_(mine or [""])))
    else:
        stmt = stmt.where(Initiative.current_state_code != "DRAFT")
        if scope == "bank":
            stmt = stmt.where(Initiative.is_in_idea_bank.is_(True))
    if state:
        stmt = stmt.where(Initiative.current_state_code == state)
    if category:
        stmt = stmt.where(Initiative.category_id == category)
    if classification:
        stmt = stmt.where(Initiative.data_classification_code == classification)
    if org_unit:
        stmt = stmt.where(Initiative.org_unit_id == org_unit)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Initiative.title.ilike(like), Initiative.code.ilike(like), Initiative.summary.ilike(like),
                              Initiative.problem_statement.ilike(like)))
    cache: dict = {}
    items = []
    for ini in db.scalars(stmt.order_by(Initiative.updated_at.desc())).all():
        # Authorisation is applied before any metadata is returned (confidential ideas never leak into lists).
        if scope != "mine" and not initiative_role(db, cu, ini):
            continue
        items.append(svc.card(db, ini, cache))
    return paginate(items, page, page_size)


@router.post("/initiatives")
def create_draft(body: IdeaIn, request: Request, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ini = Initiative(title=(body.title or "Untitled idea").strip(), owner_user_id=cu.id, submitted_by_user_id=cu.id,
                     current_state_code="DRAFT", current_stage_entered_at=utcnow(), org_unit_id=cu.user.primary_org_unit_id,
                     data_classification_code="INTERNAL", created_by=cu.id, content={}, risk_flags=[], benefit_types=[])
    db.add(ini)
    db.flush()
    _apply(db, ini, body, cu)
    if not body.members:
        svc.set_members(db, ini, [])
    record_history(db, "initiative", ini.id, None, "DRAFT", "CREATE_DRAFT", cu.id)
    publish_event(db, "INITIATIVE_DRAFT_CREATED", "initiative", ini.id, cu.id)
    db.commit()
    return {"id": ini.id, "key": ini.id, "row_version": ini.row_version}


def _detail(db: Session, cu: CurrentUser, ini: Initiative, role: str) -> dict:
    out = svc.card(db, ini)
    unit = db.get(OrgUnit, ini.org_unit_id) if ini.org_unit_id else None
    staff = role in ("STAFF", "REVIEWER")
    out.update({k: getattr(ini, k) for k in svc.EDITABLE if k != "content"})
    out.update({
        "content": ini.content or {}, "row_version": ini.row_version, "estimated_cost": ini.estimated_cost,
        "currency_code": ini.currency_code, "org_unit_id": ini.org_unit_id, "org_unit": en(unit.name_i18n) if unit else None,
        "sponsor": user_brief(db, ini.sponsor_user_id), "submitted_by": user_brief(db, ini.submitted_by_user_id),
        "on_behalf_of": user_brief(db, ini.on_behalf_of_user_id), "members": svc.members(db, ini),
        "my_role": role, "can_edit": role in ("OWNER", "MEMBER") and ini.current_state_code in ("DRAFT", "CLARIFICATION_REQUESTED"),
        "can_upload": role in ("OWNER", "MEMBER") or cu.privileged,
        "allowed_actions": svc.allowed_actions(db, cu, ini, role),
        "missing_fields": svc.missing_fields(ini) if ini.current_state_code == "DRAFT" else {},
        "is_published_to_catalogue": ini.is_published_to_catalogue,
        "confidential": ini.data_classification_code in ("CONFIDENTIAL", "RESTRICTED"),
        "can_manage": cu.privileged, "can_assign_judges": cu.has_role("SUPER_ADMIN"),
    })
    if ini.duplicate_of_id:
        original = db.get(Initiative, ini.duplicate_of_id)
        out["duplicate_of"] = {"code": original.code, "title": original.title} if original else None
    out["clarifications"] = [
        {"id": c.id, "question": c.question, "answer": c.answer, "status": c.status, "due_at": iso(c.due_at),
         "asked_at": iso(c.created_at), "answered_at": iso(c.answered_at),
         "asked_by": (user_brief(db, c.requested_by) or {}).get("full_name") if staff else "Reviewer"}
        for c in db.scalars(select(ClarificationRequest).where(ClarificationRequest.entity_type == "initiative",
                                                               ClarificationRequest.entity_id == ini.id)
                            .order_by(ClarificationRequest.created_at.desc())).all()]
    idea_rnd = db.scalar(select(ReviewRound).where(ReviewRound.round_type == "IDEA_REVIEW", ReviewRound.challenge_id.is_(None)))
    judge_comments = esvc.judge_comments(db, idea_rnd, "initiative", ini.id) if idea_rnd else {}
    judge_recs = esvc.judge_recommendations(db, idea_rnd, "initiative", ini.id) if idea_rnd else []
    out["feedback"] = [
        {"id": f.id, "decision_code": f.decision_code, "decision_reason": f.decision_reason, "strengths": f.strengths,
         "improvements": f.improvements, "next_steps": f.next_steps, "score_shared": f.score_shared,
         "judge_comments": judge_comments, "recommendations": judge_recs,
         "published_at": iso(f.published_at)}
        for f in db.scalars(select(Feedback).where(Feedback.entity_type == "initiative", Feedback.entity_id == ini.id,
                                                   Feedback.published_at.is_not(None)).order_by(Feedback.published_at.desc())).all()]
    if cu.privileged or cu.has_role("EXECUTIVE"):   # reviewer identities are for the innovation office only
        reviews = []
        for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.entity_type == "initiative",
                                                           ReviewAssignment.entity_id == ini.id)).all():
            s = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
            reviews.append({"id": a.id, "reviewer": (user_brief(db, a.reviewer_user_id) or {}).get("full_name"),
                            "status": a.status, "due_at": iso(a.due_at),
                            "weighted_score": s.weighted_score if s and a.status == "SUBMITTED" else None,
                            "recommendation": s.recommendation if s else None,
                            "strengths": s.strengths if s else None, "improvements": s.improvements if s else None})
        out["reviews"] = reviews
    return out


@router.get("/initiatives/{key}")
def get_initiative(key: str, request: Request, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ini, role = get_initiative_or_404(db, cu, key)
    if ini.data_classification_code in ("CONFIDENTIAL", "RESTRICTED") and role in ("STAFF", "REVIEWER"):
        audit(db, cu.id, "VIEW_CONFIDENTIAL", "initiative", ini.id, f"Viewed confidential idea {ini.code}", {},
              request.state.request_id)
        db.commit()
    return _detail(db, cu, ini, role)


@router.patch("/initiatives/{key}")
def update_initiative(key: str, body: IdeaIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    ini, role = get_initiative_or_404(db, cu, key)
    editable_by_owner = role in ("OWNER", "MEMBER") and ini.current_state_code in ("DRAFT", "CLARIFICATION_REQUESTED")
    if not editable_by_owner and not cu.privileged:
        raise DomainError("NOT_EDITABLE", "A submitted idea can't be edited. Ask the innovation office to return it to you.", 409)
    if body.row_version is not None and body.row_version != ini.row_version:
        raise DomainError("ROW_VERSION_CONFLICT", "Someone else changed this idea. Reload to see the latest version.", 409)
    _apply(db, ini, body, cu)
    if ini.current_state_code != "DRAFT":   # RB-03: edits after submission are versioned and audited
        count = len(db.scalars(select(InitiativeVersion.id).where(InitiativeVersion.initiative_id == ini.id)).all())
        db.add(InitiativeVersion(initiative_id=ini.id, version_no=count + 1, created_by=cu.id,
                                 snapshot=row(ini, exclude=("extra",)), reason="ADMIN_EDIT" if cu.privileged else "RESUBMIT_AFTER_CLARIFICATION"))
        audit(db, cu.id, "UPDATE", "initiative", ini.id, f"Edited {ini.code} after submission",
              {"fields": [None, sorted(body.model_dump(exclude_unset=True))]}, request.state.request_id)
    db.commit()
    return {"id": ini.id, "row_version": ini.row_version, "saved_at": iso(utcnow())}


@router.delete("/initiatives/{key}")
def delete_draft(key: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ini, role = get_initiative_or_404(db, cu, key)
    if role != "OWNER" or ini.current_state_code != "DRAFT":
        raise DomainError("ONLY_DRAFTS_CAN_BE_DELETED", "Only your own drafts can be deleted.", 409)
    ini.deleted_at = utcnow()
    db.commit()
    return {"ok": True}


@router.post("/initiatives/{key}/actions/submit")
def submit(key: str, request: Request, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """1 validate → 2 Innovation ID → 3 workflow event → 4 commit. Emails are sent afterwards by the outbox worker."""
    ini, role = get_initiative_or_404(db, cu, key)
    if role not in ("OWNER", "MEMBER") or ini.current_state_code != "DRAFT":
        raise DomainError("ACTION_NOT_ALLOWED", "Only a draft can be submitted.", 409)
    missing = svc.missing_fields(ini)
    if missing:
        raise DomainError("FORM_INCOMPLETE", "Some required fields are missing.", 422, {"fields": missing})
    now = utcnow()
    ini.code = next_code(db, "INNO", 6)       # RB-02: unique and never changed
    ini.current_state_code, ini.submitted_at, ini.current_stage_entered_at = "SUBMITTED", now, now
    db.add(InitiativeVersion(initiative_id=ini.id, version_no=1, snapshot=row(ini, exclude=("extra",)), reason="SUBMIT",
                             created_by=cu.id))
    record_history(db, "initiative", ini.id, "DRAFT", "SUBMITTED", "SUBMIT", cu.id)
    audit(db, cu.id, "CREATE", "initiative", ini.id, f"Submitted {ini.code}", {}, request.state.request_id)
    unit = db.get(OrgUnit, ini.org_unit_id) if ini.org_unit_id else None
    confidential = ini.data_classification_code in ("CONFIDENTIAL", "RESTRICTED")
    people = list(dict.fromkeys([ini.submitted_by_user_id, ini.owner_user_id]))
    variables = {"innovation_id": ini.code, "title": ini.title, "submitter": cu.user.full_name,
                 "owner": (user_brief(db, ini.owner_user_id) or {}).get("full_name"),
                 "function": en(unit.name_i18n) if unit else "", "status": "Submitted",
                 # Confidential details never go into an email body; the reader must sign in.
                 "summary": "Confidential — sign in to read the details." if confidential else (ini.summary or "")[:300],
                 "classification": ini.data_classification_code, "submitted_at": iso(now),
                 "review_sla": f"{setting(db, 'triage_sla_days', 5)} working days"}
    publish_event(db, "INITIATIVE_SUBMITTED", "initiative", ini.id, cu.id, users=people,
                  title=f"Idea submitted: {ini.code}", body="We'll check it and get back to you within 5 working days.",
                  link=f"/ideas/{ini.code}", vars=variables)
    # Second event: goes to the designated sponsor/reviewer mailbox configured in Admin (notification rules).
    office = _role_users(db, "PROGRAM_OWNER")
    publish_event(db, "INITIATIVE_NEEDS_REVIEW", "initiative", ini.id, cu.id, users=office,
                  title=f"New idea to triage: {ini.code}", body=ini.title, link=f"/ideas/{ini.code}", needs_action=True,
                  vars=variables)
    db.commit()
    return {"id": ini.id, "code": ini.code, "submitted_at": iso(now)}


def _role_users(db: Session, role_code: str) -> list[str]:
    from app.modules.identity.models import Role, UserRoleAssignment
    return list(db.scalars(select(UserRoleAssignment.user_id).join(Role, Role.id == UserRoleAssignment.role_id)
                           .where(Role.code == role_code)).all())


class ActionIn(BaseModel):
    comment: str | None = None
    duplicate_of: str | None = None


@router.post("/initiatives/{key}/actions/{action}")
def workflow_action(key: str, action: str, body: ActionIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    ini, role = get_initiative_or_404(db, cu, key)
    before = ini.current_state_code
    svc.transition(db, cu, ini, role, action.upper().replace("-", "_"), body.comment, body.duplicate_of)
    audit(db, cu.id, "UPDATE", "initiative", ini.id, f"{ini.code}: {before} → {ini.current_state_code}",
          {"state": [before, ini.current_state_code], "comment": [None, body.comment]}, request.state.request_id)
    db.commit()
    return {"current_state_code": ini.current_state_code}


@router.get("/initiatives/{key}/history")
def history(key: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ini, role = get_initiative_or_404(db, cu, key)
    cache: dict[str, Any] = {}
    staff = role in ("STAFF", "REVIEWER") or cu.privileged
    out = []
    for h in db.scalars(select(WorkflowHistory).where(WorkflowHistory.entity_type == "initiative",
                                                      WorkflowHistory.entity_id == ini.id)
                        .order_by(WorkflowHistory.occurred_at.desc())).all():
        actor = user_brief(db, h.actor_user_id, cache)
        mine = h.actor_user_id in (ini.owner_user_id, ini.submitted_by_user_id)
        out.append({"at": iso(h.occurred_at), "from_state": h.from_state, "to_state": h.to_state, "action_code": h.action_code,
                    "to_label": svc.state_label(db, h.to_state), "comment": h.comment,
                    # Owners don't see which reviewer acted; staff see the full trail.
                    "who": (actor or {}).get("full_name", "System") if staff or mine else "Innovation office"})
    return out


class AssignIn(BaseModel):
    user_ids: list[str]
    due_days: int = 10


@router.post("/initiatives/{key}/assign-reviewers")
def assign_reviewers(key: str, body: AssignIn, request: Request, cu: CurrentUser = Depends(require_roles("SUPER_ADMIN")),
                     db: Session = Depends(get_db)):
    """Older address, kept working. Only the admin chooses judges (see evaluation/judges_router.py)."""
    ini, _ = get_initiative_or_404(db, cu, key)
    rnd = db.scalar(select(ReviewRound).where(ReviewRound.round_type == "IDEA_REVIEW", ReviewRound.challenge_id.is_(None)))
    if not rnd:
        raise DomainError("ROUND_MISSING", "The open-idea review round is not configured.")
    created, blocked = 0, []
    for uid in body.user_ids:
        reason = esvc.conflict_reason(db, uid, "initiative", ini.id)
        name = (user_brief(db, uid) or {}).get("full_name")
        if reason:
            blocked.append({"reviewer": name, "reason": reason})
            continue
        if db.scalar(select(ReviewAssignment.id).where(ReviewAssignment.review_round_id == rnd.id,
                                                       ReviewAssignment.reviewer_user_id == uid,
                                                       ReviewAssignment.entity_id == ini.id)):
            continue
        due = utcnow() + timedelta(days=body.due_days)
        db.add(ReviewAssignment(review_round_id=rnd.id, reviewer_user_id=uid, entity_type="initiative", entity_id=ini.id,
                                status="ASSIGNED", due_at=due, reviewer_weight=1, created_by=cu.id))
        created += 1
        publish_event(db, "REVIEW_ASSIGNED", "initiative", ini.id, cu.id, users=[uid],
                      title=f"Review assigned: {ini.code}", body=ini.title, link="/review", needs_action=True,
                      vars={"entry_code": ini.code, "round": "Idea review", "due_date": iso(due)})
    audit(db, cu.id, "UPDATE", "initiative", ini.id, f"Assigned {created} reviewer(s) to {ini.code}", {}, request.state.request_id)
    db.commit()
    return {"created": created, "blocked": blocked}


class QuestionIn(BaseModel):
    question: str
    due_days: int = 5


@router.post("/initiatives/{key}/clarifications")
def ask(key: str, body: QuestionIn, cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    ini, _ = get_initiative_or_404(db, cu, key)
    if not body.question.strip():
        raise DomainError("QUESTION_REQUIRED", "Write your question.")
    if ini.current_state_code not in ("TRIAGE", "UNDER_REVIEW", "SUBMITTED", "CLARIFICATION_REQUESTED"):
        raise DomainError("ACTION_NOT_ALLOWED", "Questions can be asked during triage and review.", 409)
    c = ClarificationRequest(entity_type="initiative", entity_id=ini.id, requested_by=cu.id, question=body.question.strip(),
                             due_at=utcnow() + timedelta(days=body.due_days), status="OPEN",
                             resume_state=ini.current_state_code if ini.current_state_code != "CLARIFICATION_REQUESTED" else "UNDER_REVIEW")
    db.add(c)
    record_history(db, "initiative", ini.id, ini.current_state_code, "CLARIFICATION_REQUESTED", "REQUEST_CLARIFICATION", cu.id,
                   body.question)
    ini.current_state_code, ini.current_stage_entered_at = "CLARIFICATION_REQUESTED", utcnow()
    publish_event(db, "CLARIFICATION_REQUESTED", "initiative", ini.id, cu.id, users=esvc.people_of(db, "initiative", ini.id),
                  title=f"A reviewer asked a question: {ini.code}", body=body.question[:300], link=f"/ideas/{ini.code}",
                  needs_action=True, vars={"code": ini.code, "question": body.question, "due_date": iso(c.due_at)})
    db.commit()
    return {"id": c.id}


class PublishIn(BaseModel):
    asset_type: str = "PROCESS"
    impact_summary: str = ""


@router.post("/initiatives/{key}/catalogue")
def publish_to_catalogue(key: str, body: PublishIn, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                         db: Session = Depends(get_db)):
    """Only implemented or scaled, non-confidential ideas may be published."""
    ini, _ = get_initiative_or_404(db, cu, key)
    if ini.data_classification_code in ("CONFIDENTIAL", "RESTRICTED"):
        raise DomainError("CONFIDENTIAL_NOT_PUBLISHABLE", "Confidential ideas can't appear in the catalogue.", 409)
    if ini.current_state_code not in ("PRODUCTION", "IMPACT_VERIFIED", "SCALED"):
        raise DomainError("NOT_IMPLEMENTED_YET", "Only implemented or scaled ideas can be published.", 409)
    if ini.is_published_to_catalogue:
        raise DomainError("ALREADY_PUBLISHED", "This idea is already in the catalogue.", 409)
    ini.is_published_to_catalogue = True
    db.add(ReusableAsset(code=f"AST-{ini.code[5:]}", title=ini.title, description=ini.summary or ini.proposed_solution,
                         asset_type=body.asset_type, source_initiative_id=ini.id, owner_user_id=ini.owner_user_id,
                         maturity="PRODUCTION", technology=ini.technology_used, impact_summary=body.impact_summary,
                         reused_by=[], is_published=True, published_at=utcnow()))
    audit(db, cu.id, "UPDATE", "initiative", ini.id, f"Published {ini.code} to the catalogue", {}, request.state.request_id)
    publish_event(db, "ASSET_PUBLISHED", "initiative", ini.id, cu.id, users=[ini.owner_user_id],
                  title=f"{ini.code} is now in the innovation catalogue", body="Other teams can find and reuse it.",
                  link="/catalogue")
    db.commit()
    return {"ok": True}


# ---- Comments (polymorphic) ------------------------------------------------------------------------------
class CommentIn(BaseModel):
    entity_type: str
    entity_id: str
    body: str
    visibility: str = "PUBLIC_TO_TEAM"


@router.get("/comments")
def list_comments(entity_type: str, entity_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    check_entity_access(db, cu, entity_type, entity_id)
    panel = cu.sees_all
    out = []
    for c in db.scalars(select(Comment).where(Comment.entity_type == entity_type, Comment.entity_id == entity_id,
                                              Comment.deleted_at.is_(None)).order_by(Comment.created_at)).all():
        if c.visibility != "PUBLIC_TO_TEAM" and not panel:
            continue
        author = user_brief(db, c.created_by) or {}
        out.append({"id": c.id, "body": c.body, "visibility": c.visibility, "created_at": iso(c.created_at),
                    "author": author.get("full_name"), "is_mine": c.created_by == cu.id})
    return out


@router.post("/comments")
def add_comment(body: CommentIn, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    check_entity_access(db, cu, body.entity_type, body.entity_id)
    if not body.body.strip():
        raise DomainError("COMMENT_REQUIRED", "Write a comment.")
    visibility = body.visibility if cu.sees_all else "PUBLIC_TO_TEAM"
    c = Comment(entity_type=body.entity_type, entity_id=body.entity_id, body=body.body.strip(), visibility=visibility,
                created_by=cu.id)
    db.add(c)
    db.commit()
    return {"id": c.id}


# ---- Export (authorised, filtered, audited) ---------------------------------------------------------------
@router.get("/exports/initiatives")
def export_initiatives(request: Request, state: str = "", q: str = "",
                       cu: CurrentUser = Depends(require_roles("SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE")),
                       db: Session = Depends(get_db)):
    data = list_initiatives(scope="all", state=state, q=q, page=1, page_size=10000, cu=cu, db=db)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Innovation ID", "Title", "Status", "Category", "Organization", "Owner", "Classification", "Score", "Submitted"])
    for i in data["items"]:
        w.writerow([i["code"], i["title"], i["current_state_code"], en((i["category"] or {}).get("name_i18n")), i["org_unit"],
                    (i["owner"] or {}).get("full_name"), i["data_classification_code"], i["score_latest"], i["submitted_at"]])
    audit(db, cu.id, "EXPORT", "initiative", None, f"Exported {len(data['items'])} ideas to CSV",
          {"filters": [None, {"state": state, "q": q}]}, request.state.request_id)
    db.commit()
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=innovatex-ideas.csv"})
