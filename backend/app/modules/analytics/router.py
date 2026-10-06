"""Home ("What needs you now"), dashboards and global search. Everything respects the visibility rules."""
from collections import Counter
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import not_found
from app.core.permissions import CurrentUser, get_current_user, my_team_ids
from app.modules.challenges import service as csvc
from app.modules.challenges.models import Challenge, ChallengeEntry, EntrySubmission, Team, TeamJoinRequest
from app.modules.delivery.models import AwardDecision, Kpi, KpiMeasurement, PointsLedger, ReusableAsset, UserBadge
from app.modules.evaluation.models import Feedback, ReviewAssignment, ReviewRound, ReviewSummary, Shortlist
from app.modules.identity.models import OrgUnit, User
from app.modules.initiatives import service as isvc
from app.modules.initiatives.models import ClarificationRequest, Initiative, InitiativeMember
from app.modules.masterdata.models import ChallengeDomain
from app.modules.notifications.models import NotificationDelivery, NotificationOutbox
from app.shared.access import initiative_role
from app.shared import cache
from app.shared.models.base import iso, utcnow
from app.shared.util import en

router = APIRouter(tags=["home, dashboards & search"])


def _my_entries(db: Session, cu: CurrentUser) -> list[ChallengeEntry]:
    teams = my_team_ids(db, cu.id)
    return list(db.scalars(select(ChallengeEntry).where(ChallengeEntry.deleted_at.is_(None)).where(
        or_(ChallengeEntry.lead_user_id == cu.id, ChallengeEntry.team_id.in_(teams or [""])))
        .order_by(ChallengeEntry.registered_at.desc())).all())


def _my_ideas(db: Session, cu: CurrentUser) -> list[Initiative]:
    member_of = db.scalars(select(InitiativeMember.initiative_id).where(InitiativeMember.user_id == cu.id)).all()
    return list(db.scalars(select(Initiative).where(Initiative.deleted_at.is_(None)).where(
        or_(Initiative.owner_user_id == cu.id, Initiative.submitted_by_user_id == cu.id, Initiative.id.in_(member_of or [""])))
        .order_by(Initiative.updated_at.desc())).all())


def _impact_totals(db: Session) -> dict:
    """Verified value comes only from measurements an authorised verifier confirmed."""
    hours = money = 0.0
    verified_kpis = 0
    for k in db.scalars(select(Kpi).where(Kpi.entity_type == "initiative")).all():
        verified = [x for x in cache.by(db, KpiMeasurement, "kpi_id").get(k.id, []) if x.verification_status in ("VERIFIED", "ADJUSTED")]
        m = max(verified, key=lambda x: (x.period_end is not None, x.period_end), default=None)
        if not m or k.baseline_value is None or m.verified_value is None:
            continue
        verified_kpis += 1
        gain = abs(k.baseline_value - m.verified_value)
        if k.unit_code == "hours":
            hours += gain
        elif k.unit_code == "BDT":
            money += gain
    return {"verified_hours_saved": round(hours), "verified_value_bdt": round(money), "verified_kpis": verified_kpis}


def _judge_block(db: Session, cu: CurrentUser) -> dict:
    now = utcnow()
    mine = db.scalars(select(ReviewAssignment).where(ReviewAssignment.reviewer_user_id == cu.id,
                                                     ReviewAssignment.status != "DECLINED_COI")).all()
    open_items = sorted([a for a in mine if a.status != "SUBMITTED"], key=lambda a: a.due_at or now)
    summaries = {s.review_assignment_id: s.weighted_score for s in db.scalars(select(ReviewSummary).where(
        ReviewSummary.review_assignment_id.in_([a.id for a in mine] or [""]))).all()}
    scores = [summaries[a.id] for a in mine if a.status == "SUBMITTED" and summaries.get(a.id) is not None]
    spent = [(a.submitted_at - a.started_at).total_seconds() / 3600 for a in mine
             if a.status == "SUBMITTED" and a.started_at and a.submitted_at]
    return {"assigned": len(mine), "done": sum(a.status == "SUBMITTED" for a in mine), "open": len(open_items),
            "overdue": sum(1 for a in open_items if a.due_at and a.due_at < now),
            "due_soon": sum(1 for a in open_items if a.due_at and now <= a.due_at <= now + timedelta(days=3)),
            "next_due_at": iso(open_items[0].due_at) if open_items else None,
            "next_assignment_id": open_items[0].id if open_items else None,
            "average_score_given": round(sum(scores) / len(scores), 1) if scores else None,
            "average_review_hours": round(sum(spent) / len(spent), 1) if spent else None}


