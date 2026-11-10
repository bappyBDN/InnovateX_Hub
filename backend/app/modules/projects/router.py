"""Project rewards and progress tracking API (authority dashboard).

Access: a signed-in authority (view: SUPER_ADMIN, PROGRAM_OWNER, EXECUTIVE, DMD; change: SUPER_ADMIN, PROGRAM_OWNER,
DMD), or a machine sending X-API-Key = DATA_API_KEY.

All progress comes straight from ProjectFlow (read only).

GET  /projects                         tracked projects with members and current challenge
GET  /projects/meta                    whether ProjectFlow is connected, the filter, last import time
POST /projects/import                  read every matching project from ProjectFlow and update the local copy
GET  /projects/{id}
POST /projects/{id}/sync               re-read one project from ProjectFlow (progress, tasks, dates, people)
POST /projects/{id}/challenge          set (or update) the reward challenge and email the PM and Team Lead
POST /projects/{id}/team-lead          choose the Team Lead among the members

Process Brain (read only) adds the AES team's projects and, for AI and AES projects alike, the team, delivery phases
and the linked process groups with their sub-processes and RACI people. A reward challenge can go to any of the
project's people, the RACI people of its processes and the AES team lead (Admin → Settings).
"""
import hmac
import re
import threading
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit
from app.core.permissions import get_current_user
from app.modules.admin.models import SystemSetting
from app.modules.identity.models import User
from app.modules.notifications.models import NotificationOutbox
from app.modules.projects import process_brain, sources
from app.modules.projects.models import Project, ProjectChallenge, ProjectMember
from app.shared.models.base import iso, utcnow
from app.shared.util import setting

router = APIRouter(tags=["project rewards"])

VIEW_ROLES = {"SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE", "DMD"}
MANAGE_ROLES = {"SUPER_ADMIN", "PROGRAM_OWNER", "DMD"}


# ---- Access -----------------------------------------------------------------------------------------------------

@dataclass
class Actor:
    id: str | None          # None for a machine (API key)
    name: str
    can_manage: bool


def _actor(request: Request, db: Session) -> Actor:
    key = request.headers.get("X-API-Key")
    if key is not None:
        if settings.data_api_key and hmac.compare_digest(key, settings.data_api_key):
            return Actor(None, "API client", True)
        raise DomainError("UNAUTHENTICATED", "Wrong X-API-Key.", 401)
    cu = get_current_user(request, db)
    if not cu.roles & VIEW_ROLES:
        raise not_found("Page")
    return Actor(cu.id, cu.user.full_name, bool(cu.roles & MANAGE_ROLES))


def viewer(request: Request, db: Session = Depends(get_db)) -> Actor:
    return _actor(request, db)


def manager(request: Request, db: Session = Depends(get_db)) -> Actor:
    a = _actor(request, db)
    if not a.can_manage:
        raise DomainError("FORBIDDEN", "Only the program owner, DMD or super admin can change this.", 403)
    return a


# ---- Helpers ----------------------------------------------------------------------------------------------------

