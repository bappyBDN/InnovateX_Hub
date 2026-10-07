"""Who judges what.

Only the admin chooses judges. A judge is chosen for a challenge (all stages, or only some) or for one idea.
Anyone with an account can be chosen — no role is needed first. A person without an account gets an email
invitation and becomes a judge when they sign up with it.
"""
import re
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import DomainError
from app.core.events import publish_event
from app.core.security import sha256
from app.modules.challenges import service as csvc
from app.modules.challenges.models import Challenge, ChallengeEntry, TeamMember, Team
from app.modules.evaluation import service as svc
from app.modules.evaluation.models import (JudgeInvite, Panel, PanelMember, ReviewAssignment, ReviewRound, ReviewScore,
                                           ReviewSummary, RoundResult)
from app.modules.identity.models import User, UserInvitation
from app.modules.initiatives.models import Initiative
from app.modules.notifications.models import NotificationDelivery
from app.modules.notifications.service import _attempt, judge_invite_text
from app.shared.models.base import iso, utcnow
from app.shared.util import en, user_brief

STAGES = ("METHODOLOGY", "PROTOTYPE", "FINAL_JURY")
STAGE_NAMES = {"METHODOLOGY": "Methodology", "PROTOTYPE": "Prototype", "FINAL_JURY": "Final demo"}
OPEN_ROUND = ("SETUP", "IN_PROGRESS")
NOT_STARTED = ("ASSIGNED", "IN_PROGRESS")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean_stages(stages: list[str] | None) -> list[str]:
    """Stored list of stages. An empty list means every stage."""
    picked = [s for s in STAGES if s in (stages or [])]
    return [] if len(picked) == len(STAGES) else picked


def may_score(member: PanelMember, round_type: str) -> bool:
    return not member.stages or round_type in member.stages


def stage_text(stages: list[str] | None) -> str:
    return ", ".join(STAGE_NAMES[s] for s in stages) if stages else "all stages"


def is_judging(db: Session, user_id: str) -> bool:
    """True when the person was chosen as a judge anywhere (challenge or idea)."""
    if db.scalar(select(PanelMember.id).where(PanelMember.user_id == user_id).limit(1)):
        return True
    if db.scalar(select(ReviewAssignment.id).where(ReviewAssignment.reviewer_user_id == user_id,
                                                   ReviewAssignment.status != "DECLINED_COI").limit(1)):
        return True
    from app.modules.delivery.models import KpiVerifierAssignment
    from app.modules.evaluation.gates import is_gate_judge
    if db.scalar(select(KpiVerifierAssignment.id).where(KpiVerifierAssignment.verifier_user_id == user_id).limit(1)):
        return True                         # chosen to verify a KPI measurement
    return is_gate_judge(db, user_id)       # chosen for a prototype or pilot review


# ---- Challenge judges ---------------------------------------------------------------------------
def panel_of(db: Session, ch: Challenge, create: bool = False) -> Panel | None:
    panel = db.scalar(select(Panel).where(Panel.challenge_id == ch.id))
    if not panel and create:
        panel = Panel(challenge_id=ch.id, name=f"{en(ch.title_i18n)} judges", panel_type="REVIEW")
        db.add(panel)
        db.flush()
        for rnd in csvc.rounds_of(db, ch.id):
            rnd.panel_id = rnd.panel_id or panel.id
    return panel


def members_of(db: Session, panel: Panel | None) -> list[PanelMember]:
    if not panel:
        return []
    return list(db.scalars(select(PanelMember).where(PanelMember.panel_id == panel.id).order_by(PanelMember.created_at)).all())


def _participants(db: Session, ch: Challenge) -> set[str]:
    people: set[str] = set()
    for e in db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == ch.id, ChallengeEntry.deleted_at.is_(None),
                                                     ChallengeEntry.status_code != "WITHDRAWN")).all():
        people.update(csvc.notify_entry(db, e))
    teams = select(Team.id).where(Team.challenge_id == ch.id)
    people.update(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id.in_(teams), TeamMember.status == "ACTIVE")).all())
    return people


