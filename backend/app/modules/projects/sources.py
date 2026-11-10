"""Project data comes from ProjectFlow, which is only ever read.

Two ways in, chosen by the settings:
- the ProjectFlow Data API (PROJECTFLOW_API_URL + PROJECTFLOW_API_KEY): read-only HTTP, preferred;
- the ProjectFlow database (PROJECTFLOW_DATABASE_URL): direct SQL in a read-only session, the fallback.
Both return exactly the same rows."""
import logging
import re
from datetime import date

import json
import urllib.error
import urllib.parse
import urllib.request

import psycopg
from psycopg.rows import dict_row

from app.core.config import settings
from app.core.errors import DomainError

log = logging.getLogger("innovatex.projects")


class SourceError(DomainError):
    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(code, message, status)


# One query for the projects, their manager/owner and task counts, one for the associates: no per-project round trips.
# Matching is by name (ILIKE), so it keeps working if ProjectFlow renumbers its departments or functions.
# Task counts use top-level tasks that are not deleted or merged; "completed" is matched in any letter case.
_PROJECTS_SQL = """
SELECT p.id, p.code, p.name, p.objective, p.status, p.health, p.start_date,
       COALESCE(p.approved_due_date, p.forecast_due_date, p.baseline_due_date) AS due_date,
       p.completion_pct, c.name AS company, d.name AS department, f.name AS function,
       p.strategic_objective, p.expected_outcome, p.project_type, p.priority, p.methodology, p.criticality,
       p.budget, p.baseline_due_date, p.approved_due_date, p.forecast_due_date, p.actual_due_date,
       sp.name AS sponsor_name,
       COALESCE(t.total, 0) AS tasks_total, COALESCE(t.done, 0) AS tasks_done,
       m.id AS m_id, m.name AS m_name, m.email AS m_email, m.designation AS m_designation,
       md.name AS m_department, mf.name AS m_function,
       o.id AS o_id, o.name AS o_name, o.email AS o_email, o.designation AS o_designation,
       od.name AS o_department, ofn.name AS o_function
FROM projects p
JOIN departments d ON d.id = p.department_id
JOIN functions f ON f.id = p.function_id
JOIN users m ON m.id = p.manager_id
JOIN departments md ON md.id = m.department_id
JOIN functions mf ON mf.id = m.function_id
LEFT JOIN companies c ON c.id = p.company_id
LEFT JOIN users sp ON sp.id = p.sponsor_id
LEFT JOIN users o ON o.id = p.owner_id
LEFT JOIN departments od ON od.id = o.department_id
LEFT JOIN functions ofn ON ofn.id = o.function_id
LEFT JOIN LATERAL (
    SELECT count(*) AS total, count(*) FILTER (WHERE lower(tk.status) = 'completed') AS done
    FROM tasks tk
    WHERE tk.project_id = p.id AND tk.parent_id IS NULL
      AND NOT COALESCE(tk.is_deleted, false) AND tk.merged_into_task_id IS NULL
) t ON true
WHERE ((d.name ILIKE %(dept)s AND f.name ILIKE %(fn)s
   AND md.name ILIKE %(dept)s AND mf.name ILIKE %(fn)s) OR p.code = ANY(%(codes)s))
  {extra}
ORDER BY p.id
"""

_ASSOCIATES_SQL = """
SELECT pa.project_id, u.id, u.name, u.email, u.designation, d.name AS department, f.name AS function
FROM project_associates pa
JOIN users u ON u.id = pa.user_id
LEFT JOIN departments d ON d.id = u.department_id
LEFT JOIN functions f ON f.id = u.function_id
WHERE pa.project_id = ANY(%(ids)s) AND COALESCE(u.is_active, true)
"""


# Top-level tasks of the given projects with every person on them (RACI). Extra responsible people live in
# task_responsibles; they are folded into one list with the main responsible person.
_TASKS_SQL = """
SELECT t.project_id, t.id, t.code, t.title, t.status, t.progress_pct, t.blocker, t.blocker_details,
       t.planned_start_date, t.actual_start_date,
       COALESCE(t.approved_due_date, t.forecast_due_date, t.baseline_due_date) AS due_date, t.actual_due_date,
       a.name AS accountable, rv.name AS reviewer, inf.name AS informed,
       ARRAY_REMOVE(ARRAY[r.name] || COALESCE(extra.names, ARRAY[]::varchar[]), NULL) AS responsible
FROM tasks t
LEFT JOIN users r ON r.id = t.responsible_id
LEFT JOIN users a ON a.id = t.accountable_id
LEFT JOIN users rv ON rv.id = t.reviewer_id
LEFT JOIN users inf ON inf.id = t.informed_id
LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(u.name ORDER BY u.name) AS names
    FROM task_responsibles tr JOIN users u ON u.id = tr.user_id
    WHERE tr.task_id = t.id AND tr.user_id IS DISTINCT FROM t.responsible_id
) extra ON true
WHERE t.project_id = ANY(%(ids)s) AND t.parent_id IS NULL
  AND NOT COALESCE(t.is_deleted, false) AND t.merged_into_task_id IS NULL
ORDER BY t.project_id, t.sort_order NULLS LAST, t.id
"""


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


