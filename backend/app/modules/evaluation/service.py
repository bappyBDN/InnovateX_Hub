"""Score maths, conflict-of-interest checks, reviewer assignment, shortlisting and feedback.

The server always calculates scores and ranks (data-model doc §4.5); the browser only displays them.
"""
from statistics import mean, median, pstdev

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import DomainError
from app.core.events import publish_event, record_history
from app.modules.challenges import service as csvc
from app.modules.challenges.models import Challenge, ChallengeEntry, EntrySubmission, SubmissionVersion, TeamMember
from app.modules.delivery.models import Badge, PointsLedger, UserBadge
from app.modules.evaluation.models import (ConflictOfInterestDeclaration, Feedback, PanelMember, RatingScale,
                                           ReviewAssignment, ReviewRound, ReviewScore, ReviewSummary, RoundResult,
                                           Scorecard, ScorecardCriterion, Shortlist, ShortlistEntry, ShortlistRule)
from app.modules.identity.models import User
from app.modules.initiatives.models import Initiative, InitiativeMember
from app.shared.models.base import iso, utcnow
from app.shared.util import en


# ---- Scorecard helpers --------------------------------------------------------------------
def criteria_of(db: Session, scorecard_id: str | None) -> list[ScorecardCriterion]:
    if not scorecard_id:
        return []
    return list(db.scalars(select(ScorecardCriterion).where(ScorecardCriterion.scorecard_id == scorecard_id)
                           .order_by(ScorecardCriterion.sort_order)).all())


def max_rating(db: Session, scorecard_id: str | None) -> float:
    sc = db.get(Scorecard, scorecard_id) if scorecard_id else None
    scale = db.get(RatingScale, sc.rating_scale_id) if sc and sc.rating_scale_id else None
    return float(scale.max_value) if scale else 5.0


def weighted_score(ratings: dict[str, float], criteria: list[ScorecardCriterion], top: float) -> float:
    """Reviewer score = Σ (rating ÷ max_rating × criterion weight). Result is 0–100."""
    return round(sum((ratings.get(c.id) or 0) / top * (c.weight_pct or 0) for c in criteria), 2)


def ratings_of(db: Session, assignment_id: str) -> dict[str, ReviewScore]:
    return {s.scorecard_criterion_id: s for s in db.scalars(
        select(ReviewScore).where(ReviewScore.review_assignment_id == assignment_id)).all()}


# ---- Conflict of interest ---------------------------------------------------------------------
def people_of(db: Session, entity_type: str, entity_id: str) -> list[str]:
    if entity_type == "challenge_entry":
        entry = db.get(ChallengeEntry, entity_id)
        return csvc.notify_entry(db, entry) if entry else []
    ini = db.get(Initiative, entity_id)
    if not ini:
        return []
    members = db.scalars(select(InitiativeMember.user_id).where(InitiativeMember.initiative_id == ini.id)).all()
    return list(dict.fromkeys([ini.owner_user_id, ini.submitted_by_user_id, *members]))


def conflict_reason(db: Session, reviewer_id: str, entity_type: str, entity_id: str) -> str | None:
    """A judge can't score their own team, their manager or their direct reports."""
    people = [p for p in people_of(db, entity_type, entity_id) if p]
    if reviewer_id in people:
        return "SAME_TEAM"
    reviewer = db.get(User, reviewer_id)
    if reviewer and reviewer.manager_id in people:
        return "MANAGER"
    if db.scalar(select(User.id).where(User.id.in_(people or [""]), User.manager_id == reviewer_id)):
        return "DIRECT_REPORT"
    return None


# ---- Assignment --------------------------------------------------------------------------------
ELIGIBLE = {"METHODOLOGY": ("UNDER_REVIEW", "CLARIFICATION_REQUESTED"), "PROTOTYPE": ("PROTOTYPE_SUBMITTED",),
            "FINAL_JURY": ("FINAL_SUBMITTED",)}
SUBMISSION_FOR_ROUND = {"METHODOLOGY": "METHODOLOGY", "PROTOTYPE": "PROTOTYPE", "FINAL_JURY": "FINAL_PROJECT"}


