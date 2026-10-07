"""Challenge business rules: configuration, phase clock, eligibility, journey rail and serialisation.

Routers stay thin; these functions are shared by the API, the scheduler and the seed script.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import DomainError
from app.core.events import publish_event, record_history
from app.core.permissions import CurrentUser, is_entry_member
from app.modules.challenges.models import (Challenge, ChallengeEligibilityRule, ChallengeEntry, ChallengePhase,
                                           ChallengePrize, ChallengeResource, EntrySubmission, Team, TeamInviteLink,
                                           TeamMember)
from app.modules.evaluation.models import (Feedback, Panel, PanelMember, ReviewRound, ScorecardCriterion, Shortlist,
                                           ShortlistRule)
from app.modules.identity.models import OrgUnit
from app.modules.identity.sbu import is_sbu, sbu_of
from app.modules.masterdata.models import ChallengeDomain
from app.shared import cache
from app.shared.models.base import iso, row, utcnow
from app.shared.util import en, user_brief

PHASE_TO_STATUS = {
    "REGISTRATION": "OPEN_FOR_REGISTRATION", "METHODOLOGY": "METHODOLOGY_OPEN", "METHODOLOGY_REVIEW": "METHODOLOGY_REVIEW",
    "SHORTLIST": "SHORTLISTING", "BUILD": "BUILD", "PROTOTYPE": "BUILD", "PROTOTYPE_REVIEW": "PROTOTYPE_REVIEW",
    "FINAL_SUBMISSION": "FINAL_SUBMISSION", "DEMO": "DEMO_AND_JUDGING", "JUDGING": "DEMO_AND_JUDGING",
    "RESULTS": "RESULTS_PENDING_APPROVAL",
}
PHASE_NAMES = {
    "REGISTRATION": "Registration", "METHODOLOGY": "Methodology submission", "METHODOLOGY_REVIEW": "Methodology review",
    "SHORTLIST": "Shortlisting", "BUILD": "Build", "PROTOTYPE": "Prototype submission",
    "PROTOTYPE_REVIEW": "Prototype review", "FINAL_SUBMISSION": "Final submission", "DEMO": "Demo Day",
    "JUDGING": "Final judging", "RESULTS": "Results and awards",
}
FROZEN_STATUSES = {"DRAFT", "CANCELLED", "ON_HOLD", "RESULTS_PUBLISHED", "CLOSED"}
CLOSED_STATUSES = {"RESULTS_PUBLISHED", "CLOSED", "CANCELLED"}
ACTIVE_ENTRY_EXCLUDES = {"WITHDRAWN"}
SUBMISSION_PHASE = {"METHODOLOGY": "METHODOLOGY", "PROTOTYPE": "PROTOTYPE", "FINAL_PROJECT": "FINAL_SUBMISSION"}


def as_naive(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def phases_of(db: Session, challenge_id: str) -> list[ChallengePhase]:
    return sorted(cache.by(db, ChallengePhase, "challenge_id").get(challenge_id, []), key=lambda p: p.sequence_no or 0)


def phase_of(db: Session, challenge_id: str, phase_type: str) -> ChallengePhase | None:
    return next((p for p in phases_of(db, challenge_id) if p.phase_type == phase_type), None)


def phase_is_open(phase: ChallengePhase | None, now: datetime | None = None) -> bool:
    """The server clock decides. Includes the small grace period for upload problems."""
    if not phase or not phase.opens_at or not phase.closes_at:
        return False
    now = now or utcnow()
    return phase.opens_at <= now <= phase.closes_at + timedelta(minutes=phase.grace_minutes or 0)


def rounds_of(db: Session, challenge_id: str) -> list[ReviewRound]:
    return sorted(cache.by(db, ReviewRound, "challenge_id").get(challenge_id, []), key=lambda r: (r.created_at, r.id))


def round_of(db: Session, challenge_id: str, round_type: str) -> ReviewRound | None:
    return next((r for r in rounds_of(db, challenge_id) if r.round_type == round_type), None)


# ---- Configuration (used by the builder wizard and the seed) ----------------------------
def apply_config(db: Session, ch: Challenge, cfg: dict, actor_id: str | None) -> Challenge:
    def text_i18n(key: str, current: dict | None):
        if key not in cfg:
            return current or {}
        out = {"en": cfg.get(key) or ""}
        if cfg.get(f"{key}_bn"):
            out["bn"] = cfg[f"{key}_bn"]
        return out

    ch.title_i18n = text_i18n("title", ch.title_i18n)
    ch.problem_statement_i18n = text_i18n("problem_statement", ch.problem_statement_i18n)
    ch.background_i18n = text_i18n("background", ch.background_i18n)
    ch.expected_outcome_i18n = text_i18n("expected_outcome", ch.expected_outcome_i18n)
    ch.rules_i18n = text_i18n("rules", ch.rules_i18n)
    for key in ("domain_id", "category_id", "sponsor_user_id", "program_owner_user_id", "banner_color",
                "participation_mode", "team_min_size", "team_max_size", "allow_cross_org_teams", "prototype_policy",
                "blind_review", "peoples_choice_enabled", "leaderboard_enabled", "show_registration_count",
                "publish_winner_summaries", "data_classification_code", "total_prize_budget"):
        if key in cfg and cfg[key] is not None:
            setattr(ch, key, cfg[key])
    ch.updated_by = actor_id
    db.flush()

    # Eligibility
    if "eligibility_org_unit_ids" in cfg:
        for r in db.scalars(select(ChallengeEligibilityRule).where(ChallengeEligibilityRule.challenge_id == ch.id)).all():
            db.delete(r)
        for unit_id in cfg["eligibility_org_unit_ids"] or []:
            db.add(ChallengeEligibilityRule(challenge_id=ch.id, rule_type="ORG_UNIT", rule_value={"org_unit_id": unit_id}))

    # Timeline
    if "phases" in cfg:
        existing = {p.phase_type: p for p in phases_of(db, ch.id)}
        seen = set()
        ordered = sorted(cfg["phases"], key=lambda p: (as_naive(p["opens_at"]), as_naive(p["closes_at"])))
        for i, p in enumerate(ordered, start=1):
            opens, closes = as_naive(p["opens_at"]), as_naive(p["closes_at"])
            if closes <= opens:
                raise DomainError("PHASE_WINDOW_INVALID", f"{PHASE_NAMES.get(p['phase_type'], p['phase_type'])}: "
                                                          "the closing time must be after the opening time.")
            phase = existing.get(p["phase_type"]) or ChallengePhase(challenge_id=ch.id, phase_type=p["phase_type"])
            phase.sequence_no, phase.opens_at, phase.closes_at = i, opens, closes
            phase.name_i18n = {"en": p.get("name") or PHASE_NAMES.get(p["phase_type"], p["phase_type"])}
            phase.who_can_submit = {"PROTOTYPE": "PROTOTYPE_REQUIRED_ONLY", "FINAL_SUBMISSION": "SHORTLISTED",
                                    "BUILD": "SHORTLISTED"}.get(p["phase_type"], "ALL_REGISTERED")
            db.add(phase)
            seen.add(p["phase_type"])
        for kind, phase in existing.items():
            if kind not in seen:
                db.delete(phase)
        db.flush()
    by_type = {p.phase_type: p for p in phases_of(db, ch.id)}
    for kind, key in (("METHODOLOGY", "methodology_form_id"), ("PROTOTYPE", "prototype_form_id"),
                      ("FINAL_SUBMISSION", "final_form_id")):
        if kind in by_type and cfg.get(key):
            by_type[kind].submission_form_template_id = cfg[key]

    # Panel
    panel = db.scalar(select(Panel).where(Panel.challenge_id == ch.id))
    if not panel:
        panel = Panel(challenge_id=ch.id, name=f"{en(ch.title_i18n)} panel", panel_type="REVIEW")
        db.add(panel)
        db.flush()
    if "judge_user_ids" in cfg:      # used by the seed only; in the app the admin chooses judges on the Judges tab
        have = {m.user_id for m in db.scalars(select(PanelMember).where(PanelMember.panel_id == panel.id)).all()}
        judges = cfg["judge_user_ids"] or []
        for uid in judges:
            if uid not in have:
                db.add(PanelMember(panel_id=panel.id, user_id=uid, vote_weight=1, stages=[]))
        panel.chair_user_id = panel.chair_user_id or (judges[0] if judges else None)

    # Review rounds
    def ensure_round(round_type: str, phase_type: str, scorecard_key: str, name: str) -> ReviewRound | None:
        phase = by_type.get(phase_type)
        rnd = round_of(db, ch.id, round_type)
        if not phase:
            return rnd
        if not rnd:
            rnd = ReviewRound(challenge_id=ch.id, round_type=round_type, name_i18n={"en": name}, status="SETUP",
                              disagreement_threshold=2)
            db.add(rnd)
        rnd.challenge_phase_id, rnd.panel_id = phase.id, panel.id
        rnd.opens_at, rnd.due_at = phase.opens_at, phase.closes_at
        if cfg.get(scorecard_key):
            rnd.scorecard_id = cfg[scorecard_key]
        for key in ("reviewers_per_entry", "aggregation_method", "show_scores_to_entrants", "normalize_scores"):
            if cfg.get(key) is not None:
                setattr(rnd, key, cfg[key])
        rnd.blind = bool(ch.blind_review) and round_type == "METHODOLOGY"
        db.flush()
        phase.review_round_id = rnd.id
        return rnd

    method_round = ensure_round("METHODOLOGY", "METHODOLOGY_REVIEW", "methodology_scorecard_id", "Methodology review")
    ensure_round("PROTOTYPE", "PROTOTYPE_REVIEW", "final_scorecard_id", "Prototype review")
    ensure_round("FINAL_JURY", "JUDGING" if "JUDGING" in by_type else "DEMO", "final_scorecard_id", "Final judging")

    if method_round and any(k in cfg for k in ("shortlist_method", "top_n", "min_score", "waitlist_size")):
        rule = db.scalar(select(ShortlistRule).where(ShortlistRule.review_round_id == method_round.id))
        if not rule:
            rule = ShortlistRule(review_round_id=method_round.id)
            db.add(rule)
        rule.method = cfg.get("shortlist_method") or rule.method or "TOP_N"
        rule.top_n, rule.min_score = cfg.get("top_n"), cfg.get("min_score")
        rule.top_percent, rule.waitlist_size = cfg.get("top_percent"), cfg.get("waitlist_size") or 0
        rule.tie_break_rules = ["TIE_BREAKER_CRITERION", "EARLIEST_SUBMISSION", "PANEL_VOTE"]

    # Prizes
    if "prizes" in cfg:
        for p in db.scalars(select(ChallengePrize).where(ChallengePrize.challenge_id == ch.id)).all():
            db.delete(p)
        for p in cfg["prizes"] or []:
            db.add(ChallengePrize(challenge_id=ch.id, rank_from=p.get("rank_from", 1), rank_to=p.get("rank_to", p.get("rank_from", 1)),
                                  prize_type=p.get("prize_type", "CASH"), description_i18n={"en": p.get("description", "")},
                                  amount=p.get("amount"), award_category_id=p.get("award_category_id")))
        ch.total_prize_budget = sum((p.get("amount") or 0) * (p.get("rank_to", p.get("rank_from", 1)) - p.get("rank_from", 1) + 1)
                                    for p in cfg["prizes"] or [])
    db.flush()
    return ch


def publish_checklist(db: Session, ch: Challenge) -> list[dict]:
    phases = {p.phase_type: p for p in phases_of(db, ch.id)}
    panel = db.scalar(select(Panel).where(Panel.challenge_id == ch.id))
    judges = db.scalar(select(func.count()).select_from(PanelMember).where(PanelMember.panel_id == panel.id)) if panel else 0
    method_round = round_of(db, ch.id, "METHODOLOGY")
    weight = 0
    if method_round and method_round.scorecard_id:
        weight = sum(c.weight_pct or 0 for c in db.scalars(select(ScorecardCriterion).where(
            ScorecardCriterion.scorecard_id == method_round.scorecard_id)).all())
    methodology = phases.get("METHODOLOGY")
    return [
        {"code": "TITLE", "label": "Title and problem statement written",
         "ok": bool(en(ch.title_i18n) and en(ch.problem_statement_i18n))},
        {"code": "PHASES", "label": "Registration, methodology and review phases have dates",
         "ok": all(k in phases for k in ("REGISTRATION", "METHODOLOGY", "METHODOLOGY_REVIEW"))},
        {"code": "FORM", "label": "Methodology form chosen", "ok": bool(methodology and methodology.submission_form_template_id)},
        {"code": "SCORECARD", "label": "Scorecard weights total 100%", "ok": round(weight) == 100},
        # Judges are chosen by the admin and can be added at any time, so this never blocks publishing.
        {"code": "PANEL", "label": "Judges chosen (the admin can add them later)", "ok": (judges or 0) >= 1, "optional": True},
    ]


# ---- Phase clock -------------------------------------------------------------------------
def sync_challenge(db: Session, ch: Challenge, now: datetime | None = None) -> None:
    """Open/close phases by time, lock submissions at the deadline and move the challenge status."""
    now = now or utcnow()
    phases = phases_of(db, ch.id)
    for p in phases:
        p.status = "UPCOMING" if now < p.opens_at else "OPEN" if phase_is_open(p, now) else "CLOSED"
    if ch.status_code in FROZEN_STATUSES:
        return
    by_type = {p.phase_type: p for p in phases}

    registration = by_type.get("REGISTRATION")
    if registration and registration.status == "CLOSED":
        for team in db.scalars(select(Team).where(Team.challenge_id == ch.id, Team.is_locked.is_(False))).all():
            team.is_locked, team.locked_at = True, now
        for link in db.scalars(select(TeamInviteLink).join(Team, Team.id == TeamInviteLink.team_id)
                               .where(Team.challenge_id == ch.id, TeamInviteLink.status == "ACTIVE")).all():
            link.status = "EXPIRED"

    methodology = by_type.get("METHODOLOGY")
    if methodology and methodology.status == "CLOSED" and methodology.auto_lock_on_close:
        for sub in db.scalars(select(EntrySubmission).where(EntrySubmission.challenge_phase_id == methodology.id,
                                                            EntrySubmission.status == "SUBMITTED")).all():
            sub.status, sub.locked_at = "LOCKED", now
        for entry in db.scalars(select(ChallengeEntry).where(
                ChallengeEntry.challenge_id == ch.id,
                ChallengeEntry.status_code.in_(["REGISTERED", "METHODOLOGY_SUBMITTED"]))).all():
            new = "UNDER_REVIEW" if entry.status_code == "METHODOLOGY_SUBMITTED" else "NO_SUBMISSION"
            record_history(db, "challenge_entry", entry.id, entry.status_code, new, "DEADLINE_LOCK", None)
            entry.status_code = new

    open_phases = [p for p in phases if p.status == "OPEN"]
    if open_phases:
        target = PHASE_TO_STATUS.get(max(open_phases, key=lambda p: p.sequence_no).phase_type)
    elif phases and all(p.status == "UPCOMING" for p in phases):
        target = "SCHEDULED"
    else:
        target = None
    if target and target != ch.status_code and ch.status_code != "RESULTS_PENDING_APPROVAL":
        record_history(db, "challenge", ch.id, ch.status_code, target, "PHASE_CLOCK", None)
        ch.status_code = target


_last_sync: dict[str, datetime] = {}


def sync_if_stale(db: Session, ch: Challenge, seconds: int = 30) -> None:
    """Read paths call this: the background scheduler keeps phases current, so one check per 30 s is enough."""
    now = utcnow()
    last = _last_sync.get(ch.id)
    if last and (now - last).total_seconds() < seconds:
        return
    _last_sync[ch.id] = now
    sync_challenge(db, ch, now)


def sync_all_challenges(db: Session) -> None:
    for ch in db.scalars(select(Challenge).where(Challenge.deleted_at.is_(None))).all():
        sync_challenge(db, ch)
    db.commit()


def current_phase(phases: list[ChallengePhase]) -> ChallengePhase | None:
    open_phases = [p for p in phases if p.status == "OPEN"]
    if open_phases:
        return max(open_phases, key=lambda p: p.sequence_no)
    upcoming = [p for p in phases if p.status == "UPCOMING"]
    return upcoming[0] if upcoming else (phases[-1] if phases else None)


# ---- Eligibility --------------------------------------------------------------------------
def eligibility(db: Session, ch: Challenge, cu: CurrentUser) -> dict:
    for panel in cache.by(db, Panel, "challenge_id").get(ch.id, []):
        if any(m.user_id == cu.id for m in cache.by(db, PanelMember, "panel_id").get(panel.id, [])):
            return {"eligible": False, "reason": "You are on the judging panel for this challenge."}
    if cu.id in (ch.sponsor_user_id, ch.program_owner_user_id):
        return {"eligible": False, "reason": "You run this challenge, so you can't take part in it."}
    rules = [r for r in cache.by(db, ChallengeEligibilityRule, "challenge_id").get(ch.id, []) if r.rule_type == "ORG_UNIT"]
    if rules:
        unit = cache.one(db, OrgUnit, cu.user.primary_org_unit_id)
        allowed = [a for a in (cache.one(db, OrgUnit, r.rule_value.get("org_unit_id")) for r in rules) if a]
        mine = sbu_of(db, unit)
        # An SBU rule means people of that SBU; a rule on a smaller unit covers that unit and what sits under it.
        fits = lambda a: (mine is not None and mine.id == a.id) if is_sbu(a) else (  # noqa: E731
            unit.path == a.path or unit.path.startswith(a.path + "."))
        if not unit or not any(fits(a) for a in allowed):
            names = ", ".join(en(a.name_i18n) for a in allowed)
            return {"eligible": False, "reason": f"This challenge is open to {names} staff only."}
    return {"eligible": True, "reason": None}


def my_entry_in(db: Session, challenge_id: str, user_id: str) -> ChallengeEntry | None:
    """The user's active entry in a challenge (as individual, leader or team member)."""
    for e in cache.by(db, ChallengeEntry, "challenge_id").get(challenge_id, []):
        if e.status_code != "WITHDRAWN" and not e.deleted_at and is_entry_member(db, e, user_id):
            return e
    return None