def _clean(name):
    return name.strip() if isinstance(name, str) and name.strip() else None


def _use_api() -> bool:
    return bool(settings.projectflow_api_url and settings.projectflow_api_key)


def projectflow_ready() -> bool:
    return _use_api() or bool(settings.projectflow_database_url)


def read_projectflow(only_id: int | None = None, include_codes=frozenset()) -> list[dict]:
    """Projects that pass the filter, plus any project whose code is in `include_codes` whatever its department
    (an AI team project listed in Process Brain), each with `manager`, `owner`, `associates` and task counts."""
    if _use_api():
        return _read_api(only_id, set(include_codes))
    return _read_db(only_id, set(include_codes))


def all_project_codes() -> set[str]:
    """Every project code in ProjectFlow, any department. A code missing here means the project was deleted."""
    if _use_api():
        return {p["code"] for p in _fetch_tables({"projects": "id,code"})["projects"] if p.get("code")}
    try:
        with psycopg.connect(settings.projectflow_database_url, connect_timeout=15) as conn:
            conn.read_only = True
            return {r[0] for r in conn.execute("SELECT code FROM projects WHERE code IS NOT NULL").fetchall()}
    except psycopg.Error as exc:
        raise SourceError("PROJECTFLOW_UNREACHABLE", f"Could not read ProjectFlow: {str(exc).splitlines()[0][:200]}")


def _read_db(only_id: int | None = None, include_codes: set[str] = frozenset()) -> list[dict]:
    if not settings.projectflow_database_url:
        raise SourceError("PROJECTFLOW_NOT_CONFIGURED", "ProjectFlow is not connected. Set PROJECTFLOW_API_URL and "
                          "PROJECTFLOW_API_KEY on the server and restart the backend.", 503)
    params = {"dept": settings.projectflow_department, "fn": settings.projectflow_function_pattern,
              "codes": sorted(include_codes)}
    extra = ""
    if only_id is not None:
        extra, params["id"] = "AND p.id = %(id)s", only_id
    try:
        with psycopg.connect(settings.projectflow_database_url, connect_timeout=15, row_factory=dict_row) as conn:
            conn.read_only = True                     # the database refuses any write in this session
            with conn.cursor() as cur:
                cur.execute(_PROJECTS_SQL.format(extra=extra), params)
                rows = cur.fetchall()
                assoc: dict[int, list[dict]] = {}
                tasks: dict[int, list[dict]] = {}
                if rows:
                    ids = {"ids": [r["id"] for r in rows]}
                    cur.execute(_ASSOCIATES_SQL, ids)
                    for a in cur.fetchall():
                        assoc.setdefault(a["project_id"], []).append(a)
                    cur.execute(_TASKS_SQL, ids)
                    for t in cur.fetchall():
                        tasks.setdefault(t["project_id"], []).append({
                            "id": t["id"], "code": t["code"], "title": t["title"], "status": t["status"],
                            "progress": round(t["progress_pct"] or 0), "blocker": bool(t["blocker"]),
                            "blocker_details": t["blocker_details"], "start_date": _iso(t["actual_start_date"] or t["planned_start_date"]),
                            "due_date": _iso(t["due_date"]), "completed_on": _iso(t["actual_due_date"]),
                            "responsible": list(dict.fromkeys(n.strip() for n in (t["responsible"] or []) if _clean(n))),
                            "accountable": _clean(t["accountable"]), "reviewer": _clean(t["reviewer"]),
                            "informed": _clean(t["informed"])})
    except psycopg.Error as exc:
        log.warning("ProjectFlow read failed: %s", exc)
        raise SourceError("PROJECTFLOW_UNREACHABLE", f"Could not read ProjectFlow: {str(exc).splitlines()[0][:200]}")

    def person(r: dict, p: str) -> dict | None:
        if not r.get(f"{p}_id"):
            return None
        return {"id": r[f"{p}_id"], "name": r[f"{p}_name"], "email": r[f"{p}_email"],
                "designation": r[f"{p}_designation"], "department": r[f"{p}_department"], "function": r[f"{p}_function"]}

    detail_keys = ("strategic_objective", "objective", "expected_outcome", "project_type", "priority", "methodology",
                   "criticality", "budget", "sponsor_name", "start_date", "baseline_due_date", "approved_due_date",
                   "forecast_due_date", "actual_due_date")
    return [{**{k: v for k, v in r.items() if not k.startswith(("m_", "o_"))},
             "details": {k: _iso(r[k]) for k in detail_keys},
             "tasks": tasks.get(r["id"], []),
             "manager": person(r, "m"), "owner": person(r, "o"),
             "associates": [{k: a[k] for k in ("id", "name", "email", "designation", "department", "function")}
                            for a in assoc.get(r["id"], [])]}
            for r in rows]