def _program_block(db: Session) -> dict:
    now = utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    challenges = db.scalars(select(Challenge).where(Challenge.deleted_at.is_(None))).all()
    open_assignments = db.scalars(select(ReviewAssignment).where(ReviewAssignment.status.in_(["ASSIGNED", "IN_PROGRESS"]))).all()
    return {
        "challenges_by_status": dict(Counter(c.status_code for c in challenges)),
        "registrations_today": db.scalar(select(func.count()).select_from(ChallengeEntry).where(ChallengeEntry.registered_at >= today)) or 0,
        "submissions_today": db.scalar(select(func.count()).select_from(EntrySubmission).where(EntrySubmission.submitted_at >= today)) or 0,
        "reviews_open": len(open_assignments),
        "reviews_overdue": sum(1 for a in open_assignments if a.due_at and a.due_at < now),
        "shortlists_waiting": db.scalar(select(func.count()).select_from(Shortlist).where(Shortlist.status.in_(["PROPOSED", "CONFIRMED"]))) or 0,
        "results_waiting": sum(1 for c in challenges if c.status_code == "RESULTS_PENDING_APPROVAL"),
        "ideas_to_triage": db.scalar(select(func.count()).select_from(Initiative).where(
            Initiative.current_state_code.in_(["SUBMITTED", "TRIAGE"]), Initiative.deleted_at.is_(None))) or 0,
        "open_questions": 0,
    }


def _executive_block(db: Session) -> dict:
    challenges = db.scalars(select(Challenge).where(Challenge.deleted_at.is_(None), Challenge.status_code != "DRAFT")).all()
    entries = db.scalars(select(ChallengeEntry).where(ChallengeEntry.status_code != "WITHDRAWN")).all()
    ideas = db.scalars(select(Initiative).where(Initiative.deleted_at.is_(None), Initiative.current_state_code != "DRAFT")).all()
    return {"active_challenges": sum(1 for c in challenges if c.status_code not in csvc.CLOSED_STATUSES),
            "entries": len(entries), "shortlisted": sum(1 for e in entries if csvc.STAGE_INDEX.get(e.status_code, 0) >= 4),
            "ideas": len(ideas), "pilots": sum(1 for i in ideas if i.current_state_code == "PILOT"),
            "production": sum(1 for i in ideas if i.current_state_code in ("PRODUCTION", "IMPACT_VERIFIED", "SCALED")),
            "reusable_assets": db.scalar(select(func.count()).select_from(ReusableAsset).where(ReusableAsset.is_published.is_(True))) or 0,
            **_impact_totals(db)}