# ---- Journey rail and next step ---------------------------------------------------------------
STAGE_INDEX = {
    "WITHDRAWN": 0, "REGISTERED": 1, "METHODOLOGY_SUBMITTED": 1, "NO_SUBMISSION": 1, "UNDER_REVIEW": 2,
    "CLARIFICATION_REQUESTED": 2, "WAITLISTED": 3, "NOT_SHORTLISTED": 3, "SHORTLISTED": 4, "BUILDING": 4,
    "PROTOTYPE_SUBMITTED": 5, "PROTOTYPE_REVIEWED": 5, "NOT_SELECTED": 5, "FINALIST": 6, "FINAL_SUBMITTED": 6,
    "JUDGED": 7, "WINNER": 7, "RUNNER_UP": 7, "PARTICIPANT": 7, "CONVERTED_TO_INITIATIVE": 7,
}
STAGES = [("REGISTERED", "Registered", "REGISTRATION"), ("METHODOLOGY", "Methodology", "METHODOLOGY"),
          ("REVIEW", "In review", "METHODOLOGY_REVIEW"), ("SHORTLIST", "Shortlist", "SHORTLIST"),
          ("BUILD", "Build", "BUILD"), ("PROTOTYPE", "Prototype", "PROTOTYPE"), ("DEMO", "Demo", "DEMO"),
          ("RESULT", "Result", "RESULTS")]
