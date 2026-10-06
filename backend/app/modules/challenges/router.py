"""Challenges: public pages, Q&A, registration, and the program owner's management endpoints."""
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit, next_code, publish_event, record_history
from app.core.permissions import CurrentUser, get_current_user, get_entry_or_404, require_roles
from app.modules.admin.models import AuditLog, WorkflowHistory
from app.modules.challenges import service as svc
from app.modules.challenges.models import (Challenge, ChallengeEligibilityRule, ChallengeEntry, ChallengePhase,
                                           ChallengePrize, ChallengeQuestion, EntrySubmission, Team, TeamMember)
from app.modules.delivery.models import AwardDecision, DemoEvent, DemoSlot
from app.modules.evaluation.models import Panel, PanelMember, ReviewAssignment, Shortlist, ShortlistRule
from app.modules.masterdata.models import ChallengeDomain
from app.shared.models.base import iso, row, utcnow
from app.shared.util import en, user_brief

router = APIRouter(tags=["challenges"])
MANAGERS = ("SUPER_ADMIN", "PROGRAM_OWNER")
OVERSEERS = ("SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE")


def get_challenge(db: Session, key: str, cu: CurrentUser | None = None) -> Challenge:
    ch = db.get(Challenge, key) or db.scalar(select(Challenge).where(Challenge.slug == key))
    if not ch or ch.deleted_at:
        raise not_found("Challenge")
    if ch.status_code == "DRAFT" and cu is not None and not cu.privileged:
        raise not_found("Challenge")
    return ch