def latest_version_id(db: Session, entry_id: str, round_type: str) -> str | None:
    sub = db.scalar(select(EntrySubmission).where(EntrySubmission.challenge_entry_id == entry_id,
                                                  EntrySubmission.submission_type == SUBMISSION_FOR_ROUND.get(round_type)))
    if not sub:
        return None
    return db.scalar(select(SubmissionVersion.id).where(SubmissionVersion.entry_submission_id == sub.id)
                     .order_by(SubmissionVersion.version_no.desc()))


def auto_assign(db: Session, rnd: ReviewRound, actor_id: str | None) -> dict:
    """Balanced-load assignment with the conflict-of-interest check. Returns what was created and excluded."""
    ch = db.get(Challenge, rnd.challenge_id)
    entries = db.scalars(select(ChallengeEntry).where(ChallengeEntry.challenge_id == rnd.challenge_id,
                                                      ChallengeEntry.status_code.in_(ELIGIBLE.get(rnd.round_type, ())))
                         .order_by(ChallengeEntry.code)).all()
    # A judge may be limited to some stages (empty list = all stages).
    panel = [m for m in db.scalars(select(PanelMember).where(PanelMember.panel_id == rnd.panel_id)).all()
             if not m.stages or rnd.round_type in m.stages]
    if not panel:
        raise DomainError("PANEL_EMPTY", "No judge is chosen for this stage yet. The admin chooses judges on the Judges tab.")
    load = {m.user_id: db.scalar(select(func.count()).select_from(ReviewAssignment).where(
        ReviewAssignment.review_round_id == rnd.id, ReviewAssignment.reviewer_user_id == m.user_id,
        ReviewAssignment.status != "DECLINED_COI")) or 0 for m in panel}
    weights = {m.user_id: m.vote_weight or 1 for m in panel}
    wanted = len(panel) if rnd.round_type == "FINAL_JURY" else (rnd.reviewers_per_entry or 3)
    created, exclusions, short = 0, [], []
    if rnd.round_type == "PROTOTYPE":
        from app.modules.evaluation.gates import has_gate
        entries = [e for e in entries if not has_gate(db, "challenge_entry", e.id)]
    for entry in entries:
        existing = db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == rnd.id,
                                                             ReviewAssignment.entity_id == entry.id)).all()
        taken = {a.reviewer_user_id for a in existing}
        have = sum(1 for a in existing if a.status != "DECLINED_COI")
        for reviewer_id in sorted(load, key=lambda u: (load[u], u)):
            if have >= wanted:
                break
            if reviewer_id in taken:
                continue
            reason = conflict_reason(db, reviewer_id, "challenge_entry", entry.id)
            if reason:
                exclusions.append({"reviewer": db.get(User, reviewer_id).full_name, "entry": entry.code, "reason": reason})
                db.add(ConflictOfInterestDeclaration(review_round_id=rnd.id, reviewer_user_id=reviewer_id,
                                                     entity_type="challenge_entry", entity_id=entry.id,
                                                     source="SYSTEM_DETECTED", reason=reason))
                continue
            db.add(ReviewAssignment(review_round_id=rnd.id, reviewer_user_id=reviewer_id, entity_type="challenge_entry",
                                    entity_id=entry.id, status="ASSIGNED", due_at=rnd.due_at,
                                    reviewer_weight=weights[reviewer_id],
                                    submission_version_id=latest_version_id(db, entry.id, rnd.round_type), created_by=actor_id))
            load[reviewer_id] += 1
            have += 1
            created += 1
            publish_event(db, "REVIEW_ASSIGNED", "challenge_entry", entry.id, actor_id, users=[reviewer_id],
                          title=f"Entry to score: {entry.code}",
                          body=f"{en(rnd.name_i18n)} for {en(ch.title_i18n)}. Please score it before the due date.",
                          link="/review", needs_action=True,
                          vars={"entry_code": entry.code, "round": en(rnd.name_i18n)})
        free = sum(1 for u in load if not conflict_reason(db, u, "challenge_entry", entry.id))
        if have < min(wanted, free):
            short.append(entry.code)
    if created and rnd.status == "SETUP":
        rnd.status = "IN_PROGRESS"
    db.flush()
    return {"created": created, "entries": len(entries), "exclusions": exclusions, "short_of_reviewers": short}