STATUS_NOTE = {
    "NO_SUBMISSION": "Not submitted", "WAITLISTED": "On the waitlist", "NOT_SHORTLISTED": "Not shortlisted",
    "NOT_SELECTED": "Not selected", "WITHDRAWN": "Withdrawn", "CLARIFICATION_REQUESTED": "Question from the panel",
    "WINNER": "Winner", "RUNNER_UP": "Runner-up", "PARTICIPANT": "Completed", "METHODOLOGY_SUBMITTED": "Submitted",
    "PROTOTYPE_SUBMITTED": "Submitted", "FINAL_SUBMITTED": "Final project submitted", "FINALIST": "Finalist",
}


def entry_journey(db: Session, entry: ChallengeEntry, ch: Challenge, phases: list[ChallengePhase] | None = None) -> list[dict]:
    phases = phases if phases is not None else phases_of(db, ch.id)
    by_type = {p.phase_type: p for p in phases}
    cur = STAGE_INDEX.get(entry.status_code, 0)
    out = []
    for i, (code, label, phase_type) in enumerate(STAGES):
        phase = by_type.get(phase_type) or (by_type.get("JUDGING") if code == "DEMO" else None)
        if code in ("PROTOTYPE", "DEMO") and not phase:
            continue
        if not phase and code not in ("REGISTERED",):
            continue
        when = entry.registered_at if code == "REGISTERED" else (phase.opens_at if code in ("DEMO", "RESULT") else phase.closes_at)
        stage = {"code": code, "label": label, "date": iso(when), "note": None,
                 "state": "done" if i < cur else "current" if i == cur else "upcoming"}
        if code == "PROTOTYPE":
            if ch.prototype_policy == "NONE":
                stage.update(state="skipped", note="Not required")
            elif cur < 4 and ch.prototype_policy == "PANEL_DECIDES":
                stage["note"] = "Only if the panel asks"
        if i == cur:
            stage["note"] = STATUS_NOTE.get(entry.status_code, stage["note"])
            if entry.status_code in ("WINNER", "RUNNER_UP"):
                stage["state"] = "won"
        if code == "SHORTLIST" and entry.status_code in ("SHORTLISTED", "BUILDING"):
            stage.update(state="won", note="Shortlisted")
        out.append(stage)
    return out


