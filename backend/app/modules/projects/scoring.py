"""Weekly team scorecards and the deadline bonus multiplier (Project Rewards).

Every week a manager scores each project out of 100:

    Target completion           50  = 50 × min(1, progress gained this week ÷ weekly required progress)
    Quality & low bug rate      25  (entered)
    Deadline adherence          15  (entered)
    Communication & teamwork    10  (entered)
    Deductions: −10 per missed daily deadline, −5 per re-work / bug, −5 per missing status update.
    The week's score stays between 0 and 100.

Weekly required progress = remaining work ÷ weeks left to the deadline
                         = (100 − progress at the start of the week) ÷ ceil(days from week start to deadline ÷ 7)

At the deadline the average of the challenge's weekly scores sets the bonus multiplier:
    ≥ 90 → 1.5×   80–89 → 1.0×   70–79 → 0.5×   < 70 → 0×
Bonus paid = reward amount (base bonus) × multiplier, only when the target was reached in time.

Only pure functions here, so the rules are in one place and easy to test."""
import math
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.config import settings

TARGET_MAX, QUALITY_MAX, DEADLINE_MAX, COMMUNICATION_MAX = 50, 25, 15, 10
MISSED_DEADLINE_PENALTY, REWORK_PENALTY, MISSING_UPDATE_PENALTY = 10, 5, 5
# (lowest average score, multiplier), highest first
TIERS = ((90, 1.5), (80, 1.0), (70, 0.5), (0, 0.0))
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

RULES = {
    "target_max": TARGET_MAX, "quality_max": QUALITY_MAX, "deadline_max": DEADLINE_MAX,
    "communication_max": COMMUNICATION_MAX, "missed_deadline_penalty": MISSED_DEADLINE_PENALTY,
    "rework_penalty": REWORK_PENALTY, "missing_update_penalty": MISSING_UPDATE_PENALTY,
    "tiers": [{"min": m, "multiplier": x} for m, x in TIERS],
}


def local_date(dt: datetime) -> date:
    """A stored (naive UTC) time as a date in the company's time zone."""
    return dt.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(settings.display_timezone)).date()


def week_start(d: date, start_day: str) -> date:
    """The first day of the week that holds d (the week starts on start_day, e.g. Saturday)."""
    first = WEEKDAYS.index(start_day) if start_day in WEEKDAYS else 5
    return d - timedelta(days=(d.weekday() - first) % 7)


def weeks_left(start: date, deadline: date | None) -> int | None:
    """Weeks from the start of a week to the deadline, counting a part week as a whole one (at least 1)."""
    if deadline is None:
        return None
    return max(1, math.ceil(((deadline - start).days + 1) / 7))


def required_pct(progress_start: float, weeks: int | None) -> float | None:
    """How many percentage points the team has to finish this week to end on time."""
    if weeks is None:
        return None
    return round(max(0.0, 100 - progress_start) / weeks, 2)


def target_points(gained: float, required: float | None) -> float:
    if not required or required <= 0:        # nothing left to do: full marks
        return float(TARGET_MAX)
    return round(TARGET_MAX * min(1.0, max(0.0, gained) / required), 2)


def score(progress_start: float, progress_end: float, required: float | None, quality: float, deadline: float,
          communication: float, missed_deadlines: int, rework: int, missing_updates: int) -> dict:
    """One week's score with its parts."""
    target = target_points(progress_end - progress_start, required)
    earned = target + quality + deadline + communication
    deductions = (missed_deadlines * MISSED_DEADLINE_PENALTY + rework * REWORK_PENALTY
                  + missing_updates * MISSING_UPDATE_PENALTY)
    return {"target_points": target, "earned": round(earned, 2), "deductions": deductions,
            "total": round(max(0.0, min(100.0, earned - deductions)), 2)}


def multiplier(average: float | None) -> float | None:
    if average is None:
        return None
    return next(x for m, x in TIERS if average >= m)


# ---- Automatic scoring --------------------------------------------------------------------------------------------
# Every part is worked out from the project's own data on each sync (daily automatic run or Sync / Import). The rules
# are the same for every team, every point has a stated reason, and nothing is given for behaviour that was not seen.
#
#   Target completion (50)     progress gained this week ÷ weekly required progress
#   Quality (25)               share of open tasks that are not blocked (no open tasks: full points)
#   Deadline adherence (15)    share of the tasks due so far (and still open when the week began) finished by their
#                              due date; without dated tasks, actual progress ÷ progress expected by now on the
#                              timeline (start → deadline). A project past its deadline and not finished gets 0.
#   Communication & teamwork (10) — the team keeping its word and keeping everyone informed:
#       4  regular updates      days this week the progress or tasks were updated (2 days or more = 4)
#       3  weekly commitment    the week's required progress delivered (in proportion)
#       3  deadline commitment  tasks finished by their due date (same share as deadline adherence; 0 when overdue)
#   −10 per missed daily deadline   tasks due this week that were not finished by their due date
#   −5 per re-work / bug            tasks whose progress went back (or were reopened) this week
#   −5 per missing status update    a week with no update at all (after its first two days)
#
# A project already finished when the week began scores 100. In the week tracking starts (first import, or this
# feature going live) part of the week was not seen: target completion is measured against the timeline, and the
# 4 update points, which cannot be judged yet, are shared out over the two commitments (5 + 5), never given free.

