"""Review queue, scoring workspace, round results, shortlist manager, feedback, clarifications and appeals."""
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit, publish_event, record_history
from app.core.permissions import CurrentUser, get_current_user, get_entry_or_404, is_entry_member, require_roles
from app.modules.challenges import service as csvc
from app.modules.challenges.models import Challenge, ChallengeEntry, EntrySubmission, SubmissionVersion, Team
from app.modules.evaluation import service as svc
from app.modules.evaluation.models import (Appeal, ConflictOfInterestDeclaration, Feedback, PanelMember,
                                           ReviewAssignment, ReviewRound, ReviewScore, ReviewSummary, RoundResult,
                                           Shortlist, ShortlistEntry)
from app.modules.initiatives.models import ClarificationRequest, Initiative
from app.modules.masterdata.router import form_definition, scorecard_definition
from app.shared.access import get_initiative_or_404
from app.shared import cache
from app.shared.models.base import iso, utcnow
from app.shared.util import en, setting, user_brief

router = APIRouter(tags=["evaluation"])
MANAGERS = ("SUPER_ADMIN", "PROGRAM_OWNER")
OVERSEERS = ("SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE")
ADMIN = ("SUPER_ADMIN",)        # only the admin chooses judges and shares entries among them (DMD counts as Super Admin)


def _entity_brief(db: Session, a: ReviewAssignment, rnd: ReviewRound, blind: bool) -> dict:
    if a.entity_type == "challenge_entry":
        entry = db.get(ChallengeEntry, a.entity_id)
        ch = db.get(Challenge, entry.challenge_id)
        team = db.get(Team, entry.team_id) if entry.team_id else None
        return {"type": "challenge_entry", "id": entry.id, "code": entry.anonymous_alias if blind else entry.code,
                "title": entry.title, "context": en(ch.title_i18n), "context_i18n": ch.title_i18n,
                "entrant": None if blind else (team.name if team else (user_brief(db, entry.lead_user_id) or {}).get("full_name")),
                "confidential": ch.data_classification_code in ("CONFIDENTIAL", "RESTRICTED")}
    ini = db.get(Initiative, a.entity_id)
    return {"type": "initiative", "id": ini.id, "code": ini.code, "title": ini.title, "context": "Open idea",
            "context_i18n": {"en": "Open idea", "bn": "উন্মুক্ত আইডিয়া"},
            "entrant": (user_brief(db, ini.owner_user_id) or {}).get("full_name"),
            "confidential": ini.data_classification_code in ("CONFIDENTIAL", "RESTRICTED")}


