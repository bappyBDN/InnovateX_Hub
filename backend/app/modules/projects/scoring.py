"""Weekly team scores and the deadline bonus multiplier (Project Rewards).

Every sync (the daily automatic run, Import, Sync) scores each project's week out of 100, using only data that every
AI and AES project has: its progress %, start date and deadline (ProjectFlow or Process Brain), and the progress read
at each sync (a "check"). The same rules apply to every team, and every point has a stated reason.

    Target completion (65)        progress gained this week ÷ the week's required progress
                                  (required = work remaining ÷ weeks left to the deadline)
    Deadline adherence (20)       actual progress ÷ progress expected by now on the timeline (start → deadline);
                                  0 when the project is past its deadline and not finished
    Communication & teamwork (15)
        5  regular updates        days this week the progress changed (2 days or more = 5)
        5  weekly commitment      the week's required progress delivered (in proportion)
        5  deadline commitment    on track with the timeline (same share as deadline adherence)
    −10 per missed daily deadline a daily check where the progress had not moved since the previous one while the
                                  project was behind its daily pace (Fridays, the weekly holiday, are not counted)
    −5 per missing status update  a week with no progress change at all (after its first two days)
    The week's score stays between 0 and 100.

A project already finished when the week began scores 100. In the week tracking starts (first import, or this feature
going live) part of the week was not seen: target completion is measured against the timeline, and the 5 update
points, which cannot be judged yet, are shared out over the two commitments (7.5 + 7.5), never given free.

At the deadline the average of the challenge's weekly scores sets the bonus multiplier:
    ≥ 90 → 1.5×   80–89 → 1.0×   70–79 → 0.5×   < 70 → 0×
Bonus paid = reward amount (base bonus) × multiplier, only when the target was reached in time.

Only pure functions here, so the rules are in one place and easy to test."""
import math
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.config import settings

TARGET_MAX, DEADLINE_MAX, COMMUNICATION_MAX = 65, 20, 15
COMM_UPDATES, COMM_PROGRESS, COMM_DEADLINE = 5, 5, 5
MISSED_DEADLINE_PENALTY, MISSING_UPDATE_PENALTY = 10, 5
UPDATE_DAYS_FOR_FULL = 2
HOLIDAY = 4                                      # date.weekday() of Friday
# (lowest average score, multiplier), highest first
TIERS = ((90, 1.5), (80, 1.0), (70, 0.5), (0, 0.0))
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

RULES = {
    "target_max": TARGET_MAX, "deadline_max": DEADLINE_MAX, "communication_max": COMMUNICATION_MAX,
    "missed_deadline_penalty": MISSED_DEADLINE_PENALTY, "missing_update_penalty": MISSING_UPDATE_PENALTY,
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


def multiplier(average: float | None) -> float | None:
    if average is None:
        return None
    return next(x for m, x in TIERS if average >= m)


def _ratio(a: float, b: float | None) -> float:
    """a ÷ b between 0 and 1; nothing expected (b empty or 0) counts as fully met."""
    return 1.0 if not b or b <= 0 else max(0.0, min(1.0, a / b))


def missed_checks(week: date, progress_start: float, required: float | None, checks: list,
                  since: date | None = None) -> int:
    """Daily checks with no progress since the previous check while behind the daily pace. The check on the day
    tracking began is the starting point itself, so it never counts."""
    if not required or required <= 0:
        return 0
    missed, before = 0, progress_start
    for day, pct in checks:
        d = date.fromisoformat(day)
        elapsed = (d - week).days
        pace = progress_start + required * elapsed / 7
        if (elapsed >= 1 and (since is None or d > since) and d.weekday() != HOLIDAY and pct <= before
                and pct < pace - 0.01):
            missed += 1
        before = pct
    return missed


def auto_score(*, week: date, as_of: date, progress_start: float, progress_end: float, required: float | None,
               start: date | None, deadline: date | None, checks: list, update_days: int,
               partial: bool = False, since: date | None = None) -> dict:
    """One week's score from the project's progress and timeline, with the reason behind every part."""
    upto = min(as_of, week + timedelta(days=6))
    gained = progress_end - progress_start
    if progress_start >= 100:                    # finished before the week began
        return {"target_points": float(TARGET_MAX), "deadline": float(DEADLINE_MAX),
                "communication": float(COMMUNICATION_MAX), "earned": 100.0, "deductions": 0, "total": 100.0,
                "missed_deadlines": 0, "missing_updates": 0,
                "signals": {"as_of": upto.isoformat(), "gained": 0, "finished": True}}
    expected = None
    if start and deadline and deadline > start:
        expected = max(0.0, min(100.0, (upto - start).days / (deadline - start).days * 100))
    overdue = bool(deadline and deadline < upto and progress_end < 100)

    # Target completion
    week_ratio = _ratio(gained, required)
    progress_ratio = _ratio(progress_end, expected) if partial else week_ratio
    target = round(TARGET_MAX * progress_ratio, 2)
    # Deadline adherence: on track with the timeline
    timeline_ratio = 0.0 if overdue else (_ratio(progress_end, expected) if expected is not None else week_ratio)
    deadline_pts = round(DEADLINE_MAX * timeline_ratio, 2)
    # Communication & teamwork
    if partial:
        w_upd, w_prog, w_dead, update_ratio, missing = 0, COMMUNICATION_MAX / 2, COMMUNICATION_MAX / 2, 0.0, 0
    else:
        w_upd, w_prog, w_dead = COMM_UPDATES, COMM_PROGRESS, COMM_DEADLINE
        update_ratio = min(1.0, update_days / UPDATE_DAYS_FOR_FULL)
        missing = 1 if update_days == 0 and (upto - week).days >= 2 else 0
    comm = {"updates": round(w_upd * update_ratio, 2), "updates_max": w_upd,
            "progress": round(w_prog * progress_ratio, 2), "progress_max": w_prog,
            "deadline": round(w_dead * timeline_ratio, 2), "deadline_max": w_dead}
    communication = round(comm["updates"] + comm["progress"] + comm["deadline"], 2)
    # Deductions
    missed = missed_checks(week, progress_start, required, checks, since)
    deductions = missed * MISSED_DEADLINE_PENALTY + missing * MISSING_UPDATE_PENALTY
    earned = target + deadline_pts + communication
    return {"target_points": target, "deadline": deadline_pts, "communication": communication,
            "earned": round(earned, 2), "deductions": deductions,
            "total": round(max(0.0, min(100.0, earned - deductions)), 2),
            "missed_deadlines": missed, "missing_updates": missing,
            "signals": {"as_of": upto.isoformat(), "gained": round(gained, 2), "checks": len(checks),
                        "update_days": update_days, "expected": round(expected, 1) if expected is not None else None,
                        "actual": progress_end, "overdue": overdue, "partial": partial, "communication": comm}}