@router.get("/home")
def home(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    now = utcnow()
    needs: list[dict] = []
    entries = _my_entries(db, cu)
    cards = [csvc.entry_card(db, e, cu) for e in entries]
    for c in cards:
        step = c["next_step"]
        if step["action_path"] and not c["is_finished"]:
            needs.append({"tone": step["tone"], "text": f"{step['text']} — {c['title']}", "action_label": step["action_label"],
                          "link": step["action_path"], "due_at": step["due_at"]})
    for team in cache.by(db, Team, "lead_user_id").get(cu.id, []):
        pending = sum(1 for r in cache.by(db, TeamJoinRequest, "team_id").get(team.id, []) if r.status == "PENDING")
        if pending:
            needs.append({"tone": "warning", "text": f"{pending} join request{'s' if pending > 1 else ''} waiting — {team.name}",
                          "action_label": "Review", "link": f"/teams/{team.id}", "due_at": None})
    ideas = _my_ideas(db, cu)
    for ini in ideas:
        if ini.current_state_code == "CLARIFICATION_REQUESTED":
            c = db.scalar(select(ClarificationRequest).where(ClarificationRequest.entity_type == "initiative",
                                                             ClarificationRequest.entity_id == ini.id,
                                                             ClarificationRequest.status == "OPEN"))
            needs.append({"tone": "warning", "text": f"A reviewer asked a question — {ini.code}", "action_label": "Reply",
                          "link": f"/ideas/{ini.code}", "due_at": iso(c.due_at) if c else None})
        elif ini.current_state_code == "DRAFT":
            needs.append({"tone": "info", "text": f"Finish your draft idea — {ini.title}", "action_label": "Continue",
                          "link": f"/ideas/{ini.id}/edit", "due_at": None})
    entry_ids = [e.id for e in entries] or [""]
    for fb in db.scalars(select(Feedback).where(Feedback.entity_type == "challenge_entry", Feedback.entity_id.in_(entry_ids),
                                                Feedback.published_at.is_not(None), Feedback.read_at.is_(None))).all():
        e = next(x for x in entries if x.id == fb.entity_id)
        needs.append({"tone": "info", "text": f"Feedback ready — {e.title}", "action_label": "Read",
                      "link": f"/entries/{e.id}/feedback", "due_at": None})

    out: dict = {"first_name": cu.user.full_name.split(" ")[0], "roles": sorted(cu.roles), "server_time": iso(now)}
    judge = _judge_block(db, cu)
    if cu.has_role("JUDGE") or judge["assigned"]:
        out["judge"] = judge
        if judge["open"]:
            needs.insert(0, {"tone": "danger" if judge["overdue"] else "warning",
                             "text": f"{judge['open']} entr{'ies' if judge['open'] > 1 else 'y'} to score"
                                     + (f" ({judge['overdue']} overdue)" if judge["overdue"] else ""),
                             "action_label": "Start scoring", "link": f"/review/{judge['next_assignment_id']}",
                             "due_at": judge["next_due_at"]})
    if cu.privileged:
        program = _program_block(db)
        out["program"] = program
        for key, text, link, label in (("ideas_to_triage", "idea(s) waiting for triage", "/manage/ideas", "Triage"),
                                       ("shortlists_waiting", "shortlist(s) waiting for confirmation or publishing", "/manage/challenges", "Open"),
                                       ("results_waiting", "result(s) waiting for approval", "/manage/challenges", "Open"),
                                       ("reviews_overdue", "review(s) overdue", "/manage/challenges", "Send reminders")):
            if program[key]:
                needs.append({"tone": "warning", "text": f"{program[key]} {text}", "action_label": label, "link": link, "due_at": None})
    if cu.has_role("EXECUTIVE", "SUPER_ADMIN", "PROGRAM_OWNER"):
        out["executive"] = _executive_block(db)
    if cu.has_role("SUPER_ADMIN"):
        out["system"] = {"failed_emails": db.scalar(select(func.count()).select_from(NotificationDelivery).where(NotificationDelivery.status == "FAILED")) or 0,
                         "failed_jobs": db.scalar(select(func.count()).select_from(NotificationOutbox).where(NotificationOutbox.status == "FAILED")) or 0,
                         "pending_outbox": db.scalar(select(func.count()).select_from(NotificationOutbox).where(NotificationOutbox.status == "PENDING")) or 0}
    if cu.has_role("FINANCE_VERIFIER", "SPONSOR"):
        waiting = db.scalar(select(func.count()).select_from(KpiMeasurement).where(KpiMeasurement.verification_status == "UNVERIFIED")) or 0
        if waiting:
            needs.append({"tone": "warning", "text": f"{waiting} impact measurement(s) to verify", "action_label": "Verify",
                          "link": "/impact", "due_at": None})

    open_challenges = []
    for ch in db.scalars(select(Challenge).where(Challenge.deleted_at.is_(None), Challenge.status_code != "DRAFT")
                         .order_by(Challenge.published_at.desc())).all():
        csvc.sync_if_stale(db, ch)
        if ch.status_code not in csvc.CLOSED_STATUSES and ch.status_code != "SCHEDULED":
            open_challenges.append(csvc.challenge_card(db, ch, cu))
    db.commit()
    points = db.scalar(select(func.coalesce(func.sum(PointsLedger.points), 0)).where(PointsLedger.user_id == cu.id))
    out.update({
        "needs_you": needs[:8], "my_entries": [c for c in cards if not c["is_finished"]][:4],
        "open_challenges": open_challenges[:3], "open_challenges_total": len(open_challenges),
        "my_ideas": [isvc.card(db, i) for i in ideas[:3]],
        "recognition": {"points": points or 0,
                        "badges": db.scalar(select(func.count()).select_from(UserBadge).where(UserBadge.user_id == cu.id)) or 0},
        "is_new_user": not entries and not ideas and not cu.sees_all,
    })
    return out


# ---- Dashboards ------------------------------------------------------------------------------------------------
def _series(counter: dict, order: list[str] | None = None) -> list[dict]:
    keys = order or sorted(counter, key=lambda k: -counter[k])
    return [{"label": k, "value": counter.get(k, 0)} for k in keys if order or counter.get(k)]


@router.get("/dashboards/{kind}")
def dashboard(kind: str, challenge_id: str = "", cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if kind == "me":
        entries, ideas = _my_entries(db, cu), _my_ideas(db, cu)
        points = db.scalars(select(PointsLedger).where(PointsLedger.user_id == cu.id)).all()
        return {"kind": "me", "summary": f"You have {len(entries)} challenge entr{'y' if len(entries) == 1 else 'ies'} and {len(ideas)} idea(s).",
                "tiles": [{"label": "Challenge entries", "value": len(entries)}, {"label": "Ideas", "value": len(ideas)},
                          {"label": "Points", "value": sum(p.points or 0 for p in points)},
                          {"label": "Badges", "value": db.scalar(select(func.count()).select_from(UserBadge).where(UserBadge.user_id == cu.id)) or 0}],
                "entries_by_status": _series(Counter(e.status_code for e in entries)),
                "ideas_by_state": _series(Counter(i.current_state_code for i in ideas))}

    if kind == "judge":
        block = _judge_block(db, cu)
        if not cu.has_role("JUDGE", "SUPER_ADMIN", "PROGRAM_OWNER") and not block["assigned"]:
            raise not_found("Page")
        by_round = Counter()
        for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.reviewer_user_id == cu.id)).all():
            rnd = db.get(ReviewRound, a.review_round_id)
            by_round[en(rnd.name_i18n)] += 1
        return {"kind": "judge", "summary": f"{block['done']} of {block['assigned']} assigned reviews are done; {block['overdue']} overdue.",
                "tiles": [{"label": "Assigned", "value": block["assigned"]}, {"label": "Done", "value": block["done"]},
                          {"label": "Due in 3 days", "value": block["due_soon"]}, {"label": "Overdue", "value": block["overdue"]},
                          {"label": "Average score given", "value": block["average_score_given"]},
                          {"label": "Average review time (h)", "value": block["average_review_hours"]}],
                "by_round": _series(by_round)}

    if kind in ("program", "challenge"):
        if not cu.privileged:
            raise not_found("Page")
        stmt = select(ChallengeEntry).where(ChallengeEntry.deleted_at.is_(None))
        if challenge_id:
            stmt = stmt.where(ChallengeEntry.challenge_id == challenge_id)
        entries = db.scalars(stmt).all()
        active = [e for e in entries if e.status_code != "WITHDRAWN"]
        idx = lambda e: csvc.STAGE_INDEX.get(e.status_code, 0)   # noqa: E731
        submitted = [e for e in active if e.status_code != "REGISTERED" and e.status_code != "NO_SUBMISSION"]
        funnel = [
            {"label": "Registered", "value": len(active)},
            {"label": "Methodology submitted", "value": len(submitted)},
            {"label": "Shortlisted", "value": sum(1 for e in active if idx(e) >= 4)},
            {"label": "Prototype", "value": sum(1 for e in active if idx(e) >= 5 and e.status_code != "NOT_SELECTED" or (idx(e) >= 6))},
            {"label": "Finalist", "value": sum(1 for e in active if idx(e) >= 6)},
            {"label": "Winner", "value": sum(1 for e in active if e.status_code in ("WINNER", "RUNNER_UP", "CONVERTED_TO_INITIATIVE"))},
        ]
        users = {u.id: u for u in db.scalars(select(User)).all()}
        units = {u.id: u for u in db.scalars(select(OrgUnit)).all()}
        by_unit, by_domain = Counter(), Counter()
        challenges = {c.id: c for c in db.scalars(select(Challenge)).all()}
        domains = {d.id: en(d.name_i18n) for d in db.scalars(select(ChallengeDomain)).all()}
        participants = set()
        for e in active:
            for uid in csvc.notify_entry(db, e):
                participants.add(uid)
                u = users.get(uid)
                unit = units.get(u.primary_org_unit_id) if u else None
                by_unit[en(unit.name_i18n) if unit else "Unknown"] += 1
            by_domain[domains.get(challenges[e.challenge_id].domain_id, "Other")] += 1
        now = utcnow()
        assignments = db.scalars(select(ReviewAssignment).where(ReviewAssignment.status != "DECLINED_COI")).all()
        if challenge_id:
            round_ids = {r.id for r in csvc.rounds_of(db, challenge_id)}
            assignments = [a for a in assignments if a.review_round_id in round_ids]
        done = [a for a in assignments if a.status == "SUBMITTED"]
        on_time = sum(1 for a in done if not a.due_at or a.submitted_at <= a.due_at)
        entry_ids = [e.id for e in entries] or [""]
        feedback = db.scalars(select(Feedback).where(Feedback.entity_type == "challenge_entry", Feedback.entity_id.in_(entry_ids))).all()
        decided = [e for e in active if idx(e) >= 3 and e.status_code not in ("UNDER_REVIEW", "CLARIFICATION_REQUESTED")]
        published_for = {f.entity_id for f in feedback if f.published_at}
        ideas = db.scalars(select(Initiative).where(Initiative.deleted_at.is_(None), Initiative.current_state_code != "DRAFT")).all()
        progress = []
        for c in challenges.values():
            if c.status_code == "DRAFT" or (challenge_id and c.id != challenge_id):
                continue
            n = csvc.challenge_numbers(db, c)
            progress.append({"id": c.id, "title": en(c.title_i18n), "status_code": c.status_code, **n})
        scores = [e.current_score for e in active if e.current_score is not None]
        buckets = Counter(f"{int(s // 10) * 10}–{int(s // 10) * 10 + 9}" for s in scores)
        return {
            "kind": kind,
            "summary": f"{len(active)} entries from {len(participants)} people; {funnel[2]['value']} shortlisted "
                       f"({round(funnel[2]['value'] * 100 / len(submitted)) if submitted else 0}% of submitted methodologies).",
            "tiles": [{"label": "Entries", "value": len(active)}, {"label": "Unique participants", "value": len(participants)},
                      {"label": "Team entries", "value": sum(1 for e in active if e.entry_type == "TEAM")},
                      {"label": "Reviews done", "value": f"{len(done)}/{len(assignments)}"},
                      {"label": "Reviews on time", "value": f"{round(on_time * 100 / len(done)) if done else 0}%"},
                      {"label": "Reviews overdue", "value": sum(1 for a in assignments if a.status != "SUBMITTED" and a.due_at and a.due_at < now)},
                      {"label": "Feedback published", "value": f"{round(len(published_for & {e.id for e in decided}) * 100 / len(decided)) if decided else 0}%"}],
            "funnel": funnel, "participation_by_org_unit": _series(by_unit), "participation_by_domain": _series(by_domain),
            "challenge_progress": progress, "score_distribution": _series(buckets, sorted(buckets)),
            "ideas_by_state": _series(Counter(i.current_state_code for i in ideas),
                                      [s for s in ["SUBMITTED", "TRIAGE", "UNDER_REVIEW", "CLARIFICATION_REQUESTED", "SHORTLISTED",
                                                   "ON_HOLD", "NOT_SELECTED", "PROTOTYPE", "DEMO_VALIDATION", "PILOT", "PRODUCTION",
                                                   "IMPACT_VERIFIED", "SCALED", "CLOSED"]]),
            "challenges": [{"id": c.id, "title": en(c.title_i18n)} for c in challenges.values() if c.status_code != "DRAFT"],
        }

    if kind == "executive":
        if not cu.has_role("EXECUTIVE", "SUPER_ADMIN", "PROGRAM_OWNER"):
            raise not_found("Page")
        block = _executive_block(db)
        ideas = db.scalars(select(Initiative).where(Initiative.deleted_at.is_(None), Initiative.current_state_code != "DRAFT")).all()
        order = {"SHORTLISTED": 1, "PROTOTYPE": 2, "DEMO_VALIDATION": 2, "PILOT": 3, "PRODUCTION": 4, "IMPACT_VERIFIED": 5, "SCALED": 6}
        reached = lambda n: sum(1 for i in ideas if order.get(i.current_state_code, 0) >= n)   # noqa: E731
        pct = lambda a, b: round(a * 100 / b) if b else 0   # noqa: E731
        conversions = [
            {"label": "Submitted → shortlisted", "value": pct(reached(1), len(ideas))},
            {"label": "Shortlisted → prototype", "value": pct(reached(2), reached(1))},
            {"label": "Prototype → pilot", "value": pct(reached(3), reached(2))},
            {"label": "Pilot → production", "value": pct(reached(4), reached(3))},
            {"label": "Production → scaled", "value": pct(reached(6), reached(4))},
        ]
        funnel = [{"label": "Submitted", "value": len(ideas)}, {"label": "Shortlisted", "value": reached(1)},
                  {"label": "Prototype", "value": reached(2)}, {"label": "Pilot", "value": reached(3)},
                  {"label": "Production", "value": reached(4)}, {"label": "Impact verified", "value": reached(5)},
                  {"label": "Scaled", "value": reached(6)}]
        months = Counter()
        for i in ideas:
            if i.submitted_at:
                months[i.submitted_at.strftime("%b %Y")] += 1
        ordered_months = sorted(months, key=lambda m: __import__("datetime").datetime.strptime(m, "%b %Y"))
        domains = {d.id: en(d.name_i18n) for d in db.scalars(select(ChallengeDomain)).all()}
        challenges = {c.id: c for c in db.scalars(select(Challenge)).all()}
        by_domain = Counter()
        for e in db.scalars(select(ChallengeEntry).where(ChallengeEntry.status_code != "WITHDRAWN")).all():
            by_domain[domains.get(challenges[e.challenge_id].domain_id, "Other")] += 1
        units = {u.id: en(u.name_i18n) for u in db.scalars(select(OrgUnit)).all()}
        by_unit = Counter(units.get(i.org_unit_id, "Unknown") for i in ideas)
        top = []
        for i in sorted([i for i in ideas if i.data_classification_code not in ("CONFIDENTIAL", "RESTRICTED") or cu.privileged],
                        key=lambda i: (-order.get(i.current_state_code, 0), -(i.score_latest or 0)))[:6]:
            top.append({"code": i.code, "title": i.title, "state": i.current_state_code, "score": i.score_latest, "is_awarded": i.is_awarded})
        risky = sum(1 for i in ideas if any(f != "NONE" for f in (i.risk_flags or [])))
        return {
            "kind": "executive",
            "summary": f"{block['production']} innovations are in production with {block['verified_hours_saved']:,} verified hours saved "
                       f"and BDT {block['verified_value_bdt']:,} verified value per period.",
            "tiles": [{"label": "Verified hours saved", "value": block["verified_hours_saved"]},
                      {"label": "Verified value (BDT)", "value": block["verified_value_bdt"]},
                      {"label": "In production", "value": block["production"]}, {"label": "Pilots running", "value": block["pilots"]},
                      {"label": "Active challenges", "value": block["active_challenges"]},
                      {"label": "Reusable assets", "value": block["reusable_assets"]},
                      {"label": "Awards given", "value": db.scalar(select(func.count()).select_from(AwardDecision).where(AwardDecision.publication_status == "PUBLISHED")) or 0},
                      {"label": "Ideas with risk flags", "value": risky}],
            "funnel": funnel, "conversions": conversions, "top_domains": _series(by_domain),
            "ideas_by_org_unit": _series(by_unit), "trend_by_month": _series(months, ordered_months), "top_innovations": top,
        }
    raise not_found("Page")