def _recalc(db: Session, rnd: ReviewRound) -> None:
    """Recalculate a stage and clear results of entries that no longer have any judge."""
    db.flush()
    judged = set(db.scalars(select(ReviewAssignment.entity_id).where(ReviewAssignment.review_round_id == rnd.id,
                                                                     ReviewAssignment.status != "DECLINED_COI")).all())
    for res in db.scalars(select(RoundResult).where(RoundResult.review_round_id == rnd.id)).all():
        if res.entity_id not in judged and not res.is_frozen:
            db.delete(res)
    db.flush()
    svc.calculate_round(db, rnd)


def _drop_open(db: Session, round_ids: list[str], user_id: str, entity_id: str | None = None) -> int:
    """Take away work the judge has not submitted yet. Submitted scores always stay."""
    stmt = select(ReviewAssignment).where(ReviewAssignment.review_round_id.in_(round_ids or [""]),
                                          ReviewAssignment.reviewer_user_id == user_id,
                                          ReviewAssignment.status.in_(NOT_STARTED))
    if entity_id:
        stmt = stmt.where(ReviewAssignment.entity_id == entity_id)
    rows = db.scalars(stmt).all()
    for a in rows:
        for model in (ReviewScore, ReviewSummary):
            for row in db.scalars(select(model).where(model.review_assignment_id == a.id)).all():
                db.delete(row)
        db.delete(a)
    db.flush()
    return len(rows)


def share_out(db: Session, ch: Challenge, actor_id: str | None, new_judges: list[str] | None = None) -> dict:
    """Give the entries that are waiting for scores to the judges.

    Each entry gets the number of judges set for the challenge. A judge who was just added also gets every entry
    that is waiting now in their stages, so a newly chosen judge always has something to score."""
    members = {m.user_id: m for m in members_of(db, panel_of(db, ch))}
    created, exclusions, short = 0, [], []
    for rnd in csvc.rounds_of(db, ch.id):
        if rnd.status not in OPEN_ROUND:
            continue
        if any(may_score(m, rnd.round_type) for m in members.values()):
            res = svc.auto_assign(db, rnd, actor_id)
            created += res["created"]
            exclusions += res["exclusions"]
            short += res["short_of_reviewers"]
        entries = db.scalars(select(ChallengeEntry).where(
            ChallengeEntry.challenge_id == ch.id, ChallengeEntry.status_code.in_(svc.ELIGIBLE.get(rnd.round_type, ())))).all()
        for uid in new_judges or []:
            m = members.get(uid)
            if not m or not may_score(m, rnd.round_type):
                continue
            for entry in entries:
                if db.scalar(select(ReviewAssignment.id).where(ReviewAssignment.review_round_id == rnd.id,
                                                               ReviewAssignment.reviewer_user_id == uid,
                                                               ReviewAssignment.entity_id == entry.id)):
                    continue
                if svc.conflict_reason(db, uid, "challenge_entry", entry.id):
                    continue
                db.add(ReviewAssignment(review_round_id=rnd.id, reviewer_user_id=uid, entity_type="challenge_entry",
                                        entity_id=entry.id, status="ASSIGNED", due_at=rnd.due_at,
                                        reviewer_weight=m.vote_weight or 1, created_by=actor_id,
                                        submission_version_id=svc.latest_version_id(db, entry.id, rnd.round_type)))
                created += 1
                if rnd.status == "SETUP":
                    rnd.status = "IN_PROGRESS"
        _recalc(db, rnd)
    return {"created": created, "exclusions": exclusions, "short_of_reviewers": sorted(set(short))}