# ---- Public ----------------------------------------------------------------------------
@router.get("/challenges")
def list_challenges(tab: str = "open", domain: str = "", q: str = "", mode: str = "", eligible_only: bool = False,
                    cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    items = []
    for ch in db.scalars(select(Challenge).where(Challenge.deleted_at.is_(None), Challenge.status_code != "DRAFT")
                         .order_by(Challenge.published_at.desc())).all():
        svc.sync_if_stale(db, ch)
        bucket = "closed" if ch.status_code in svc.CLOSED_STATUSES else "upcoming" if ch.status_code == "SCHEDULED" else "open"
        if tab and tab != "all" and bucket != tab:
            continue
        if domain and ch.domain_id != domain:
            continue
        if mode and ch.participation_mode not in (mode, "BOTH"):
            continue
        if q and q.lower() not in f"{en(ch.title_i18n)} {en(ch.problem_statement_i18n)}".lower():
            continue
        card = svc.challenge_card(db, ch, cu)
        if eligible_only and not card["eligibility"]["eligible"] and not card["my_entry_id"]:
            continue
        items.append(card)
    db.commit()
    return {"items": items, "total": len(items), "page": 1}


@router.get("/challenges/{key}")
def challenge_detail(key: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ch = get_challenge(db, key, cu)
    svc.sync_if_stale(db, ch)
    db.commit()
    return svc.challenge_detail(db, ch, cu)


@router.get("/challenges/{key}/questions")
def questions(key: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ch = get_challenge(db, key, cu)
    out = []
    for q in db.scalars(select(ChallengeQuestion).where(ChallengeQuestion.challenge_id == ch.id)
                        .order_by(ChallengeQuestion.created_at.desc())).all():
        if not cu.privileged and not q.is_published and q.asked_by != cu.id:
            continue
        item = {"id": q.id, "question": q.question, "answer": q.answer, "is_published": q.is_published,
                "asked_at": iso(q.created_at), "answered_at": iso(q.answered_at), "is_mine": q.asked_by == cu.id,
                "asked_by": None, "answered_by": (user_brief(db, q.answered_by) or {}).get("full_name") if q.answer else None}
        if cu.privileged or not q.is_anonymous:
            item["asked_by"] = (user_brief(db, q.asked_by) or {}).get("full_name")  # only the program owner sees names
        out.append(item)
    return out


class QuestionIn(BaseModel):
    question: str
    is_anonymous: bool = True


@router.post("/challenges/{key}/questions")
def ask_question(key: str, body: QuestionIn, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ch = get_challenge(db, key, cu)
    if len(body.question.strip()) < 5:
        raise DomainError("QUESTION_TOO_SHORT", "Write your question in a full sentence.")
    q = ChallengeQuestion(challenge_id=ch.id, asked_by=cu.id, question=body.question.strip(), is_anonymous=body.is_anonymous)
    db.add(q)
    publish_event(db, "CHALLENGE_QUESTION_ASKED", "challenge", ch.id, cu.id, users=[ch.program_owner_user_id],
                  title=f"New question on {en(ch.title_i18n)}", body=body.question[:200],
                  link=f"/manage/challenges/{ch.id}?tab=qa", needs_action=True)
    db.commit()
    return {"id": q.id}


class AnswerIn(BaseModel):
    answer: str
    is_published: bool = True


@router.post("/questions/{question_id}/answer")
def answer_question(question_id: str, body: AnswerIn, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                    db: Session = Depends(get_db)):
    q = db.get(ChallengeQuestion, question_id)
    if not q:
        raise not_found("Question")
    q.answer, q.answered_by, q.answered_at, q.is_published = body.answer, cu.id, utcnow(), body.is_published
    ch = db.get(Challenge, q.challenge_id)
    publish_event(db, "CHALLENGE_QUESTION_ANSWERED", "challenge", ch.id, cu.id, users=[q.asked_by],
                  title=f"Your question on {en(ch.title_i18n)} was answered", body=body.answer[:200],
                  link=f"/challenges/{ch.slug}?tab=qa")
    db.commit()
    return {"ok": True}


# ---- Registration -----------------------------------------------------------------------
class RegisterIn(BaseModel):
    entry_type: str = "INDIVIDUAL"
    title: str
    summary: str | None = None
    team_name: str | None = None
    accept_declaration: bool = False


@router.post("/challenges/{key}/entries")
def register(key: str, body: RegisterIn, request: Request, cu: CurrentUser = Depends(get_current_user),
             db: Session = Depends(get_db)):
    ch = get_challenge(db, key, cu)
    svc.sync_challenge(db, ch)
    registration = svc.phase_of(db, ch.id, "REGISTRATION")
    if not svc.phase_is_open(registration):
        when = svc._fmt(registration.closes_at) if registration else ""
        raise DomainError("REGISTRATION_CLOSED", f"Registration for this challenge closed on {when}.")
    elig = svc.eligibility(db, ch, cu)
    if not elig["eligible"]:
        raise DomainError("NOT_ELIGIBLE", elig["reason"])
    existing = svc.my_entry_in(db, ch.id, cu.id)
    if existing:
        raise DomainError("ALREADY_REGISTERED", "You're already registered for this challenge.", 409,
                          {"entry_id": existing.id, "team_id": existing.team_id})
    if body.entry_type not in ("INDIVIDUAL", "TEAM") or ch.participation_mode not in ("BOTH", body.entry_type):
        raise DomainError("MODE_NOT_ALLOWED", "This challenge doesn't allow that way of taking part.")
    if not body.accept_declaration:
        raise DomainError("DECLARATION_REQUIRED", "Please accept the rules and the originality declaration.")
    if len(body.title.strip()) < 3:
        raise DomainError("TITLE_REQUIRED", "Give your entry a working title.")
    now = utcnow()
    team = None
    if body.entry_type == "TEAM":
        if not (body.team_name or "").strip():
            raise DomainError("TEAM_NAME_REQUIRED", "Give your team a name.")
        team = Team(name=body.team_name.strip(), challenge_id=ch.id, lead_user_id=cu.id, created_by=cu.id)
        db.add(team)
        db.flush()
        db.add(TeamMember(team_id=team.id, user_id=cu.id, member_role="LEAD", credit_share_pct=100, status="ACTIVE",
                          joined_at=now))
    seq_code = next_code(db, f"ENT-{ch.code[4:]}", 4)
    entry = ChallengeEntry(code=seq_code, challenge_id=ch.id, entry_type=body.entry_type, team_id=team.id if team else None,
                           lead_user_id=cu.id, title=body.title.strip(), summary=body.summary, status_code="REGISTERED",
                           registered_at=now, declarations_accepted_at=now, org_unit_id=cu.user.primary_org_unit_id,
                           anonymous_alias=f"Entry #{int(seq_code.rsplit('-', 1)[1])}", created_by=cu.id)
    db.add(entry)
    db.flush()
    record_history(db, "challenge_entry", entry.id, None, "REGISTERED", "REGISTER", cu.id)
    audit(db, cu.id, "CREATE", "challenge_entry", entry.id, f"Registered {entry.code}", {}, request.state.request_id)
    methodology = svc.phase_of(db, ch.id, "METHODOLOGY")
    publish_event(db, "ENTRY_REGISTERED", "challenge_entry", entry.id, cu.id, users=[cu.id],
                  title=f"You're registered: {en(ch.title_i18n)}",
                  body=f"Entry {entry.code}. Submit your methodology by {svc._fmt(methodology.closes_at) if methodology else 'the deadline'}.",
                  link=f"/entries/{entry.id}", vars={"entry_code": entry.code, "challenge": en(ch.title_i18n)})
    db.commit()
    return svc.entry_card(db, entry, cu, ch)


@router.get("/me/entries")
def my_entries(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.core.permissions import my_team_ids
    teams = my_team_ids(db, cu.id)
    entries = db.scalars(select(ChallengeEntry).where(ChallengeEntry.deleted_at.is_(None)).where(
        (ChallengeEntry.lead_user_id == cu.id) | (ChallengeEntry.team_id.in_(teams or [""])))
        .order_by(ChallengeEntry.registered_at.desc())).all()
    items = [svc.entry_card(db, e, cu) for e in entries]
    return {"items": items, "total": len(items), "page": 1}


@router.get("/entries/{entry_id}")
def entry_detail(entry_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.modules.evaluation.models import Feedback
    from app.modules.initiatives.models import ClarificationRequest
    entry = get_entry_or_404(db, cu, entry_id)
    ch = db.get(Challenge, entry.challenge_id)
    svc.sync_if_stale(db, ch)
    from app.core.permissions import is_entry_member
    member = is_entry_member(db, entry, cu.id)
    out = svc.entry_card(db, entry, cu, ch, hide_identity=svc.blind_for(cu, ch) and not member)
    subs = {s.submission_type: s for s in db.scalars(select(EntrySubmission).where(
        EntrySubmission.challenge_entry_id == entry.id)).all()}
    phases = {p.phase_type: p for p in svc.phases_of(db, ch.id)}

    def sub_info(kind: str, phase_type: str, path: str):
        phase, s = phases.get(phase_type), subs.get(kind)
        if not phase:
            return None
        required = True
        if kind == "PROTOTYPE":
            required = ch.prototype_policy != "NONE"   # every shortlisted entry gets the demo form
        return {"type": kind, "path": f"/entries/{entry.id}/{path}", "status": s.status if s else "NOT_STARTED",
                "submission_id": s.id if s else None, "version_no": s.current_version_no if s else 0,
                "submitted_at": iso(s.submitted_at) if s else None, "completeness_pct": s.completeness_pct if s else 0,
                "opens_at": iso(phase.opens_at), "closes_at": iso(phase.closes_at), "window_open": svc.phase_is_open(phase),
                "required": required}

    def prototype_info():
        info = sub_info("PROTOTYPE", "PROTOTYPE", "prototype")
        from app.modules.evaluation import gates
        gate = gates.latest(db, "challenge_entry", entry.id, "PROTOTYPE")
        if info and gate:      # sent through the prototype review (link + how to use it)
            info.update(status={"DRAFT": "DRAFT", "CHANGES_REQUESTED": "DRAFT"}.get(gate.status, "SUBMITTED"),
                        review_status=gate.status, version_no=gate.round_no,
                        submitted_at=iso(gate.submitted_at), completeness_pct=100 if gate.status != "DRAFT" else 50)
        return info

    out["submissions"] = [x for x in (sub_info("METHODOLOGY", "METHODOLOGY", "methodology"),
                                      prototype_info(),
                                      sub_info("FINAL_PROJECT", "FINAL_SUBMISSION", "final")) if x]
    feedback_count = len(db.scalars(select(Feedback.id).where(Feedback.entity_type == "challenge_entry",
                                                              Feedback.entity_id == entry.id,
                                                              Feedback.published_at.is_not(None))).all())
    out["feedback_available"] = feedback_count > 0
    out["clarifications"] = [
        {"id": c.id, "question": c.question, "answer": c.answer, "status": c.status, "due_at": iso(c.due_at),
         "asked_at": iso(c.created_at), "answered_at": iso(c.answered_at)}
        for c in db.scalars(select(ClarificationRequest).where(ClarificationRequest.entity_type == "challenge_entry",
                                                               ClarificationRequest.entity_id == entry.id)
                            .order_by(ClarificationRequest.created_at.desc())).all()]
    out["is_member"] = member
    out["is_lead"] = entry.lead_user_id == cu.id
    out["can_withdraw"] = (out["is_lead"] or cu.privileged) and svc.STAGE_INDEX.get(entry.status_code, 0) in (1, 2)
    out["show_shortlist_moment"] = member and entry.status_code in ("SHORTLISTED", "BUILDING") and not entry.shortlist_moment_seen
    if out["show_shortlist_moment"]:
        entry.shortlist_moment_seen = True  # shown once
    if cu.sees_all and not svc.blind_for(cu, ch):
        out["current_score"], out["current_rank"] = entry.current_score, entry.current_rank
    db.commit()
    return out


class WithdrawIn(BaseModel):
    reason: str = ""


@router.post("/entries/{entry_id}/actions/withdraw")
def withdraw(entry_id: str, body: WithdrawIn, request: Request, cu: CurrentUser = Depends(get_current_user),
             db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, cu, entry_id)
    if entry.lead_user_id != cu.id and not cu.privileged:
        raise DomainError("LEADER_ONLY", "Only the team leader can withdraw the entry.")
    if cu.privileged and entry.lead_user_id != cu.id and not body.reason.strip():
        raise DomainError("REASON_REQUIRED", "Give a reason for withdrawing this entry.")
    if entry.status_code == "WITHDRAWN":
        raise DomainError("ALREADY_WITHDRAWN", "This entry is already withdrawn.")
    record_history(db, "challenge_entry", entry.id, entry.status_code, "WITHDRAWN", "WITHDRAW", cu.id, body.reason)
    entry.status_code, entry.withdrawn_at, entry.withdraw_reason = "WITHDRAWN", utcnow(), body.reason
    audit(db, cu.id, "UPDATE", "challenge_entry", entry.id, f"Withdrew {entry.code}", {"reason": [None, body.reason]},
          request.state.request_id)
    publish_event(db, "ENTRY_WITHDRAWN", "challenge_entry", entry.id, cu.id, users=svc.notify_entry(db, entry),
                  title=f"Entry {entry.code} was withdrawn", body=body.reason, link=f"/entries/{entry.id}")
    db.commit()
    return {"ok": True}


# ---- Management (program owner, super admin) -----------------------------------------------
@router.get("/public/challenges")
def public_challenges(db: Session = Depends(get_db)):
    """Landing page (no sign-in): published challenges that people can register for now or soon.
    Only the facts already shown openly on a challenge page — never entries, teams or scores."""
    from app.modules.evaluation.models import ScorecardCriterion
    items = []
    for ch in db.scalars(select(Challenge).where(Challenge.deleted_at.is_(None), Challenge.status_code != "DRAFT")
                         .order_by(Challenge.published_at.desc())).all():
        if ch.data_classification_code in ("CONFIDENTIAL", "RESTRICTED"):
            continue
        svc.sync_if_stale(db, ch)
        phases = svc.phases_of(db, ch.id)
        registration = next((p for p in phases if p.phase_type == "REGISTRATION"), None)
        if not registration or registration.status == "CLOSED":
            continue                      # registration is over: nothing a visitor can do
        domain = db.get(ChallengeDomain, ch.domain_id) if ch.domain_id else None
        rnd = svc.round_of(db, ch.id, "METHODOLOGY")
        criteria = db.scalars(select(ScorecardCriterion).where(ScorecardCriterion.scorecard_id == rnd.scorecard_id)
                              .order_by(ScorecardCriterion.sort_order)).all() if rnd and rnd.scorecard_id else []
        items.append({
            "code": ch.code, "slug": ch.slug, "title_i18n": ch.title_i18n,
            "domain": en(domain.name_i18n) if domain else "Other",
            "status": "open" if svc.phase_is_open(registration) else "soon",
            "registration_opens_at": iso(registration.opens_at), "registration_closes_at": iso(registration.closes_at),
            "participation_mode": ch.participation_mode, "team_min_size": ch.team_min_size, "team_max_size": ch.team_max_size,
            "problem": en(ch.problem_statement_i18n), "expected_outcome": en(ch.expected_outcome_i18n),
            "total_prize_budget": ch.total_prize_budget, "currency_code": ch.currency_code,
            "phases": [{"name": en(p.name_i18n) or p.phase_type.replace("_", " ").capitalize(), "opens_at": iso(p.opens_at),
                        "closes_at": iso(p.closes_at)} for p in phases],
            "criteria": [{"name": en(c.name_i18n), "weight_pct": c.weight_pct} for c in criteria],
        })
    # A few totals for the landing page. Counts only — no names and no content.
    from app.modules.initiatives.models import Initiative
    ideas = db.scalar(select(func.count()).select_from(Initiative).where(Initiative.deleted_at.is_(None),
                                                                         Initiative.current_state_code != "DRAFT")) or 0
    entries = db.scalars(select(ChallengeEntry.status_code).where(ChallengeEntry.deleted_at.is_(None),
                                                                  ChallengeEntry.status_code != "WITHDRAWN")).all()
    awarded_ideas = db.scalar(select(func.count()).select_from(Initiative).where(Initiative.deleted_at.is_(None),
                                                                                 Initiative.is_awarded.is_(True))) or 0
    stats = {
        "challenges": db.scalar(select(func.count()).select_from(Challenge).where(Challenge.deleted_at.is_(None),
                                                                                  Challenge.status_code != "DRAFT")) or 0,
        "ideas": ideas, "entries": len(entries),
        "rewarded": sum(1 for s in entries if s in ("WINNER", "RUNNER_UP")) + awarded_ideas,
    }
    db.commit()
    return {"items": items, "total": len(items), "stats": stats}


@router.get("/manage/challenges")
def manage_list(status: str = "", domain: str = "", cu: CurrentUser = Depends(require_roles(*OVERSEERS)),
                db: Session = Depends(get_db)):
    items = []
    for ch in db.scalars(select(Challenge).where(Challenge.deleted_at.is_(None)).order_by(Challenge.created_at.desc())).all():
        svc.sync_if_stale(db, ch)
        if status and ch.status_code != status:
            continue
        if domain and ch.domain_id != domain:
            continue
        card = svc.challenge_card(db, ch, cu)
        phases = svc.phases_of(db, ch.id)
        upcoming = [p.closes_at for p in phases if p.status == "OPEN"] + [p.opens_at for p in phases if p.status == "UPCOMING"]
        items.append({**card, "numbers": svc.challenge_numbers(db, ch), "next_date": iso(min(upcoming)) if upcoming else None,
                      "owner": (user_brief(db, ch.program_owner_user_id) or {}).get("full_name")})
    db.commit()
    return {"items": items, "total": len(items), "page": 1}


class PhaseIn(BaseModel):
    phase_type: str
    name: str | None = None
    opens_at: datetime
    closes_at: datetime


class PrizeIn(BaseModel):
    rank_from: int = 1
    rank_to: int = 1
    prize_type: str = "CASH"
    description: str = ""
    amount: float | None = None


class ChallengeIn(BaseModel):
    title: str
    title_bn: str | None = None
    domain_id: str | None = None
    category_id: str | None = None
    sponsor_user_id: str | None = None
    banner_color: str | None = None
    problem_statement: str = ""
    background: str = ""
    expected_outcome: str = ""
    rules: str = ""
    participation_mode: str = "BOTH"
    team_min_size: int = 1
    team_max_size: int = 5
    allow_cross_org_teams: bool = True
    eligibility_org_unit_ids: list[str] = []
    phases: list[PhaseIn] = []
    methodology_form_id: str | None = None
    prototype_form_id: str | None = None
    final_form_id: str | None = None
    methodology_scorecard_id: str | None = None
    final_scorecard_id: str | None = None
    judge_user_ids: list[str] = []
    reviewers_per_entry: int = 3
    blind_review: bool = False
    aggregation_method: str = "MEAN"
    show_scores_to_entrants: str = "TOTAL_ONLY"
    shortlist_method: str = "TOP_N"
    top_n: int | None = 5
    min_score: float | None = None
    top_percent: float | None = None
    waitlist_size: int = 2
    prototype_policy: str = "PANEL_DECIDES"
    prizes: list[PrizeIn] = []
    publish_winner_summaries: bool = True
    peoples_choice_enabled: bool = False
    leaderboard_enabled: bool = False
    show_registration_count: bool = True


def _slug(db: Session, title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80] or "challenge"
    slug, n = base, 2
    while db.scalar(select(Challenge.id).where(Challenge.slug == slug)):
        slug, n = f"{base}-{n}", n + 1
    return slug


@router.post("/challenges")
def create_challenge(body: ChallengeIn, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                     db: Session = Depends(get_db)):
    ch = Challenge(code=next_code(db, "CHL", 3), slug=_slug(db, body.title), status_code="DRAFT",
                   program_owner_user_id=cu.id, org_unit_id=cu.user.primary_org_unit_id, created_by=cu.id,
                   title_i18n={"en": body.title})
    db.add(ch)
    db.flush()
    cfg = body.model_dump()
    cfg.pop("judge_user_ids", None)      # judges are chosen by the admin on the Judges tab
    svc.apply_config(db, ch, cfg, cu.id)
    audit(db, cu.id, "CREATE", "challenge", ch.id, f"Created challenge {ch.code}", {}, request.state.request_id)
    db.commit()
    return {"id": ch.id, "slug": ch.slug, "code": ch.code}


@router.put("/challenges/{challenge_id}")
def update_challenge(challenge_id: str, body: ChallengeIn, request: Request,
                     cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    cfg = body.model_dump()
    cfg.pop("judge_user_ids", None)      # judges are chosen by the admin on the Judges tab
    if ch.status_code != "DRAFT":
        # After publishing, structure is locked; text, dates, prizes and panel can still change.
        for key in ("participation_mode", "team_min_size", "team_max_size", "prototype_policy", "eligibility_org_unit_ids"):
            cfg.pop(key, None)
    svc.apply_config(db, ch, cfg, cu.id)
    audit(db, cu.id, "UPDATE", "challenge", ch.id, f"Edited challenge {ch.code}", {}, request.state.request_id)
    svc.sync_if_stale(db, ch)
    db.commit()
    return {"id": ch.id, "slug": ch.slug, "code": ch.code}


@router.get("/manage/challenges/{challenge_id}")
def manage_detail(challenge_id: str, cu: CurrentUser = Depends(require_roles(*OVERSEERS)), db: Session = Depends(get_db)):
    """Control centre: overview numbers, timeline, rounds, shortlists, plus the editable configuration."""
    ch = get_challenge(db, challenge_id)
    svc.sync_challenge(db, ch)
    db.commit()
    detail = svc.challenge_detail(db, ch, cu)
    phases = svc.phases_of(db, ch.id)
    by_type = {p.phase_type: p for p in phases}
    panel = db.scalar(select(Panel).where(Panel.challenge_id == ch.id))
    judges = [user_brief(db, m.user_id) for m in db.scalars(select(PanelMember).where(PanelMember.panel_id == panel.id)).all()] if panel else []
    rounds = []
    for rnd in svc.rounds_of(db, ch.id):
        assignments = db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == rnd.id,
                                                                ReviewAssignment.status != "DECLINED_COI")).all()
        now = utcnow()
        shortlist = db.scalar(select(Shortlist).where(Shortlist.review_round_id == rnd.id).order_by(Shortlist.created_at.desc()))
        rounds.append({"id": rnd.id, "round_type": rnd.round_type, "name": en(rnd.name_i18n), "status": rnd.status,
                       "scorecard_id": rnd.scorecard_id, "reviewers_per_entry": rnd.reviewers_per_entry,
                       "aggregation_method": rnd.aggregation_method, "blind": rnd.blind,
                       "show_scores_to_entrants": rnd.show_scores_to_entrants, "due_at": iso(rnd.due_at),
                       "assigned": len(assignments), "submitted": sum(a.status == "SUBMITTED" for a in assignments),
                       "overdue": sum(a.status != "SUBMITTED" and bool(a.due_at and a.due_at < now) for a in assignments),
                       "shortlist": {"id": shortlist.id, "status": shortlist.status} if shortlist else None})
    method_round = svc.round_of(db, ch.id, "METHODOLOGY")
    final_round = svc.round_of(db, ch.id, "FINAL_JURY")
    rule = db.scalar(select(ShortlistRule).where(ShortlistRule.review_round_id == method_round.id)) if method_round else None
    demo = db.scalar(select(DemoEvent).where(DemoEvent.challenge_id == ch.id))
    slots = db.scalars(select(DemoSlot).where(DemoSlot.demo_event_id == demo.id).order_by(DemoSlot.starts_at)).all() if demo else []
    entry_titles = {e.id: e for e in db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == ch.id)).all()}
    config = {
        "title": en(ch.title_i18n), "title_bn": (ch.title_i18n or {}).get("bn"), "domain_id": ch.domain_id,
        "category_id": ch.category_id, "sponsor_user_id": ch.sponsor_user_id, "banner_color": ch.banner_color,
        "problem_statement": en(ch.problem_statement_i18n), "background": en(ch.background_i18n),
        "expected_outcome": en(ch.expected_outcome_i18n), "rules": en(ch.rules_i18n),
        "participation_mode": ch.participation_mode, "team_min_size": ch.team_min_size, "team_max_size": ch.team_max_size,
        "allow_cross_org_teams": ch.allow_cross_org_teams,
        "eligibility_org_unit_ids": [r.rule_value.get("org_unit_id") for r in db.scalars(select(ChallengeEligibilityRule).where(
            ChallengeEligibilityRule.challenge_id == ch.id)).all()],
        "phases": [{"phase_type": p.phase_type, "name": en(p.name_i18n), "opens_at": iso(p.opens_at), "closes_at": iso(p.closes_at)} for p in phases],
        "methodology_form_id": by_type["METHODOLOGY"].submission_form_template_id if "METHODOLOGY" in by_type else None,
        "prototype_form_id": by_type["PROTOTYPE"].submission_form_template_id if "PROTOTYPE" in by_type else None,
        "final_form_id": by_type["FINAL_SUBMISSION"].submission_form_template_id if "FINAL_SUBMISSION" in by_type else None,
        "methodology_scorecard_id": method_round.scorecard_id if method_round else None,
        "final_scorecard_id": final_round.scorecard_id if final_round else None,
        "judge_user_ids": [j["id"] for j in judges if j],
        "reviewers_per_entry": method_round.reviewers_per_entry if method_round else 3,
        "blind_review": ch.blind_review, "aggregation_method": method_round.aggregation_method if method_round else "MEAN",
        "show_scores_to_entrants": method_round.show_scores_to_entrants if method_round else "TOTAL_ONLY",
        "shortlist_method": rule.method if rule else "TOP_N", "top_n": rule.top_n if rule else 5,
        "min_score": rule.min_score if rule else None, "top_percent": rule.top_percent if rule else None,
        "waitlist_size": rule.waitlist_size if rule else 0, "prototype_policy": ch.prototype_policy,
        "prizes": [{"rank_from": p.rank_from, "rank_to": p.rank_to, "prize_type": p.prize_type,
                    "description": en(p.description_i18n), "amount": p.amount}
                   for p in db.scalars(select(ChallengePrize).where(ChallengePrize.challenge_id == ch.id).order_by(ChallengePrize.rank_from)).all()],
        "publish_winner_summaries": ch.publish_winner_summaries, "peoples_choice_enabled": ch.peoples_choice_enabled,
        "leaderboard_enabled": ch.leaderboard_enabled, "show_registration_count": ch.show_registration_count,
    }
    return {
        **detail, "numbers": svc.challenge_numbers(db, ch), "judges": judges, "rounds": rounds, "config": config,
        "publish_checklist": svc.publish_checklist(db, ch), "can_assign_judges": cu.has_role("SUPER_ADMIN"),
        "owner": user_brief(db, ch.program_owner_user_id),
        "results_status": "PUBLISHED" if ch.results_published_at else "APPROVED" if ch.results_approved_at else
                          "DRAFT" if db.scalar(select(AwardDecision.id).where(AwardDecision.challenge_id == ch.id)) else None,
        "demo_event": {**row(demo, exclude=("created_by", "updated_by")),
                       "slots": [{"id": s.id, "starts_at": iso(s.starts_at), "duration_min": s.duration_min, "status": s.status,
                                  "entry": {"id": s.entity_id, "code": entry_titles[s.entity_id].code,
                                            "title": entry_titles[s.entity_id].title} if s.entity_id in entry_titles else None}
                                 for s in slots]} if demo else None,
        "can_manage": cu.privileged,
    }


@router.post("/challenges/{challenge_id}/actions/publish")
def publish_challenge(challenge_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                      db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    if ch.status_code != "DRAFT":
        raise DomainError("ALREADY_PUBLISHED", "This challenge is already published.")
    missing = [c["label"] for c in svc.publish_checklist(db, ch) if not c["ok"] and not c.get("optional")]
    if missing:
        raise DomainError("PUBLISH_CHECKLIST_INCOMPLETE", "Finish the checklist before publishing.", 400, {"missing": missing})
    record_history(db, "challenge", ch.id, "DRAFT", "SCHEDULED", "PUBLISH", cu.id)
    ch.status_code, ch.published_at = "SCHEDULED", utcnow()
    svc.sync_challenge(db, ch)
    audit(db, cu.id, "UPDATE", "challenge", ch.id, f"Published challenge {ch.code}", {"status": ["DRAFT", ch.status_code]},
          request.state.request_id)
    from app.modules.identity.models import User
    everyone = list(db.scalars(select(User.id).where(User.is_active.is_(True), User.has_corporate_login.is_(True))).all())
    publish_event(db, "CHALLENGE_PUBLISHED", "challenge", ch.id, cu.id, users=everyone,
                  title=f"New challenge: {en(ch.title_i18n)}", body=en(ch.problem_statement_i18n)[:200],
                  link=f"/challenges/{ch.slug}", vars={"challenge": en(ch.title_i18n)})
    db.commit()
    return {"status_code": ch.status_code}


class ExtendIn(BaseModel):
    phase_type: str
    new_closes_at: datetime
    reason: str


@router.post("/challenges/{challenge_id}/actions/extend-deadline")
def extend_deadline(challenge_id: str, body: ExtendIn, request: Request,
                    cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    """Extensions apply to everyone (fairness rule) and are audited with the reason."""
    ch = get_challenge(db, challenge_id)
    phase = svc.phase_of(db, ch.id, body.phase_type)
    if not phase:
        raise not_found("Phase")
    if not body.reason.strip():
        raise DomainError("REASON_REQUIRED", "Give a reason for the extension.")
    new_close = svc.as_naive(body.new_closes_at)
    if new_close <= phase.opens_at:
        raise DomainError("PHASE_WINDOW_INVALID", "The new closing time must be after the opening time.")
    before = phase.closes_at
    shift = new_close - before
    phase.closes_at = new_close
    for later in svc.phases_of(db, ch.id):  # keep later phases from overlapping the extended one
        if later.sequence_no > phase.sequence_no and later.opens_at < new_close:
            later.opens_at, later.closes_at = later.opens_at + shift, later.closes_at + shift
    svc.sync_challenge(db, ch)
    audit(db, cu.id, "OVERRIDE", "challenge", ch.id, f"Extended {body.phase_type} deadline for everyone: {body.reason}",
          {"closes_at": [iso(before), iso(new_close)]}, request.state.request_id)
    entrants = [u for e in db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == ch.id,
                                                                   ChallengeEntry.status_code != "WITHDRAWN")).all()
                for u in svc.notify_entry(db, e)]
    publish_event(db, "PHASE_DEADLINE_EXTENDED", "challenge", ch.id, cu.id, users=entrants,
                  title=f"Deadline extended: {en(ch.title_i18n)}",
                  body=f"{svc.PHASE_NAMES.get(body.phase_type, body.phase_type)} now closes on {svc._fmt(new_close)}.",
                  link=f"/challenges/{ch.slug}")
    db.commit()
    return {"ok": True}


class ClosePhaseIn(BaseModel):
    phase_type: str


@router.post("/challenges/{challenge_id}/actions/close-phase")
def close_phase(challenge_id: str, body: ClosePhaseIn, request: Request,
                cu: CurrentUser = Depends(require_roles(*MANAGERS)), db: Session = Depends(get_db)):
    """Close the given open phase now and open the next one immediately."""
    ch = get_challenge(db, challenge_id)
    phases = svc.phases_of(db, ch.id)
    phase = next((p for p in phases if p.phase_type == body.phase_type), None)
    now = utcnow()
    if not phase or not svc.phase_is_open(phase, now):
        raise DomainError("PHASE_NOT_OPEN", "This phase is not open.")
    from datetime import timedelta
    phase.closes_at, phase.grace_minutes = now - timedelta(seconds=1), 0
    nxt = next((p for p in phases if p.sequence_no > phase.sequence_no), None)
    if nxt and nxt.opens_at > now:
        nxt.opens_at = now
    svc.sync_challenge(db, ch, now)
    audit(db, cu.id, "OVERRIDE", "challenge", ch.id, f"Closed {body.phase_type} phase early", {}, request.state.request_id)
    db.commit()
    return {"status_code": ch.status_code}


class AnnounceIn(BaseModel):
    message: str


@router.post("/challenges/{challenge_id}/actions/announce")
def announce(challenge_id: str, body: AnnounceIn, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
             db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    entrants = [u for e in db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == ch.id,
                                                                   ChallengeEntry.status_code != "WITHDRAWN")).all()
                for u in svc.notify_entry(db, e)]
    publish_event(db, "CHALLENGE_ANNOUNCEMENT", "challenge", ch.id, cu.id, users=entrants,
                  title=f"Announcement: {en(ch.title_i18n)}", body=body.message, link=f"/challenges/{ch.slug}")
    db.commit()
    return {"sent_to": len(set(entrants))}


@router.get("/challenges/{challenge_id}/entries")
def challenge_entries(challenge_id: str, cu: CurrentUser = Depends(require_roles(*OVERSEERS, "JUDGE")), db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    out = []
    for e in db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == ch.id, ChallengeEntry.deleted_at.is_(None))
                        .order_by(ChallengeEntry.code)).all():
        sub = db.scalar(select(EntrySubmission).where(EntrySubmission.challenge_entry_id == e.id,
                                                      EntrySubmission.submission_type == "METHODOLOGY"))
        team = db.get(Team, e.team_id) if e.team_id else None
        out.append({"id": e.id, "code": e.code, "title": e.title, "entry_type": e.entry_type, "status_code": e.status_code,
                    "team": team.name if team else None, "lead": (user_brief(db, e.lead_user_id) or {}).get("full_name"),
                    "registered_at": iso(e.registered_at), "methodology_status": sub.status if sub else "NOT_STARTED",
                    "methodology_submission_id": sub.id if sub else None,
                    "current_score": e.current_score, "current_rank": e.current_rank, "prototype_required": e.prototype_required})
    return {"items": out, "total": len(out), "page": 1}


@router.get("/challenges/{challenge_id}/activity")
def challenge_activity(challenge_id: str, cu: CurrentUser = Depends(require_roles(*OVERSEERS)), db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    cache: dict[str, Any] = {}
    logs = db.scalars(select(AuditLog).where(AuditLog.entity_type == "challenge", AuditLog.entity_id == ch.id)
                      .order_by(AuditLog.occurred_at.desc()).limit(100)).all()
    history = db.scalars(select(WorkflowHistory).where(WorkflowHistory.entity_type == "challenge",
                                                       WorkflowHistory.entity_id == ch.id)
                         .order_by(WorkflowHistory.occurred_at.desc()).limit(100)).all()
    items = [{"at": iso(a.occurred_at), "who": (user_brief(db, a.actor_user_id, cache) or {}).get("full_name") or "System",
              "what": a.summary, "kind": a.action} for a in logs]
    items += [{"at": iso(h.occurred_at), "who": (user_brief(db, h.actor_user_id, cache) or {}).get("full_name") or "System",
               "what": f"Status changed: {h.from_state or '—'} → {h.to_state}", "kind": "STATUS"} for h in history]
    return sorted(items, key=lambda i: i["at"] or "", reverse=True)
