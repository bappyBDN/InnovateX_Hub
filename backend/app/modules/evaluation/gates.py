"""Prototype review and pilot review.

When a prototype is allowed, the candidate fills a short form (the link and how to use it) and sends it for review.
Judges chosen by the admin each approve it, send it back for changes, or reject it — a decision with written feedback,
no score. Most judges decide; the admin can always make the final call. An approved prototype moves on to the pilot,
and the pilot is reviewed the same way with a short pilot report.

Works for an idea (prototype and pilot) and for a challenge entry (prototype; a winning entry continues as an idea
for its pilot).
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import DomainError, not_found
from app.core.events import publish_event, record_history
from app.core.permissions import CurrentUser, get_entry_or_404, is_entry_member
from app.modules.challenges import service as csvc
from app.modules.challenges.models import Challenge, ChallengeEntry, Team
from app.modules.evaluation import service as svc
from app.modules.evaluation.models import PanelMember, ReviewAssignment, StageGate, StageGateVote
from app.modules.identity.models import Role, User, UserRoleAssignment
from app.modules.initiatives.models import Initiative, InitiativeMember
from app.shared.models.base import iso, utcnow
from app.shared.util import en, user_brief

STAGE_TITLE = {"PROTOTYPE": "Prototype review", "PILOT": "Pilot review"}
# field key, label, required, kind
FIELDS = {
    "PROTOTYPE": [("link", "Prototype link", True, "URL"),
                  ("how_to_use", "How to use it", True, "TEXT"),
                  ("notes", "Anything else the judges should know", False, "TEXT")],
    "PILOT": [("summary", "What was tested in the pilot", True, "TEXT"),
              ("results", "Results against the target", True, "TEXT"),
              ("link", "Link to evidence", False, "URL"),
              ("next_steps", "What is needed to go live", False, "TEXT")],
}
DECISIONS = {"APPROVE": "APPROVED", "REVISE": "CHANGES_REQUESTED", "REJECT": "REJECTED"}
OUTCOME_TEXT = {"APPROVED": "approved", "CHANGES_REQUESTED": "sent back for changes", "REJECTED": "rejected"}


# ---- The thing being reviewed -------------------------------------------------------------------
class Subject:
    """An idea or a challenge entry, with the few facts the review needs."""

    def __init__(self, db: Session, entity_type: str, entity_id: str):
        self.db, self.entity_type = db, entity_type
        if entity_type == "initiative":
            ini = db.get(Initiative, entity_id) or db.scalar(select(Initiative).where(Initiative.code == entity_id))
            if not ini or ini.deleted_at:
                raise not_found("Idea")
            self.obj, self.id, self.code, self.title = ini, ini.id, ini.code or ini.id, ini.title
            self.context, self.link = "Idea", f"/ideas/{ini.code or ini.id}"
            self.summary = ini.summary or ini.problem_statement or ""
        elif entity_type == "challenge_entry":
            entry = db.get(ChallengeEntry, entity_id)
            if not entry or entry.deleted_at:
                raise not_found("Entry")
            ch = db.get(Challenge, entry.challenge_id)
            self.obj, self.id, self.code, self.title = entry, entry.id, entry.code, entry.title
            self.challenge, self.context, self.link = ch, en(ch.title_i18n), f"/entries/{entry.id}/prototype"
            team = db.get(Team, entry.team_id) if entry.team_id else None
            self.summary = f"Entry by {team.name if team else (user_brief(db, entry.lead_user_id) or {}).get('full_name', '')}"
        else:
            raise not_found("Record")

    def people(self) -> list[str]:
        return [p for p in svc.people_of(self.db, self.entity_type, self.id) if p]

    def is_member(self, user_id: str) -> bool:
        if self.entity_type == "challenge_entry":
            return is_entry_member(self.db, self.obj, user_id)
        ini = self.obj
        if user_id in (ini.owner_user_id, ini.submitted_by_user_id):
            return True
        return bool(self.db.scalar(select(InitiativeMember.id).where(InitiativeMember.initiative_id == ini.id,
                                                                     InitiativeMember.user_id == user_id,
                                                                     InitiativeMember.left_at.is_(None))))

    def stages(self) -> list[str]:
        return ["PROTOTYPE", "PILOT"] if self.entity_type == "initiative" else ["PROTOTYPE"]

    def open_reason(self, stage: str) -> str | None:
        """None when the candidate may send this stage for review now; otherwise why not."""
        if self.entity_type == "initiative":
            state = self.obj.current_state_code
            if stage == "PROTOTYPE":
                return None if state in ("PROTOTYPE", "DEMO_VALIDATION") else "Opens when a prototype is authorised for this idea."
            return None if state == "PILOT" else "Opens when the idea is in pilot."
        entry, ch = self.obj, self.challenge
        if not (entry.prototype_required or ch.prototype_policy in ("OPTIONAL", "REQUIRED_ALL")):
            return "No prototype is needed for this entry."
        phase = csvc.phase_of(self.db, ch.id, "PROTOTYPE")
        if phase and utcnow() < phase.opens_at:
            return f"The prototype window opens on {csvc._fmt(phase.opens_at)}."
        if phase and not csvc.phase_is_open(phase):
            return f"The prototype window closed on {csvc._fmt(phase.closes_at)}."
        if entry.status_code not in ("SHORTLISTED", "BUILDING", "PROTOTYPE_SUBMITTED"):
            return "Opens when the entry is shortlisted."
        return None

    def relevant(self, stage: str) -> bool:
        """Whether to show this stage at all (hide the pilot box on an idea that is nowhere near a pilot)."""
        if self.entity_type == "challenge_entry":
            return bool(self.obj.prototype_required or self.challenge.prototype_policy in ("OPTIONAL", "REQUIRED_ALL")) \
                and self.obj.status_code not in ("REGISTERED", "METHODOLOGY_SUBMITTED", "UNDER_REVIEW", "WITHDRAWN", "NO_SUBMISSION")
        state = self.obj.current_state_code
        after_prototype = ("PROTOTYPE", "DEMO_VALIDATION", "PILOT", "PRODUCTION", "IMPACT_VERIFIED", "SCALED")
        return state in after_prototype if stage == "PROTOTYPE" else state in after_prototype[2:]

    def set_state(self, new: str, action: str, actor_id: str | None, comment: str | None = None) -> None:
        now = utcnow()
        if self.entity_type == "initiative":
            ini = self.obj
            if ini.current_state_code == new:
                return
            record_history(self.db, "initiative", ini.id, ini.current_state_code, new, action, actor_id, comment)
            ini.current_state_code, ini.current_stage_entered_at = new, now
            ini.is_in_idea_bank = new == "NOT_SELECTED"
            if new == "CLOSED":
                ini.closed_at = now
        else:
            entry = self.obj
            if entry.status_code == new:
                return
            record_history(self.db, "challenge_entry", entry.id, entry.status_code, new, action, actor_id, comment)
            entry.status_code = new


def has_gate(db: Session, entity_type: str, entity_id: str, stage: str = "PROTOTYPE") -> bool:
    return bool(db.scalar(select(StageGate.id).where(StageGate.entity_type == entity_type, StageGate.entity_id == entity_id,
                                                     StageGate.stage == stage, StageGate.status != "DRAFT").limit(1)))


def approved(db: Session, entity_type: str, entity_id: str, stage: str) -> bool:
    gate = latest(db, entity_type, entity_id, stage)
    return bool(gate and gate.status == "APPROVED")


def rounds(db: Session, entity_type: str, entity_id: str, stage: str) -> list[StageGate]:
    return list(db.scalars(select(StageGate).where(StageGate.entity_type == entity_type, StageGate.entity_id == entity_id,
                                                   StageGate.stage == stage).order_by(StageGate.round_no.desc())).all())


def latest(db: Session, entity_type: str, entity_id: str, stage: str) -> StageGate | None:
    found = rounds(db, entity_type, entity_id, stage)
    return found[0] if found else None


def votes_of(db: Session, gate: StageGate) -> list[StageGateVote]:
    return list(db.scalars(select(StageGateVote).where(StageGateVote.gate_id == gate.id).order_by(StageGateVote.created_at)).all())


def admin_ids(db: Session) -> list[str]:
    roles = select(Role.id).where(Role.code.in_(["SUPER_ADMIN", "DMD"]))
    return list(dict.fromkeys(db.scalars(select(UserRoleAssignment.user_id).where(UserRoleAssignment.role_id.in_(roles))).all()))


# ---- What each person sees ----------------------------------------------------------------------
def tally(votes: list[StageGateVote]) -> dict:
    count = {d: sum(1 for v in votes if v.decision == d) for d in DECISIONS}
    return {"approve": count["APPROVE"], "revise": count["REVISE"], "reject": count["REJECT"],
            "pending": sum(1 for v in votes if not v.decision), "total": len(votes)}


def gate_view(db: Session, gate: StageGate, staff: bool) -> dict:
    """Candidates see the judges' feedback without names, and only once the review is decided. Staff see everything."""
    votes = votes_of(db, gate)
    decided = gate.status in DECISIONS.values()
    feedback = [{"decision": v.decision, "feedback": v.feedback, "decided_at": iso(v.decided_at),
                 "judge": user_brief(db, v.judge_user_id) if staff else None}
                for v in votes if (staff or (decided and v.decision))]
    return {"id": gate.id, "stage": gate.stage, "round_no": gate.round_no, "status": gate.status, "content": gate.content or {},
            "submitted_at": iso(gate.submitted_at), "decided_at": iso(gate.decided_at), "decision_note": gate.decision_note,
            "decided_by_admin": bool(gate.decided_by), "tally": tally(votes), "feedback": feedback}