def add_challenge_judges(db: Session, ch: Challenge, user_ids: list[str], stages: list[str] | None, actor_id: str | None) -> dict:
    stages = clean_stages(stages)
    panel = panel_of(db, ch, create=True)
    current = {m.user_id: m for m in members_of(db, panel)}
    taking_part = _participants(db, ch)
    added, updated, skipped = [], [], []
    for uid in dict.fromkeys(user_ids):
        user = db.get(User, uid)
        if not user or not user.is_active:
            continue
        if uid in taking_part:
            skipped.append({"name": user.full_name, "reason": "TAKES_PART"})
            continue
        if uid in current:
            if (current[uid].stages or []) != stages:
                set_stages(db, ch, uid, stages, actor_id, share=False)
                updated.append(user.full_name)
            continue
        db.add(PanelMember(panel_id=panel.id, user_id=uid, vote_weight=1, stages=stages, created_by=actor_id))
        added.append(uid)
    db.flush()
    panel.chair_user_id = panel.chair_user_id or (added[0] if added else None)
    shared = share_out(db, ch, actor_id, new_judges=added)
    if added:
        publish_event(db, "JUDGE_CHOSEN", "challenge", ch.id, actor_id, users=added,
                      title=f"You are a judge: {en(ch.title_i18n)}",
                      body=f"You were chosen to judge {stage_text(stages)}. Entries to score appear under My judging.",
                      link="/review", needs_action=True)
    return {"added": [db.get(User, u).full_name for u in added], "updated": updated, "skipped": skipped, **shared}


def set_stages(db: Session, ch: Challenge, user_id: str, stages: list[str] | None, actor_id: str | None, share: bool = True) -> None:
    stages = clean_stages(stages)
    panel = panel_of(db, ch)
    member = next((m for m in members_of(db, panel) if m.user_id == user_id), None)
    if not member:
        raise DomainError("JUDGE_NOT_FOUND", "This person is not a judge of this challenge.", 404)
    member.stages = stages
    closed = [r.id for r in csvc.rounds_of(db, ch.id) if not may_score(member, r.round_type) and r.status in OPEN_ROUND]
    _drop_open(db, closed, user_id)
    if share:
        share_out(db, ch, actor_id, new_judges=[user_id])


def remove_challenge_judge(db: Session, ch: Challenge, user_id: str, actor_id: str | None) -> dict:
    panel = panel_of(db, ch)
    member = next((m for m in members_of(db, panel) if m.user_id == user_id), None)
    if not member:
        raise DomainError("JUDGE_NOT_FOUND", "This person is not a judge of this challenge.", 404)
    rounds = csvc.rounds_of(db, ch.id)
    dropped = _drop_open(db, [r.id for r in rounds], user_id)
    kept = db.scalar(select(ReviewAssignment.id).where(ReviewAssignment.review_round_id.in_([r.id for r in rounds] or [""]),
                                                       ReviewAssignment.reviewer_user_id == user_id,
                                                       ReviewAssignment.status == "SUBMITTED").limit(1))
    db.delete(member)
    db.flush()
    if panel.chair_user_id == user_id:
        rest = members_of(db, panel)
        panel.chair_user_id = rest[0].user_id if rest else None
    share_out(db, ch, actor_id)
    return {"removed_open_reviews": dropped, "kept_submitted_scores": bool(kept)}


def challenge_stage_options(db: Session, ch: Challenge) -> list[dict]:
    present = {r.round_type for r in csvc.rounds_of(db, ch.id)}
    return [{"code": s, "name": STAGE_NAMES[s], "in_challenge": s in present} for s in STAGES]


def challenge_judges(db: Session, ch: Challenge) -> dict:
    rounds = {r.id: r for r in csvc.rounds_of(db, ch.id)}
    work: dict[str, list[ReviewAssignment]] = {}
    for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id.in_(list(rounds) or [""]),
                                                       ReviewAssignment.status != "DECLINED_COI")).all():
        work.setdefault(a.reviewer_user_id, []).append(a)
    judges = []
    for m in members_of(db, panel_of(db, ch)):
        mine = work.get(m.user_id, [])
        judges.append({"user": user_brief(db, m.user_id), "stages": m.stages or [], "all_stages": not m.stages,
                       "assigned": len(mine), "done": sum(a.status == "SUBMITTED" for a in mine)})
    return {"stages": challenge_stage_options(db, ch), "judges": [j for j in judges if j["user"]],
            "invites": pending_invites(db, "challenge", ch.id)}


# ---- Idea judges --------------------------------------------------------------------------------
def idea_round(db: Session) -> ReviewRound:
    rnd = db.scalar(select(ReviewRound).where(ReviewRound.round_type == "IDEA_REVIEW", ReviewRound.challenge_id.is_(None)))
    if not rnd:
        raise DomainError("ROUND_MISSING", "Idea judging is not set up yet.")
    return rnd