# ---- Search (authorisation is applied before anything is returned) -------------------------------------------------
@router.get("/search")
def search(q: str = "", cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    q = q.strip().lower()
    if len(q) < 2:
        return {"items": []}
    items = []
    for ch in db.scalars(select(Challenge).where(Challenge.deleted_at.is_(None), Challenge.status_code != "DRAFT")).all():
        if q in f"{ch.code} {en(ch.title_i18n)} {(ch.title_i18n or {}).get('bn', '')}".lower():
            items.append({"type": "challenge", "id": ch.id, "code": ch.code, "title": en(ch.title_i18n), "link_path": f"/challenges/{ch.slug}"})
    entries = db.scalars(select(ChallengeEntry)).all() if cu.privileged or cu.has_role("EXECUTIVE") else _my_entries(db, cu)
    for e in entries:
        if q in f"{e.code} {e.title}".lower():
            items.append({"type": "entry", "id": e.id, "code": e.code, "title": e.title, "link_path": f"/entries/{e.id}"})
    for ini in db.scalars(select(Initiative).where(Initiative.deleted_at.is_(None))
                          .where(or_(Initiative.title.ilike(f"%{q}%"), Initiative.code.ilike(f"%{q}%")))).all():
        if initiative_role(db, cu, ini):   # confidential ideas never appear for unauthorised users
            items.append({"type": "idea", "id": ini.id, "code": ini.code or "Draft", "title": ini.title,
                          "link_path": f"/ideas/{ini.code or ini.id}"})
    for a in db.scalars(select(ReusableAsset).where(ReusableAsset.is_published.is_(True))).all():
        if q in f"{a.code} {a.title} {a.technology}".lower():
            items.append({"type": "asset", "id": a.id, "code": a.code, "title": a.title, "link_path": "/catalogue"})
    return {"items": items[:20]}