UPDATE_DAYS_FOR_FULL = 2
COMM_UPDATES, COMM_PROGRESS, COMM_DEADLINE = 4, 3, 3


def _d(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def task_done(t: dict) -> bool:
    return (t.get("status") or "").lower() == "completed" or (t.get("progress") or 0) >= 100


def _done_by(t: dict, day: date) -> bool:
    """Finished on or before `day` (a finished task without a finish date counts as finished on time)."""
    if not task_done(t):
        return False
    finished = _d(t.get("completed_on"))
    return finished is None or finished <= day


def _ratio(a: float, b: float | None) -> float:
    """a ÷ b between 0 and 1; nothing expected (b empty or 0) counts as fully met."""
    return 1.0 if not b or b <= 0 else max(0.0, min(1.0, a / b))


def auto_score(*, week: date, as_of: date, progress_start: float, progress_end: float, required: float | None,
               tasks: list[dict], start: date | None, deadline: date | None, update_days: int,
               rework: int, partial: bool = False) -> dict:
    """One week's score from the project's data, with the reason behind every part."""
    upto = min(as_of, week + timedelta(days=6))
    gained = progress_end - progress_start
    expected = None
    if start and deadline and deadline > start:
        expected = max(0.0, min(100.0, (upto - start).days / (deadline - start).days * 100))
    if progress_start >= 100:                    # finished before the week began
        parts = score(100, 100, 0, QUALITY_MAX, DEADLINE_MAX, COMMUNICATION_MAX, 0, 0, 0)
        return {**parts, "quality": float(QUALITY_MAX), "deadline": float(DEADLINE_MAX),
                "communication": float(COMMUNICATION_MAX), "missed_deadlines": 0, "rework": 0, "missing_updates": 0,
                "signals": {"as_of": upto.isoformat(), "gained": 0, "finished": True}}
    overdue = bool(deadline and deadline < upto and progress_end < 100)

    # Target completion: this week's progress against what the week needed
    progress_ratio = _ratio(progress_end, expected) if partial else _ratio(gained, required)
    target = round(TARGET_MAX * progress_ratio, 2)

    # Deadline adherence
    dated = [(t, _d(t.get("due_date"))) for t in tasks]
    dated = [(t, due) for t, due in dated if due]
    relevant = [(t, due) for t, due in dated if due <= upto and not _done_by(t, week - timedelta(days=1))]
    late = [t for t, due in relevant if not _done_by(t, due)]
    if relevant:
        deadline_ratio = 1 - len(late) / len(relevant)
        deadline_why = {"basis": "tasks", "due": len(relevant), "late": len(late)}
    else:
        deadline_ratio = _ratio(progress_end, expected)
        deadline_why = {"basis": "timeline", "expected": round(expected, 1) if expected is not None else None,
                        "actual": progress_end}
    if overdue:
        deadline_ratio = 0.0
        deadline_why = {**deadline_why, "overdue": True}
    deadline_pts = DEADLINE_MAX * deadline_ratio

    # Quality
    open_tasks = [t for t in tasks if not task_done(t)]
    blocked = [t for t in open_tasks if t.get("blocker") or (t.get("status") or "").lower() == "blocked"]
    quality_pts = QUALITY_MAX * (1 - len(blocked) / len(open_tasks)) if open_tasks else QUALITY_MAX

    # Communication & teamwork
    if partial:                                  # updates cannot be judged yet: the commitments carry the 10 points
        w_upd, w_prog, w_dead = 0, COMMUNICATION_MAX / 2, COMMUNICATION_MAX / 2
        update_ratio, missing = None, 0
    else:
        w_upd, w_prog, w_dead = COMM_UPDATES, COMM_PROGRESS, COMM_DEADLINE
        update_ratio = min(1.0, update_days / UPDATE_DAYS_FOR_FULL)
        missing = 1 if update_days == 0 and (upto - week).days >= 2 else 0
    comm = {"updates": round(w_upd * (update_ratio or 0), 2), "updates_max": w_upd,
            "progress": round(w_prog * progress_ratio, 2), "progress_max": w_prog,
            "deadline": round(w_dead * deadline_ratio, 2), "deadline_max": w_dead}
    comm_pts = comm["updates"] + comm["progress"] + comm["deadline"]

    missed = sum(1 for t, due in dated if week <= due <= upto and not _done_by(t, due))
    deductions = (missed * MISSED_DEADLINE_PENALTY + rework * REWORK_PENALTY + missing * MISSING_UPDATE_PENALTY)
    earned = target + quality_pts + deadline_pts + comm_pts
    return {"target_points": target, "earned": round(earned, 2), "deductions": deductions,
            "total": round(max(0.0, min(100.0, earned - deductions)), 2),
            "quality": round(quality_pts, 2), "deadline": round(deadline_pts, 2),
            "communication": round(comm_pts, 2), "missed_deadlines": missed, "rework": rework,
            "missing_updates": missing,
            "signals": {"as_of": upto.isoformat(), "gained": round(gained, 2), "open_tasks": len(open_tasks),
                        "blocked": len(blocked), "update_days": update_days, "deadline": deadline_why,
                        "partial": partial, "overdue": overdue, "communication": comm,
                        "expected": round(expected, 1) if expected is not None else None}}