def add_idea_judges(db: Session, ini: Initiative, user_ids: list[str], due_days: int, actor_id: str | None) -> dict:
    rnd = idea_round(db)
    due = utcnow() + timedelta(days=max(1, min(due_days or 10, 90)))
    added, skipped = [], []
    for uid in dict.fromkeys(user_ids):
        user = db.get(User, uid)
        if not user or not user.is_active:
            continue
        reason = svc.conflict_reason(db, uid, "initiative", ini.id)
        if reason:
            skipped.append({"name": user.full_name, "reviewer": user.full_name, "reason": reason})
            continue
        if db.scalar(select(ReviewAssignment.id).where(ReviewAssignment.review_round_id == rnd.id,
                                                       ReviewAssignment.reviewer_user_id == uid,
                                                       ReviewAssignment.entity_id == ini.id)):
            continue
        db.add(ReviewAssignment(review_round_id=rnd.id, reviewer_user_id=uid, entity_type="initiative", entity_id=ini.id,
                                status="ASSIGNED", due_at=due, reviewer_weight=1, created_by=actor_id))
        added.append(uid)
    if added:
        publish_event(db, "REVIEW_ASSIGNED", "initiative", ini.id, actor_id, users=added,
                      title=f"You are a judge: {ini.code}", body=ini.title, link="/review", needs_action=True,
                      vars={"entry_code": ini.code, "round": "Idea judging", "due_date": iso(due)})
    db.flush()
    return {"added": [db.get(User, u).full_name for u in added], "created": len(added), "skipped": skipped, "blocked": skipped}


def entry_round(db: Session, entry: ChallengeEntry) -> ReviewRound:
    """The scoring round this entry is waiting in: Methodology review, or the Final jury."""
    kind = next((k for k, states in svc.ELIGIBLE.items() if k != "PROTOTYPE" and entry.status_code in states), None)
    rnd = csvc.round_of(db, entry.challenge_id, kind) if kind else None
    if not rnd:
        raise DomainError("NOT_WAITING_FOR_SCORES", "This entry is not waiting for scores right now.", 409)
    return rnd


def add_entry_judges(db: Session, entry: ChallengeEntry, user_ids: list[str], due_days: int, actor_id: str | None) -> dict:
    """The admin picks one or many judges for this one entry, the same way as for an idea."""
    rnd = entry_round(db, entry)
    due = utcnow() + timedelta(days=max(1, min(due_days or 10, 90)))
    added, skipped = [], []
    for uid in dict.fromkeys(user_ids):
        user = db.get(User, uid)
        if not user or not user.is_active:
            continue
        reason = svc.conflict_reason(db, uid, "challenge_entry", entry.id)
        if reason:
            skipped.append({"name": user.full_name, "reviewer": user.full_name, "reason": reason})
            continue
        if db.scalar(select(ReviewAssignment.id).where(ReviewAssignment.review_round_id == rnd.id,
                                                       ReviewAssignment.reviewer_user_id == uid,
                                                       ReviewAssignment.entity_id == entry.id)):
            continue
        db.add(ReviewAssignment(review_round_id=rnd.id, reviewer_user_id=uid, entity_type="challenge_entry",
                                entity_id=entry.id, status="ASSIGNED", due_at=due, reviewer_weight=1, created_by=actor_id,
                                submission_version_id=svc.latest_version_id(db, entry.id, rnd.round_type)))
        added.append(uid)
    if added:
        if rnd.status == "SETUP":
            rnd.status = "IN_PROGRESS"
        publish_event(db, "REVIEW_ASSIGNED", "challenge_entry", entry.id, actor_id, users=added,
                      title=f"You are a judge: {entry.code}", body=entry.title, link="/review", needs_action=True,
                      vars={"entry_code": entry.code, "round": en(rnd.name_i18n), "due_date": iso(due)})
    db.flush()
    _recalc(db, rnd)
    return {"added": [db.get(User, u).full_name for u in added], "created": len(added), "skipped": skipped, "blocked": skipped}