def _fmt(d: datetime | None) -> str:
    if not d:
        return "the deadline"
    local = d + timedelta(hours=6)  # Asia/Dhaka for the sentence only; the UI formats real dates itself
    return local.strftime("%d %b, %I:%M %p").lstrip("0").replace(", 0", ", ")


def entry_next_step(db: Session, entry: ChallengeEntry, ch: Challenge, phases: list[ChallengePhase] | None = None) -> dict:
    phases = phases if phases is not None else phases_of(db, ch.id)
    by_type = {p.phase_type: p for p in phases}

    def closes(kind: str):
        return by_type[kind].closes_at if kind in by_type else None

    base = f"/entries/{entry.id}"
    s = entry.status_code
    step = {"text": "", "action_label": None, "action_path": None, "due_at": None, "tone": "info"}
    if s == "REGISTERED":
        m = by_type.get("METHODOLOGY")
        if m and utcnow() < m.opens_at:
            step.update(text=f"The methodology window opens on {_fmt(m.opens_at)}.", due_at=iso(m.opens_at))
        else:
            step.update(text=f"Submit your methodology by {_fmt(closes('METHODOLOGY'))}.", action_label="Continue methodology",
                        action_path=f"{base}/methodology", due_at=iso(closes("METHODOLOGY")), tone="warning")
    elif s == "METHODOLOGY_SUBMITTED":
        step.update(text=f"Methodology submitted. You can still edit until {_fmt(closes('METHODOLOGY'))}.",
                    action_label="Edit methodology", action_path=f"{base}/methodology", due_at=iso(closes("METHODOLOGY")))
    elif s == "NO_SUBMISSION":
        step.update(text="The methodology window closed and nothing was submitted. "
                         "You can still share your idea as an open idea.", action_label="Submit an idea", action_path="/ideas/new")
    elif s == "UNDER_REVIEW":
        step.update(text=f"Your methodology is with the judges. You'll hear by {_fmt(closes('SHORTLIST') or closes('METHODOLOGY_REVIEW'))}.")
    elif s == "CLARIFICATION_REQUESTED":
        step.update(text="The panel asked a question. Reply so the review can continue.", action_label="Reply",
                    action_path=base, tone="warning")
    elif s in ("SHORTLISTED", "BUILDING"):
        if ch.prototype_policy != "NONE" and "PROTOTYPE" in by_type:
            step.update(text=f"Share your demo link and explain how to use it by {_fmt(closes('PROTOTYPE'))}. "
                             "The innovation office then sends it to the judges.", action_label="Open demo form",
                        action_path=f"{base}/prototype", due_at=iso(closes("PROTOTYPE")), tone="success")
        else:
            step.update(text=f"Prepare your final project by {_fmt(closes('FINAL_SUBMISSION'))}.", action_label="Open build plan",
                        action_path=f"{base}/milestones", due_at=iso(closes("FINAL_SUBMISSION")), tone="success")
    elif s == "WAITLISTED":
        step.update(text="You're on the waitlist. We'll tell you if a place opens.")
    elif s in ("NOT_SHORTLISTED", "NOT_SELECTED"):
        step.update(text="Read your feedback. Your idea can still be submitted as an open idea.", action_label="Read feedback",
                    action_path=f"{base}/feedback")
    elif s in ("PROTOTYPE_SUBMITTED", "PROTOTYPE_REVIEWED"):
        step.update(text="Your prototype is with the judges.")
    elif s == "FINALIST":
        step.update(text="You're a finalist. Book your demo slot and submit your final project.", action_label="Book demo",
                    action_path=f"{base}/demo", due_at=iso(closes("FINAL_SUBMISSION")), tone="success")
    elif s == "FINAL_SUBMITTED":
        step.update(text="Final project submitted. Present at Demo Day; results follow after judging.",
                    action_label="Demo slot", action_path=f"{base}/demo")
    elif s == "JUDGED":
        step.update(text="Judging is complete. Results will be published after approval.")
    elif s in ("WINNER", "RUNNER_UP", "PARTICIPANT", "CONVERTED_TO_INITIATIVE"):
        step.update(text="See the results and your feedback.", action_label="See results", action_path=f"{base}/feedback",
                    tone="success" if s != "PARTICIPANT" else "info")
    elif s == "WITHDRAWN":
        step.update(text="This entry was withdrawn.")
    return step