# ---- Round results -----------------------------------------------------------------------------
def _aggregate(method: str, scored: list[tuple[float, float]]) -> float:
    values = [s for s, _ in scored]
    if method == "MEDIAN":
        return median(values)
    if method == "TRIMMED_MEAN" and len(values) >= 5:
        return mean(sorted(values)[1:-1])
    if method == "WEIGHTED_BY_REVIEWER":
        total = sum(w for _, w in scored) or 1
        return sum(s * w for s, w in scored) / total
    return mean(values)


def calculate_round(db: Session, rnd: ReviewRound) -> list[RoundResult]:
    criteria = criteria_of(db, rnd.scorecard_id)
    top = max_rating(db, rnd.scorecard_id)
    assignments = db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == rnd.id,
                                                            ReviewAssignment.status != "DECLINED_COI")).all()
    by_entity: dict[tuple[str, str], list[ReviewAssignment]] = {}
    for a in assignments:
        by_entity.setdefault((a.entity_type, a.entity_id), []).append(a)
    existing = {(r.entity_type, r.entity_id): r for r in db.scalars(
        select(RoundResult).where(RoundResult.review_round_id == rnd.id)).all()}

    # 1. reviewer scores
    scores: dict[str, float] = {}
    ratings: dict[str, dict[str, float]] = {}
    for a in assignments:
        if a.status != "SUBMITTED":
            continue
        ratings[a.id] = {cid: s.rating for cid, s in ratings_of(db, a.id).items() if s.rating is not None}
        scores[a.id] = weighted_score(ratings[a.id], criteria, top)

    # 2. optional z-score normalisation to remove "strict" or "generous" reviewer bias
    by_reviewer: dict[str, list[float]] = {}
    for a in assignments:
        if a.id in scores:
            by_reviewer.setdefault(a.reviewer_user_id, []).append(scores[a.id])
    all_scores = list(scores.values())
    overall_mean = mean(all_scores) if all_scores else 0
    overall_sd = pstdev(all_scores) if len(all_scores) > 1 else 0
    z: dict[str, float] = {}
    for a in assignments:
        if a.id in scores:
            mine = by_reviewer[a.reviewer_user_id]
            sd = pstdev(mine) if len(mine) > 1 else 0
            z[a.id] = (scores[a.id] - mean(mine)) / sd if sd else 0.0

    results = []
    for key, items in by_entity.items():
        res = existing.get(key) or RoundResult(review_round_id=rnd.id, entity_type=key[0], entity_id=key[1])
        if res.is_frozen:
            results.append(res)
            continue
        done = [a for a in items if a.id in scores]
        res.reviews_expected, res.reviews_completed = len(items), len(done)
        if done:
            res.raw_score = round(_aggregate(rnd.aggregation_method or "MEAN", [(scores[a.id], a.reviewer_weight or 1) for a in done]), 2)
            res.normalized_score = round(mean(z[a.id] for a in done), 3)
            if rnd.normalize_scores:
                res.final_score = round(min(100, max(0, overall_mean + res.normalized_score * overall_sd)), 2)
            else:
                res.final_score = res.raw_score
            averages, disagreements, failed = {}, [], []
            for c in criteria:
                given = [ratings[a.id][c.id] for a in done if c.id in ratings[a.id]]
                if not given:
                    continue
                averages[c.code] = round(mean(given), 2)
                if c.min_rating is not None and averages[c.code] < c.min_rating:
                    failed.append(c.code)
                if rnd.disagreement_threshold and max(given) - min(given) >= rnd.disagreement_threshold:
                    disagreements.append(c.code)
            res.criterion_averages, res.failed_gates, res.disagreement_criteria = averages, failed, disagreements
            res.needs_discussion = bool(disagreements) and not res.discussion_resolved
        else:
            res.raw_score = res.final_score = res.normalized_score = None
            res.criterion_averages, res.failed_gates, res.disagreement_criteria, res.needs_discussion = {}, [], [], False
        res.calculated_at = utcnow()
        db.add(res)
        results.append(res)

    tie_code = next((c.code for c in criteria if c.is_tie_breaker), None)
    ranked = sorted([r for r in results if r.final_score is not None],
                    key=lambda r: (-r.final_score, -((r.criterion_averages or {}).get(tie_code) or 0)))
    for i, r in enumerate(ranked, start=1):
        if not r.is_frozen:
            r.rank = i
        if r.entity_type == "challenge_entry":
            entry = db.get(ChallengeEntry, r.entity_id)
            if entry:
                entry.current_score, entry.current_rank = r.final_score, r.rank
        else:
            ini = db.get(Initiative, r.entity_id)
            if ini:
                ini.score_latest = r.final_score
    db.flush()
    return results