def overview(db: Session, cu: CurrentUser, subject: Subject) -> dict:
    member = subject.is_member(cu.id)
    admin = cu.has_role("SUPER_ADMIN")
    staff = admin or cu.privileged or cu.has_role("EXECUTIVE")
    out = []
    for stage in subject.stages():
        found = rounds(db, subject.entity_type, subject.id, stage)
        gate = found[0] if found else None
        if not gate and not subject.relevant(stage):
            continue
        reason = subject.open_reason(stage)
        editable = member and reason is None and (not gate or gate.status in ("DRAFT", "CHANGES_REQUESTED"))
        out.append({"stage": stage, "title": STAGE_TITLE[stage],
                    "fields": [{"key": k, "label": label, "required": req, "kind": kind} for k, label, req, kind in FIELDS[stage]],
                    "can_edit": editable, "closed_reason": None if gate and gate.status != "DRAFT" else reason,
                    "gate": gate_view(db, gate, staff) if gate else None,
                    "earlier": [gate_view(db, g, staff) for g in found[1:]]})
    return {"entity": {"type": subject.entity_type, "id": subject.id, "code": subject.code, "title": subject.title,
                       "context": subject.context},
            "stages": out, "is_member": member, "can_manage": admin}


# ---- Candidate: fill the form and send it -------------------------------------------------------
def save(db: Session, cu: CurrentUser, subject: Subject, stage: str, content: dict, submit: bool) -> StageGate:
    if stage not in subject.stages():
        raise not_found("Page")
    if not subject.is_member(cu.id):
        raise not_found("Page")
    reason = subject.open_reason(stage)
    if reason:
        raise DomainError("STAGE_NOT_OPEN", reason, 409)
    gate = latest(db, subject.entity_type, subject.id, stage)
    if gate and gate.status not in ("DRAFT", "CHANGES_REQUESTED"):
        raise DomainError("ALREADY_SENT", "This was already sent for review.", 409)
    clean = {k: str(content.get(k) or "").strip() for k, *_ in FIELDS[stage]}
    if gate and gate.status == "CHANGES_REQUESTED":     # a new round; the same judges look again
        previous = gate
        gate = StageGate(entity_type=subject.entity_type, entity_id=subject.id, stage=stage, round_no=previous.round_no + 1,
                         status="DRAFT", created_by=cu.id)
        db.add(gate)
        db.flush()
        for v in votes_of(db, previous):
            db.add(StageGateVote(gate_id=gate.id, judge_user_id=v.judge_user_id))
    elif not gate:
        gate = StageGate(entity_type=subject.entity_type, entity_id=subject.id, stage=stage, round_no=1, status="DRAFT",
                         created_by=cu.id)
        db.add(gate)
        db.flush()
    gate.content = clean
    if not submit:
        db.flush()
        return gate

    errors = {}
    for key, label, required, kind in FIELDS[stage]:
        if required and not clean[key]:
            errors[key] = "This field is required."
        elif kind == "URL" and clean[key] and not clean[key].lower().startswith(("http://", "https://")):
            errors[key] = "Enter a full link starting with http:// or https://."
    if errors:
        raise DomainError("VALIDATION_ERROR", "Some fields need attention.", 422, {"fields": errors})
    gate.status, gate.submitted_by, gate.submitted_at = "IN_REVIEW", cu.id, utcnow()
    db.flush()
    if not votes_of(db, gate):
        add_judges(db, gate, subject, default_judges(db, subject, stage), cu.id, notify=False)
    if subject.entity_type == "initiative" and stage == "PROTOTYPE":
        subject.set_state("DEMO_VALIDATION", "PROTOTYPE_SENT_FOR_REVIEW", cu.id)
    elif subject.entity_type == "challenge_entry":
        subject.set_state("PROTOTYPE_SUBMITTED", "PROTOTYPE_SENT_FOR_REVIEW", cu.id)
    judges = [v.judge_user_id for v in votes_of(db, gate)]
    name = STAGE_TITLE[stage]
    if judges:
        publish_event(db, "GATE_TO_REVIEW", subject.entity_type, subject.id, cu.id, users=judges,
                      title=f"{name}: {subject.code}", body=f"{subject.title}. Open it under My judging and give your decision.",
                      link="/review", needs_action=True)
    publish_event(db, "GATE_SUBMITTED", subject.entity_type, subject.id, cu.id, users=admin_ids(db),
                  title=f"{name} sent: {subject.code}",
                  body=f"{subject.title}. " + ("Check the judges." if judges else "No judges are chosen yet — choose them now."),
                  link=subject.link, needs_action=not judges)
    db.flush()
    return gate