def _dt(v) -> datetime | None:
    """ProjectFlow keeps plain dates. A deadline date means the end of that day in the company's time zone
    (Asia/Dhaka), stored as naive UTC like every other time here."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=None)
    if isinstance(v, date):
        local = datetime.combine(v, time(23, 59, 59), tzinfo=ZoneInfo(settings.display_timezone))
        return local.astimezone(timezone.utc).replace(tzinfo=None)
    return None


def _follow_deadline(project: Project, challenges: list[ProjectChallenge]) -> ProjectChallenge | None:
    """The latest challenge that follows the ProjectFlow deadline takes the project's current deadline. If the
    deadline was moved later, a challenge that had expired only because of the old date becomes Active again."""
    latest = challenges[0] if challenges else None      # challenges come newest first
    if (not latest or latest.deadline_source != "projectflow" or not project.due_date
            or latest.status == "Achieved" or latest.target_date == project.due_date):
        return None
    latest.target_date = project.due_date
    if latest.status == "Expired" and project.due_date > utcnow():
        latest.status = "Active"
    return latest


def _next_challenge_id(db: Session) -> str:
    last = db.scalar(select(func.max(ProjectChallenge.challenge_id)))
    return f"RC-{(int(last.split('-')[1]) + 1) if last else 1:05d}"


def _refresh_statuses(db: Session, project: Project, challenges: list[ProjectChallenge]) -> bool:
    """Active → Achieved when the target is reached in time, Active → Expired once the target date passes."""
    now, changed = utcnow(), False
    for c in challenges:
        if c.status != "Active":
            continue
        if (project.completion_percentage or 0) >= (c.target_percentage or 100):
            c.status, c.achieved_at, changed = "Achieved", now, True
        elif c.target_date and c.target_date < now:
            c.status, changed = "Expired", True
    return changed


def _load(db: Session, projects: list[Project]) -> tuple[dict, dict]:
    """Members and challenges of many projects in two queries (no N+1)."""
    ids = [p.id for p in projects]
    members: dict[str, list[ProjectMember]] = {}
    challenges: dict[str, list[ProjectChallenge]] = {}
    if ids:
        for m in db.scalars(select(ProjectMember).where(ProjectMember.project_id.in_(ids))
                            .order_by(ProjectMember.role, ProjectMember.full_name)):
            members.setdefault(m.project_id, []).append(m)
        for c in db.scalars(select(ProjectChallenge).where(ProjectChallenge.project_id.in_(ids))
                            .order_by(ProjectChallenge.created_at.desc())):
            challenges.setdefault(c.project_id, []).append(c)
    return members, challenges


def _challenge_out(c: ProjectChallenge) -> dict:
    return {"id": c.id, "challenge_id": c.challenge_id, "reward_amount": float(c.reward_amount or 0),
            "target_date": iso(c.target_date), "target_percentage": c.target_percentage, "status": c.status,
            "deadline_source": c.deadline_source or "custom",
            "note": c.note, "achieved_at": iso(c.achieved_at), "notified": c.notified or [],
            "recipients": c.recipients or [],
            "created_at": iso(c.created_at)}


def _aes_lead(db: Session) -> dict | None:
    """The AES team lead from Admin → Settings, or None while no name is set."""
    name = str(setting(db, "aes_team_lead_name", "") or "").strip()
    email = str(setting(db, "aes_team_lead_email", "") or "").strip() or None
    designation = str(setting(db, "aes_team_lead_designation", "") or "").strip() or None
    return {"key": "aes_lead", "name": name, "email": email, "designation": designation} if name else None


def _candidates(p: Project, members: list[ProjectMember], aes_lead: dict | None) -> list[dict]:
    """Everyone a reward challenge can go to: the project's people, the RACI people of its processes, the AES lead.
    `key` is what the client sends back; the server rebuilds this list, so only these people can be chosen."""
    out: list[dict] = []
    for m in members:
        out.append({"key": f"m:{m.id}", "name": m.full_name, "email": m.email, "designation": m.designation,
                    "source": "project", "role": m.role, "roles": [m.role], "processes": []})
    for r in process_brain.raci_people(p.processes or []):
        out.append({**r, "source": "raci",
                    "role": "RACI: " + ", ".join(process_brain.RACI_ROLES.get(x, x) for x in r["roles"])})
    # Already the project's Team Lead (every AES project): listed once, as Team Lead.
    if aes_lead and not any(m.email and aes_lead["email"] and m.email.lower() == aes_lead["email"].lower()
                            or m.full_name == aes_lead["name"] for m in members):
        out.append({**aes_lead, "source": "aes_lead", "role": "AES Team Lead", "roles": [], "processes": []})
    return out


def _out(p: Project, members: list[ProjectMember], challenges: list[ProjectChallenge],
         aes_lead: dict | None = None) -> dict:
    current = next((c for c in challenges if c.status == "Active"), challenges[0] if challenges else None)
    pct = max(0, min(100, p.completion_percentage or 0))
    tasks = p.tasks or []
    # Everyone responsible or accountable for any task, each name once, in task order.
    responsible = list(dict.fromkeys(n for t in tasks for n in t.get("responsible") or []))
    accountable = list(dict.fromkeys(t["accountable"] for t in tasks if t.get("accountable")))
    return {
        "details": p.details or {}, "tasks": tasks,
        "people": {"responsible": responsible, "accountable": accountable,
                   "reviewer": list(dict.fromkeys(t["reviewer"] for t in tasks if t.get("reviewer"))),
                   "informed": list(dict.fromkeys(t["informed"] for t in tasks if t.get("informed")))},
        "id": p.id, "external_id": p.external_id, "code": p.code, "name": p.name, "objective": p.objective,
        "company": p.company, "department": p.department, "function": p.function, "status": p.status,
        "health": p.health, "start_date": iso(p.start_date), "due_date": iso(p.due_date),
        "completion_percentage": pct, "remaining_percentage": 100 - pct,
        "projectflow_completion": p.projectflow_completion, "tasks_total": p.total_items,
        "tasks_completed": p.completed_items, "last_synced_at": iso(p.last_synced_at),
        "last_sync_error": p.last_sync_error, "is_eligible": p.is_eligible,
        "members": [{"id": m.id, "full_name": m.full_name, "email": m.email, "designation": m.designation,
                     "role": m.role, "assigned_manually": m.assigned_manually} for m in members],
        "challenge": _challenge_out(current) if current else None,
        "challenge_history": [_challenge_out(c) for c in challenges],
        "team": p.team, "pb_id": p.pb_id, "progress_source": p.progress_source,
        "phases": p.phases or {}, "processes": p.processes or [],
        "candidates": _candidates(p, members, aes_lead),
    }


def _get(db: Session, project_id: str) -> Project:
    p = db.get(Project, project_id) or db.scalar(select(Project).where(Project.code == project_id))
    if not p:
        raise not_found("Project")
    return p


def _one(db: Session, p: Project) -> dict:
    members, challenges = _load(db, [p])
    if _refresh_statuses(db, p, challenges.get(p.id, [])):
        db.commit()
    return _out(p, members.get(p.id, []), challenges.get(p.id, []), _aes_lead(db))


# ---- Read -------------------------------------------------------------------------------------------------------

@router.get("/projects")
def list_projects(include_ineligible: bool = False, team: Literal["AI", "AES"] | None = None,
                  actor: Actor = Depends(viewer), db: Session = Depends(get_db)):
    q = select(Project).order_by(Project.completion_percentage.desc(), Project.code)
    if not include_ineligible:
        q = q.where(Project.is_eligible.is_(True))
    if team:
        q = q.where(Project.team == team)
    projects = db.scalars(q).all()
    members, challenges = _load(db, projects)
    if any([_refresh_statuses(db, p, challenges.get(p.id, [])) for p in projects]):
        db.commit()
    aes_lead = _aes_lead(db)
    return {"items": [_out(p, members.get(p.id, []), challenges.get(p.id, []), aes_lead) for p in projects],
            "can_manage": actor.can_manage, "aes_lead": aes_lead}


@router.get("/projects/meta")
def projects_meta(actor: Actor = Depends(viewer), db: Session = Depends(get_db)):
    return {"projectflow": sources.projectflow_ready(), "process_brain": process_brain.ready(),
            "can_manage": actor.can_manage, "aes_lead": _aes_lead(db),
            "auto_sync": {k: v for k, v in _auto_sync_config(db).items() if k != "at"},
            "timezone": settings.display_timezone,
            "filter": {"department": settings.projectflow_department, "function": settings.projectflow_function_pattern},
            "last_import": iso(db.scalar(select(func.max(Project.imported_at))))}


@router.get("/projects/{project_id}")
def get_project(project_id: str, actor: Actor = Depends(viewer), db: Session = Depends(get_db)):
    return _one(db, _get(db, project_id))


# ---- Import and sync (ProjectFlow + Process Brain) ------------------------------------------------------------

def _upsert_members(db: Session, p: Project, row: dict, existing: list[ProjectMember]) -> None:
    wanted: list[tuple[dict, str]] = [(row["manager"], "Project Manager")]
    manual_lead = any(m.role == "Team Lead" and m.assigned_manually for m in existing)
    if row.get("owner") and not manual_lead:
        wanted.append((row["owner"], "Team Lead"))
    wanted += [(a, "Developer") for a in row["associates"]]
    keep = {(m.external_user_id, m.role) for m in existing if m.role == "Team Lead" and m.assigned_manually}
    by_key = {(m.external_user_id, m.role): m for m in existing}
    emails ={person["email"].lower() for person, _ in wanted if person and person.get("email")}
    accounts = dict(db.execute(select(func.lower(User.email), User.id).where(func.lower(User.email).in_(emails))).all()) \
        if emails else {}
    for person, role in wanted:
        if not person:
            continue
        key = (person["id"], role)
        keep.add(key)
        m = by_key.get(key) or ProjectMember(project_id=p.id, external_user_id=person["id"], role=role)
        m.full_name, m.email, m.designation = person["name"], person.get("email"), person.get("designation")
        m.department, m.function = person.get("department"), person.get("function")
        m.user_id = accounts.get((person.get("email") or "").lower())
        if key not in by_key:
            db.add(m)
            by_key[key] = m
    for key, m in by_key.items():
        if key not in keep and m in existing:
            db.delete(m)


def _fill(p: Project, r: dict, now: datetime) -> None:
    """Copy one ProjectFlow row onto the local project."""
    p.code, p.name, p.objective = r["code"], r["name"], r["objective"]
    p.company, p.department, p.function = r["company"], r["department"], r["function"]
    p.status, p.health, p.start_date, p.due_date = r["status"], r["health"], _dt(r["start_date"]), _dt(r["due_date"])
    p.projectflow_completion = r["completion_pct"]
    p.completion_percentage = max(0, min(100, round(r["completion_pct"] or 0)))
    p.total_items, p.completed_items = r["tasks_total"], r["tasks_done"]
    p.details, p.tasks = r["details"], r["tasks"]
    p.progress_source, p.last_synced_at, p.last_sync_error, p.is_eligible = "projectflow", now, None, True


def _as_date(v):
    try:
        return date.fromisoformat(v[:10]) if isinstance(v, str) and v else None
    except ValueError:
        return None


def _fill_pb(db: Session, p: Project, r: dict, now: datetime, members: list[ProjectMember]) -> None:
    """Copy one Process Brain row. Team, phases and processes always; progress, dates and people only when the
    project is not tracked in ProjectFlow (ProjectFlow stays the source of progress for its own projects)."""
    p.pb_id, p.team, p.phases, p.processes = r["id"], r["team"], r["phases"], r["processes"]
    if p.external_id is not None:
        return
    p.code, p.name, p.status = r["id"], r["name"], r["status"]
    p.start_date, p.due_date = _dt(_as_date(r["start"])), _dt(_as_date(r["end"]))
    p.completion_percentage = p.projectflow_completion = r["pct"]
    p.total_items = p.completed_items = None
    p.details = {"start_date": r["start"], "forecast_due_date": r["end"], "project_type": r.get("module")}
    p.tasks = []
    p.progress_source, p.last_synced_at, p.last_sync_error, p.is_eligible = "process_brain", now, None, True
    # The owner named in Process Brain is the Project Manager (a name only; no account behind it).
    owner = (r.get("owner") or "").strip()
    current = [m for m in members if m.role == "Project Manager" and m.external_user_id is None]
    if owner and not any(m.full_name == owner for m in current):
        db.add(ProjectMember(project_id=p.id, full_name=owner, role="Project Manager"))
    for m in current:
        if m.full_name != owner:
            db.delete(m)
    if p.team == "AES":
        _set_aes_team_lead(db, p, members)


def _set_aes_team_lead(db: Session, p: Project, members: list[ProjectMember]) -> None:
    """Every AES project has the AES team lead (Admin → Settings) as its Team Lead, unless a Team Lead was chosen
    by hand for that project."""
    lead = _aes_lead(db)
    leads = [m for m in members if m.role == "Team Lead"]
    if not lead or any(m.assigned_manually for m in leads):
        return
    keep = next((m for m in leads if m.full_name == lead["name"]), None)
    for m in leads:
        if m is not keep:
            db.delete(m)
    m = keep or ProjectMember(project_id=p.id, role="Team Lead")
    m.full_name, m.email, m.designation = lead["name"], lead["email"], lead["designation"]
    m.user_id = db.scalar(select(User.id).where(func.lower(User.email) == lead["email"].lower())) if lead["email"] else None
    if not keep:
        db.add(m)


def apply_aes_team_lead(db: Session) -> int:
    """After the AES team lead changes in Admin → Settings: make the new lead Team Lead of every AES project."""
    projects = list(db.scalars(select(Project).where(Project.team == "AES")))
    members, _ = _load(db, projects)
    for p in projects:
        _set_aes_team_lead(db, p, members.get(p.id, []))
    return len(projects)


def _delete_project(db: Session, p: Project) -> None:
    """Gone from every source it came from: removed here too, with its people and reward challenges."""
    for model in (ProjectMember, ProjectChallenge):
        for row in db.scalars(select(model).where(model.project_id == p.id)):
            db.delete(row)
    db.delete(p)


def _reconcile(db: Session, p: Project, pf: tuple[bool, dict | None], pb: tuple[bool, dict | None], now: datetime,
               members: list[ProjectMember], challenges: list[ProjectChallenge]) -> str:
    """Bring one project in line with its sources. pf / pb = (that source was read, the project's row or None).
    A source that could not be read changes nothing, so an outage never removes projects.
    Returns "deleted", "updated" or "kept"."""
    (pf_ok, pf_row), (pb_ok, pb_row) = pf, pb
    linked_pf, linked_pb = p.external_id is not None, p.pb_id is not None
    pf_gone = linked_pf and pf_ok and pf_row is None
    pb_gone = linked_pb and pb_ok and pb_row is None
    if (linked_pf or linked_pb) and (not linked_pf or pf_gone) and (not linked_pb or pb_gone):
        _delete_project(db, p)
        return "deleted"
    if pf_gone:                                      # still in Process Brain: progress now comes from there
        p.external_id = None
        for m in members:
            if m.external_user_id is not None and not m.assigned_manually:
                db.delete(m)
        members = [m for m in members if m.external_user_id is None or m.assigned_manually]
    if pb_gone:                                      # still in ProjectFlow: no process links any more
        p.pb_id, p.processes, p.phases = None, [], {}
    if not pf_row and not pb_row:
        return "kept"
    if pf_row and p.external_id is not None:
        _fill(p, pf_row, now)
        p.team = p.team or "AI"                      # the ProjectFlow filter is the AI analysis function
        _upsert_members(db, p, pf_row, members)
    if pb_row:
        _fill_pb(db, p, pb_row, now, members)
    p.imported_at = now
    _follow_deadline(p, challenges)
    return "updated"


def _read(name: str, ready: bool, read, errors: list[dict]):
    """(read ok, rows). A source that is not connected, fails, or returns nothing is treated as not read."""
    if not ready:
        return False, []
    try:
        rows = read()
    except DomainError as exc:
        errors.append({"source": name, "message": exc.message})
        return False, []
    if not rows:
        errors.append({"source": name, "message": "It returned no projects, so nothing was removed."})
        return False, []
    return True, rows


_PF_CODE = re.compile(r"^PRJ-\d+$")


def _is_pf_code(code: str | None) -> bool:
    return bool(code and _PF_CODE.match(code))


def _drop_deleted_in_pf(pb_rows: list[dict], pf_ok: bool, errors: list) -> list[dict]:
    """Process Brain's project list is a snapshot and can still hold projects already deleted in ProjectFlow.
    Those rows are dropped (so the project is removed here) — only when ProjectFlow itself was read just now."""
    if not pf_ok or not any(_is_pf_code(r["id"]) for r in pb_rows):
        return pb_rows
    try:
        existing = sources.all_project_codes()
    except DomainError as exc:
        errors.append({"source": "projectflow", "message": exc.message})
        return pb_rows
    if not existing:
        return pb_rows
    return [r for r in pb_rows if not _is_pf_code(r["id"]) or r["id"] in existing]


_IMPORT_LOCK = threading.Lock()


def run_import(db: Session, actor_id: str | None, request_id: str | None, trigger: str = "manual") -> dict:
    """Read ProjectFlow and Process Brain, then add new projects, update the rest and delete the ones that are gone
    from every source they came from. Used by the Import button and the daily automatic run."""
    if not sources.projectflow_ready() and not process_brain.ready():
        raise DomainError("NO_PROJECT_SOURCE", "Neither ProjectFlow nor Process Brain is connected.", 503)
    if not _IMPORT_LOCK.acquire(blocking=False):
        raise DomainError("IMPORT_RUNNING", "An import is already running. Try again in a minute.", 409)
    try:
        errors: list[dict] = []
        pb_ok, pb_rows = _read("process_brain", process_brain.ready(), process_brain.read_projects, errors)
        # ProjectFlow is the live source for every ProjectFlow project (PRJ-…), also those Process Brain lists outside
        # the department filter, and the authority on whether such a project still exists.
        pf_codes = {r["id"] for r in pb_rows if _is_pf_code(r["id"])}
        pf_ok, pf_rows = _read("projectflow", sources.projectflow_ready(),
                               lambda: sources.read_projectflow(include_codes=pf_codes), errors)
        pb_rows = _drop_deleted_in_pf(pb_rows, pf_ok, errors)
        if not pf_ok and not pb_ok:
            raise DomainError("IMPORT_FAILED", " ".join(e["message"] for e in errors) or "Nothing could be read.", 502)
        now = utcnow()
        every = list(db.scalars(select(Project)))
        created = 0

        # Link every source row to a local project (adopting a match by code or name), creating what is new.
        by_ext = {p.external_id: p for p in every if p.external_id is not None}
        for r in pf_rows:
            if r["id"] in by_ext:
                continue
            p = next((x for x in every if x.external_id is None and x.code == r["code"]), None)
            if not p:
                p = Project(progress_source="projectflow", created_by=actor_id)
                db.add(p)
                every.append(p)
                created += 1
            p.external_id = r["id"]
            by_ext[r["id"]] = p
        by_pb = {p.pb_id: p for p in every if p.pb_id}
        for r in pb_rows:
            if r["id"] in by_pb:
                continue
            name = (r["name"] or "").strip().lower()
            p = (next((x for x in every if not x.pb_id and x.code == r["id"]), None)
                 or next((x for x in every if not x.pb_id and x.external_id is not None
                          and (x.name or "").strip().lower() == name), None))
            if not p:
                p = Project(progress_source="process_brain", created_by=actor_id)
                db.add(p)
                every.append(p)
                created += 1
            p.pb_id = r["id"]
            by_pb[r["id"]] = p
        db.flush()

        pf_map = {r["id"]: r for r in pf_rows}
        pb_map = {r["id"]: r for r in pb_rows}
        members, challenges = _load(db, every)
        counts = {"updated": 0, "deleted": 0, "kept": 0}
        removed: list[str] = []
        for p in every:
            label = f"{p.code or p.pb_id} {p.name or ''}".strip()
            result = _reconcile(db, p, (pf_ok, pf_map.get(p.external_id)), (pb_ok, pb_map.get(p.pb_id)), now,
                                members.get(p.id, []), challenges.get(p.id, []))
            counts[result] += 1
            if result == "deleted":
                removed.append(label)
        updated = counts["updated"] - created
        audit(db, actor_id, "SYNC", "projects", None,
              f"{trigger.capitalize()} project import: {created} new, {updated} updated, {len(removed)} removed"
              + (f" ({', '.join(removed)[:400]})" if removed else ""),
              {"errors": errors, "removed": removed}, request_id)
        db.commit()
        total = db.scalar(select(func.count()).select_from(Project))
        return {"matched": total, "created": created, "updated": updated, "removed": len(removed),
                "removed_projects": removed, "no_longer_matching": len(removed),
                "aes": sum(1 for r in pb_rows if r["team"] == "AES"), "ai": sum(1 for r in pb_rows if r["team"] == "AI"),
                "sources": {"projectflow": pf_ok, "process_brain": pb_ok}, "errors": errors}
    except Exception:
        db.rollback()
        raise
    finally:
        _IMPORT_LOCK.release()


def _auto_sync_config(db: Session) -> dict:
    raw = str(setting(db, "projects_auto_sync_time", "06:00") or "06:00").strip()
    try:
        at = time.fromisoformat(raw if len(raw) > 2 else f"{raw}:00")
    except ValueError:
        at = time(6, 0)
    return {"enabled": setting(db, "projects_auto_sync_enabled", True) is not False, "time": f"{at:%H:%M}",
            "at": at, "last": str(setting(db, "projects_last_auto_sync", "") or "") or None}


def run_daily_if_due(db: Session) -> dict | None:
    """Called every minute by the background worker: runs the import once a day, at or after the set time
    (company time zone). The day it ran is saved first, so a failing run is not retried in a loop."""
    cfg = _auto_sync_config(db)
    if not cfg["enabled"] or not (sources.projectflow_ready() or process_brain.ready()):
        return None
    now_local = datetime.now(ZoneInfo(settings.display_timezone))
    today = now_local.date().isoformat()
    if now_local.time() < cfg["at"] or (cfg["last"] or "").startswith(today) or _IMPORT_LOCK.locked():
        return None                                  # not yet, done today, or a manual import is running now
    row = db.scalar(select(SystemSetting).where(SystemSetting.key == "projects_last_auto_sync"))
    if not row:
        row = SystemSetting(key="projects_last_auto_sync", description="Filled in by the system.")
        db.add(row)
    row.value = f"{now_local:%Y-%m-%d %H:%M} running…"
    db.commit()
    try:
        r = run_import(db, None, None, trigger="automatic")
        row.value = (f"{now_local:%Y-%m-%d %H:%M} OK: {r['matched']} projects ({r['created']} new, {r['updated']} "
                     f"updated, {r['removed']} removed)" + (f"; {len(r['errors'])} source warning(s)" if r["errors"] else ""))
    except Exception as exc:                          # recorded; tried again tomorrow (or press Import now)
        db.rollback()
        row = db.scalar(select(SystemSetting).where(SystemSetting.key == "projects_last_auto_sync"))
        row.value = f"{now_local:%Y-%m-%d %H:%M} FAILED: {getattr(exc, 'message', str(exc))[:300]}"
        r = None
    db.commit()
    return r


@router.post("/projects/import")
def import_projects(request: Request, actor: Actor = Depends(manager), db: Session = Depends(get_db)):
    """Import and sync every project now (the same as the daily automatic run)."""
    return run_import(db, actor.id, request.state.request_id)


# ---- Sync one project ---------------------------------------------------------------------------------------------

@router.post("/projects/{project_id}/sync")
def sync_project(project_id: str, request: Request, actor: Actor = Depends(manager), db: Session = Depends(get_db)):
    p = _get(db, project_id)
    errors: list[str] = []

    def read(linked, ready, fn):
        if not (linked and ready):
            return False, None
        try:
            rows = fn()
        except DomainError as exc:
            errors.append(exc.message)
            return False, None
        return True, (rows[0] if rows else None)

    code = p.code or p.pb_id
    if p.external_id is not None:
        pf = read(True, sources.projectflow_ready(), lambda: sources.read_projectflow(only_id=p.external_id))
    else:                                            # a ProjectFlow project so far known only from Process Brain
        pf = read(_is_pf_code(code), sources.projectflow_ready(),
                  lambda: [r for r in sources.read_projectflow(include_codes={code}) if r["code"] == code])
        if pf[1]:
            p.external_id = pf[1]["id"]
    pb = read(p.pb_id is not None, process_brain.ready(), lambda: process_brain.read_projects(only_id=p.pb_id))
    if pb[1]:
        kept = _drop_deleted_in_pf([pb[1]], pf[0], [])
        pb = (pb[0], kept[0] if kept else None)
    if not pf[0] and not pb[0]:
        p.last_sync_error = (" ".join(errors) or "This project is not linked to ProjectFlow or Process Brain.")[:500]
        db.commit()
        raise DomainError("SYNC_FAILED", p.last_sync_error, 502 if errors else 422)
    before, code, name = p.completion_percentage, p.code, p.name
    members, challenges = _load(db, [p])
    result = _reconcile(db, p, pf, pb, utcnow(), members.get(p.id, []), challenges.get(p.id, []))
    if result == "deleted":
        audit(db, actor.id, "DELETE", "project", p.id,
              f"Removed {code} {name}: it is no longer in ProjectFlow or Process Brain", {}, request.state.request_id)
        db.commit()
        return {"deleted": True, "code": code, "name": name}
    p.last_sync_error = " ".join(errors)[:500] or None
    audit(db, actor.id, "SYNC", "project", p.id, f"Synced {p.code}: {before}% → {p.completion_percentage}%", {},
          request.state.request_id)
    db.commit()
    return _one(db, p)


# ---- Team Lead --------------------------------------------------------------------------------------------------

class TeamLeadIn(BaseModel):
    member_id: str


@router.post("/projects/{project_id}/team-lead")
def set_team_lead(project_id: str, body: TeamLeadIn, request: Request, actor: Actor = Depends(manager),
                  db: Session = Depends(get_db)):
    p = _get(db, project_id)
    src = db.get(ProjectMember, body.member_id)
    if not src or src.project_id != p.id:
        raise not_found("Member")
    for m in db.scalars(select(ProjectMember).where(ProjectMember.project_id == p.id, ProjectMember.role == "Team Lead")):
        db.delete(m)
    db.flush()
    db.add(ProjectMember(project_id=p.id, external_user_id=src.external_user_id, user_id=src.user_id,
                         full_name=src.full_name, email=src.email, designation=src.designation,
                         department=src.department, function=src.function, role="Team Lead", assigned_manually=True))
    audit(db, actor.id, "UPDATE", "project", p.id, f"Made {src.full_name} Team Lead of {p.code}", {},
          request.state.request_id)
    db.commit()
    return _one(db, p)


# ---- Reward challenge ---------------------------------------------------------------------------------------------

class ChallengeIn(BaseModel):
    reward_amount: Decimal = Field(gt=0, le=Decimal("100000000"), decimal_places=2)
    # projectflow (default): the deadline is the project's ProjectFlow deadline and follows it when it changes.
    # custom: the admin's own date in target_date, which then stays fixed.
    deadline_source: Literal["projectflow", "custom"] = "projectflow"
    target_date: datetime | None = None
    target_percentage: int = Field(100, ge=1, le=100)
    note: str | None = Field(None, max_length=1000)
    # Who the reward is for (keys from the project's `candidates`). Left out: the Project Manager and Team Lead.
    recipient_keys: list[str] | None = Field(None, max_length=500)

    @field_validator("target_date")
    @classmethod
    def _future(cls, v: datetime | None):
        if v is None:
            return v
        v = v.astimezone(timezone.utc).replace(tzinfo=None) if v.tzinfo else v
        if v <= utcnow():
            raise ValueError("The target date must be in the future.")
        return v


@router.post("/projects/{project_id}/challenge", status_code=201)
def set_challenge(project_id: str, body: ChallengeIn, request: Request, actor: Actor = Depends(manager),
                  db: Session = Depends(get_db)):
    p = _get(db, project_id)
    if body.deadline_source == "projectflow":
        if not p.due_date:
            raise DomainError("NO_PROJECT_DEADLINE", "This project has no deadline in ProjectFlow. Choose a custom "
                              "deadline instead.", 422)
        if p.due_date <= utcnow():
            raise DomainError("PROJECT_DEADLINE_PASSED", "The ProjectFlow deadline has already passed. Choose a "
                              "custom deadline instead.", 422)
        target = p.due_date
    else:
        if not body.target_date:
            raise DomainError("VALIDATION_ERROR", "Some fields need attention.", 422,
                              {"fields": {"target_date": "Choose the custom deadline."}})
        target = body.target_date
    members, challenges = _load(db, [p])
    _refresh_statuses(db, p, challenges.get(p.id, []))
    c = next((x for x in challenges.get(p.id, []) if x.status == "Active"), None)
    action = "updated" if c else "set"
    if not c:
        c = ProjectChallenge(challenge_id=_next_challenge_id(db), project_id=p.id, status="Active", created_by=actor.id)
        db.add(c)
    c.reward_amount, c.target_date, c.target_percentage = body.reward_amount, target, body.target_percentage
    c.deadline_source = body.deadline_source
    c.note, c.updated_by = (body.note or "").strip() or None, actor.id

    # The chosen people (default: the PM and the Team Lead); one email each, even if one person holds many roles.
    candidates = _candidates(p, members.get(p.id, []), _aes_lead(db))
    if body.recipient_keys is None:
        chosen = [x for x in candidates if x["source"] == "project" and x["role"] in ("Project Manager", "Team Lead")]
    else:
        keys = set(body.recipient_keys)
        chosen = [x for x in candidates if x["key"] in keys]
        if not chosen:
            raise DomainError("VALIDATION_ERROR", "Choose at least one person for this reward.", 422,
                              {"fields": {"recipient_keys": "Choose at least one person."}})
    c.recipients = [{"key": x["key"], "name": x["name"], "email": x["email"], "role": x["role"]} for x in chosen]
    member_accounts = {f"m:{m.id}": m.user_id for m in members.get(p.id, [])}
    emails = {x["email"].lower() for x in chosen if x["email"]}
    accounts = dict(db.execute(select(func.lower(User.email), User.id)
                               .where(func.lower(User.email).in_(emails))).all()) if emails else {}
    recipients: dict[str, dict] = {}
    for x in chosen:
        if not x["email"]:
            continue                                # recorded as a recipient, but there is no address to write to
        r = recipients.setdefault(x["email"].lower(), {
            "name": x["name"], "email": x["email"], "roles": [],
            "user_id": member_accounts.get(x["key"]) or accounts.get(x["email"].lower())})
        if x["role"] not in r["roles"]:
            r["roles"].append(x["role"])
    c.notified = [{"name": r["name"], "email": r["email"], "role": " & ".join(r["roles"])} for r in recipients.values()]
    amount = f"{body.reward_amount:,.2f}"
    local = target.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(settings.display_timezone))
    source_note = ("This is the project deadline in ProjectFlow and moves with it." if body.deadline_source == "projectflow"
                   else "This deadline was set by the program team.")
    for r in recipients.values():   # outbox: the background worker sends these, the request does not wait for SMTP
        db.add(NotificationOutbox(event_type="PROJECT_REWARD_CHALLENGE", payload={
            "title": f"Reward challenge for {p.code}: ৳{amount}",
            "body": f"Reach {body.target_percentage}% by {local:%d %b %Y} to earn ৳{amount}.",
            "link_path": "/manage/projects", "entity_type": "project", "entity_id": p.id,
            "recipient_user_ids": [r["user_id"]] if r["user_id"] else [],
            "recipient_emails": [] if r["user_id"] else [r["email"]],
            "vars": {"recipient_name": r["name"], "project_code": p.code, "project_name": p.name,
                     "reward_amount": amount, "target_date": f"{local:%d %B %Y, %I:%M %p} ({settings.display_timezone})",
                     "target_percentage": body.target_percentage, "completion": p.completion_percentage or 0,
                     "action": action, "note": "\n".join(x for x in (source_note, c.note) if x),
                     "set_by": actor.name}}))
    audit(db, actor.id, "CREATE" if action == "set" else "UPDATE", "project_challenge", c.id,
          f"Reward challenge {c.challenge_id} {action} on {p.code}: ৳{amount} by {local:%Y-%m-%d} ({body.deadline_source})",
          {"reward_amount": amount, "target_date": iso(target), "deadline_source": body.deadline_source},
          request.state.request_id)
    db.commit()
    return {**_one(db, p), "notified": c.notified, "recipients": c.recipients, "action": action}