# ---- ProjectFlow Data API ------------------------------------------------------------------------------------
# The API serves whole tables (GET /tables/{table}, at most 1000 rows a page) and has no filters, so the eight small
# tables are read once and joined here, with the same rules as the SQL above.
_PAGE = 1000
_COLUMNS = {
    "projects": "id,code,name,objective,status,health,start_date,approved_due_date,forecast_due_date,baseline_due_date,"
                "actual_due_date,completion_pct,company_id,department_id,function_id,manager_id,owner_id,sponsor_id,"
                "strategic_objective,expected_outcome,project_type,priority,methodology,criticality,budget",
    "tasks": "id,code,title,status,progress_pct,blocker,blocker_details,planned_start_date,actual_start_date,"
             "approved_due_date,forecast_due_date,baseline_due_date,actual_due_date,project_id,parent_id,is_deleted,"
             "merged_into_task_id,sort_order,responsible_id,accountable_id,reviewer_id,informed_id",
    "users": "id,name,email,designation,department_id,function_id,is_active",
    "departments": "id,name",
    "functions": "id,name",
    "companies": "id,name",
    "project_associates": "project_id,user_id",
    "task_responsibles": "task_id,user_id",
}
_DATES = ("start_date", "approved_due_date", "forecast_due_date", "baseline_due_date", "actual_due_date",
          "planned_start_date", "actual_start_date")


def _like(pattern: str):
    """SQL ILIKE as a Python test: % = anything, _ = one character, letter case ignored."""
    rx = "".join(".*" if ch == "%" else "." if ch == "_" else re.escape(ch) for ch in pattern)
    compiled = re.compile(rf"^{rx}$", re.IGNORECASE | re.DOTALL)
    return lambda value: bool(value) and bool(compiled.match(value))


def _as_date(v):
    if isinstance(v, str) and v:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return v