# ---- Admin: judges and the final call -----------------------------------------------------------
def default_judges(db: Session, subject: Subject, stage: str) -> list[str]:
    """Start with the people who already judged this work; the admin can change them."""
    if subject.entity_type == "challenge_entry":
        members = db.scalars(select(PanelMember).where(PanelMember.panel_id.in_(_panel_ids(db, subject.challenge.id)))).all()
        return [m.user_id for m in members if not m.stages or "PROTOTYPE" in m.stages]
    if stage == "PILOT":
        prototype = latest(db, "initiative", subject.id, "PROTOTYPE")
        if prototype:
            earlier = [v.judge_user_id for v in votes_of(db, prototype)]
            if earlier:
                return earlier
    return list(dict.fromkeys(db.scalars(select(ReviewAssignment.reviewer_user_id).where(
        ReviewAssignment.entity_type == "initiative", ReviewAssignment.entity_id == subject.id,
        ReviewAssignment.status != "DECLINED_COI")).all()))


def _panel_ids(db: Session, challenge_id: str) -> list[str]:
    from app.modules.evaluation.models import Panel
    return list(db.scalars(select(Panel.id).where(Panel.challenge_id == challenge_id)).all()) or [""]


def add_judges(db: Session, gate: StageGate, subject: Subject, user_ids: list[str], actor_id: str | None, notify: bool = True) -> dict:
    have = {v.judge_user_id for v in votes_of(db, gate)}
    people = set(subject.people())
    added, skipped = [], []
    for uid in dict.fromkeys(user_ids):
        user = db.get(User, uid)
        if not user or not user.is_active or uid in have:
            continue
        reason = "SAME_TEAM" if uid in people else svc.conflict_reason(db, uid, subject.entity_type, subject.id)
        if reason:
            skipped.append({"name": user.full_name, "reason": reason})
            continue
        db.add(StageGateVote(gate_id=gate.id, judge_user_id=uid, created_by=actor_id))
        added.append(uid)
    db.flush()
    if added and notify and gate.status == "IN_REVIEW":
        publish_event(db, "GATE_TO_REVIEW", subject.entity_type, subject.id, actor_id, users=added,
                      title=f"{STAGE_TITLE[gate.stage]}: {subject.code}",
                      body=f"{subject.title}. Open it under My judging and give your decision.", link="/review", needs_action=True)
    return {"added": [db.get(User, u).full_name for u in added], "skipped": skipped, "created": len(added),
            "invited": [], "invalid_emails": []}