# ---- Serialisation ----------------------------------------------------------------------------------
def entry_card(db: Session, entry: ChallengeEntry, cu: CurrentUser | None = None, ch: Challenge | None = None,
               hide_identity: bool = False) -> dict:
    ch = ch or cache.one(db, Challenge, entry.challenge_id)
    phases = phases_of(db, ch.id)
    team = cache.one(db, Team, entry.team_id)
    members = sum(1 for m in cache.by(db, TeamMember, "team_id").get(team.id, []) if m.status == "ACTIVE") if team else 1
    out = {
        "id": entry.id, "code": entry.code, "title": entry.title, "summary": entry.summary,
        "entry_type": entry.entry_type, "status_code": entry.status_code, "registered_at": iso(entry.registered_at),
        "prototype_required": entry.prototype_required or ch.prototype_policy != "NONE", "final_rank": entry.final_rank,
        "challenge": {"id": ch.id, "slug": ch.slug, "code": ch.code, "title_i18n": ch.title_i18n,
                      "status_code": ch.status_code, "prototype_policy": ch.prototype_policy},
        "team": {"id": team.id, "name": team.name, "member_count": members} if team else None,
        "lead": user_brief(db, entry.lead_user_id),
        "journey": entry_journey(db, entry, ch, phases),
        "next_step": entry_next_step(db, entry, ch, phases),
        "is_finished": entry.status_code in ("NOT_SHORTLISTED", "NOT_SELECTED", "WINNER", "RUNNER_UP", "PARTICIPANT",
                                             "WITHDRAWN", "NO_SUBMISSION", "CONVERTED_TO_INITIATIVE"),
    }
    if hide_identity:
        out.update(code=entry.anonymous_alias or "Entry", team=None, lead=None)
    return out