def remove_entry_judge(db: Session, entry: ChallengeEntry, user_id: str) -> dict:
    rnd = entry_round(db, entry)
    dropped = _drop_open(db, [rnd.id], user_id, entity_id=entry.id)
    if not dropped:
        raise DomainError("SCORE_ALREADY_SUBMITTED", "This judge already submitted a score, so they can't be removed.", 409)
    _recalc(db, rnd)
    return {"removed_open_reviews": dropped}


def entry_judges(db: Session, entry: ChallengeEntry) -> dict:
    judges = []
    for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.entity_type == "challenge_entry",
                                                       ReviewAssignment.entity_id == entry.id,
                                                       ReviewAssignment.status != "DECLINED_COI")
                        .order_by(ReviewAssignment.created_at)).all():
        summary = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
        judges.append({"user": user_brief(db, a.reviewer_user_id), "status": a.status, "due_at": iso(a.due_at),
                       "score": summary.weighted_score if summary and a.status == "SUBMITTED" else None})
    judges = [j for j in judges if j["user"]]
    scores = [j["score"] for j in judges if j["score"] is not None]
    return {"judges": judges, "invites": [], "average_score": round(sum(scores) / len(scores), 2) if scores else None,
            "scored": len(scores), "total": len(judges)}


def remove_idea_judge(db: Session, ini: Initiative, user_id: str) -> dict:
    rnd = idea_round(db)
    dropped = _drop_open(db, [rnd.id], user_id, entity_id=ini.id)
    if not dropped:
        raise DomainError("SCORE_ALREADY_SUBMITTED", "This judge already submitted a score, so they can't be removed.", 409)
    _recalc(db, rnd)
    return {"removed_open_reviews": dropped}


def idea_judges(db: Session, ini: Initiative) -> dict:
    judges = []
    for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.entity_type == "initiative",
                                                       ReviewAssignment.entity_id == ini.id,
                                                       ReviewAssignment.status != "DECLINED_COI")
                        .order_by(ReviewAssignment.created_at)).all():
        summary = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
        judges.append({"user": user_brief(db, a.reviewer_user_id), "status": a.status, "due_at": iso(a.due_at),
                       "score": summary.weighted_score if summary and a.status == "SUBMITTED" else None})
    judges = [j for j in judges if j["user"]]
    scores = [j["score"] for j in judges if j["score"] is not None]
    # The idea's score is the average of the judges who have scored it; it is what shortlisting looks at.
    return {"judges": judges, "invites": pending_invites(db, "initiative", ini.id),
            "average_score": round(sum(scores) / len(scores), 2) if scores else None,
            "scored": len(scores), "total": len(judges)}


# ---- Invitations by email -----------------------------------------------------------------------
def pending_invites(db: Session, scope_type: str, scope_id: str) -> list[dict]:
    out = []
    for ji in db.scalars(select(JudgeInvite).where(JudgeInvite.scope_type == scope_type, JudgeInvite.scope_id == scope_id,
                                                   JudgeInvite.status == "PENDING").order_by(JudgeInvite.created_at)).all():
        inv = db.get(UserInvitation, ji.invitation_id) if ji.invitation_id else None
        if not inv or inv.status != "PENDING":
            continue
        out.append({"id": ji.id, "email": ji.email, "stages": ji.stages or [], "all_stages": not ji.stages,
                    "sent_at": iso(ji.created_at), "expires_at": iso(inv.expires_at),
                    "expired": bool(inv.expires_at and inv.expires_at < utcnow())})
    return out


def split_emails(raw: list[str] | str | None) -> list[str]:
    parts = re.split(r"[\s,;]+", raw) if isinstance(raw, str) else list(raw or [])
    return list(dict.fromkeys(p.strip().lower() for p in parts if p and p.strip()))