def remove_judge(db: Session, gate: StageGate, subject: Subject, user_id: str) -> None:
    vote = next((v for v in votes_of(db, gate) if v.judge_user_id == user_id), None)
    if not vote:
        raise DomainError("JUDGE_NOT_FOUND", "This person is not a judge of this review.", 404)
    if vote.decision:
        raise DomainError("ALREADY_DECIDED", "This judge already gave a decision, so they can't be removed.", 409)
    db.delete(vote)
    db.flush()
    settle(db, gate, subject)


def outcome_of(votes: list[StageGateVote]) -> str | None:
    """Most judges decide. With no clear majority once everyone has decided, it goes back for changes."""
    t = tally(votes)
    if not t["total"]:
        return None
    half = t["total"] / 2
    if t["approve"] > half:
        return "APPROVED"
    if t["reject"] > half:
        return "REJECTED"
    if t["revise"] > half or t["pending"] == 0:
        return "CHANGES_REQUESTED"
    return None


def settle(db: Session, gate: StageGate, subject: Subject) -> None:
    if gate.status != "IN_REVIEW":
        return
    result = outcome_of(votes_of(db, gate))
    if result:
        apply(db, gate, subject, result, None, None)


def vote(db: Session, cu: CurrentUser, ballot: StageGateVote, decision: str, feedback: str) -> StageGate:
    gate = db.get(StageGate, ballot.gate_id)
    if gate.status != "IN_REVIEW":
        raise DomainError("REVIEW_CLOSED", "This review is already decided.", 409)
    if decision not in DECISIONS:
        raise DomainError("DECISION_REQUIRED", "Choose a decision.", 422, {"fields": {"decision": "Choose a decision."}})
    if decision != "APPROVE" and len((feedback or "").strip()) < 10:
        raise DomainError("FEEDBACK_REQUIRED", "Write what should change, or why it is rejected. It is shared with the candidate.",
                          422, {"fields": {"feedback": "Write at least a sentence."}})
    subject = Subject(db, gate.entity_type, gate.entity_id)
    if cu.id in subject.people():
        raise DomainError("CONFLICT_OF_INTEREST", "You can't review your own work.")
    ballot.decision, ballot.feedback, ballot.decided_at = decision, (feedback or "").strip(), utcnow()
    db.flush()
    settle(db, gate, subject)
    return gate