# ---- Shortlisting ------------------------------------------------------------------------------
def default_rule(db: Session, rnd: ReviewRound) -> ShortlistRule:
    rule = db.scalar(select(ShortlistRule).where(ShortlistRule.review_round_id == rnd.id))
    if not rule:
        rule = ShortlistRule(review_round_id=rnd.id, method="TOP_N", top_n=5, waitlist_size=0,
                             tie_break_rules=["TIE_BREAKER_CRITERION", "EARLIEST_SUBMISSION"])
        db.add(rule)
        db.flush()
    return rule


def rule_text(rule: ShortlistRule) -> str:
    m = rule.method
    if m == "TOP_N":
        return f"Top {rule.top_n}"
    if m == "THRESHOLD":
        return f"Score ≥ {rule.min_score:g}"
    if m == "TOP_N_WITH_THRESHOLD":
        return f"Top {rule.top_n} with score ≥ {rule.min_score:g}"
    if m == "TOP_PERCENT":
        return f"Top {rule.top_percent:g}%"
    return "Manual choice (score shown as guidance)"


def propose_blockers(db: Session, rnd: ReviewRound, results: list[RoundResult], rule: ShortlistRule) -> list[str]:
    reasons = []
    if not results:
        reasons.append("No reviews are assigned in this round yet.")
    pending = sum((r.reviews_expected or 0) - (r.reviews_completed or 0) for r in results)
    if rule.require_all_reviews_done and pending:
        reasons.append(f"{pending} review(s) are not submitted yet.")
    disagree = sum(1 for r in results if r.needs_discussion)
    if disagree:
        reasons.append(f"{disagree} entr{'y has' if disagree == 1 else 'ies have'} a judge disagreement to resolve.")
    return reasons


def _submitted_at(db: Session, entry_id: str, round_type: str):
    sub = db.scalar(select(EntrySubmission).where(EntrySubmission.challenge_entry_id == entry_id,
                                                  EntrySubmission.submission_type == SUBMISSION_FOR_ROUND.get(round_type)))
    return (sub.submitted_at if sub else None) or utcnow()


