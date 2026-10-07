"""Build plan (milestones, progress), Demo Day, impact (KPIs, measurements, verification),
results & awards, catalogue."""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit, publish_event, record_history
from app.core.permissions import CurrentUser, get_current_user, get_entry_or_404, is_entry_member, require_roles
from app.modules.challenges import service as csvc
from app.modules.challenges.models import Challenge, ChallengeEntry, ChallengePrize, EntrySubmission, Team
from app.modules.delivery.models import (AwardCategory, AwardDecision, DemoEvent, DemoSlot, Kpi, KpiMeasurement, KpiVerifierAssignment, PresentationRequest,
                                         Milestone, ProgressUpdate, ReusableAsset, Reward)
from app.modules.evaluation import service as esvc
from app.modules.evaluation.gates import latest as latest_gate
from app.modules.evaluation.models import Feedback, ReviewRound, RoundResult
from app.modules.identity.models import User
from app.modules.initiatives.models import Initiative, InitiativeMember
from app.shared.access import check_entity_access, initiative_role
from app.shared.models.base import iso, row, utcnow
from app.shared.util import en, user_brief

router = APIRouter(tags=["delivery, impact & awards"])
MANAGERS = ("SUPER_ADMIN", "PROGRAM_OWNER")
OVERSEERS = ("SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE")
VERIFIERS = ("SUPER_ADMIN", "PROGRAM_OWNER", "FINANCE_VERIFIER", "SPONSOR")


# ---- Milestones and progress updates -----------------------------------------------------------
class MilestoneIn(BaseModel):
    entity_type: str = "challenge_entry"
    entity_id: str
    title: str
    description: str | None = None
    due_date: date | None = None
    owner_user_id: str | None = None
    status: str = "PLANNED"


def _milestone(db: Session, m: Milestone) -> dict:
    return {**row(m, exclude=("created_by", "updated_by")), "owner": (user_brief(db, m.owner_user_id) or {}).get("full_name")}