def apply(db: Session, gate: StageGate, subject: Subject, result: str, actor_id: str | None, note: str | None) -> None:
    """Record the outcome and move the idea or entry on."""
    gate.status, gate.decided_at, gate.decided_by, gate.decision_note = result, utcnow(), actor_id, (note or "").strip() or None
    people = subject.people()
    action = f"{gate.stage}_{result}"
    next_step = ""
    if subject.entity_type == "initiative" and gate.stage == "PROTOTYPE":
        if result == "APPROVED":
            subject.set_state("PILOT", action, actor_id, note)
            svc.award_points(db, people, 80, "PILOT", "PILOT_STARTED", "initiative", subject.id)
            next_step = "Your idea moves to the pilot. Run it, then send the pilot report for review."
        elif result == "CHANGES_REQUESTED":
            subject.set_state("PROTOTYPE", action, actor_id, note)
            next_step = "Read the feedback, improve the prototype and send it again."
        else:
            subject.set_state("NOT_SELECTED", action, actor_id, note)
            next_step = "Thank you for building it. The idea stays on record in the Idea Bank."
    elif subject.entity_type == "initiative":           # pilot
        if result == "APPROVED":
            next_step = "The pilot is approved. The idea can now move to production."
        elif result == "CHANGES_REQUESTED":
            next_step = "Read the feedback, update the pilot report and send it again."
        else:
            subject.set_state("CLOSED", action, actor_id, note)
            next_step = "The pilot was stopped."
    else:                                               # challenge entry prototype
        if result == "APPROVED":
            subject.set_state("FINALIST", action, actor_id, note)
            svc.award_points(db, people, 80, "FINALIST", "FINALIST", "challenge_entry", subject.id)
            next_step = "You are a finalist. Book your demo slot and prepare your final project."
        elif result == "CHANGES_REQUESTED":
            subject.set_state("BUILDING", action, actor_id, note)
            next_step = "Read the feedback, improve the prototype and send it again before the window closes."
        else:
            subject.set_state("NOT_SELECTED", action, actor_id, note)
            next_step = "Thank you for building a prototype. Your work stays on record."
    title = f"{STAGE_TITLE[gate.stage]} {OUTCOME_TEXT[result]}: {subject.code}"
    publish_event(db, f"GATE_{result}", subject.entity_type, subject.id, actor_id, users=people, title=title, body=next_step,
                  link=subject.link, needs_action=result != "REJECTED")
    if subject.entity_type == "initiative" and gate.stage == "PILOT" and result == "APPROVED":
        publish_event(db, "GATE_APPROVED", "initiative", subject.id, actor_id, users=admin_ids(db), title=title,
                      body="The pilot review is approved. The idea can be moved to production.", link=subject.link, needs_action=True)
    db.flush()