def propose_shortlist(db: Session, rnd: ReviewRound, actor_id: str) -> Shortlist:
    rule = default_rule(db, rnd)
    results = calculate_round(db, rnd)
    blockers = propose_blockers(db, rnd, results, rule)
    if blockers:
        raise DomainError("REVIEWS_INCOMPLETE" if "review" in blockers[0] else "DISAGREEMENTS_UNRESOLVED", " ".join(blockers))
    if db.scalar(select(Shortlist.id).where(Shortlist.review_round_id == rnd.id, Shortlist.status.in_(["CONFIRMED", "PUBLISHED"]))):
        raise DomainError("SHORTLIST_ALREADY_CONFIRMED", "The shortlist for this round is already confirmed.")

    criteria = criteria_of(db, rnd.scorecard_id)
    tie_code = next((c.code for c in criteria if c.is_tie_breaker), None)
    scored = [r for r in results if r.final_score is not None]
    eligible = [r for r in scored if not (rule.exclude_failed_gates and r.failed_gates)]
    ranked = sorted(eligible, key=lambda r: (-r.final_score, -((r.criterion_averages or {}).get(tie_code) or 0),
                                             _submitted_at(db, r.entity_id, rnd.round_type)))
    method = rule.method
    if method == "TOP_N":
        selected = ranked[: rule.top_n or 0]
    elif method == "THRESHOLD":
        selected = [r for r in ranked if r.final_score >= (rule.min_score or 0)]
    elif method == "TOP_N_WITH_THRESHOLD":
        selected = [r for r in ranked[: rule.top_n or 0] if r.final_score >= (rule.min_score or 0)]
    elif method == "TOP_PERCENT":
        selected = ranked[: max(1, round(len(ranked) * (rule.top_percent or 0) / 100))]
    else:  # MANUAL: the panel picks; nothing is pre-selected
        selected = []
    rest = [r for r in ranked if r not in selected]
    waitlist = rest[: rule.waitlist_size or 0]

    for old in db.scalars(select(Shortlist).where(Shortlist.review_round_id == rnd.id, Shortlist.status == "PROPOSED")).all():
        for e in db.scalars(select(ShortlistEntry).where(ShortlistEntry.shortlist_id == old.id)).all():
            db.delete(e)
        db.delete(old)
    ch = db.get(Challenge, rnd.challenge_id)
    shortlist = Shortlist(review_round_id=rnd.id, status="PROPOSED", generated_at=utcnow(), created_by=actor_id,
                          shortlist_type="FINALISTS" if rnd.round_type == "PROTOTYPE" else "SHORTLIST",
                          rule_snapshot={"method": rule.method, "top_n": rule.top_n, "min_score": rule.min_score,
                                         "top_percent": rule.top_percent, "waitlist_size": rule.waitlist_size,
                                         "text": rule_text(rule)})
    db.add(shortlist)
    db.flush()
    for r in sorted(scored, key=lambda r: r.rank or 9999):
        decision = "IN" if r in selected else "WAITLIST" if r in waitlist else "OUT"
        db.add(ShortlistEntry(shortlist_id=shortlist.id, entity_type=r.entity_type, entity_id=r.entity_id,
                              final_score=r.final_score, rank=r.rank, system_decision=decision, final_decision=decision,
                              prototype_required=decision == "IN" and ch.prototype_policy == "REQUIRED_ALL"))
    ensure_feedback_drafts(db, rnd, actor_id)
    publish_event(db, "SHORTLIST_PROPOSED", "review_round", rnd.id, actor_id)
    db.flush()
    return shortlist


def judge_comments(db: Session, rnd: ReviewRound, entity_type: str, entity_id: str) -> dict[str, list[str]]:
    """Anonymised per-criterion comments from submitted reviews (no judge names), grouped by criterion name."""
    criteria = {c.id: c for c in criteria_of(db, rnd.scorecard_id)}
    out: dict[str, list[str]] = {}
    for a in db.scalars(select(ReviewAssignment).where(
            ReviewAssignment.review_round_id == rnd.id, ReviewAssignment.entity_type == entity_type,
            ReviewAssignment.entity_id == entity_id, ReviewAssignment.status == "SUBMITTED")).all():
        for cid, s in ratings_of(db, a.id).items():
            if cid not in criteria or not (s.comment or "").strip():
                continue
            out.setdefault(en(criteria[cid].name_i18n), []).append(s.comment.strip())
    return {name: list(dict.fromkeys(comments)) for name, comments in out.items()}


def judge_recommendations(db: Session, rnd: ReviewRound, entity_type: str, entity_id: str) -> list[str]:
    """Anonymised recommendation values from submitted reviews (e.g. ['YES', 'MAYBE']). No judge names."""
    out: list[str] = []
    for a in db.scalars(select(ReviewAssignment).where(
            ReviewAssignment.review_round_id == rnd.id, ReviewAssignment.entity_type == entity_type,
            ReviewAssignment.entity_id == entity_id, ReviewAssignment.status == "SUBMITTED")).all():
        s = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
        if s and s.recommendation:
            out.append(s.recommendation)
    return out