@router.get("/milestones")
def list_milestones(entity_type: str, entity_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    check_entity_access(db, cu, entity_type, entity_id)
    ms = db.scalars(select(Milestone).where(Milestone.entity_type == entity_type, Milestone.entity_id == entity_id)
                    .order_by(Milestone.sort_order, Milestone.due_date)).all()
    updates = db.scalars(select(ProgressUpdate).where(ProgressUpdate.entity_type == entity_type,
                                                      ProgressUpdate.entity_id == entity_id)
                         .order_by(ProgressUpdate.created_at.desc())).all()
    done = sum(1 for m in ms if m.status == "DONE")
    return {"milestones": [_milestone(db, m) for m in ms], "percent_complete": round(done * 100 / len(ms)) if ms else 0,
            "updates": [{**row(u, exclude=("created_by", "updated_by")),
                         "posted_by_name": (user_brief(db, u.posted_by) or {}).get("full_name")} for u in updates]}


@router.post("/milestones")
def add_milestone(body: MilestoneIn, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    check_entity_access(db, cu, body.entity_type, body.entity_id, write=True)
    if body.entity_type == "challenge_entry":
        entry = db.get(ChallengeEntry, body.entity_id)
        if csvc.STAGE_INDEX.get(entry.status_code, 0) < 4:
            raise DomainError("NOT_SHORTLISTED", "The build plan opens after your entry is shortlisted.", 409)
        if entry.status_code == "SHORTLISTED":
            record_history(db, "challenge_entry", entry.id, "SHORTLISTED", "BUILDING", "START_BUILD", cu.id)
            entry.status_code = "BUILDING"
    count = len(db.scalars(select(Milestone.id).where(Milestone.entity_type == body.entity_type,
                                                      Milestone.entity_id == body.entity_id)).all())
    m = Milestone(**body.model_dump(), sort_order=count + 1, created_by=cu.id)
    db.add(m)
    db.commit()
    return _milestone(db, m)


class MilestonePatch(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: date | None = None
    owner_user_id: str | None = None
    status: str | None = None
    sort_order: int | None = None


@router.patch("/milestones/{milestone_id}")
def update_milestone(milestone_id: str, body: MilestonePatch, cu: CurrentUser = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    m = db.get(Milestone, milestone_id)
    if not m:
        raise not_found("Milestone")
    check_entity_access(db, cu, m.entity_type, m.entity_id, write=True)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    if body.status == "DONE" and not m.completed_at:
        m.completed_at = utcnow()
        publish_event(db, "MILESTONE_COMPLETED", m.entity_type, m.entity_id, cu.id)
    db.commit()
    return _milestone(db, m)


@router.delete("/milestones/{milestone_id}")
def delete_milestone(milestone_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.get(Milestone, milestone_id)
    if not m:
        raise not_found("Milestone")
    check_entity_access(db, cu, m.entity_type, m.entity_id, write=True)
    db.delete(m)
    db.commit()
    return {"ok": True}


class ProgressIn(BaseModel):
    entity_type: str = "challenge_entry"
    entity_id: str
    update_text: str
    percent_complete: int = 0
    blockers: str | None = None
    help_needed: str | None = None


@router.post("/progress-updates")
def post_progress(body: ProgressIn, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    check_entity_access(db, cu, body.entity_type, body.entity_id, write=True)
    if not body.update_text.strip():
        raise DomainError("UPDATE_REQUIRED", "Write what you did this week.")
    u = ProgressUpdate(**body.model_dump(), posted_by=cu.id, created_by=cu.id)
    db.add(u)
    db.commit()
    return {"id": u.id}


# ---- Demo Day ---------------------------------------------------------------------------------------
class DemoEventIn(BaseModel):
    title: str = "Demo Day"
    starts_at: datetime
    slot_count: int = 6
    duration_min: int = 20
    location: str | None = None
    online_link: str | None = None


@router.post("/challenges/{challenge_id}/demo-event")
def create_demo_event(challenge_id: str, body: DemoEventIn, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                      db: Session = Depends(get_db)):
    ch = db.get(Challenge, challenge_id)
    if not ch:
        raise not_found("Challenge")
    if db.scalar(select(DemoEvent.id).where(DemoEvent.challenge_id == ch.id)):
        raise DomainError("DEMO_EVENT_EXISTS", "This challenge already has a Demo Day.")
    start = csvc.as_naive(body.starts_at)
    ev = DemoEvent(challenge_id=ch.id, title=body.title, starts_at=start, location=body.location, online_link=body.online_link,
                   ends_at=start + timedelta(minutes=body.duration_min * body.slot_count), created_by=cu.id)
    db.add(ev)
    db.flush()
    for i in range(body.slot_count):
        db.add(DemoSlot(demo_event_id=ev.id, starts_at=start + timedelta(minutes=body.duration_min * i),
                        duration_min=body.duration_min, status="OPEN"))
    audit(db, cu.id, "CREATE", "demo_event", ev.id, f"Created Demo Day for {ch.code}", {}, request.state.request_id)
    db.commit()
    return {"id": ev.id}


FINALIST_STATES = ("FINALIST", "FINAL_SUBMITTED")


@router.get("/entries/{entry_id}/demo")
def demo_for_entry(entry_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Slots show only 'free' or 'taken' — never which other entry booked them."""
    entry = get_entry_or_404(db, cu, entry_id)
    ev = db.scalar(select(DemoEvent).where(DemoEvent.challenge_id == entry.challenge_id))
    member = is_entry_member(db, entry, cu.id)
    if not ev:
        return {"event": None, "slots": [], "my_slot": None, "can_book": False,
                "message": "Demo Day is not scheduled yet. We'll notify you when slots open."}
    slots = db.scalars(select(DemoSlot).where(DemoSlot.demo_event_id == ev.id).order_by(DemoSlot.starts_at)).all()
    mine = next((s for s in slots if s.entity_id == entry.id), None)
    can = member and entry.status_code in FINALIST_STATES
    locked = bool(mine and mine.starts_at - timedelta(hours=48) < utcnow())
    return {
        "event": {"id": ev.id, "title": ev.title, "starts_at": iso(ev.starts_at), "ends_at": iso(ev.ends_at),
                  "location": ev.location, "online_link": ev.online_link},
        "slots": [{"id": s.id, "starts_at": iso(s.starts_at), "duration_min": s.duration_min,
                   "available": s.status == "OPEN", "is_mine": s.entity_id == entry.id} for s in slots],
        "my_slot": {"id": mine.id, "starts_at": iso(mine.starts_at), "duration_min": mine.duration_min} if mine else None,
        "can_book": can and not locked, "reschedule_locked": locked,
        "checklist": ["Working demo (live or recorded)", "Results so far against your KPI", "What you need to run a pilot",
                      "5 minutes for questions from the jury"],
        "message": None if can else "Demo booking opens for finalists." if member else "Read only.",
    }


@router.post("/entries/{entry_id}/demo/slots/{slot_id}/book")
def book_slot(entry_id: str, slot_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, cu, entry_id, members_only=True)
    if entry.status_code not in FINALIST_STATES:
        raise DomainError("NOT_A_FINALIST", "Demo booking is for finalists.", 409)
    slot = db.get(DemoSlot, slot_id)
    ev = db.get(DemoEvent, slot.demo_event_id) if slot else None
    if not slot or not ev or ev.challenge_id != entry.challenge_id:
        raise not_found("Slot")
    if slot.status != "OPEN":
        raise DomainError("SLOT_TAKEN", "This slot was just taken. Pick another one.", 409)
    current = db.scalar(select(DemoSlot).where(DemoSlot.demo_event_id == ev.id, DemoSlot.entity_id == entry.id))
    if current:
        if current.starts_at - timedelta(hours=48) < utcnow():
            raise DomainError("RESCHEDULE_CLOSED", "You can reschedule until 48 hours before your slot.", 409)
        current.entity_type, current.entity_id, current.status = None, None, "OPEN"
    slot.entity_type, slot.entity_id, slot.status = "challenge_entry", entry.id, "BOOKED"
    publish_event(db, "DEMO_SLOT_BOOKED", "challenge_entry", entry.id, cu.id, users=csvc.notify_entry(db, entry),
                  title=f"Demo slot booked: {entry.title}", body=f"Your demo is on {csvc._fmt(slot.starts_at)}.",
                  link=f"/entries/{entry.id}/demo")
    db.commit()
    return {"ok": True}


# ---- Final presentation schedule ---------------------------------------------------------------------
PRESENTING = ("FINALIST", "FINAL_SUBMITTED", "JUDGED")


def _window(db: Session, challenge_id: str):
    """The days a finalist may present on: the final submission period."""
    phase = csvc.phase_of(db, challenge_id, "FINAL_SUBMISSION")
    return (phase.opens_at, phase.closes_at) if phase else (None, None)


def _presentation_view(db: Session, r: PresentationRequest) -> dict:
    return {"id": r.id, "status": r.status, "proposed_start": iso(r.proposed_start), "note": r.note,
            "suggested_start": iso(r.suggested_start), "admin_note": r.admin_note, "scheduled_start": iso(r.scheduled_start),
            "decided_at": iso(r.decided_at), "created_at": iso(r.created_at),
            "proposed_by": (user_brief(db, r.proposed_by) or {}).get("full_name")}


def _requests_of(db: Session, entry_id: str) -> list[PresentationRequest]:
    return list(db.scalars(select(PresentationRequest).where(PresentationRequest.entry_id == entry_id)
                           .order_by(PresentationRequest.created_at.desc())).all())


def _check_in_window(db: Session, entry: ChallengeEntry, when: datetime) -> datetime:
    start = csvc.as_naive(when)
    opens, closes = _window(db, entry.challenge_id)
    if not opens:
        raise DomainError("NO_WINDOW", "The presentation period is not set for this challenge.", 409)
    if not opens <= start <= closes:
        raise DomainError("OUTSIDE_WINDOW", f"Choose a time between {csvc._fmt(opens)} and {csvc._fmt(closes)}.", 422,
                          {"fields": {"proposed_at": "Outside the presentation period."}})
    if start < utcnow():
        raise DomainError("IN_THE_PAST", "Choose a time in the future.", 422, {"fields": {"proposed_at": "Choose a future time."}})
    return start


@router.get("/entries/{entry_id}/presentation")
def presentation_for_entry(entry_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, cu, entry_id)
    member = is_entry_member(db, entry, cu.id)
    opens, closes = _window(db, entry.challenge_id)
    reqs = _requests_of(db, entry.id)
    current = next((r for r in reqs if r.status != "CANCELLED"), None)
    admin = cu.has_role("SUPER_ADMIN")
    return {"window": {"opens_at": iso(opens), "closes_at": iso(closes)},
            "current": _presentation_view(db, current) if current else None,
            "history": [_presentation_view(db, r) for r in reqs],
            "scheduled_at": iso(current.scheduled_start) if current and current.status == "ACCEPTED" else None,
            "is_finalist": entry.status_code in PRESENTING,
            "can_propose": member and entry.status_code in PRESENTING and bool(opens) and (not current or current.status != "ACCEPTED"),
            "can_decide": admin and bool(current) and current.status == "PROPOSED",
            "can_accept_suggestion": member and bool(current) and current.status == "COUNTER_PROPOSED",
            "entry": {"id": entry.id, "code": entry.code, "title": entry.title}}


class PresentationIn(BaseModel):
    proposed_at: datetime
    note: str | None = None


@router.post("/entries/{entry_id}/presentation")
def propose_presentation(entry_id: str, body: PresentationIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, cu, entry_id, members_only=True)
    if entry.status_code not in PRESENTING:
        raise DomainError("NOT_A_FINALIST", "Scheduling the presentation is for finalists.", 409)
    start = _check_in_window(db, entry, body.proposed_at)
    for old in _requests_of(db, entry.id):
        if old.status in ("PROPOSED", "COUNTER_PROPOSED"):
            old.status = "CANCELLED"
        elif old.status == "ACCEPTED":
            old.status = "CANCELLED"        # a new proposal replaces a confirmed time
    r = PresentationRequest(entry_id=entry.id, proposed_start=start, proposed_by=cu.id, note=(body.note or "").strip() or None,
                            status="PROPOSED", created_by=cu.id)
    db.add(r)
    from app.modules.evaluation.gates import admin_ids
    publish_event(db, "PRESENTATION_PROPOSED", "challenge_entry", entry.id, cu.id, users=admin_ids(db),
                  title=f"Presentation time proposed: {entry.code}",
                  body=f"{entry.title} proposes {csvc._fmt(start)}. Accept it or suggest another time.",
                  link=f"/entries/{entry.id}/presentation", needs_action=True)
    audit(db, cu.id, "UPDATE", "challenge_entry", entry.id, f"Proposed a presentation time for {entry.code}", {}, request.state.request_id)
    db.commit()
    return {"id": r.id, "status": r.status}


def _request_or_404(db: Session, request_id: str) -> tuple[PresentationRequest, ChallengeEntry]:
    r = db.get(PresentationRequest, request_id)
    entry = db.get(ChallengeEntry, r.entry_id) if r else None
    if not r or not entry:
        raise not_found("Request")
    return r, entry


@router.post("/presentation-requests/{request_id}/accept")
def accept_presentation(request_id: str, request: Request, cu: CurrentUser = Depends(require_roles("SUPER_ADMIN")),
                        db: Session = Depends(get_db)):
    """The admin accepts the time the team proposed."""
    r, entry = _request_or_404(db, request_id)
    if r.status != "PROPOSED":
        raise DomainError("NOT_WAITING", "There is nothing to accept on this request.", 409)
    r.status, r.scheduled_start, r.decided_by, r.decided_at = "ACCEPTED", r.proposed_start, cu.id, utcnow()
    publish_event(db, "PRESENTATION_CONFIRMED", "challenge_entry", entry.id, cu.id, users=csvc.notify_entry(db, entry),
                  title=f"Presentation confirmed: {entry.code}",
                  body=f"Your presentation is on {csvc._fmt(r.scheduled_start)}. Prepare your demo and results.",
                  link=f"/entries/{entry.id}/presentation")
    audit(db, cu.id, "UPDATE", "challenge_entry", entry.id, f"Accepted the presentation time for {entry.code}", {}, request.state.request_id)
    db.commit()
    return {"status": r.status, "scheduled_at": iso(r.scheduled_start)}


class SuggestIn(BaseModel):
    suggested_at: datetime
    note: str | None = None


@router.post("/presentation-requests/{request_id}/suggest")
def suggest_presentation(request_id: str, body: SuggestIn, request: Request, cu: CurrentUser = Depends(require_roles("SUPER_ADMIN")),
                         db: Session = Depends(get_db)):
    """The admin can't make that time and suggests another one inside the same period."""
    r, entry = _request_or_404(db, request_id)
    if r.status != "PROPOSED":
        raise DomainError("NOT_WAITING", "There is nothing to change on this request.", 409)
    start = _check_in_window(db, entry, body.suggested_at)
    r.status, r.suggested_start, r.admin_note, r.decided_by, r.decided_at = "COUNTER_PROPOSED", start, (body.note or "").strip() or None, cu.id, utcnow()
    publish_event(db, "PRESENTATION_COUNTER", "challenge_entry", entry.id, cu.id, users=csvc.notify_entry(db, entry),
                  title=f"New presentation time suggested: {entry.code}",
                  body=f"The innovation office suggests {csvc._fmt(start)}. Accept it or propose another time.",
                  link=f"/entries/{entry.id}/presentation", needs_action=True)
    audit(db, cu.id, "UPDATE", "challenge_entry", entry.id, f"Suggested another presentation time for {entry.code}", {}, request.state.request_id)
    db.commit()
    return {"status": r.status, "suggested_at": iso(r.suggested_start)}


@router.post("/presentation-requests/{request_id}/accept-suggestion")
def accept_suggestion(request_id: str, request: Request, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """The team agrees to the time the admin suggested."""
    r, entry = _request_or_404(db, request_id)
    get_entry_or_404(db, cu, entry.id, members_only=True)
    if r.status != "COUNTER_PROPOSED":
        raise DomainError("NOT_WAITING", "There is no suggestion to accept.", 409)
    r.status, r.scheduled_start = "ACCEPTED", r.suggested_start
    from app.modules.evaluation.gates import admin_ids
    publish_event(db, "PRESENTATION_CONFIRMED", "challenge_entry", entry.id, cu.id, users=[*admin_ids(db), *csvc.notify_entry(db, entry)],
                  title=f"Presentation confirmed: {entry.code}", body=f"{entry.title} presents on {csvc._fmt(r.scheduled_start)}.",
                  link=f"/entries/{entry.id}/presentation")
    audit(db, cu.id, "UPDATE", "challenge_entry", entry.id, f"Agreed to the suggested presentation time for {entry.code}", {}, request.state.request_id)
    db.commit()
    return {"status": r.status, "scheduled_at": iso(r.scheduled_start)}


@router.get("/manage/challenges/{challenge_id}/presentations")
def presentations_overview(challenge_id: str, cu: CurrentUser = Depends(require_roles(*OVERSEERS)), db: Session = Depends(get_db)):
    ch = db.get(Challenge, challenge_id)
    if not ch:
        raise not_found("Challenge")
    opens, closes = _window(db, ch.id)
    rows = []
    for e in db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == ch.id,
                                                     ChallengeEntry.status_code.in_(PRESENTING + ("WINNER", "RUNNER_UP", "PARTICIPANT")))
                        .order_by(ChallengeEntry.code)).all():
        reqs = _requests_of(db, e.id)
        current = next((r for r in reqs if r.status != "CANCELLED"), None)
        team = db.get(Team, e.team_id) if e.team_id else None
        rows.append({"entry": {"id": e.id, "code": e.code, "title": e.title, "status_code": e.status_code,
                               "entrant": team.name if team else (user_brief(db, e.lead_user_id) or {}).get("full_name")},
                     "current": _presentation_view(db, current) if current else None})
    rows.sort(key=lambda r: ((r["current"] or {}).get("scheduled_start") or "9", r["entry"]["code"]))
    return {"window": {"opens_at": iso(opens), "closes_at": iso(closes)}, "items": rows, "can_decide": cu.has_role("SUPER_ADMIN")}


# ---- Impact: KPIs, measurements, verification ----------------------------------------------------------
class KpiIn(BaseModel):
    entity_type: str = "initiative"
    entity_id: str
    name: str
    benefit_type_code: str | None = None
    unit_code: str = "hours"
    direction: str = "DECREASE"
    baseline_value: float | None = None
    baseline_period: str | None = None
    target_value: float | None = None
    target_date: date | None = None
    is_primary: bool = False


def _assigned_id(db: Session, measurement_id: str) -> str | None:
    """Who the admin chose to verify this measurement (the latest choice), or None."""
    a = db.scalar(select(KpiVerifierAssignment).where(KpiVerifierAssignment.measurement_id == measurement_id)
                  .order_by(KpiVerifierAssignment.created_at.desc()))
    return a.verifier_user_id if a else None


def _kpi(db: Session, k: Kpi) -> dict:
    ms = db.scalars(select(KpiMeasurement).where(KpiMeasurement.kpi_id == k.id).order_by(KpiMeasurement.period_end)).all()
    latest = ms[-1] if ms else None
    verified = [m for m in ms if m.verification_status in ("VERIFIED", "ADJUSTED")]
    return {**row(k, exclude=("created_by", "updated_by")),
            "latest_value": (latest.verified_value if latest and latest.verified_value is not None else latest.measured_value) if latest else None,
            "is_verified": bool(verified),
            "measurements": [{**row(m, exclude=("created_by", "updated_by")),
                              "verifier": (user_brief(db, m.verifier_user_id) or {}).get("full_name"),
                              "assigned_verifier": user_brief(db, _assigned_id(db, m.id)) if m.verification_status == "UNVERIFIED" else None,
                              "measured_by_name": (user_brief(db, m.measured_by) or {}).get("full_name")} for m in ms]}


@router.get("/kpis")
def list_kpis(entity_type: str, entity_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    check_entity_access(db, cu, entity_type, entity_id)
    return [_kpi(db, k) for k in db.scalars(select(Kpi).where(Kpi.entity_type == entity_type, Kpi.entity_id == entity_id)
                                            .order_by(Kpi.is_primary.desc(), Kpi.created_at)).all()]


@router.post("/kpis")
def add_kpi(body: KpiIn, request: Request, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    check_entity_access(db, cu, body.entity_type, body.entity_id, write=True)
    if not body.name.strip():
        raise DomainError("NAME_REQUIRED", "Name the KPI.")
    has_primary = db.scalar(select(Kpi.id).where(Kpi.entity_type == body.entity_type, Kpi.entity_id == body.entity_id,
                                                 Kpi.is_primary.is_(True)))
    k = Kpi(**body.model_dump(), created_by=cu.id)
    k.is_primary = body.is_primary or not has_primary
    db.add(k)
    audit(db, cu.id, "CREATE", "kpi", k.id, f"Added KPI '{k.name}'", {}, request.state.request_id)
    db.commit()
    return _kpi(db, k)


class KpiPatch(BaseModel):
    baseline_value: float | None = None
    baseline_period: str | None = None
    target_value: float | None = None
    target_date: date | None = None


@router.patch("/kpis/{kpi_id}")
def update_kpi(kpi_id: str, body: KpiPatch, request: Request, cu: CurrentUser = Depends(get_current_user),
               db: Session = Depends(get_db)):
    k = db.get(Kpi, kpi_id)
    if not k:
        raise not_found("KPI")
    check_entity_access(db, cu, k.entity_type, k.entity_id, write=True)
    before = [k.baseline_value, k.target_value]
    for key, v in body.model_dump(exclude_unset=True).items():
        setattr(k, key, v)
    audit(db, cu.id, "UPDATE", "kpi", k.id, f"Changed baseline/target of '{k.name}'",
          {"baseline": [before[0], k.baseline_value], "target": [before[1], k.target_value]}, request.state.request_id)
    db.commit()
    return _kpi(db, k)


class MeasurementIn(BaseModel):
    period_start: date | None = None
    period_end: date | None = None
    measured_value: float
    source: str = "MANUAL"
    note: str | None = None


@router.post("/kpis/{kpi_id}/measurements")
def add_measurement(kpi_id: str, body: MeasurementIn, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    k = db.get(Kpi, kpi_id)
    if not k:
        raise not_found("KPI")
    check_entity_access(db, cu, k.entity_type, k.entity_id, write=True)
    m = KpiMeasurement(kpi_id=k.id, **body.model_dump(), measured_by=cu.id, verification_status="UNVERIFIED", created_by=cu.id)
    if not m.period_end:
        m.period_end = utcnow().date()
    db.add(m)
    from app.modules.evaluation.gates import admin_ids
    # Nobody is picked automatically: the Super Admin / DMD chooses who verifies it.
    publish_event(db, "KPI_MEASURED", k.entity_type, k.entity_id, cu.id, users=admin_ids(db),
                  title=f"Measurement waiting for a verifier: {k.name}",
                  body=f"{body.measured_value:g} {k.unit_code} recorded. Choose who verifies it.",
                  link="/impact", needs_action=True)
    db.commit()
    return {"id": m.id}


class VerifyIn(BaseModel):
    status: str                      # VERIFIED, ADJUSTED, REJECTED
    verification_type: str = "BUSINESS"
    verified_value: float | None = None
    note: str | None = None


class VerifierIn(BaseModel):
    user_id: str


@router.post("/measurements/{measurement_id}/verifier")
def choose_verifier(measurement_id: str, body: VerifierIn, request: Request,
                    cu: CurrentUser = Depends(require_roles("SUPER_ADMIN")), db: Session = Depends(get_db)):
    """The Super Admin / DMD chooses who verifies a KPI measurement. It then shows in that person's judging panel."""
    m = db.get(KpiMeasurement, measurement_id)
    if not m:
        raise not_found("Measurement")
    k = db.get(Kpi, m.kpi_id)
    if m.verification_status != "UNVERIFIED":
        raise DomainError("ALREADY_VERIFIED", "This measurement was already checked.", 409)
    user = db.get(User, body.user_id)
    if not user or not user.is_active:
        raise DomainError("USER_NOT_FOUND", "Choose a person with an active account.", 422)
    from app.modules.evaluation import service as esvc
    if body.user_id == m.measured_by or body.user_id in esvc.people_of(db, k.entity_type, k.entity_id):
        raise DomainError("CONFLICT_OF_INTEREST", "A person can't verify a measurement of their own idea.", 422)
    previous = _assigned_id(db, m.id)
    if previous == body.user_id:
        return {"ok": True, "unchanged": True}
    for old in db.scalars(select(KpiVerifierAssignment).where(KpiVerifierAssignment.measurement_id == m.id)).all():
        db.delete(old)
    db.add(KpiVerifierAssignment(measurement_id=m.id, verifier_user_id=body.user_id, assigned_by=cu.id, created_by=cu.id))
    audit(db, cu.id, "CONFIG_CHANGE", "kpi_measurement", m.id, f"Chose {user.full_name} to verify '{k.name}'",
          {"verifier": [previous, body.user_id]}, request.state.request_id)
    publish_event(db, "KPI_VERIFIER_ASSIGNED", k.entity_type, k.entity_id, cu.id, users=[body.user_id],
                  title=f"KPI to verify: {k.name}",
                  body=f"{m.measured_value:g} {k.unit_code} recorded. Open it under My judging and verify, adjust or reject it.",
                  link="/review", needs_action=True)
    db.commit()
    return {"ok": True, "verifier": user_brief(db, body.user_id)}


@router.post("/measurements/{measurement_id}/verify")
def verify_measurement(measurement_id: str, body: VerifyIn, request: Request,
                       cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """RB-06: a benefit is 'Verified' only when the person the admin chose (or the admin) confirms it."""
    m = db.get(KpiMeasurement, measurement_id)
    if not m:
        raise not_found("Measurement")
    if _assigned_id(db, m.id) != cu.id and not cu.has_role("SUPER_ADMIN"):
        raise not_found("Measurement")
    k = db.get(Kpi, m.kpi_id)
    if body.status not in ("VERIFIED", "ADJUSTED", "REJECTED"):
        raise DomainError("INVALID_STATUS", "Choose Verify, Adjust or Reject.")
    if m.verification_status != "UNVERIFIED":
        raise DomainError("ALREADY_VERIFIED", "This measurement was already checked.", 409)
    if m.measured_by == cu.id:
        raise DomainError("SELF_VERIFICATION", "You can't verify a measurement you recorded yourself.")
    if body.status == "ADJUSTED" and body.verified_value is None:
        raise DomainError("VALUE_REQUIRED", "Enter the adjusted value.")
    if body.status in ("ADJUSTED", "REJECTED") and not (body.note or "").strip():
        raise DomainError("NOTE_REQUIRED", "Add a note explaining the adjustment or rejection.")
    before = m.verification_status
    m.verification_status, m.verification_type = body.status, body.verification_type
    m.verified_value = body.verified_value if body.status == "ADJUSTED" else m.measured_value if body.status == "VERIFIED" else None
    m.verifier_user_id, m.verification_note, m.verified_at = cu.id, body.note, utcnow()
    audit(db, cu.id, "UPDATE", "kpi_measurement", m.id, f"Impact {body.status.lower()} for '{k.name}'",
          {"status": [before, body.status], "value": [m.measured_value, m.verified_value]}, request.state.request_id)
    publish_event(db, "IMPACT_VERIFIED", k.entity_type, k.entity_id, cu.id, users=[m.measured_by],
                  title=f"Measurement {body.status.lower()}: {k.name}", body=body.note or "", link="/impact")
    db.commit()
    return {"ok": True}


@router.get("/impact")
def impact_overview(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Owners see their own ideas in pilot/production; verifiers get a queue of measurements to check."""
    is_admin = cu.has_role("SUPER_ADMIN")
    mine, queue, portfolio = [], [], []
    chosen = {a.measurement_id for a in db.scalars(select(KpiVerifierAssignment).where(
        KpiVerifierAssignment.verifier_user_id == cu.id)).all()}
    member_of = set(db.scalars(select(InitiativeMember.initiative_id).where(InitiativeMember.user_id == cu.id)).all())
    for ini in db.scalars(select(Initiative).where(Initiative.deleted_at.is_(None),
                                                   Initiative.current_state_code.in_(
                                                       ["PROTOTYPE", "DEMO_VALIDATION", "PILOT", "PRODUCTION", "IMPACT_VERIFIED", "SCALED"]))
                          .order_by(Initiative.updated_at.desc())).all():
        own = ini.owner_user_id == cu.id or ini.id in member_of
        if not own and not initiative_role(db, cu, ini):
            continue
        kpis = [_kpi(db, k) for k in db.scalars(select(Kpi).where(Kpi.entity_type == "initiative", Kpi.entity_id == ini.id)
                                                .order_by(Kpi.is_primary.desc())).all()]
        item = {"id": ini.id, "code": ini.code, "title": ini.title, "current_state_code": ini.current_state_code,
                "owner": (user_brief(db, ini.owner_user_id) or {}).get("full_name"), "kpis": kpis, "can_edit": own or cu.privileged}
        (mine if own else portfolio).append(item)
    # The queue holds only what the admin chose for this person; the admin sees every waiting measurement to assign it.
    for ini in (db.scalars(select(Initiative).where(Initiative.deleted_at.is_(None))).all() if (is_admin or chosen) else []):
        for k in db.scalars(select(Kpi).where(Kpi.entity_type == "initiative", Kpi.entity_id == ini.id)).all():
            for m in _kpi(db, k)["measurements"]:
                if m["verification_status"] != "UNVERIFIED" or m["measured_by"] == cu.id:
                    continue
                if m["id"] in chosen or is_admin:
                    queue.append({"measurement": m, "kpi": {"id": k.id, "name": k.name, "unit_code": k.unit_code,
                                                           "baseline_value": k.baseline_value, "target_value": k.target_value},
                                  "initiative": {"code": ini.code, "title": ini.title},
                                  "can_decide": m["id"] in chosen or is_admin, "can_assign": is_admin})
    can_verify = is_admin or bool(chosen)
    return {"mine": mine, "portfolio": portfolio if (cu.sees_all or can_verify) else [], "verify_queue": queue,
            "can_verify": can_verify, "can_assign": is_admin}


@router.get("/kpi-verifications/{measurement_id}")
def verification_detail(measurement_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """What the chosen verifier sees in the judging panel: the idea, the KPI, its history and the number to check."""
    m = db.get(KpiMeasurement, measurement_id)
    if not m:
        raise not_found("Measurement")
    mine = _assigned_id(db, m.id) == cu.id
    if not mine and not cu.has_role("SUPER_ADMIN"):
        raise not_found("Measurement")
    k = db.get(Kpi, m.kpi_id)
    ini = db.get(Initiative, k.entity_id) if k.entity_type == "initiative" else None
    data = _kpi(db, k)
    return {"measurement": next(x for x in data["measurements"] if x["id"] == m.id),
            "kpi": {"id": k.id, "name": k.name, "unit_code": k.unit_code, "direction": k.direction,
                    "baseline_value": k.baseline_value, "target_value": k.target_value},
            "history": data["measurements"],
            "initiative": {"code": ini.code, "title": ini.title, "summary": ini.summary} if ini else {"code": "", "title": k.name},
            "can_decide": m.verification_status == "UNVERIFIED" and m.measured_by != cu.id and (mine or cu.has_role("SUPER_ADMIN")),
            "can_assign": cu.has_role("SUPER_ADMIN") and m.verification_status == "UNVERIFIED"}


def my_queue_items(db: Session, user_id: str) -> list[dict]:
    """KPI verifications chosen for this person, in the same shape as the rest of My judging."""
    items = []
    for a in db.scalars(select(KpiVerifierAssignment).where(KpiVerifierAssignment.verifier_user_id == user_id)).all():
        m = db.get(KpiMeasurement, a.measurement_id)
        k = db.get(Kpi, m.kpi_id) if m else None
        ini = db.get(Initiative, k.entity_id) if k and k.entity_type == "initiative" else None
        if not m or not ini:
            continue
        waiting = m.verification_status == "UNVERIFIED"
        items.append({"id": m.id, "kpi": True, "status": "ASSIGNED" if waiting else "SUBMITTED", "due_at": None,
                      "submitted_at": iso(m.verified_at), "round_type": "KPI_VERIFICATION", "round_name": "KPI verification",
                      "blind": False, "overdue_days": 0,
                      "entity": {"type": "initiative", "id": ini.id, "code": ini.code, "title": f"{ini.title} — {k.name}",
                                 "context": "Impact", "context_i18n": {"en": "Impact", "bn": "প্রভাব"},
                                 "entrant": None, "confidential": False}})
    return items


# ---- Results and awards --------------------------------------------------------------------------------
def _final_round(db: Session, challenge_id: str) -> ReviewRound | None:
    return csvc.round_of(db, challenge_id, "FINAL_JURY")


def _has_evidence(db: Session, entry: ChallengeEntry) -> bool:
    """RB-05: a working solution was submitted, or its demo (or pilot) was approved by the judges."""
    from app.modules.evaluation.gates import approved
    if db.scalar(select(EntrySubmission.id).where(EntrySubmission.challenge_entry_id == entry.id,
                                                  EntrySubmission.submission_type.in_(["FINAL_PROJECT", "PROTOTYPE"]),
                                                  EntrySubmission.status.in_(["SUBMITTED", "LOCKED"]))):
        return True
    return approved(db, "challenge_entry", entry.id, "PROTOTYPE") or approved(db, "challenge_entry", entry.id, "PILOT")


@router.get("/manage/challenges/{challenge_id}/results")
def results_workspace(challenge_id: str, cu: CurrentUser = Depends(require_roles(*OVERSEERS)), db: Session = Depends(get_db)):
    ch = db.get(Challenge, challenge_id)
    if not ch:
        raise not_found("Challenge")
    rnd = _final_round(db, ch.id)
    results = {r.entity_id: r for r in esvc.calculate_round(db, rnd)} if rnd else {}
    db.commit()
    decisions = {d.entity_id: d for d in db.scalars(select(AwardDecision).where(AwardDecision.challenge_id == ch.id)).all()}
    rows = []
    for e in db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == ch.id, ChallengeEntry.status_code.in_(
            ["FINALIST", "FINAL_SUBMITTED", "JUDGED", "WINNER", "RUNNER_UP", "PARTICIPANT", "CONVERTED_TO_INITIATIVE"]))).all():
        r, d = results.get(e.id), decisions.get(e.id)
        team = db.get(Team, e.team_id) if e.team_id else None
        demo = latest_gate(db, "challenge_entry", e.id, "PROTOTYPE")
        rows.append({"entry_id": e.id, "code": e.code, "title": e.title, "status_code": e.status_code,
                     "entrant": team.name if team else (user_brief(db, e.lead_user_id) or {}).get("full_name"),
                     "jury_score": r.final_score if r else None, "jury_rank": r.rank if r else None,
                     "reviews_completed": r.reviews_completed if r else 0, "reviews_expected": r.reviews_expected if r else 0,
                     "has_working_evidence": _has_evidence(db, e),
                     "demo_status": demo.status if demo else None,
                     "demo_link": (demo.content or {}).get("link") if demo and demo.status == "APPROVED" else None,
                     "converted_initiative_code": (db.get(Initiative, e.converted_initiative_id).code
                                                   if e.converted_initiative_id else None),
                     "decision": {"rank": d.rank, "result": d.result, "award_category_id": d.award_category_id,
                                  "decision_note": d.decision_note, "presentation_score": d.jury_score} if d else None})
    rows.sort(key=lambda r: (r["jury_rank"] is None, r["jury_rank"] or 0))
    pending = sum(r["reviews_expected"] - r["reviews_completed"] for r in rows)
    status = "PUBLISHED" if ch.results_published_at else "APPROVED" if ch.results_approved_at else "DRAFT" if decisions else "NONE"
    return {
        "challenge": {"id": ch.id, "code": ch.code, "title_i18n": ch.title_i18n, "status_code": ch.status_code, "slug": ch.slug},
        "round": {"id": rnd.id, "name": en(rnd.name_i18n), "status": rnd.status} if rnd else None,
        "entries": rows, "pending_reviews": pending, "status": status,
        "approved_by": (user_brief(db, ch.results_approved_by) or {}).get("full_name"),
        "approved_at": iso(ch.results_approved_at), "published_at": iso(ch.results_published_at),
        "prizes": [{"rank_from": p.rank_from, "rank_to": p.rank_to, "prize_type": p.prize_type, "amount": p.amount,
                    "description": en(p.description_i18n), "currency_code": p.currency_code}
                   for p in db.scalars(select(ChallengePrize).where(ChallengePrize.challenge_id == ch.id).order_by(ChallengePrize.rank_from)).all()],
        "award_categories": [{"id": a.id, "code": a.code, "name": en(a.name_i18n)} for a in db.scalars(
            select(AwardCategory).where(AwardCategory.is_active.is_(True)).order_by(AwardCategory.code)).all()],
        "can_manage": cu.privileged,
    }


class DecisionIn(BaseModel):
    entry_id: str
    presentation_score: float | None = None   # score the panel gave at the live presentation (0-100)
    rank: int
    result: str = "WINNER"       # WINNER or RUNNER_UP
    award_category_id: str | None = None
    decision_note: str | None = None


class DecisionsIn(BaseModel):
    decisions: list[DecisionIn]


@router.put("/manage/challenges/{challenge_id}/results/decisions")
def save_decisions(challenge_id: str, body: DecisionsIn, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                   db: Session = Depends(get_db)):
    """The jury's decision is recorded by a human. Nothing here is decided automatically (RB-04)."""
    ch = db.get(Challenge, challenge_id)
    if not ch:
        raise not_found("Challenge")
    if ch.results_published_at:
        raise DomainError("RESULTS_PUBLISHED", "Published results can't be changed.", 409)
    if not any(d.result == "WINNER" for d in body.decisions):
        raise DomainError("WINNER_REQUIRED", "Choose at least one winner.")
    rnd = _final_round(db, ch.id)
    scores = {r.entity_id: r.final_score for r in db.scalars(select(RoundResult).where(RoundResult.review_round_id == rnd.id)).all()} if rnd else {}
    for d in body.decisions:
        entry = db.get(ChallengeEntry, d.entry_id)
        if not entry or entry.challenge_id != ch.id:
            raise not_found("Entry")
        if d.presentation_score is not None and not 0 <= d.presentation_score <= 100:
            raise DomainError("SCORE_RANGE", "The presentation score is between 0 and 100.", 422)
        if d.result == "WINNER" and not _has_evidence(db, entry):   # RB-05
            raise DomainError("WORKING_EVIDENCE_REQUIRED", f"{entry.code} has no working solution submitted. "
                                                           "A top award needs working evidence.", 409)
    for old in db.scalars(select(AwardDecision).where(AwardDecision.challenge_id == ch.id)).all():
        db.delete(old)
    for d in body.decisions:
        db.add(AwardDecision(challenge_id=ch.id, award_category_id=d.award_category_id, entity_type="challenge_entry",
                             entity_id=d.entry_id, rank=d.rank, result=d.result, decision_note=d.decision_note,
                             jury_score=d.presentation_score if d.presentation_score is not None else scores.get(d.entry_id),
                             publication_status="DRAFT", created_by=cu.id))
    ch.results_approved_by = ch.results_approved_at = None
    record_history(db, "challenge", ch.id, ch.status_code, "RESULTS_PENDING_APPROVAL", "RECORD_JURY_DECISION", cu.id)
    ch.status_code = "RESULTS_PENDING_APPROVAL"
    audit(db, cu.id, "UPDATE", "challenge", ch.id, f"Recorded jury decision for {ch.code}",
          {"decisions": [None, [d.model_dump() for d in body.decisions]]}, request.state.request_id)
    db.commit()
    return {"status": "DRAFT"}


@router.post("/manage/challenges/{challenge_id}/results/actions/{action}")
def results_action(challenge_id: str, action: str, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                   db: Session = Depends(get_db)):
    ch = db.get(Challenge, challenge_id)
    if not ch:
        raise not_found("Challenge")
    decisions = db.scalars(select(AwardDecision).where(AwardDecision.challenge_id == ch.id).order_by(AwardDecision.rank)).all()
    if not decisions:
        raise DomainError("NO_DECISION", "Record the jury decision first.", 409)
    now = utcnow()
    if action == "approve":
        ch.results_approved_by, ch.results_approved_at = cu.id, now
        for d in decisions:
            d.publication_status, d.approved_by, d.approved_at = "APPROVED", cu.id, now
        audit(db, cu.id, "UPDATE", "challenge", ch.id, f"Approved results for {ch.code}", {}, request.state.request_id)
        db.commit()
        return {"status": "APPROVED"}
    if action != "publish":
        raise not_found("Action")
    if not ch.results_approved_at:
        raise DomainError("RESULTS_NOT_APPROVED", "Results must be approved before they are published.", 409)
    if ch.results_published_at:
        raise DomainError("RESULTS_PUBLISHED", "Results are already published.", 409)
    prizes = db.scalars(select(ChallengePrize).where(ChallengePrize.challenge_id == ch.id)).all()
    decided = {d.entity_id: d for d in decisions}
    rnd = _final_round(db, ch.id)
    for entry in db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == ch.id)).all():
        d = decided.get(entry.id)
        if d:
            new = "WINNER" if d.result == "WINNER" else "RUNNER_UP"
            entry.final_rank = d.rank
            d.publication_status, d.published_at = "PUBLISHED", now
            shares = esvc.team_shares(db, entry)
            for p in prizes:   # team prizes are split by the agreed credit share
                if p.rank_from <= d.rank <= p.rank_to:
                    for uid, pct in shares.items():
                        db.add(Reward(recipient_user_id=uid, source_type="challenge_prize", source_id=entry.id,
                                      reward_type=p.prize_type, title=f"{en(p.description_i18n)} — {en(ch.title_i18n)}",
                                      amount=round((p.amount or 0) * pct / 100, 2) if p.amount else None, share_pct=pct,
                                      status="SENT_TO_HR", approved_by=cu.id, approved_at=now))
            esvc.award_points(db, list(shares), 300 if new == "WINNER" else 150, new,
                              "WINNER" if new == "WINNER" else "FINALIST", "challenge_entry", entry.id)
        elif entry.status_code in ("FINALIST", "FINAL_SUBMITTED", "JUDGED"):
            new = "PARTICIPANT"
        else:
            continue
        record_history(db, "challenge_entry", entry.id, entry.status_code, new, "RESULTS_PUBLISHED", cu.id)
        entry.status_code = new
        fb = None
        if rnd:
            res = db.scalar(select(RoundResult).where(RoundResult.review_round_id == rnd.id, RoundResult.entity_id == entry.id))
            fb = db.scalar(select(Feedback).where(Feedback.review_round_id == rnd.id, Feedback.entity_id == entry.id))
            if not fb:
                esvc.ensure_feedback_drafts(db, rnd, cu.id)
                fb = db.scalar(select(Feedback).where(Feedback.review_round_id == rnd.id, Feedback.entity_id == entry.id))
            if fb:
                if d and d.jury_score is not None:
                    fb.score_shared = d.jury_score      # the panel's final (live presentation) score
                fb.decision_code, fb.published_at = new, now
                fb.decision_reason = fb.decision_reason or (d.decision_note if d else None)
                fb.next_steps = fb.next_steps or ("Your solution can now continue as an initiative towards pilot and production."
                                                  if d else "Thank you for presenting at Demo Day. Your work stays on record.")
            if res:
                res.is_frozen = True
        if not fb:      # the final presentation was given live: the entrant still gets the result in the system
            db.add(Feedback(entity_type="challenge_entry", entity_id=entry.id, decision_code=new, written_by=cu.id,
                            strengths="", improvements="", published_at=now, score_shared=d.jury_score if d else None,
                            decision_reason=(d.decision_note if d else None), review_round_id=rnd.id if rnd else None,
                            next_steps=("Your solution can now continue as an initiative towards pilot and production."
                                        if d else "Thank you for presenting at Demo Day. Your work stays on record.")))
        publish_event(db, "AWARD_PUBLISHED", "challenge_entry", entry.id, cu.id, users=csvc.notify_entry(db, entry),
                      title=f"Results are out: {en(ch.title_i18n)}",
                      body={"WINNER": "Congratulations — your entry won.", "RUNNER_UP": "Congratulations — your entry is a runner-up."}
                      .get(new, "See the results and your feedback."),
                      link=f"/entries/{entry.id}/feedback",
                      vars={"challenge": en(ch.title_i18n), "entry_code": entry.code,
                            "result": {"WINNER": "Winner", "RUNNER_UP": "Runner-up"}.get(new, "Completed"),
                            # an email whose subject starts with "Congratulations" gets the champion look
                            "headline": {"WINNER": "Congratulations, you are the champion",
                                         "RUNNER_UP": "Congratulations, you are a runner-up"}.get(new, "Results published")})
    record_history(db, "challenge", ch.id, ch.status_code, "RESULTS_PUBLISHED", "PUBLISH_RESULTS", cu.id)
    ch.status_code, ch.results_published_at = "RESULTS_PUBLISHED", now
    if rnd:
        rnd.status = "PUBLISHED"
    audit(db, cu.id, "UPDATE", "challenge", ch.id, f"Published results for {ch.code}", {}, request.state.request_id)
    publish_event(db, "CHALLENGE_RESULTS_PUBLISHED", "challenge", ch.id, cu.id)
    db.commit()
    return {"status": "PUBLISHED"}


@router.post("/entries/{entry_id}/actions/convert-to-initiative")
def convert_to_initiative(entry_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*MANAGERS)),
                          db: Session = Depends(get_db)):
    """A winning entry continues as an initiative towards pilot, production, impact and scale."""
    from app.core.events import next_code
    from app.modules.initiatives import service as isvc
    entry = get_entry_or_404(db, cu, entry_id)
    if entry.status_code not in ("WINNER", "RUNNER_UP"):
        raise DomainError("NOT_A_WINNER", "Only winning entries can continue as an initiative.", 409)
    if entry.converted_initiative_id:
        raise DomainError("ALREADY_CONVERTED", "This entry already continues as an initiative.", 409)
    ch = db.get(Challenge, entry.challenge_id)
    sub = db.scalar(select(EntrySubmission).where(EntrySubmission.challenge_entry_id == entry.id,
                                                  EntrySubmission.submission_type == "METHODOLOGY"))
    c = (sub.content if sub else {}) or {}
    now = utcnow()
    ini = Initiative(code=next_code(db, "INNO", 6), title=entry.title, summary=entry.summary,
                     problem_statement=c.get("problem_understanding") or en(ch.problem_statement_i18n),
                     current_process=c.get("current_situation") or en(ch.background_i18n),
                     proposed_solution=c.get("approach") or entry.summary, expected_benefit=c.get("expected_impact"),
                     category_id=ch.category_id, challenge_entry_id=entry.id, owner_user_id=entry.lead_user_id,
                     submitted_by_user_id=entry.lead_user_id, sponsor_user_id=ch.sponsor_user_id, org_unit_id=entry.org_unit_id,
                     data_classification_code=ch.data_classification_code, current_state_code="PROTOTYPE",
                     current_stage_entered_at=now, submitted_at=now, is_awarded=True, declaration_accepted=True, created_by=cu.id)
    db.add(ini)
    db.flush()
    shares = esvc.team_shares(db, entry)
    isvc.set_members(db, ini, [{"user_id": u, "credit_share_pct": p} for u, p in shares.items() if u != entry.lead_user_id])
    entry.converted_initiative_id = ini.id
    record_history(db, "initiative", ini.id, None, "PROTOTYPE", "CONVERTED_FROM_ENTRY", cu.id, f"From {entry.code}")
    audit(db, cu.id, "CREATE", "initiative", ini.id, f"Converted {entry.code} to {ini.code}", {}, request.state.request_id)
    publish_event(db, "INITIATIVE_STATE_CHANGED", "initiative", ini.id, cu.id, users=list(shares),
                  title=f"Your winning entry continues as {ini.code}", body="Track the pilot and impact from My ideas.",
                  link=f"/ideas/{ini.code}")
    db.commit()
    return {"code": ini.code}


@router.get("/results")
def published_results(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Published results only: winners' title, team name, short summary and prize. Non-winning entries are never listed."""
    categories = {a.id: en(a.name_i18n) for a in db.scalars(select(AwardCategory)).all()}
    challenges = []
    for ch in db.scalars(select(Challenge).where(Challenge.results_published_at.is_not(None))
                         .order_by(Challenge.results_published_at.desc())).all():
        prizes = db.scalars(select(ChallengePrize).where(ChallengePrize.challenge_id == ch.id)).all()
        winners = []
        for d in db.scalars(select(AwardDecision).where(AwardDecision.challenge_id == ch.id,
                                                        AwardDecision.publication_status == "PUBLISHED").order_by(AwardDecision.rank)).all():
            entry = db.get(ChallengeEntry, d.entity_id)
            team = db.get(Team, entry.team_id) if entry.team_id else None
            prize = next((p for p in prizes if p.rank_from <= d.rank <= p.rank_to), None)
            winners.append({"rank": d.rank, "result": d.result, "award_category": categories.get(d.award_category_id),
                            "score": d.jury_score, "jury_note": d.decision_note,
                            "title": entry.title if ch.publish_winner_summaries else None,
                            "team_name": (team.name if team else (user_brief(db, entry.lead_user_id) or {}).get("full_name"))
                            if ch.publish_winner_summaries else None,
                            "summary": entry.summary if ch.publish_winner_summaries else None,
                            "prize": {"description": en(prize.description_i18n), "amount": prize.amount,
                                      "currency_code": prize.currency_code, "prize_type": prize.prize_type} if prize else None})
        challenges.append({"id": ch.id, "slug": ch.slug, "code": ch.code, "title_i18n": ch.title_i18n,
                           "results_published_at": iso(ch.results_published_at), "winners": winners})
    hall = []
    for ini in db.scalars(select(Initiative).where(Initiative.deleted_at.is_(None),
                                                   Initiative.data_classification_code.in_(["PUBLIC", "INTERNAL"]),
                                                   Initiative.current_state_code.in_(["PRODUCTION", "IMPACT_VERIFIED", "SCALED"]))
                          .order_by(Initiative.implemented_on.desc())).all():
        primary = db.scalar(select(Kpi).where(Kpi.entity_type == "initiative", Kpi.entity_id == ini.id).order_by(Kpi.is_primary.desc()))
        k = _kpi(db, primary) if primary else None
        hall.append({"code": ini.code, "title": ini.title, "summary": ini.summary, "is_awarded": ini.is_awarded,
                     "current_state_code": ini.current_state_code, "owner": (user_brief(db, ini.owner_user_id) or {}).get("full_name"),
                     "impact": {"name": k["name"], "baseline": k["baseline_value"], "actual": k["latest_value"],
                                "unit": k["unit_code"], "verified": k["is_verified"]} if k else None})
    return {"challenges": challenges, "hall_of_fame": hall}


# ---- Catalogue ---------------------------------------------------------------------------------------------
@router.get("/catalogue/assets")
def catalogue(q: str = "", asset_type: str = "", cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Implemented or scaled, non-confidential innovations that other teams can reuse."""
    items = []
    for a in db.scalars(select(ReusableAsset).where(ReusableAsset.is_published.is_(True),
                                                    ReusableAsset.data_classification_code.in_(["PUBLIC", "INTERNAL"]))
                        .order_by(ReusableAsset.published_at.desc())).all():
        if asset_type and a.asset_type != asset_type:
            continue
        if q and q.lower() not in f"{a.title} {a.description} {a.technology}".lower():
            continue
        ini = db.get(Initiative, a.source_initiative_id) if a.source_initiative_id else None
        items.append({**row(a, exclude=("created_by", "updated_by")), "owner": user_brief(db, a.owner_user_id),
                      "innovation_id": ini.code if ini else None, "is_awarded": bool(ini and ini.is_awarded),
                      "status": ini.current_state_code if ini else None})
    return {"items": items, "total": len(items), "page": 1}