def decide(db: Session, cu: CurrentUser, gate: StageGate, decision: str, note: str) -> None:
    """The admin's final call. It overrides the judges and always needs a reason."""
    if gate.status != "IN_REVIEW":
        raise DomainError("REVIEW_CLOSED", "This review is already decided.", 409)
    if decision not in DECISIONS:
        raise DomainError("DECISION_REQUIRED", "Choose a decision.", 422)
    if len((note or "").strip()) < 10:
        raise DomainError("REASON_REQUIRED", "Write the reason for your decision. It is shared with the candidate.", 422,
                          {"fields": {"note": "Write at least a sentence."}})
    apply(db, gate, Subject(db, gate.entity_type, gate.entity_id), DECISIONS[decision], cu.id, note)


# ---- Judge: my reviews --------------------------------------------------------------------------
def my_queue_items(db: Session, user_id: str) -> list[dict]:
    """Prototype and pilot reviews in the same shape as the scoring list of My judging."""
    items = []
    for ballot in db.scalars(select(StageGateVote).where(StageGateVote.judge_user_id == user_id)).all():
        gate = db.get(StageGate, ballot.gate_id)
        if not gate or gate.status == "DRAFT":
            continue
        try:
            subject = Subject(db, gate.entity_type, gate.entity_id)
        except DomainError:
            continue
        waiting = gate.status == "IN_REVIEW" and not ballot.decision
        items.append({"id": ballot.id, "gate": True, "status": "ASSIGNED" if waiting else "SUBMITTED", "due_at": None,
                      "submitted_at": iso(ballot.decided_at or gate.decided_at), "round_type": gate.stage,
                      "round_name": STAGE_TITLE[gate.stage] + (f" (round {gate.round_no})" if gate.round_no > 1 else ""),
                      "blind": False, "overdue_days": 0,
                      "entity": {"type": subject.entity_type, "id": subject.id, "code": subject.code, "title": subject.title,
                                 "context": subject.context, "context_i18n": {"en": subject.context},
                                 "entrant": None, "confidential": False}})
    return items


def is_gate_judge(db: Session, user_id: str) -> bool:
    return bool(db.scalar(select(StageGateVote.id).where(StageGateVote.judge_user_id == user_id).limit(1)))