# ---- Review queue ------------------------------------------------------------------------
@router.get("/me/review-queue")
def review_queue(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Everything the signed-in person was chosen to judge. No role is needed: being chosen is enough."""
    now = utcnow()
    items = []
    cache.preload(db, ReviewRound, ChallengeEntry, Challenge, Team, Initiative)   # db.get() below is then free
    for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.reviewer_user_id == cu.id,
                                                       ReviewAssignment.status != "DECLINED_COI")
                        .order_by(ReviewAssignment.due_at)).all():
        rnd = db.get(ReviewRound, a.review_round_id)
        brief = _entity_brief(db, a, rnd, False)
        overdue_days = (now - a.due_at).days + 1 if a.due_at and a.due_at < now and a.status != "SUBMITTED" else 0
        items.append({"id": a.id, "status": a.status, "due_at": iso(a.due_at), "submitted_at": iso(a.submitted_at),
                      "round_type": rnd.round_type, "round_name": en(rnd.name_i18n), "blind": False,
                      "entity": brief, "overdue_days": overdue_days})
    from app.modules.evaluation.gates import my_queue_items
    items += my_queue_items(db, cu.id)     # prototype and pilot reviews: a decision, not a score
    week = now + timedelta(days=7)
    open_items = [i for i in items if i["status"] != "SUBMITTED"]
    summary = {
        "due_today": sum(1 for a in open_items if a["due_at"] and now.date().isoformat() == a["due_at"][:10]),
        "due_this_week": sum(1 for a in open_items if a["due_at"] and now.isoformat() <= a["due_at"] <= week.isoformat()),
        "overdue": sum(1 for a in open_items if a["overdue_days"] > 0),
        "done": sum(1 for a in items if a["status"] == "SUBMITTED"), "open": len(open_items),
    }
    items.sort(key=lambda i: (i["status"] == "SUBMITTED", i["due_at"] or "9"))
    return {"items": items, "total": len(items), "page": 1, "summary": summary}


def _assignment_or_404(db: Session, cu: CurrentUser, assignment_id: str, own_only: bool = False) -> ReviewAssignment:
    a = db.get(ReviewAssignment, assignment_id)
    if not a or (a.reviewer_user_id != cu.id and (own_only or not cu.privileged)):
        raise not_found("Review")   # judges can open only their own assignments
    return a


def _live_total(db: Session, a: ReviewAssignment, rnd: ReviewRound) -> float:
    criteria = svc.criteria_of(db, rnd.scorecard_id)
    given = {cid: s.rating for cid, s in svc.ratings_of(db, a.id).items() if s.rating is not None}
    return svc.weighted_score(given, criteria, svc.max_rating(db, rnd.scorecard_id))


@router.get("/review-assignments/{assignment_id}")
def workspace(assignment_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.modules.initiatives.service import initiative_as_form
    a = _assignment_or_404(db, cu, assignment_id)
    rnd = db.get(ReviewRound, a.review_round_id)
    blind = False   # judges see who submitted
    entity = _entity_brief(db, a, rnd, blind)
    if a.entity_type == "challenge_entry":
        version = db.get(SubmissionVersion, a.submission_version_id) if a.submission_version_id else None
        if not version:
            vid = svc.latest_version_id(db, a.entity_id, rnd.round_type)
            version = db.get(SubmissionVersion, vid) if vid else None
        sub = db.get(EntrySubmission, version.entry_submission_id) if version else None
        submission = {"form": form_definition(db, sub.form_template_id) if sub else None,
                      "content": version.content if version else {}, "version_no": version.version_no if version else 0,
                      "submitted_at": iso(version.submitted_at) if version else None}
    else:
        ini = db.get(Initiative, a.entity_id)
        form, content = initiative_as_form(db, ini)
        submission = {"form": form, "content": content, "version_no": 1, "submitted_at": iso(ini.submitted_at)}
    scores = svc.ratings_of(db, a.id)
    summary = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
    if a.status == "ASSIGNED" and a.reviewer_user_id == cu.id:
        a.status, a.started_at = "IN_PROGRESS", utcnow()
        db.commit()
    clar = db.scalars(select(ClarificationRequest).where(ClarificationRequest.entity_type == a.entity_type,
                                                         ClarificationRequest.entity_id == a.entity_id)
                      .order_by(ClarificationRequest.created_at.desc())).all()
    return {
        "id": a.id, "status": a.status, "due_at": iso(a.due_at), "submitted_at": iso(a.submitted_at),
        "round": {"id": rnd.id, "name": en(rnd.name_i18n), "round_type": rnd.round_type, "blind": blind},
        "entity": entity, "submission": submission,
        "attachment_entity": {"entity_type": a.entity_type, "entity_id": a.entity_id},
        "scorecard": scorecard_definition(db, rnd.scorecard_id),
        "scores": [{"criterion_id": cid, "rating": s.rating, "comment": s.comment} for cid, s in scores.items()],
        "summary": {"recommendation": summary.recommendation if summary else None,
                    "strengths": summary.strengths if summary else "", "improvements": summary.improvements if summary else "",
                    "private_note": summary.private_note if summary else ""},
        "weighted_score": summary.weighted_score if summary and a.status == "SUBMITTED" else _live_total(db, a, rnd),
        "read_only": a.status == "SUBMITTED" or a.reviewer_user_id != cu.id,
        "blind_note": "Names in attachments may be visible — score only the content." if blind else None,
        "clarifications": [{"id": c.id, "question": c.question, "answer": c.answer, "status": c.status,
                            "asked_at": iso(c.created_at), "answered_at": iso(c.answered_at)} for c in clar],
    }


class ScoreIn(BaseModel):
    criterion_id: str
    rating: float | None = None
    comment: str | None = None


class ReviewIn(BaseModel):
    scores: list[ScoreIn] = []
    recommendation: str | None = None
    strengths: str | None = None
    improvements: str | None = None
    private_note: str | None = None


def _save_review(db: Session, a: ReviewAssignment, rnd: ReviewRound, body: ReviewIn) -> ReviewSummary:
    criteria = {c.id: c for c in svc.criteria_of(db, rnd.scorecard_id)}
    top = svc.max_rating(db, rnd.scorecard_id)
    existing = svc.ratings_of(db, a.id)
    for s in body.scores:
        if s.criterion_id not in criteria:
            continue
        if s.rating is not None and not (1 <= s.rating <= top):
            raise DomainError("RATING_OUT_OF_RANGE", f"Ratings must be between 1 and {top:g}.")
        row_ = existing.get(s.criterion_id) or ReviewScore(review_assignment_id=a.id, scorecard_criterion_id=s.criterion_id)
        row_.rating, row_.comment = s.rating, s.comment
        db.add(row_)
        existing[s.criterion_id] = row_
    summary = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id)) or \
        ReviewSummary(review_assignment_id=a.id)
    for key in ("recommendation", "strengths", "improvements", "private_note"):
        if getattr(body, key) is not None:
            setattr(summary, key, getattr(body, key))
    given = {cid: s.rating for cid, s in existing.items() if s.rating is not None}
    summary.weighted_score = svc.weighted_score(given, list(criteria.values()), top)   # the server calculates the score
    db.add(summary)
    if a.status == "ASSIGNED":
        a.status, a.started_at = "IN_PROGRESS", utcnow()
    db.flush()
    return summary


@router.put("/review-assignments/{assignment_id}/scores")
def save_scores(assignment_id: str, body: ReviewIn, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    a = _assignment_or_404(db, cu, assignment_id, own_only=True)
    if a.status == "SUBMITTED":
        raise DomainError("REVIEW_ALREADY_SUBMITTED", "This review was submitted and is read only.", 409)
    rnd = db.get(ReviewRound, a.review_round_id)
    summary = _save_review(db, a, rnd, body)
    db.commit()
    return {"weighted_score": summary.weighted_score, "status": a.status, "saved_at": iso(utcnow())}


@router.post("/review-assignments/{assignment_id}/actions/submit")
def submit_review(assignment_id: str, body: ReviewIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    a = _assignment_or_404(db, cu, assignment_id, own_only=True)
    if a.status == "SUBMITTED":
        raise DomainError("REVIEW_ALREADY_SUBMITTED", "This review was submitted and is read only.", 409)
    if svc.conflict_reason(db, cu.id, a.entity_type, a.entity_id):
        raise DomainError("CONFLICT_OF_INTEREST", "You can't score this entry because of a conflict of interest.")
    rnd = db.get(ReviewRound, a.review_round_id)
    summary = _save_review(db, a, rnd, body)
    scores = svc.ratings_of(db, a.id)
    errors = {}
    for c in svc.criteria_of(db, rnd.scorecard_id):
        s = scores.get(c.id)
        if not s or s.rating is None:
            errors[c.id] = "Give a rating."
        elif s.rating in (c.comment_required_at or []) and not (s.comment or "").strip():
            errors[c.id] = f"A comment is required for a rating of {s.rating:g}."
    if not (summary.strengths or "").strip():
        errors["strengths"] = "Write at least one strength. It is shared with the entrant."
    if not (summary.improvements or "").strip():
        errors["improvements"] = "Write at least one improvement. It is shared with the entrant."
    if not summary.recommendation:
        errors["recommendation"] = "Choose a recommendation."
    if errors:
        db.commit()   # keep the draft
        raise DomainError("REVIEW_INCOMPLETE", "Finish the scorecard before submitting.", 422, {"fields": errors})
    a.status, a.submitted_at = "SUBMITTED", utcnow()
    db.flush()
    results = svc.calculate_round(db, rnd)
    audit(db, cu.id, "SCORE_CHANGE", a.entity_type, a.entity_id, f"Review submitted (score {summary.weighted_score})",
          {"weighted_score": [None, summary.weighted_score]}, request.state.request_id)
    mine = next((r for r in results if r.entity_id == a.entity_id), None)
    owner = None
    if rnd.challenge_id:
        owner = db.get(Challenge, rnd.challenge_id).program_owner_user_id
    if mine and mine.needs_discussion and owner:
        publish_event(db, "SCORE_DISAGREEMENT_FOUND", a.entity_type, a.entity_id, cu.id, users=[owner],
                      title="Judges disagree on an entry", body="Open the round results to resolve it before shortlisting.",
                      link=f"/manage/challenges/{rnd.challenge_id}/rounds/{rnd.id}", needs_action=True)
    pending = db.scalar(select(func.count()).select_from(ReviewAssignment).where(
        ReviewAssignment.review_round_id == rnd.id, ReviewAssignment.status.in_(["ASSIGNED", "IN_PROGRESS"])))
    if not pending and owner:
        publish_event(db, "ROUND_COMPLETED", "review_round", rnd.id, cu.id, users=[owner],
                      title=f"All reviews are in: {en(rnd.name_i18n)}", body="You can now look at the results and propose the shortlist.",
                      link=f"/manage/challenges/{rnd.challenge_id}/rounds/{rnd.id}", needs_action=True)
    else:
        publish_event(db, "REVIEW_SUBMITTED", a.entity_type, a.entity_id, cu.id)
    db.commit()
    return {"status": a.status, "weighted_score": summary.weighted_score}


class ConflictIn(BaseModel):
    reason: str = "OTHER"
    note: str = ""


@router.post("/review-assignments/{assignment_id}/actions/declare-conflict")
def declare_conflict(assignment_id: str, body: ConflictIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    a = _assignment_or_404(db, cu, assignment_id, own_only=True)
    if a.status == "SUBMITTED":
        raise DomainError("REVIEW_ALREADY_SUBMITTED", "This review was already submitted.", 409)
    rnd = db.get(ReviewRound, a.review_round_id)
    a.status = "DECLINED_COI"
    db.add(ConflictOfInterestDeclaration(review_round_id=rnd.id, reviewer_user_id=cu.id, entity_type=a.entity_type,
                                         entity_id=a.entity_id, source="SELF_DECLARED", reason=body.reason, note=body.note))
    db.flush()
    # Reassign to the least-loaded panel member with no conflict.
    replacement = None
    if rnd.panel_id:
        taken = set(db.scalars(select(ReviewAssignment.reviewer_user_id).where(
            ReviewAssignment.review_round_id == rnd.id, ReviewAssignment.entity_id == a.entity_id)).all())
        candidates = []
        for m in db.scalars(select(PanelMember).where(PanelMember.panel_id == rnd.panel_id)).all():
            if m.stages and rnd.round_type not in m.stages:
                continue
            if m.user_id in taken or svc.conflict_reason(db, m.user_id, a.entity_type, a.entity_id):
                continue
            load = db.scalar(select(func.count()).select_from(ReviewAssignment).where(
                ReviewAssignment.review_round_id == rnd.id, ReviewAssignment.reviewer_user_id == m.user_id))
            candidates.append((load, m.user_id))
        if candidates:
            replacement = min(candidates)[1]
            db.add(ReviewAssignment(review_round_id=rnd.id, reviewer_user_id=replacement, entity_type=a.entity_type,
                                    entity_id=a.entity_id, status="ASSIGNED", due_at=a.due_at, reviewer_weight=1,
                                    submission_version_id=a.submission_version_id))
            publish_event(db, "REVIEW_ASSIGNED", a.entity_type, a.entity_id, cu.id, users=[replacement],
                          title="Review assigned", body=f"{en(rnd.name_i18n)}: a review was reassigned to you.",
                          link="/review", needs_action=True)
    audit(db, cu.id, "UPDATE", "review_assignment", a.id, f"Declared a conflict of interest ({body.reason})", {},
          request.state.request_id)
    svc.calculate_round(db, rnd)
    db.commit()
    return {"reassigned": bool(replacement)}


# ---- Clarifications (review clock pauses until the owner answers) ---------------------------------
class QuestionIn(BaseModel):
    question: str
    due_days: int = 5


@router.post("/review-assignments/{assignment_id}/clarification")
def ask_clarification(assignment_id: str, body: QuestionIn, cu: CurrentUser = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    a = _assignment_or_404(db, cu, assignment_id, own_only=True)
    if not body.question.strip():
        raise DomainError("QUESTION_REQUIRED", "Write your question.")
    c = ClarificationRequest(entity_type=a.entity_type, entity_id=a.entity_id, requested_by=cu.id,
                             question=body.question.strip(), due_at=utcnow() + timedelta(days=body.due_days), status="OPEN")
    if a.entity_type == "challenge_entry":
        entry = db.get(ChallengeEntry, a.entity_id)
        c.resume_state = entry.status_code if entry.status_code != "CLARIFICATION_REQUESTED" else "UNDER_REVIEW"
        record_history(db, "challenge_entry", entry.id, entry.status_code, "CLARIFICATION_REQUESTED", "REQUEST_CLARIFICATION", cu.id)
        entry.status_code = "CLARIFICATION_REQUESTED"
        people, link, code = csvc.notify_entry(db, entry), f"/entries/{entry.id}", entry.code
    else:
        ini = db.get(Initiative, a.entity_id)
        c.resume_state = ini.current_state_code if ini.current_state_code != "CLARIFICATION_REQUESTED" else "UNDER_REVIEW"
        record_history(db, "initiative", ini.id, ini.current_state_code, "CLARIFICATION_REQUESTED", "REQUEST_CLARIFICATION", cu.id)
        ini.current_state_code, ini.current_stage_entered_at = "CLARIFICATION_REQUESTED", utcnow()
        people, link, code = svc.people_of(db, "initiative", ini.id), f"/ideas/{ini.code}", ini.code
    db.add(c)
    publish_event(db, "CLARIFICATION_REQUESTED", a.entity_type, a.entity_id, cu.id, users=people,
                  title=f"The panel asked a question: {code}", body=body.question[:300], link=link, needs_action=True,
                  vars={"code": code, "question": body.question, "due_date": iso(c.due_at)})
    db.commit()
    return {"id": c.id}


class AnswerIn(BaseModel):
    answer: str


@router.post("/clarifications/{clarification_id}/answer")
def answer_clarification(clarification_id: str, body: AnswerIn, cu: CurrentUser = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    c = db.get(ClarificationRequest, clarification_id)
    if not c or c.status != "OPEN":
        raise not_found("Question")
    if not body.answer.strip():
        raise DomainError("ANSWER_REQUIRED", "Write your reply.")
    if c.entity_type == "challenge_entry":
        entry = get_entry_or_404(db, cu, c.entity_id, members_only=True)
        still_open = db.scalar(select(func.count()).select_from(ClarificationRequest).where(
            ClarificationRequest.entity_type == "challenge_entry", ClarificationRequest.entity_id == entry.id,
            ClarificationRequest.status == "OPEN", ClarificationRequest.id != c.id))
        if entry.status_code == "CLARIFICATION_REQUESTED" and not still_open:
            record_history(db, "challenge_entry", entry.id, entry.status_code, c.resume_state or "UNDER_REVIEW",
                           "ANSWER_CLARIFICATION", cu.id)
            entry.status_code = c.resume_state or "UNDER_REVIEW"
        code, link = entry.code, "/review"
    else:
        ini, role = get_initiative_or_404(db, cu, c.entity_id)
        if role not in ("OWNER", "MEMBER"):
            raise not_found("Question")
        if ini.current_state_code == "CLARIFICATION_REQUESTED":
            record_history(db, "initiative", ini.id, ini.current_state_code, c.resume_state or "UNDER_REVIEW",
                           "ANSWER_CLARIFICATION", cu.id)
            ini.current_state_code, ini.current_stage_entered_at = c.resume_state or "UNDER_REVIEW", utcnow()
        code, link = ini.code, f"/ideas/{ini.code}"
    c.answer, c.answered_by, c.answered_at, c.status = body.answer.strip(), cu.id, utcnow(), "ANSWERED"
    publish_event(db, "CLARIFICATION_ANSWERED", c.entity_type, c.entity_id, cu.id, users=[c.requested_by],
                  title=f"Reply received: {code}", body=body.answer[:300], link=link, needs_action=True,
                  vars={"code": code})
    db.commit()
    return {"ok": True}


# ---- Rounds: assign, results, discussion --------------------------------------------------------------
def _round_or_404(db: Session, round_id: str) -> ReviewRound:
    rnd = db.get(ReviewRound, round_id)
    if not rnd:
        raise not_found("Review round")
    return rnd


@router.post("/review-rounds/{round_id}/actions/assign")
def assign(round_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)), db: Session = Depends(get_db)):
    rnd = _round_or_404(db, round_id)
    ch = db.get(Challenge, rnd.challenge_id)
    csvc.sync_challenge(db, ch)
    result = svc.auto_assign(db, rnd, cu.id)
    svc.calculate_round(db, rnd)
    audit(db, cu.id, "UPDATE", "review_round", rnd.id, f"Auto-assigned judges ({result['created']} reviews)", {},
          request.state.request_id)
    db.commit()
    return result


@router.post("/review-rounds/{round_id}/actions/remind")
def remind(round_id: str, cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    rnd = _round_or_404(db, round_id)
    pending = db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == rnd.id,
                                                        ReviewAssignment.status.in_(["ASSIGNED", "IN_PROGRESS"]))).all()
    judges = list({a.reviewer_user_id for a in pending})
    if judges:
        publish_event(db, "REVIEW_DUE_SOON", "review_round", rnd.id, cu.id, users=judges,
                      title=f"Reminder: reviews due for {en(rnd.name_i18n)}", body="Please finish your assigned reviews.",
                      link="/review", needs_action=True, vars={"round": en(rnd.name_i18n), "due_date": iso(rnd.due_at)})
    db.commit()
    return {"reminded": len(judges)}


@router.get("/review-rounds/{round_id}/results")
def round_results(round_id: str, cu: CurrentUser = Depends(require_roles(*OVERSEERS)), db: Session = Depends(get_db)):
    rnd = _round_or_404(db, round_id)
    ch = db.get(Challenge, rnd.challenge_id) if rnd.challenge_id else None
    results = svc.calculate_round(db, rnd)
    db.commit()
    criteria = svc.criteria_of(db, rnd.scorecard_id)
    by_id = {c.id: c for c in criteria}
    rule = svc.default_rule(db, rnd)
    rows = []
    for r in sorted(results, key=lambda r: (r.rank is None, r.rank or 0)):
        entry = db.get(ChallengeEntry, r.entity_id) if r.entity_type == "challenge_entry" else None
        team = db.get(Team, entry.team_id) if entry and entry.team_id else None
        reviews = []
        for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == rnd.id,
                                                           ReviewAssignment.entity_id == r.entity_id,
                                                           ReviewAssignment.status != "DECLINED_COI")).all():
            summary = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
            ratings = svc.ratings_of(db, a.id)
            reviews.append({"reviewer": (user_brief(db, a.reviewer_user_id) or {}).get("full_name"), "status": a.status,
                            "weighted_score": summary.weighted_score if summary and a.status == "SUBMITTED" else None,
                            "recommendation": summary.recommendation if summary else None,
                            "private_note": summary.private_note if summary else None,
                            "ratings": {by_id[cid].code: s.rating for cid, s in ratings.items()
                                        if cid in by_id} if a.status == "SUBMITTED" else {},
                            "comments": {by_id[cid].code: s.comment for cid, s in ratings.items()
                                         if cid in by_id and (s.comment or "").strip()} if a.status == "SUBMITTED" else {}})
        rows.append({"id": r.id, "rank": r.rank, "entity_id": r.entity_id,
                     "entry": {"id": entry.id, "code": entry.code, "title": entry.title, "status_code": entry.status_code,
                               "entrant": team.name if team else (user_brief(db, entry.lead_user_id) or {}).get("full_name")} if entry else None,
                     "final_score": r.final_score, "raw_score": r.raw_score, "normalized_score": r.normalized_score,
                     "criterion_averages": r.criterion_averages or {}, "reviews_expected": r.reviews_expected,
                     "reviews_completed": r.reviews_completed, "failed_gates": r.failed_gates or [],
                     "needs_discussion": r.needs_discussion, "disagreement_criteria": r.disagreement_criteria or [],
                     "discussion_resolved": r.discussion_resolved, "discussion_resolution": r.discussion_resolution,
                     "discussion_note": r.discussion_note, "is_frozen": r.is_frozen, "reviews": reviews})
    shortlist = db.scalar(select(Shortlist).where(Shortlist.review_round_id == rnd.id).order_by(Shortlist.created_at.desc()))
    blockers = svc.propose_blockers(db, rnd, results, rule)
    if shortlist and shortlist.status in ("CONFIRMED", "PUBLISHED"):
        blockers = ["The shortlist for this round is already confirmed."]
    return {
        "round": {"id": rnd.id, "name": en(rnd.name_i18n), "round_type": rnd.round_type, "status": rnd.status,
                  "aggregation_method": rnd.aggregation_method, "normalize_scores": rnd.normalize_scores,
                  "disagreement_threshold": rnd.disagreement_threshold, "due_at": iso(rnd.due_at),
                  "show_scores_to_entrants": rnd.show_scores_to_entrants},
        "challenge": {"id": ch.id, "title_i18n": ch.title_i18n, "slug": ch.slug, "prototype_policy": ch.prototype_policy} if ch else None,
        "criteria": [{"code": c.code, "name": en(c.name_i18n), "weight_pct": c.weight_pct, "min_rating": c.min_rating} for c in criteria],
        "rule": {"text": svc.rule_text(rule), "method": rule.method, "top_n": rule.top_n, "min_score": rule.min_score,
                 "waitlist_size": rule.waitlist_size},
        "results": rows, "can_propose": cu.privileged and not blockers and rnd.round_type != "FINAL_JURY",
        "propose_blockers": blockers,
        "shortlist": {"id": shortlist.id, "status": shortlist.status} if shortlist else None,
        "can_manage": cu.privileged,
    }


class ResolveIn(BaseModel):
    resolution: str = "SCORES_KEPT"   # SCORES_KEPT, SCORES_UPDATED, CHAIR_DECISION
    note: str


@router.post("/round-results/{result_id}/resolve-discussion")
def resolve_discussion(result_id: str, body: ResolveIn, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                       db: Session = Depends(get_db)):
    res = db.get(RoundResult, result_id)
    if not res:
        raise not_found("Result")
    if not body.note.strip():
        raise DomainError("NOTE_REQUIRED", "Record how the disagreement was resolved.")
    res.discussion_resolved, res.needs_discussion = True, False
    res.discussion_resolution, res.discussion_note = body.resolution, body.note.strip()
    audit(db, cu.id, "OVERRIDE", res.entity_type, res.entity_id, f"Resolved judge disagreement: {body.resolution}",
          {"note": [None, body.note]}, request.state.request_id)
    db.commit()
    return {"ok": True}


# ---- Shortlist ----------------------------------------------------------------------------------------
@router.post("/review-rounds/{round_id}/shortlist/actions/propose")
def propose(round_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    rnd = _round_or_404(db, round_id)
    shortlist = svc.propose_shortlist(db, rnd, cu.id)
    audit(db, cu.id, "CREATE", "shortlist", shortlist.id, f"Proposed shortlist ({shortlist.rule_snapshot.get('text')})", {},
          request.state.request_id)
    db.commit()
    return {"id": shortlist.id, "status": shortlist.status}


def _shortlist_or_404(db: Session, shortlist_id: str) -> tuple[Shortlist, ReviewRound]:
    shortlist = db.get(Shortlist, shortlist_id)
    if not shortlist:
        raise not_found("Shortlist")
    return shortlist, db.get(ReviewRound, shortlist.review_round_id)


@router.get("/shortlists/{shortlist_id}")
def get_shortlist(shortlist_id: str, cu: CurrentUser = Depends(require_roles(*OVERSEERS)), db: Session = Depends(get_db)):
    shortlist, rnd = _shortlist_or_404(db, shortlist_id)
    ch = db.get(Challenge, rnd.challenge_id)
    rows, counts, missing_feedback = [], {"IN": 0, "WAITLIST": 0, "OUT": 0}, 0
    for se in db.scalars(select(ShortlistEntry).where(ShortlistEntry.shortlist_id == shortlist.id).order_by(ShortlistEntry.rank)).all():
        entry = db.get(ChallengeEntry, se.entity_id)
        team = db.get(Team, entry.team_id) if entry.team_id else None
        fb = db.scalar(select(Feedback).where(Feedback.review_round_id == rnd.id, Feedback.entity_id == entry.id))
        has_feedback = bool(fb and (fb.strengths or "").strip() and (fb.improvements or "").strip())
        missing_feedback += not has_feedback
        counts[se.final_decision] += 1
        rows.append({"id": se.id, "rank": se.rank, "final_score": se.final_score, "system_decision": se.system_decision,
                     "final_decision": se.final_decision, "is_override": se.is_override, "override_reason": se.override_reason,
                     "prototype_required": se.prototype_required, "prototype_reason": se.prototype_reason,
                     "has_feedback": has_feedback, "feedback_id": fb.id if fb else None,
                     "entry": {"id": entry.id, "code": entry.code, "title": entry.title, "status_code": entry.status_code,
                               "entrant": team.name if team else (user_brief(db, entry.lead_user_id) or {}).get("full_name")}})
    return {"id": shortlist.id, "status": shortlist.status, "shortlist_type": shortlist.shortlist_type,
            "rule": shortlist.rule_snapshot, "generated_at": iso(shortlist.generated_at),
            "confirmed_at": iso(shortlist.confirmed_at), "published_at": iso(shortlist.published_at),
            "confirmed_by": (user_brief(db, shortlist.confirmed_by) or {}).get("full_name"),
            "round": {"id": rnd.id, "name": en(rnd.name_i18n), "round_type": rnd.round_type},
            "challenge": {"id": ch.id, "title_i18n": ch.title_i18n, "prototype_policy": ch.prototype_policy},
            "prototype_editable": ch.prototype_policy == "PANEL_DECIDES" and rnd.round_type == "METHODOLOGY",
            "counts": counts, "missing_feedback": missing_feedback, "entries": rows, "can_manage": cu.privileged}


class ShortlistEntryIn(BaseModel):
    final_decision: str | None = None
    override_reason: str | None = None
    prototype_required: bool | None = None
    prototype_reason: str | None = None


@router.patch("/shortlists/{shortlist_id}/entries/{entry_row_id}")
def override_entry(shortlist_id: str, entry_row_id: str, body: ShortlistEntryIn, request: Request,
                   cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    shortlist, rnd = _shortlist_or_404(db, shortlist_id)
    if shortlist.status != "PROPOSED":
        raise DomainError("SHORTLIST_LOCKED", "A confirmed shortlist can't be changed.", 409)
    se = db.get(ShortlistEntry, entry_row_id)
    if not se or se.shortlist_id != shortlist.id:
        raise not_found("Entry")
    entry = db.get(ChallengeEntry, se.entity_id)
    if body.final_decision:
        if body.final_decision not in ("IN", "WAITLIST", "OUT"):
            raise DomainError("INVALID_DECISION", "Choose In, Waitlist or Out.")
        is_override = body.final_decision != se.system_decision
        if is_override and not (body.override_reason or "").strip():
            raise DomainError("OVERRIDE_REASON_REQUIRED", "Give a reason for changing the system's decision.")
        before = se.final_decision
        se.final_decision, se.is_override = body.final_decision, is_override
        se.override_reason = body.override_reason.strip() if is_override else None
        if se.final_decision != "IN":
            se.prototype_required = False
        audit(db, cu.id, "OVERRIDE", "challenge_entry", entry.id,
              f"Shortlist decision for {entry.code}: {before} → {se.final_decision}",
              {"final_decision": [before, se.final_decision], "reason": [None, se.override_reason]}, request.state.request_id)
    if body.prototype_required is not None:
        if se.final_decision != "IN" and body.prototype_required:
            raise DomainError("NOT_SHORTLISTED", "Only shortlisted entries can be asked for a prototype.")
        se.prototype_required, se.prototype_reason = body.prototype_required, body.prototype_reason
        audit(db, cu.id, "UPDATE", "challenge_entry", entry.id,
              f"Prototype {'required' if body.prototype_required else 'not required'} for {entry.code}", {},
              request.state.request_id)
    db.commit()
    return {"ok": True}


@router.post("/shortlists/{shortlist_id}/actions/{action}")
def shortlist_action(shortlist_id: str, action: str, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                     db: Session = Depends(get_db)):
    shortlist, rnd = _shortlist_or_404(db, shortlist_id)
    if action == "confirm":   # a human always confirms; this locks scores and decisions
        if shortlist.status != "PROPOSED":
            raise DomainError("SHORTLIST_LOCKED", "This shortlist is already confirmed.", 409)
        shortlist.status, shortlist.confirmed_by, shortlist.confirmed_at = "CONFIRMED", cu.id, utcnow()
        for r in db.scalars(select(RoundResult).where(RoundResult.review_round_id == rnd.id)).all():
            r.is_frozen = True
        rnd.status = "COMPLETED"
        audit(db, cu.id, "UPDATE", "shortlist", shortlist.id, "Confirmed shortlist", {"status": ["PROPOSED", "CONFIRMED"]},
              request.state.request_id)
        publish_event(db, "SHORTLIST_CONFIRMED", "review_round", rnd.id, cu.id)
    elif action == "publish":
        if shortlist.status != "CONFIRMED":
            raise DomainError("SHORTLIST_NOT_CONFIRMED", "Confirm the shortlist before publishing results to entrants.", 409)
        missing = 0
        for se in db.scalars(select(ShortlistEntry).where(ShortlistEntry.shortlist_id == shortlist.id)).all():
            fb = db.scalar(select(Feedback).where(Feedback.review_round_id == rnd.id, Feedback.entity_id == se.entity_id))
            missing += not (fb and (fb.strengths or "").strip() and (fb.improvements or "").strip())
        if missing:
            raise DomainError("FEEDBACK_MISSING", f"Feedback is missing for {missing} entr{'y' if missing == 1 else 'ies'}. "
                                                  "Every entry gets written feedback.", 409)
        counts = svc.publish_shortlist(db, shortlist, rnd, cu.id)
        audit(db, cu.id, "UPDATE", "shortlist", shortlist.id, f"Published shortlist results to entrants ({counts})", {},
              request.state.request_id)
    elif action == "rerun":
        if shortlist.status != "PROPOSED":
            raise DomainError("SHORTLIST_LOCKED", "A confirmed shortlist can't be re-run.", 409)
        new = svc.propose_shortlist(db, rnd, cu.id)
        db.commit()
        return {"id": new.id, "status": new.status}
    else:
        raise not_found("Action")
    db.commit()
    return {"id": shortlist.id, "status": shortlist.status}


# ---- Feedback ---------------------------------------------------------------------------------------------
@router.get("/review-rounds/{round_id}/feedback")
def feedback_composer(round_id: str, cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    rnd = _round_or_404(db, round_id)
    svc.calculate_round(db, rnd)
    svc.ensure_feedback_drafts(db, rnd, cu.id)
    db.commit()
    out = []
    for fb in db.scalars(select(Feedback).where(Feedback.review_round_id == rnd.id)).all():
        entry = db.get(ChallengeEntry, fb.entity_id)
        if not entry:
            continue
        out.append({"id": fb.id, "entry": {"id": entry.id, "code": entry.code, "title": entry.title, "status_code": entry.status_code},
                    "strengths": fb.strengths, "improvements": fb.improvements, "decision_reason": fb.decision_reason,
                    "next_steps": fb.next_steps, "score_shared": fb.score_shared, "published_at": iso(fb.published_at),
                    "read_at": iso(fb.read_at), "complete": bool((fb.strengths or "").strip() and (fb.improvements or "").strip())})
    out.sort(key=lambda f: f["entry"]["code"])
    return {"round": {"id": rnd.id, "name": en(rnd.name_i18n)}, "items": out}


class FeedbackIn(BaseModel):
    strengths: str = ""
    improvements: str = ""
    decision_reason: str | None = None
    next_steps: str | None = None


@router.put("/feedback/{feedback_id}")
def save_feedback(feedback_id: str, body: FeedbackIn, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                  db: Session = Depends(get_db)):
    fb = db.get(Feedback, feedback_id)
    if not fb:
        raise not_found("Feedback")
    fb.strengths, fb.improvements = body.strengths, body.improvements
    fb.decision_reason, fb.next_steps, fb.written_by = body.decision_reason, body.next_steps, cu.id
    audit(db, cu.id, "UPDATE", fb.entity_type, fb.entity_id, "Edited feedback", {}, request.state.request_id)
    db.commit()
    return {"ok": True}


@router.get("/entries/{entry_id}/feedback")
def entry_feedback(entry_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """What the entrant sees: decision, strengths, improvements, next steps and (if allowed) the score.
    Judges' names are never included and there is no comparison with other entries."""
    entry = get_entry_or_404(db, cu, entry_id)
    member = is_entry_member(db, entry, cu.id)
    items = []
    for fb in db.scalars(select(Feedback).where(Feedback.entity_type == "challenge_entry", Feedback.entity_id == entry.id,
                                                Feedback.published_at.is_not(None)).order_by(Feedback.published_at.desc())).all():
        rnd = db.get(ReviewRound, fb.review_round_id) if fb.review_round_id else None
        if member and not fb.read_at:
            fb.read_at = utcnow()   # tracked for the program owner
        appeal = db.scalar(select(Appeal).where(Appeal.feedback_id == fb.id))
        window = int(setting(db, "appeal_window_days", 5))
        items.append({"id": fb.id, "round": en(rnd.name_i18n) if rnd else "Review", "decision_code": fb.decision_code,
                      "strengths": fb.strengths, "improvements": fb.improvements, "decision_reason": fb.decision_reason,
                      "next_steps": fb.next_steps, "score_shared": fb.score_shared, "criterion_scores": fb.criterion_scores or {},
                      "judge_comments": svc.judge_comments(db, rnd, "challenge_entry", entry.id) if rnd else {},
                      "published_at": iso(fb.published_at),
                      "appeal": {"id": appeal.id, "status": appeal.status, "reason": appeal.reason,
                                 "decision_note": appeal.decision_note} if appeal else None,
                      "can_appeal": member and not appeal and fb.published_at + timedelta(days=window) > utcnow(),
                      "appeal_deadline": iso(fb.published_at + timedelta(days=window))})
    db.commit()
    return {"entry": {"id": entry.id, "code": entry.code, "title": entry.title, "status_code": entry.status_code},
            "items": items}


class AppealIn(BaseModel):
    feedback_id: str
    reason: str


@router.post("/appeals")
def raise_appeal(body: AppealIn, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    fb = db.get(Feedback, body.feedback_id)
    if not fb or not fb.published_at:
        raise not_found("Feedback")
    entry = get_entry_or_404(db, cu, fb.entity_id, members_only=True)
    if db.scalar(select(Appeal.id).where(Appeal.feedback_id == fb.id)):
        raise DomainError("APPEAL_EXISTS", "An appeal was already raised for this feedback.")
    if fb.published_at + timedelta(days=int(setting(db, "appeal_window_days", 5))) < utcnow():
        raise DomainError("APPEAL_WINDOW_CLOSED", "The appeal window has closed.")
    if len(body.reason.strip()) < 20:
        raise DomainError("APPEAL_REASON_REQUIRED", "Explain which part of the process was not followed.")
    appeal = Appeal(entity_type="challenge_entry", entity_id=entry.id, feedback_id=fb.id, raised_by=cu.id,
                    reason=body.reason.strip(), status="OPEN")
    db.add(appeal)
    ch = db.get(Challenge, entry.challenge_id)
    publish_event(db, "APPEAL_RAISED", "challenge_entry", entry.id, cu.id, users=[ch.program_owner_user_id],
                  title=f"Appeal raised: {entry.code}", body=body.reason[:200], link=f"/manage/challenges/{ch.id}?tab=entries",
                  needs_action=True)
    db.commit()
    return {"id": appeal.id, "status": appeal.status}


class AppealDecisionIn(BaseModel):
    status: str   # UPHELD or DISMISSED
    decision_note: str


@router.get("/appeals")
def list_appeals(cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    out = []
    for ap in db.scalars(select(Appeal).order_by(Appeal.created_at.desc())).all():
        entry = db.get(ChallengeEntry, ap.entity_id)
        out.append({"id": ap.id, "status": ap.status, "reason": ap.reason, "decision_note": ap.decision_note,
                    "raised_at": iso(ap.created_at), "raised_by": (user_brief(db, ap.raised_by) or {}).get("full_name"),
                    "entry": {"id": entry.id, "code": entry.code, "title": entry.title, "challenge_id": entry.challenge_id} if entry else None})
    return out


@router.post("/appeals/{appeal_id}/actions/decide")
def decide_appeal(appeal_id: str, body: AppealDecisionIn, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                  db: Session = Depends(get_db)):
    ap = db.get(Appeal, appeal_id)
    if not ap or body.status not in ("UPHELD", "DISMISSED"):
        raise not_found("Appeal")
    ap.status, ap.decided_by, ap.decision_note, ap.decided_at = body.status, cu.id, body.decision_note, utcnow()
    audit(db, cu.id, "UPDATE", "appeal", ap.id, f"Appeal {body.status.lower()}", {}, request.state.request_id)
    publish_event(db, "APPEAL_DECIDED", "challenge_entry", ap.entity_id, cu.id, users=[ap.raised_by],
                  title=f"Your appeal was {'upheld' if body.status == 'UPHELD' else 'reviewed'}", body=body.decision_note[:300],
                  link=f"/entries/{ap.entity_id}/feedback")
    db.commit()
    return {"status": ap.status}
