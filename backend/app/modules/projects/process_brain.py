"""Process Brain (Anwar Group process registry) is only ever read.

- `{origin}/api/live` lists the AI and AES team projects: progress, status, dates, delivery phases and the process
  paths each project touches (SBU › wing › process group › sub-process).
- `{PROCESS_BRAIN_URL}/processes` and `/raci?process_id=…` (X-API-Key) give the process groups and their RACI people.

`read_projects()` joins them into one row per project, each linked process group carrying its sub-processes and the
RACI people of that process group."""
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from app.core.config import settings
from app.modules.projects.sources import SourceError

log = logging.getLogger("innovatex.projects")

RACI_ROLES = {"R": "Responsible", "A": "Accountable", "C": "Consulted", "I": "Informed", "DO": "Data Owner"}
_ROLE_ORDER = list(RACI_ROLES)


def ready() -> bool:
    return bool(settings.process_brain_url and settings.process_brain_api_key)


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"X-API-Key": settings.process_brain_api_key,
                                               "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise SourceError("PROCESS_BRAIN_KEY_REJECTED", "Process Brain refused the API key. Check "
                              "PROCESS_BRAIN_API_KEY.")
        log.warning("Process Brain read failed: %s %s", url, exc)
        raise SourceError("PROCESS_BRAIN_UNREACHABLE", f"Could not read Process Brain: HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        log.warning("Process Brain read failed: %s %s", url, exc)
        raise SourceError("PROCESS_BRAIN_UNREACHABLE", f"Could not read Process Brain: {str(exc)[:200]}")


def _urls() -> tuple[str, str]:
    base = settings.process_brain_url.rstrip("/")
    parts = urllib.parse.urlsplit(base)
    return base, f"{parts.scheme}://{parts.netloc}/api/live"


def _raci(base: str, process_id: str) -> list[dict]:
    rows = _get(f"{base}/raci?{urllib.parse.urlencode({'process_id': process_id})}").get("rows") or []
    out = []
    for r in sorted(rows, key=lambda x: (_ROLE_ORDER.index(x["role"]) if x.get("role") in RACI_ROLES else 99,
                                         x.get("person_index") or 0)):
        name = (r.get("name") or "").strip()
        if not name:
            continue                                    # a role with nobody named yet
        out.append({"role": r.get("role"), "name": name, "email": (r.get("email") or "").strip() or None,
                    "employee_id": r.get("employee_id"), "designation": r.get("designation")})
    return out


def read_projects(only_id: str | None = None) -> list[dict]:
    if not ready():
        raise SourceError("PROCESS_BRAIN_NOT_CONFIGURED", "Process Brain is not connected. Set PROCESS_BRAIN_URL "
                          "and PROCESS_BRAIN_API_KEY on the server and restart the backend.", 503)
    base, live_url = _urls()
    live = _get(live_url)
    projects = [p for p in live.get("projects") or [] if only_id is None or p.get("id") == only_id]
    processes = _get(f"{base}/processes?limit=100000").get("rows") or []
    by_name = {(p["sbu"], (p["process_group"] or "").strip().lower()): p for p in processes}
    by_id = {p["process_id"]: p for p in processes}
    canonical = {(r[0], r[1], r[2]): r[3] for r in live.get("reg") or [] if len(r) >= 4}

    def find(sbu, wing, group):
        p = by_name.get((sbu, group.strip().lower()))
        if p:
            return p
        c = canonical.get((sbu, wing, group))
        return by_id.get(f"{sbu}-{c}") if c else None

    # Every project's linked process groups, in the order Process Brain lists them.
    linked: dict[str, dict[tuple, dict]] = {}
    for p in projects:
        groups: dict[tuple, dict] = {}
        for path in p.get("paths") or []:
            _, sbu, wing, group, sub = (list(path) + [None] * 5)[:5]
            proc = find(sbu, wing, group) if group else None
            key = (sbu, wing, group)
            g = groups.setdefault(key, {
                "process_id": proc["process_id"] if proc else None, "sbu": sbu,
                "company": proc.get("sbu_company") if proc else None,
                "wing": proc["wing"] if proc else wing, "wing_code": wing,
                "process_group": group, "subprocesses": [], "raci": []})
            if sub and sub not in g["subprocesses"]:
                g["subprocesses"].append(sub)
        linked[p["id"]] = groups

    # RACI of every process group needed, a few at a time (one request per process group).
    wanted = sorted({g["process_id"] for groups in linked.values() for g in groups.values() if g["process_id"]})
    with ThreadPoolExecutor(max_workers=8) as pool:
        racis = dict(zip(wanted, pool.map(lambda pid: _raci(base, pid), wanted)))

    out = []
    for p in projects:
        groups = list(linked[p["id"]].values())
        for g in groups:
            g["raci"] = racis.get(g["process_id"], [])
        out.append({
            "id": p["id"], "team": (p.get("team") or "").upper() or None, "name": p.get("name"),
            "module": p.get("module"), "owner": p.get("owner"), "status": p.get("status"),
            "start": p.get("start"), "end": p.get("end"),
            "pct": max(0, min(100, round((p.get("pct") or 0) * 100))),
            "phases": p.get("phases") or {}, "phase_source": p.get("phaseSource"), "processes": groups})
    return out


def raci_people(processes: list[dict]) -> list[dict]:
    """Everyone in the RACI of the given process groups, each person once (by email, else by name), with every role
    they hold and where."""
    people: dict[str, dict] = {}
    for g in processes or []:
        where = " · ".join(x for x in (g.get("sbu"), g.get("process_group")) if x)
        for r in g.get("raci") or []:
            key = (r.get("email") or r["name"]).strip().lower()
            person = people.setdefault(key, {"key": f"raci:{key}", "name": r["name"], "email": r.get("email"),
                                             "designation": r.get("designation"), "roles": [], "processes": []})
            if r.get("role") and r["role"] not in person["roles"]:
                person["roles"].append(r["role"])
            if where and where not in person["processes"]:
                person["processes"].append(where)
    for person in people.values():
        person["roles"].sort(key=lambda x: _ROLE_ORDER.index(x) if x in _ROLE_ORDER else 99)
    return list(people.values())