def ensure_feedback_drafts(db: Session, rnd: ReviewRound, actor_id: str | None) -> None:
    """Gather the judges' shared strengths and improvements into one draft per entry (anonymised)."""
    criteria = {c.code: c for c in criteria_of(db, rnd.scorecard_id)}
    for res in db.scalars(select(RoundResult).where(RoundResult.review_round_id == rnd.id)).all():
        fb = db.scalar(select(Feedback).where(Feedback.review_round_id == rnd.id, Feedback.entity_id == res.entity_id))
        if fb:
            continue
        strengths, improvements = [], []
        for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == rnd.id,
                                                           ReviewAssignment.entity_id == res.entity_id,
                                                           ReviewAssignment.status == "SUBMITTED")).all():
            summary = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
            if summary and summary.strengths:
                strengths.append(summary.strengths.strip())
            if summary and summary.improvements:
                improvements.append(summary.improvements.strip())
        db.add(Feedback(entity_type=res.entity_type, entity_id=res.entity_id, review_round_id=rnd.id,
                        strengths="\n".join(f"• {s}" for s in strengths), improvements="\n".join(f"• {s}" for s in improvements),
                        score_shared=res.final_score if rnd.show_scores_to_entrants != "NONE" else None,
                        criterion_scores={en(criteria[k].name_i18n): v for k, v in (res.criterion_averages or {}).items() if k in criteria}
                        if rnd.show_scores_to_entrants == "PER_CRITERION" else {},
                        written_by=actor_id))
    db.flush()


DECISION_STATUS = {
    "METHODOLOGY": {"IN": "SHORTLISTED", "WAITLIST": "WAITLISTED", "OUT": "NOT_SHORTLISTED"},
    "PROTOTYPE": {"IN": "FINALIST", "WAITLIST": "NOT_SELECTED", "OUT": "NOT_SELECTED"},
}
NEXT_STEPS = {
    "SHORTLISTED": "Open your build plan, add milestones and start building. Resources for shortlisted entries are now unlocked. "
                   "If a demo is asked for, share your demo link and how to use it on the Prototype page.",
    "WAITLISTED": "You're on the waitlist. If a shortlisted entry withdraws, we'll tell you straight away.",
    "NOT_SHORTLISTED": "Thank you for taking part. You can still submit this as an open idea any time.",
    "FINALIST": "Choose a date and time for your live presentation. You are also eligible for the pilot: open the pilot form on the Demo & pilot page.",
    "NOT_SELECTED": "Thank you for building a prototype. Your work stays on record and can continue as an open idea.",
}


def award_points(db: Session, user_ids: list[str], points: int, reason: str, badge_code: str | None, entity_type: str,
                 entity_id: str) -> None:
    badge = db.scalar(select(Badge).where(Badge.code == badge_code)) if badge_code else None
    for uid in user_ids:
        db.add(PointsLedger(user_id=uid, points=points, reason_code=reason, source_entity_type=entity_type,
                            source_entity_id=entity_id))
        if badge and not db.scalar(select(UserBadge.id).where(UserBadge.user_id == uid, UserBadge.badge_id == badge.id,
                                                              UserBadge.source_entity_id == entity_id)):
            db.add(UserBadge(user_id=uid, badge_id=badge.id, source_entity_type=entity_type, source_entity_id=entity_id,
                             awarded_at=utcnow()))