def blind_for(cu: CurrentUser, ch: Challenge) -> bool:
    """Judges (who are not also privileged) see aliases instead of names in blind challenges."""
    return False   # judges can view all participant documents and information (names are not hidden)


def registration_count(db: Session, challenge_id: str) -> int:
    return sum(1 for e in cache.by(db, ChallengeEntry, "challenge_id").get(challenge_id, []) if e.status_code != "WITHDRAWN")


def challenge_card(db: Session, ch: Challenge, cu: CurrentUser) -> dict:
    phases = phases_of(db, ch.id)
    cur = current_phase(phases)
    domain = cache.one(db, ChallengeDomain, ch.domain_id)
    registration = next((p for p in phases if p.phase_type == "REGISTRATION"), None)
    mine = my_entry_in(db, ch.id, cu.id)
    return {
        "id": ch.id, "code": ch.code, "slug": ch.slug, "title_i18n": ch.title_i18n, "status_code": ch.status_code,
        "domain": {"id": domain.id, "code": domain.code, "name_i18n": domain.name_i18n} if domain else None,
        "banner_color": ch.banner_color, "participation_mode": ch.participation_mode,
        "team_min_size": ch.team_min_size, "team_max_size": ch.team_max_size,
        "problem_statement_i18n": ch.problem_statement_i18n,
        "total_prize_budget": ch.total_prize_budget, "currency_code": ch.currency_code,
        "current_phase": {"phase_type": cur.phase_type, "name_i18n": cur.name_i18n, "opens_at": iso(cur.opens_at),
                          "closes_at": iso(cur.closes_at), "status": cur.status} if cur else None,
        "registration": {"is_open": phase_is_open(registration), "opens_at": iso(registration.opens_at) if registration else None,
                         "closes_at": iso(registration.closes_at) if registration else None,
                         "count": registration_count(db, ch.id) if ch.show_registration_count else None},
        "eligibility": eligibility(db, ch, cu),
        "my_entry_id": mine.id if mine else None,
        "published_at": iso(ch.published_at), "results_published_at": iso(ch.results_published_at),
    }