def _fetch_tables(spec: dict[str, str] | None = None) -> dict[str, list[dict]]:
    """Whole tables from the Data API: {table: comma-separated columns}. Defaults to what Project Rewards needs."""
    if not _use_api():
        raise SourceError("PROJECTFLOW_NOT_CONFIGURED", "ProjectFlow is not connected. Set PROJECTFLOW_API_URL and "
                          "PROJECTFLOW_API_KEY on the server and restart the backend.", 503)
    spec = spec or _COLUMNS
    base = settings.projectflow_api_url.rstrip("/")
    headers = {"X-API-Key": settings.projectflow_api_key, "Accept": "application/json"}

    def get(table: str, columns: str, offset: int) -> dict:
        query = urllib.parse.urlencode({"limit": _PAGE, "offset": offset, "columns": columns})
        req = urllib.request.Request(f"{base}/tables/{table}?{query}", headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())

    out: dict[str, list[dict]] = {}
    try:
        for table, columns in spec.items():
            rows, offset = [], 0
            while True:
                page = get(table, columns, offset)
                rows.extend(page.get("rows", []))
                offset += _PAGE
                if offset >= (page.get("total") or 0) or not page.get("rows"):
                    break
            for row in rows:
                for k in _DATES:
                    if k in row:
                        row[k] = _as_date(row[k])
            out[table] = rows
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise SourceError("PROJECTFLOW_KEY_REJECTED", "ProjectFlow refused the API key. Check PROJECTFLOW_API_KEY.")
        log.warning("ProjectFlow API read failed: %s", exc)
        raise SourceError("PROJECTFLOW_UNREACHABLE", f"Could not read ProjectFlow: HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        log.warning("ProjectFlow API read failed: %s", exc)
        raise SourceError("PROJECTFLOW_UNREACHABLE", f"Could not read ProjectFlow: {str(exc)[:200]}")
    return out


def read_tables(spec: dict[str, str]) -> dict[str, list[dict]]:
    """Read some ProjectFlow tables (used by the organization sync)."""
    return _fetch_tables(spec)


def _read_api(only_id: int | None = None, include_codes: set[str] = frozenset()) -> list[dict]:
    t = _fetch_tables()
    users = {u["id"]: u for u in t["users"]}
    depts = {d["id"]: d["name"] for d in t["departments"]}
    funcs = {f["id"]: f["name"] for f in t["functions"]}
    comps = {c["id"]: c["name"] for c in t["companies"]}
    dept_ok, fn_ok = _like(settings.projectflow_department), _like(settings.projectflow_function_pattern)

    def person(uid) -> dict | None:
        u = users.get(uid)
        if not u:
            return None
        return {"id": u["id"], "name": u["name"], "email": u["email"], "designation": u["designation"],
                "department": depts.get(u["department_id"]), "function": funcs.get(u["function_id"])}

    def live_top_level(task) -> bool:
        return task["parent_id"] is None and not task.get("is_deleted") and task.get("merged_into_task_id") is None

    picked = []
    for p in sorted(t["projects"], key=lambda x: x["id"]):
        if only_id is not None and p["id"] != only_id:
            continue
        m = users.get(p["manager_id"])
        # Same as the inner joins in the SQL: project and manager must both have a matching department and function.
        if not m:
            continue
        if p["code"] not in include_codes and not (
                dept_ok(depts.get(p["department_id"])) and fn_ok(funcs.get(p["function_id"]))
                and dept_ok(depts.get(m["department_id"])) and fn_ok(funcs.get(m["function_id"]))):
            continue
        picked.append(p)
    ids = {p["id"] for p in picked}

    extra_resp: dict[int, list[int]] = {}
    for tr in t["task_responsibles"]:
        extra_resp.setdefault(tr["task_id"], []).append(tr["user_id"])
    tasks_by_project: dict[int, list[dict]] = {}
    for task in t["tasks"]:
        if task["project_id"] in ids and live_top_level(task):
            tasks_by_project.setdefault(task["project_id"], []).append(task)

    def name(uid):
        return _clean((users.get(uid) or {}).get("name"))

    rows = []
    for p in picked:
        mine = sorted(tasks_by_project.get(p["id"], []), key=lambda x: (x["sort_order"] is None, x["sort_order"] or 0, x["id"]))
        task_rows = []
        for task in mine:
            others = sorted(n for n in ((users.get(u) or {}).get("name") for u in extra_resp.get(task["id"], [])
                                        if u != task["responsible_id"]) if n)
            responsible = [n for n in [(users.get(task["responsible_id"]) or {}).get("name"), *others] if n]
            task_rows.append({
                "id": task["id"], "code": task["code"], "title": task["title"], "status": task["status"],
                "progress": round(task["progress_pct"] or 0), "blocker": bool(task["blocker"]),
                "blocker_details": task["blocker_details"],
                "start_date": _iso(task["actual_start_date"] or task["planned_start_date"]),
                "due_date": _iso(task["approved_due_date"] or task["forecast_due_date"] or task["baseline_due_date"]),
                "completed_on": _iso(task["actual_due_date"]),
                "responsible": list(dict.fromkeys(n.strip() for n in responsible if _clean(n))),
                "accountable": name(task["accountable_id"]), "reviewer": name(task["reviewer_id"]),
                "informed": name(task["informed_id"])})
        due = p["approved_due_date"] or p["forecast_due_date"] or p["baseline_due_date"]
        flat = {
            "id": p["id"], "code": p["code"], "name": p["name"], "objective": p["objective"], "status": p["status"],
            "health": p["health"], "start_date": p["start_date"], "due_date": due, "completion_pct": p["completion_pct"],
            "company": comps.get(p["company_id"]), "department": depts.get(p["department_id"]),
            "function": funcs.get(p["function_id"]), "strategic_objective": p["strategic_objective"],
            "expected_outcome": p["expected_outcome"], "project_type": p["project_type"], "priority": p["priority"],
            "methodology": p["methodology"], "criticality": p["criticality"], "budget": p["budget"],
            "baseline_due_date": p["baseline_due_date"], "approved_due_date": p["approved_due_date"],
            "forecast_due_date": p["forecast_due_date"], "actual_due_date": p["actual_due_date"],
            "sponsor_name": (users.get(p["sponsor_id"]) or {}).get("name"),
            "tasks_total": len(mine), "tasks_done": sum(1 for x in mine if (x["status"] or "").lower() == "completed"),
        }
        detail_keys = ("strategic_objective", "objective", "expected_outcome", "project_type", "priority", "methodology",
                       "criticality", "budget", "sponsor_name", "start_date", "baseline_due_date", "approved_due_date",
                       "forecast_due_date", "actual_due_date")
        associates = []
        for a in t["project_associates"]:
            u = users.get(a["user_id"])
            if a["project_id"] == p["id"] and u and u.get("is_active") is not False:
                associates.append(person(u["id"]))
        rows.append({**flat, "details": {k: _iso(flat[k]) for k in detail_keys}, "tasks": task_rows,
                     "manager": person(p["manager_id"]), "owner": person(p["owner_id"]), "associates": associates})
    return rows