def publish_shortlist(db: Session, shortlist: Shortlist, rnd: ReviewRound, actor_id: str) -> dict:
    ch = db.get(Challenge, rnd.challenge_id)
    mapping = DECISION_STATUS.get(rnd.round_type, DECISION_STATUS["METHODOLOGY"])
    counts = {"IN": 0, "WAITLIST": 0, "OUT": 0}
    now = utcnow()
    for se in db.scalars(select(ShortlistEntry).where(ShortlistEntry.shortlist_id == shortlist.id)).all():
        entry = db.get(ChallengeEntry, se.entity_id)
        if not entry or entry.status_code == "WITHDRAWN":
            continue
        new = mapping[se.final_decision]
        counts[se.final_decision] += 1
        record_history(db, "challenge_entry", entry.id, entry.status_code, new, "SHORTLIST_PUBLISHED", actor_id,
                       se.override_reason)
        entry.status_code = new
        if rnd.round_type == "PROTOTYPE":
            from app.modules.evaluation.gates import record_shortlist_outcome
            record_shortlist_outcome(db, entry.id, se.final_decision == "IN", actor_id)
        if rnd.round_type == "METHODOLOGY":
            entry.prototype_required = bool(se.prototype_required) and se.final_decision == "IN"
        fb = db.scalar(select(Feedback).where(Feedback.review_round_id == rnd.id, Feedback.entity_id == entry.id))
        if fb:
            fb.decision_code = new
            fb.next_steps = fb.next_steps or NEXT_STEPS.get(new)
            if new == "SHORTLISTED" and entry.prototype_required:
                fb.next_steps = (fb.next_steps or "") + " The panel asks you to submit a working prototype" + \
                                (f": {se.prototype_reason}." if se.prototype_reason else ".")
            fb.published_at = fb.published_at or now
        people = csvc.notify_entry(db, entry)
        if se.final_decision == "IN":
            award_points(db, people, 50 if rnd.round_type == "METHODOLOGY" else 80, new,
                         "SHORTLISTED" if rnd.round_type == "METHODOLOGY" else "FINALIST", "challenge_entry", entry.id)
        event = {"SHORTLISTED": "ENTRY_SHORTLISTED", "FINALIST": "ENTRY_SHORTLISTED"}.get(new, "ENTRY_NOT_SHORTLISTED")
        titles = {"SHORTLISTED": "Your entry is shortlisted", "WAITLISTED": "Your entry is on the waitlist",
                  "NOT_SHORTLISTED": "Shortlist result and your feedback", "FINALIST": "You're a finalist",
                  "NOT_SELECTED": "Prototype result and your feedback"}
        body = NEXT_STEPS.get(new, "")
        if new == "SHORTLISTED" and ch.prototype_policy != "NONE":
            phase = csvc.phase_of(db, ch.id, "PROTOTYPE")
            if phase:   # tell the team when to be ready
                body = (f"You are shortlisted! Start building. Share your demo link and how to use it by {csvc._fmt(phase.closes_at)} "
                        "on the Demo & pilot page.")
        if new == "FINALIST":
            fphase = csvc.phase_of(db, ch.id, "FINAL_SUBMISSION")
            body = ("You are a finalist! Choose a date and time for your live presentation"
                    + (f" between {csvc._fmt(fphase.opens_at)} and {csvc._fmt(fphase.closes_at)}" if fphase else "")
                    + ". The innovation office will accept it or suggest another time.")
        publish_event(db, event, "challenge_entry", entry.id, actor_id, users=people,
                      title=f"{titles[new]}: {entry.title}", body=body,
                      link=f"/entries/{entry.id}" if se.final_decision == "IN" else f"/entries/{entry.id}/feedback",
                      needs_action=se.final_decision == "IN",
                      vars={"entry_code": entry.code, "challenge": en(ch.title_i18n), "decision": titles[new]},
                      data={"rank": se.rank, "final_score": se.final_score, "prototype_required": se.prototype_required})
    shortlist.status, shortlist.published_at = "PUBLISHED", now
    rnd.status = "PUBLISHED"
    publish_event(db, "SHORTLIST_PUBLISHED", "review_round", rnd.id, actor_id)
    db.flush()
    return counts


def team_shares(db: Session, entry: ChallengeEntry) -> dict[str, float]:
    """Credit share per person; an individual entry is 100% to the lead."""
    if not entry.team_id:
        return {entry.lead_user_id: 100.0}
    members = db.scalars(select(TeamMember).where(TeamMember.team_id == entry.team_id, TeamMember.status == "ACTIVE")).all()
    return {m.user_id: m.credit_share_pct or round(100 / len(members), 2) for m in members}