def challenge_detail(db: Session, ch: Challenge, cu: CurrentUser) -> dict:
    """Public information only: problem, rules, timeline, prizes, Q&A and a registration count."""
    out = challenge_card(db, ch, cu)
    phases = phases_of(db, ch.id)
    mine = my_entry_in(db, ch.id, cu.id)
    shortlisted = bool(mine and STAGE_INDEX.get(mine.status_code, 0) >= 4)

    def criteria(round_type: str):
        rnd = round_of(db, ch.id, round_type)
        if not rnd or not rnd.scorecard_id:
            return []
        return [{"name": en(c.name_i18n), "name_i18n": c.name_i18n, "guidance": en(c.guidance_i18n), "weight_pct": c.weight_pct}
                for c in db.scalars(select(ScorecardCriterion).where(ScorecardCriterion.scorecard_id == rnd.scorecard_id)
                                    .order_by(ScorecardCriterion.sort_order)).all()]

    resources = []
    for r in db.scalars(select(ChallengeResource).where(ChallengeResource.challenge_id == ch.id)).all():
        locked = (r.access_level == "REGISTERED" and not mine and not cu.sees_all) or \
                 (r.access_level == "SHORTLISTED" and not shortlisted and not cu.sees_all)
        resources.append({"id": r.id, "title": r.title, "resource_type": r.resource_type, "access_level": r.access_level,
                          "locked": locked, "url": None if locked else r.url,
                          "locked_reason": None if not locked else "Available after shortlisting"
                          if r.access_level == "SHORTLISTED" else "Available after you register"})
    rules = db.scalars(select(ChallengeEligibilityRule).where(ChallengeEligibilityRule.challenge_id == ch.id)).all()
    units = [db.get(OrgUnit, r.rule_value.get("org_unit_id")) for r in rules if r.rule_type == "ORG_UNIT"]
    out.update({
        "background_i18n": ch.background_i18n, "expected_outcome_i18n": ch.expected_outcome_i18n,
        "rules_i18n": ch.rules_i18n, "prototype_policy": ch.prototype_policy, "blind_review": ch.blind_review,
        "sponsor": user_brief(db, ch.sponsor_user_id), "allow_cross_org_teams": ch.allow_cross_org_teams,
        "who_can_join": ", ".join(en(u.name_i18n) for u in units if u) + " staff" if units else "All employees",
        "phases": [{"id": p.id, "phase_type": p.phase_type, "name_i18n": p.name_i18n, "sequence_no": p.sequence_no,
                    "opens_at": iso(p.opens_at), "closes_at": iso(p.closes_at), "status": p.status,
                    "note": "Only if the panel asks" if p.phase_type in ("PROTOTYPE", "PROTOTYPE_REVIEW")
                    and ch.prototype_policy == "PANEL_DECIDES" else None} for p in phases],
        "prizes": [{"rank_from": p.rank_from, "rank_to": p.rank_to, "prize_type": p.prize_type,
                    "description": en(p.description_i18n), "amount": p.amount, "currency_code": p.currency_code}
                   for p in db.scalars(select(ChallengePrize).where(ChallengePrize.challenge_id == ch.id)
                                       .order_by(ChallengePrize.rank_from)).all()],
        "methodology_criteria": criteria("METHODOLOGY"), "final_criteria": criteria("FINAL_JURY"),
        "resources": resources,
        "my_entry": entry_card(db, mine, cu, ch) if mine else None,
    })
    return out