def invite_by_email(db: Session, emails: list[str], scope_type: str, scope_id: str, what: str, stages: list[str] | None,
                    due_days: int, message: str | None, inviter: User) -> dict:
    """Returns the people who already have an account (to be added directly) and the invitations that were sent."""
    stages = clean_stages(stages)
    existing, invited, invalid = [], [], []
    for email in split_emails(emails):
        if not EMAIL_RE.match(email):
            invalid.append(email)
            continue
        user = db.scalar(select(User).where(User.email.is_not(None), User.email.ilike(email)))
        if user:
            existing.append(user.id)
            continue
        # One sign-up link per person: reuse their open invitation (with a fresh link) so earlier choices still apply.
        inv = db.scalar(select(UserInvitation).where(UserInvitation.email == email, UserInvitation.status == "PENDING")
                        .order_by(UserInvitation.created_at.desc()))
        token = secrets.token_urlsafe(32)
        expires = utcnow() + timedelta(days=settings.invitation_expiry_days)
        if inv:
            inv.token_hash, inv.expires_at = sha256(token), expires
        else:
            inv = UserInvitation(email=email, role_codes=[], token_hash=sha256(token), invited_by=inviter.id,
                                 message=(message or "").strip() or None, expires_at=expires, status="PENDING",
                                 created_by=inviter.id)
            db.add(inv)
            db.flush()
        for old in db.scalars(select(JudgeInvite).where(JudgeInvite.email == email, JudgeInvite.scope_type == scope_type,
                                                        JudgeInvite.scope_id == scope_id, JudgeInvite.status == "PENDING")).all():
            old.status = "REVOKED"
        db.add(JudgeInvite(email=email, invitation_id=inv.id, scope_type=scope_type, scope_id=scope_id, stages=stages,
                           due_days=due_days, invited_by=inviter.id, status="PENDING", created_by=inviter.id))
        link = f"{settings.frontend_url}/signup?invite={token}"
        subject, body = judge_invite_text(inviter.full_name, what, stage_text(stages) if scope_type == "challenge" else None,
                                          message, f"{expires:%d %b %Y}", link)
        d = NotificationDelivery(event_type="JUDGE_INVITED", recipient_address=email, channel="EMAIL", template_code="JUDGE_INVITE",
                                 rendered_subject=subject, rendered_body=body, attempts=0)
        _attempt(d)
        db.add(d)
        # Without an email server the message is only logged, so say so: the admin then sends the link themselves.
        invited.append({"email": email, "invite_url": link, "email_status": d.status if settings.smtp_host else "NOT_SET_UP"})
    db.flush()
    return {"existing_user_ids": existing, "invited": invited, "invalid": invalid}


def revoke_invite(db: Session, invite_id: str) -> None:
    ji = db.get(JudgeInvite, invite_id)
    if not ji or ji.status != "PENDING":
        raise DomainError("INVITE_NOT_FOUND", "This invitation is no longer open.", 404)
    ji.status = "REVOKED"
    db.flush()
    inv = db.get(UserInvitation, ji.invitation_id) if ji.invitation_id else None
    others = db.scalar(select(JudgeInvite.id).where(JudgeInvite.invitation_id == ji.invitation_id,
                                                    JudgeInvite.status == "PENDING").limit(1))
    if inv and inv.status == "PENDING" and not inv.role_codes and not others:
        inv.status = "REVOKED"       # nothing else hangs on this sign-up link


def has_judge_invite(db: Session, invitation_id: str) -> bool:
    return bool(db.scalar(select(JudgeInvite.id).where(JudgeInvite.invitation_id == invitation_id,
                                                       JudgeInvite.status != "REVOKED").limit(1)))


def apply_invites(db: Session, user: User, inv: UserInvitation) -> None:
    """Called when someone signs up with an invitation link: make them the judge they were invited to be."""
    for ji in db.scalars(select(JudgeInvite).where(JudgeInvite.invitation_id == inv.id, JudgeInvite.status == "PENDING")).all():
        if ji.scope_type == "challenge":
            ch = db.get(Challenge, ji.scope_id)
            if ch and not ch.deleted_at:
                add_challenge_judges(db, ch, [user.id], ji.stages, ji.invited_by)
        else:
            ini = db.get(Initiative, ji.scope_id)
            if ini and not ini.deleted_at:
                add_idea_judges(db, ini, [user.id], ji.due_days or 10, ji.invited_by)
        ji.status = "ACCEPTED"