def judge_feedback(db: Session, entity_type: str, entity_id: str) -> dict:
    """Everything the judges said about one idea or entry, with names — for staff only.

    Per scoring round: each judge's score, recommendation, per-criterion rating and comment, strengths, suggestions
    (improvements) and private note. Plus the demo / pilot review decisions with the feedback each judge wrote.
    """
    from app.modules.evaluation.gates import STAGE_TITLE, rounds as gate_rounds, votes_of
    from app.shared.util import user_brief

    assignments = list(db.scalars(select(ReviewAssignment).where(
        ReviewAssignment.entity_type == entity_type, ReviewAssignment.entity_id == entity_id,
        ReviewAssignment.status != "DECLINED_COI").order_by(ReviewAssignment.created_at)).all())
    by_round: dict[str, list[ReviewAssignment]] = {}
    for a in assignments:
        by_round.setdefault(a.review_round_id, []).append(a)
    out_rounds, all_scores, recs = [], [], {}
    for round_id, items in by_round.items():
        rnd = db.get(ReviewRound, round_id)
        if not rnd:
            continue
        criteria = criteria_of(db, rnd.scorecard_id)
        top = max_rating(db, rnd.scorecard_id)
        reviews, scores = [], []
        for a in items:
            summary = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
            done = a.status == "SUBMITTED"
            ratings = ratings_of(db, a.id) if done else {}
            score = summary.weighted_score if summary and done else None
            if score is not None:
                scores.append(score)
                all_scores.append(score)
            if done and summary and summary.recommendation:
                recs[summary.recommendation] = recs.get(summary.recommendation, 0) + 1
            reviews.append({
                "id": a.id, "judge": user_brief(db, a.reviewer_user_id), "status": a.status,
                "submitted_at": iso(a.submitted_at), "weighted_score": score,
                "recommendation": summary.recommendation if summary and done else None,
                "strengths": summary.strengths if summary and done else None,
                "improvements": summary.improvements if summary and done else None,
                "private_note": summary.private_note if summary and done else None,
                "criteria": [{"code": c.code, "name": en(c.name_i18n), "weight_pct": c.weight_pct,
                              "rating": ratings[c.id].rating if c.id in ratings else None,
                              "comment": ratings[c.id].comment if c.id in ratings else None} for c in criteria] if done else [],
            })
        out_rounds.append({"round_id": rnd.id, "name": en(rnd.name_i18n), "round_type": rnd.round_type, "status": rnd.status,
                           "scale_max": top, "reviews": reviews,
                           "average_score": round(sum(scores) / len(scores), 1) if scores else None,
                           "reviews_done": len(scores), "reviews_total": len(items)})
    out_rounds.sort(key=lambda r: ["IDEA_REVIEW", "METHODOLOGY", "PROTOTYPE", "FINAL_JURY"].index(r["round_type"])
                    if r["round_type"] in ("IDEA_REVIEW", "METHODOLOGY", "PROTOTYPE", "FINAL_JURY") else 9)

    gate_out = []
    for stage in ("PROTOTYPE", "PILOT"):
        for g in reversed(gate_rounds(db, entity_type, entity_id, stage)):
            if g.status == "DRAFT":
                continue
            gate_out.append({
                "id": g.id, "stage": stage, "title": STAGE_TITLE[stage], "round_no": g.round_no, "status": g.status,
                "submitted_at": iso(g.submitted_at), "decided_at": iso(g.decided_at), "decision_note": g.decision_note,
                "decided_by_admin": bool(g.decided_by),
                "judges": [{"judge": user_brief(db, v.judge_user_id), "decision": v.decision, "feedback": v.feedback,
                            "decided_at": iso(v.decided_at)} for v in votes_of(db, g)]})
    return {"entity_type": entity_type, "entity_id": entity_id, "rounds": out_rounds, "gates": gate_out,
            "summary": {"average_score": round(sum(all_scores) / len(all_scores), 1) if all_scores else None,
                        "reviews_done": len(all_scores), "reviews_total": len(assignments), "recommendations": recs}}