def notify_entry(db: Session, entry: ChallengeEntry) -> list[str]:
    """Everyone who should hear about an entry: the lead and active team members."""
    users = [entry.lead_user_id]
    if entry.team_id:
        users += [m.user_id for m in cache.by(db, TeamMember, "team_id").get(entry.team_id, []) if m.status == "ACTIVE"]
    return list(dict.fromkeys(users))


def challenge_numbers(db: Session, ch: Challenge) -> dict:
    from app.modules.evaluation.models import ReviewAssignment
    entries = [e for e in cache.by(db, ChallengeEntry, "challenge_id").get(ch.id, []) if not e.deleted_at]
    active = [e for e in entries if e.status_code != "WITHDRAWN"]
    round_ids = [r.id for r in rounds_of(db, ch.id)]
    assigned = submitted = overdue = 0
    now = utcnow()
    for rid in round_ids:
        for a in cache.by(db, ReviewAssignment, "review_round_id").get(rid, []):
            if a.status == "DECLINED_COI":
                continue
            assigned += 1
            submitted += a.status == "SUBMITTED"
            overdue += a.status != "SUBMITTED" and bool(a.due_at and a.due_at < now)
    subs = sum(1 for e in entries for s in cache.by(db, EntrySubmission, "challenge_entry_id").get(e.id, [])
               if s.submission_type == "METHODOLOGY" and s.status in ("SUBMITTED", "LOCKED"))
    shortlist_waiting = sum(1 for rid in round_ids for s in cache.by(db, Shortlist, "review_round_id").get(rid, [])
                            if s.status in ("PROPOSED", "CONFIRMED"))
    feedback_published = sum(1 for e in entries for f in cache.by(db, Feedback, "entity_id").get(e.id, [])
                             if f.entity_type == "challenge_entry" and f.published_at)
    return {
        "registered": len(active), "teams": sum(1 for e in active if e.entry_type == "TEAM"),
        "methodologies_submitted": subs, "reviews_assigned": assigned, "reviews_done": submitted,
        "reviews_overdue": overdue, "reviews_done_pct": round(submitted * 100 / assigned) if assigned else 0,
        "shortlisted": sum(1 for e in active if STAGE_INDEX.get(e.status_code, 0) >= 4),
        "finalists": sum(1 for e in active if e.status_code in ("FINALIST", "FINAL_SUBMITTED", "JUDGED", "WINNER", "RUNNER_UP", "PARTICIPANT")),
        "winners": sum(1 for e in active if e.status_code in ("WINNER", "RUNNER_UP")),
        "shortlists_waiting": shortlist_waiting, "feedback_published": feedback_published,
    }
