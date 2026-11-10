"""End-to-end test: create a challenge and drive it to a published reward.

Runs against the backend in .env (BACKEND_URL). It uses the live database, so it only ADDS
one test challenge and its entries -- it never resets or deletes existing data.

    python scripts/e2e_create_to_reward.py

Roles exercised: SUPER_ADMIN (creates, chooses judges, approves, publishes), PROGRAM_OWNER
(management, shortlist), JUDGE (scoring + demo review), EMPLOYEE/participant (register,
submit, read own result), plus negative/permission checks throughout.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
env = {}
if (ROOT / ".env").exists():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
cfg = lambda k, d: os.environ.get(k) or env.get(k) or d  # noqa: E731
BASE = cfg("BACKEND_URL", "http://127.0.0.1:8000").rstrip("/") + cfg("API_PREFIX", "/api/v1")
PASSWORD = cfg("DEMO_PASSWORD", "Password@123")
DOMAIN = "anwargroup.example"

tokens: dict[str, str] = {}
LOG: list[dict] = []
PASS = FAIL = 0


def raw(method, path, token=None, body=None):
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            payload, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        payload, status = e.read(), e.code
    try:
        return status, json.loads(payload)
    except Exception:
        return status, payload


def login(user):
    if user not in tokens:
        s, d = raw("POST", "/auth/login", body={"email": f"{user}@{DOMAIN}", "password": PASSWORD})
        assert s == 200, f"login {user}: {s} {d}"
        tokens[user] = d["access_token"]
    return tokens[user]


def call(who, method, path, body=None, expect=200, label=""):
    global PASS, FAIL
    status, data = raw(method, path, login(who) if who else None, body)
    ok = status == expect
    PASS += ok
    FAIL += not ok
    entry = {"who": who, "method": method, "path": path, "status": status, "expect": expect, "ok": ok, "label": label}
    LOG.append(entry)
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {who or 'public'} {method} {path} -> {status}" + (f"  ({label})" if label else ""))
    if not ok:
        detail = json.dumps(data)[:600] if not isinstance(data, bytes) else str(data)[:300]
        print(f"         expected {expect}; got {detail}")
        raise AssertionError(f"{method} {path} -> {status} (expected {expect}) {detail}")
    return data


def probe(who, method, path, expect, body=None, label=""):
    """Negative/permission check: expect a specific non-200 status; never raises on mismatch."""
    global PASS, FAIL
    status, data = raw(method, path, login(who) if who else None, body)
    ok = status == expect
    PASS += ok
    FAIL += not ok
    LOG.append({"who": who, "method": method, "path": path, "status": status, "expect": expect, "ok": ok, "label": label, "negative": True})
    print(f"  [{'PASS' if ok else 'FAIL'}] {who or 'public'} {method} {path} -> {status} (want {expect})  {label}")
    if not ok:
        print(f"         got {json.dumps(data)[:300] if not isinstance(data, bytes) else data}")
    return status, data


def section(name):
    print(f"\n== {name}")


def fill(form, base=None):
    """Fill every field of a dynamic form so required checks pass; leave given answers alone."""
    content = dict(base or {})
    for sec in form["sections"]:
        for f in sec["fields"]:
            k, t = f["field_key"], f["field_type"]
            if content.get(k) not in (None, "", [], False):
                continue
            if t in ("TEXT", "LONG_TEXT"):
                content[k] = f"E2E automated answer for {k} — written by the test harness."
            elif t in ("NUMBER", "MONEY"):
                content[k] = 10
            elif t == "DATE":
                content[k] = datetime.now(timezone.utc).date().isoformat()
            elif t == "SELECT":
                content[k] = f["options"][0]["value"] if f["options"] else "YES"
            elif t == "MULTI_SELECT":
                content[k] = [f["options"][0]["value"]] if f["options"] else ["ONE"]
            elif t == "URL":
                content[k] = "https://example.org/e2e"
            elif t in ("CHECKBOX", "DECLARATION"):
                content[k] = True
            else:
                content[k] = f"E2E {k}"
    return content


def score_all(judges, round_type, entity_ids, rating=4, recommendation="YES"):
    """Every judge scores every assignment in this round that belongs to our entries."""
    done = 0
    for u in judges:
        for a in call(u, "GET", "/me/review-queue")["items"]:
            if a["status"] == "SUBMITTED" or a.get("round_type") != round_type:
                continue
            if a["entity"]["id"] not in entity_ids:
                continue
            ws = call(u, "GET", f"/review-assignments/{a['id']}")
            scores = [{"criterion_id": c["id"], "rating": rating, "comment": None} for c in ws["scorecard"]["criteria"]]
            res = call(u, "POST", f"/review-assignments/{a['id']}/actions/submit",
                       {"scores": scores, "recommendation": recommendation,
                        "strengths": "Clear problem and a practical plan.",
                        "improvements": "Show the numbers behind the estimate."})
            done += 1
    return done


started = datetime.now(timezone.utc)
print(f"E2E create-to-reward against {BASE}\nstarted {started.isoformat(timespec='seconds')}")

# ---------------------------------------------------------------------------------------------
section("0. Sign in every role the flow needs")
people = {}
for u in ("admin", "owner", "judge1", "judge2", "judge3", "judge4", "priya", "omar", "lamia"):
    me = call(u, "GET", "/me")
    people[u] = {"id": me["id"], "name": me["full_name"], "roles": me["roles"], "email": me.get("email")}
    print(f"       {u:8s} = {me['full_name']:24s} roles={me['roles']}")
JUDGES = ["judge1", "judge2", "judge3", "judge4"]
PARTICIPANTS = ["priya", "omar", "lamia"]

section("1. SUPER ADMIN builds a new challenge (draft)")
domains = call("admin", "GET", "/domains")
forms = call("admin", "GET", "/forms")
scorecards = call("admin", "GET", "/scorecards")
method_form = next((f for f in forms if f["purpose"] == "METHODOLOGY"), None)
final_form = next((f for f in forms if f["purpose"] in ("FINAL", "FINAL_PROJECT")), None)
method_sc = next((s for s in scorecards if s["purpose"] in ("METHODOLOGY", "IDEA_REVIEW") and s["total_weight"] == 100), None) or scorecards[0]
final_sc = next((s for s in scorecards if s["purpose"] in ("FINAL_JURY", "PROTOTYPE") and s["total_weight"] == 100), None) or scorecards[-1]
assert method_form, "there must be a methodology form to publish a challenge"
print(f"       domain={domains[0]['name']}  method_form={method_form['code']}  method_sc={method_sc['code']}  final_sc={final_sc['code']}")

now = datetime.now(timezone.utc)
iso = lambda d: (now + timedelta(days=d)).isoformat()  # noqa: E731
title = f"E2E Kaizen: cut rework at the finishing line ({now:%H%M%S})"
payload = {
    "title": title,
    "domain_id": domains[0]["id"],
    "problem_statement": "Rework at the finishing line runs at 4.2%; the target is under 1%.",
    "expected_outcome": "Rework below 1% within two months, with the causes tracked per shift.",
    "rules": "Open to all permanent staff. One entry per person or team.",
    "participation_mode": "BOTH", "team_min_size": 1, "team_max_size": 5,
    "phases": [
        {"phase_type": "REGISTRATION", "opens_at": iso(-0.15), "closes_at": iso(30)},
        {"phase_type": "METHODOLOGY", "opens_at": iso(-0.10), "closes_at": iso(30)},
        {"phase_type": "METHODOLOGY_REVIEW", "opens_at": iso(30), "closes_at": iso(32)},
        {"phase_type": "SHORTLIST", "opens_at": iso(32), "closes_at": iso(34)},
        {"phase_type": "BUILD", "opens_at": iso(34), "closes_at": iso(40)},
        {"phase_type": "PROTOTYPE", "opens_at": iso(40), "closes_at": iso(46)},
        {"phase_type": "PROTOTYPE_REVIEW", "opens_at": iso(46), "closes_at": iso(48)},
        {"phase_type": "FINAL_SUBMISSION", "opens_at": iso(48), "closes_at": iso(54)},
        {"phase_type": "JUDGING", "opens_at": iso(54), "closes_at": iso(56)},
        {"phase_type": "RESULTS", "opens_at": iso(56), "closes_at": iso(58)},
    ],
    "methodology_form_id": method_form["id"],
    "methodology_scorecard_id": method_sc["id"], "final_scorecard_id": final_sc["id"],
    "reviewers_per_entry": 2, "blind_review": False, "aggregation_method": "MEAN",
    "show_scores_to_entrants": "PER_CRITERION", "shortlist_method": "TOP_N", "top_n": 2, "waitlist_size": 0,
    "prototype_policy": "REQUIRED_ALL", "publish_winner_summaries": True,
    "prizes": [{"rank_from": 1, "rank_to": 1, "description": "Winner", "amount": 100000},
               {"rank_from": 2, "rank_to": 2, "description": "Runner-up", "amount": 50000}],
}
created = call("admin", "POST", "/challenges", payload)
CH = created["id"]
print(f"       created {created['code']}  slug={created['slug']}")
check = call("admin", "GET", f"/manage/challenges/{CH}")["publish_checklist"]
for c in check:
    print(f"       checklist: {c['code']:8s} ok={c['ok']}{' (optional)' if c.get('optional') else ''}")
print(f"       rounds planned: {[r['round_type'] for r in call('admin', 'GET', f'/manage/challenges/{CH}')['rounds']]}")

section("2. Permission checks before publishing")
probe("lamia", "POST", "/challenges", 404, body=payload, label="an employee cannot create a challenge")
probe("owner", "POST", f"/challenges/{CH}/judges", 404, body={"user_ids": [people['judge1']['id']]}, label="only the admin chooses judges")
detail_as_employee = probe("lamia", "GET", f"/challenges/{created['slug']}", 404, label="a DRAFT challenge is hidden from staff")

section("3. Publish (structure locks, registration opens)")
pub = call("admin", "POST", f"/challenges/{CH}/actions/publish")
print(f"       status after publish: {pub['status_code']}")
probe("admin", "POST", f"/challenges/{CH}/actions/publish", 400, label="cannot publish twice")
card = call("lamia", "GET", f"/challenges/{created['slug']}")
print(f"       public view: status={card['status_code']} registration_open={card['registration']['is_open']}")

section("4. Participants register (3 entries)")
entries = {}
for u in PARTICIPANTS:
    r = call(u, "POST", f"/challenges/{CH}/entries",
             {"entry_type": "TEAM", "team_name": f"{people[u]['name'].split()[0]} Crew", "title": f"{u}'s rework fix",
              "summary": f"An approach from {u} to cut finishing-line rework.", "accept_declaration": True})
    entries[u] = {"id": r["id"], "code": r["code"]}
    print(f"       {u}: {r['code']} team={r['team']['name']}")
EIDS = [entries[u]["id"] for u in PARTICIPANTS]
probe("priya", "POST", f"/challenges/{CH}/entries", 409,
      body={"entry_type": "TEAM", "team_name": "Again", "title": "dup", "accept_declaration": True}, label="no duplicate registration")
probe("anika", "POST", f"/challenges/{CH}/entries", 400,
      body={"entry_type": "TEAM", "team_name": "NoDecl", "title": "no declaration", "accept_declaration": False},
      label="declaration is required")
probe("priya", "GET", f"/entries/{entries['omar']['id']}", 404, label="a participant cannot open a rival's entry")
call("judge1", "GET", f"/entries/{entries['omar']['id']}")  # judges see everything

section("5. Q&A and methodology submission")
q = call("lamia", "POST", f"/challenges/{created['slug']}/questions", {"question": "Will the line be stopped for the trial?"})
qs = call("admin", "GET", f"/challenges/{CH}/questions")
call("admin", "POST", f"/questions/{qs[0]['id']}/answer", {"answer": "Yes, a planned 30-minute trial per shift."})
for u in PARTICIPANTS:
    eid = entries[u]["id"]
    form = call(u, "GET", f"/entries/{eid}/submissions/methodology")
    content = fill(form["form"])
    out = call(u, "POST", f"/entries/{eid}/submissions/methodology/actions/submit", {"content": content})
    print(f"       {u}: methodology v{out['version_no']} ({out['status']})")

section("6. Close methodology: entries go to the judges (deadline lock)")
closed = call("admin", "POST", f"/challenges/{CH}/actions/close-phase", {"phase_type": "METHODOLOGY"})
print(f"       status now {closed['status_code']}")
for u in PARTICIPANTS:
    st = call(u, "GET", f"/entries/{entries[u]['id']}")["status_code"]
    print(f"       {u}: entry status {st}")
    assert st == "UNDER_REVIEW", st
probe("priya", "PUT", f"/entries/{entries['priya']['id']}/submissions/methodology", 409,
      body={"content": {}}, label="methodology is locked after the deadline")

section("7. Admin chooses judges and shares the entries out")
added = call("admin", "POST", f"/challenges/{CH}/judges",
             {"user_ids": [people[j]["id"] for j in JUDGES], "stages": [], "emails": ""})
print(f"       judges added: {added['added']}  entries shared: {added['created']}  excluded: {[(x['reviewer'], x['reason']) for x in added['exclusions']]}")
assigned = call("admin", "POST", f"/review-rounds/{[r['id'] for r in call('admin', 'GET', f'/manage/challenges/{CH}')['rounds'] if r['round_type'] == 'METHODOLOGY'][0]}/actions/assign")
print(f"       assignments created: {assigned['created']}  short_of_reviewers: {assigned.get('short_of_reviewers')}")

section("8. Judges score the methodology")
mq = call("judge1", "GET", "/me/review-queue")
print(f"       judge1 queue: {mq['summary']}")
# a judge can't open another judge's assignment
other = [a for a in call("judge2", "GET", "/me/review-queue")["items"]
         if a["round_type"] == "METHODOLOGY" and a["status"] != "SUBMITTED" and a["entity"]["id"] in EIDS]
if other:
    probe("judge1", "GET", f"/review-assignments/{other[0]['id']}", 404, label="judges cannot open each other's reviews")
n_scored = score_all(JUDGES, "METHODOLOGY", EIDS)
print(f"       methodology reviews submitted: {n_scored}")

section("9. Round results, then propose / confirm / publish the shortlist")
mr = next(r for r in call("admin", "GET", f"/manage/challenges/{CH}")["rounds"] if r["round_type"] == "METHODOLOGY")
res = call("owner", "GET", f"/review-rounds/{mr['id']}/results")
print(f"       can_propose={res['can_propose']} blockers={res['propose_blockers']}")
for row in res["results"]:
    print(f"       {row['entry']['code']}: score={row['final_score']} rank={row['rank']} needs_discussion={row['needs_discussion']}")
    if row["needs_discussion"]:
        call("owner", "POST", f"/round-results/{row['id']}/resolve-discussion", {"resolution": "SCORES_KEPT", "note": "Panel call."})
call("owner", "PATCH", f"/review-rounds/{mr['id']}/shortlist-rule", {"top_n": 2})
sl = call("owner", "POST", f"/review-rounds/{mr['id']}/shortlist/actions/propose")
slv = call("owner", "GET", f"/shortlists/{sl['id']}")
print(f"       shortlist counts: {slv['counts']}  rule: {slv['rule']['text']}")
fb = call("owner", "GET", f"/review-rounds/{mr['id']}/feedback")
call("owner", "PUT", f"/feedback/{fb['items'][0]['id']}",
     {"strengths": "• Clear baseline", "improvements": "• Quantify the trial", "next_steps": "Start your build plan."})
probe("owner", "POST", f"/shortlists/{sl['id']}/actions/publish", 409, label="must confirm before publishing")
call("owner", "POST", f"/shortlists/{sl['id']}/actions/confirm")
call("owner", "POST", f"/shortlists/{sl['id']}/actions/publish")
for u in PARTICIPANTS:
    print(f"       {u}: entry status {call(u, 'GET', f'/entries/{entries[u]['id']}')['status_code']}")

shortlisted = [u for u in PARTICIPANTS if call(u, "GET", f"/entries/{entries[u]['id']}")["status_code"] == "SHORTLISTED"]
print(f"       shortlisted: {[(u, entries[u]['code']) for u in shortlisted]}")

section("10. Build + demo review (Prototype stage)")
call("admin", "POST", f"/challenges/{CH}/actions/close-phase", {"phase_type": "METHODOLOGY_REVIEW"})
call("admin", "POST", f"/challenges/{CH}/actions/close-phase", {"phase_type": "SHORTLIST"})
call("admin", "POST", f"/challenges/{CH}/actions/close-phase", {"phase_type": "BUILD"})
print(f"       current status: {call('admin', 'GET', f'/manage/challenges/{CH}')['status_code']}")
for u in shortlisted:
    eid = entries[u]["id"]
    call(u, "POST", "/milestones", {"entity_id": eid, "title": "Baseline measured", "due_date": iso(41)[:10]})
    gate = call(u, "PUT", f"/gates/challenge_entry/{eid}/PROTOTYPE",
                {"content": {"link": "https://demo.example.org/rework", "how_to_use": "Open the link, pick the line, tap Capture."}, "submit": True})
    print(f"       {u}: demo submitted gate={gate['status']}")
    call("admin", "POST", f"/gates/{gate['id']}/send-for-review", {"user_ids": [people[j]["id"] for j in JUDGES[:2]]})
call("admin", "POST", f"/challenges/{CH}/actions/close-phase", {"phase_type": "PROTOTYPE"})

# The demo review can be scored in the Prototype round, or decided by judge votes. Handle both.
demo_scored = False
for u in shortlisted:
    ov = call("admin", "GET", f"/gates/challenge_entry/{entries[u]['id']}")
    gate = ov["stages"][0].get("gate") or {}
    # In the scored path the admin view lists review assignments; in the vote path it is empty.
    if gate.get("judges"):
        demo_scored = True
print(f"       demo review mode: {'scored (Prototype round)' if demo_scored else 'judge decisions (gate votes)'}")
if demo_scored:
    n_proto = score_all(JUDGES, "PROTOTYPE", [entries[u]["id"] for u in shortlisted])
    print(f"       demo/prototype scores submitted: {n_proto}")
    pr = next(r for r in call("admin", "GET", f"/manage/challenges/{CH}")["rounds"] if r["round_type"] == "PROTOTYPE")
    pres = call("owner", "GET", f"/review-rounds/{pr['id']}/results")
    for row in pres["results"]:
        print(f"       {row['entry']['code']}: demo score={row['final_score']} rank={row['rank']}")
        if row["needs_discussion"]:
            call("owner", "POST", f"/round-results/{row['id']}/resolve-discussion", {"resolution": "SCORES_KEPT", "note": "ok"})
    call("owner", "PATCH", f"/review-rounds/{pr['id']}/shortlist-rule", {"top_n": 2})
    psl = call("owner", "POST", f"/review-rounds/{pr['id']}/shortlist/actions/propose")
    call("owner", "POST", f"/shortlists/{psl['id']}/actions/confirm")
    call("owner", "POST", f"/shortlists/{psl['id']}/actions/publish")
else:
    for u in shortlisted:
        for j in JUDGES:
            for a in call(j, "GET", "/me/review-queue")["items"]:
                if a.get("gate") and a["entity"]["id"] == entries[u]["id"] and a["status"] != "SUBMITTED":
                    call(j, "POST", f"/gate-votes/{a['id']}", {"decision": "APPROVE", "feedback": ""})
    print("       demo approved by judge decisions")
finalists = [u for u in shortlisted if call(u, "GET", f"/entries/{entries[u]['id']}")["status_code"] == "FINALIST"]
print(f"       finalists: {[(u, entries[u]['code']) for u in finalists]}")

section("11. Final submission + final jury")
call("admin", "POST", f"/challenges/{CH}/actions/close-phase", {"phase_type": "PROTOTYPE_REVIEW"})
for u in finalists:
    out = call(u, "POST", f"/entries/{entries[u]['id']}/submissions/final/actions/submit",
               {"content": {"solution_summary": "Rework tracker live on two lines.", "results": "Rework 4.2% to 0.9%.",
                            "pilot_plan": "Roll out to line 3 in four weeks."}})
    print(f"       {u}: final v{out['version_no']} ({out['status']})")
call("admin", "POST", f"/challenges/{CH}/actions/close-phase", {"phase_type": "FINAL_SUBMISSION"})
print(f"       current status: {call('admin', 'GET', f'/manage/challenges/{CH}')['status_code']}")
ja = call("admin", "POST", f"/review-rounds/{[r['id'] for r in call('admin', 'GET', f'/manage/challenges/{CH}')['rounds'] if r['round_type'] == 'FINAL_JURY'][0]}/actions/assign")
print(f"       jury assignments created: {ja['created']}")
score_all(JUDGES, "FINAL_JURY", [entries[u]["id"] for u in finalists], rating=4)
call("admin", "POST", f"/challenges/{CH}/actions/close-phase", {"phase_type": "JUDGING"})

section("12. Results, approval, publication and reward")
rw = call("admin", "GET", f"/manage/challenges/{CH}/results")
print(f"       results status={rw['status']} pending_reviews={rw['pending_reviews']}")
for e in rw["entries"]:
    print(f"       {e['code']}: jury_score={e['jury_score']} rank={e['jury_rank']} evidence={e['has_working_evidence']} demo={e['demo_status']}")
ranked = [e for e in rw["entries"] if e["jury_score"] is not None]
winner_row, runner_row = ranked[0], ranked[1]
cat_id = rw["award_categories"][0]["id"] if rw["award_categories"] else None
call("admin", "PUT", f"/manage/challenges/{CH}/results/decisions", {"decisions": [
    {"entry_id": winner_row["entry_id"], "rank": 1, "result": "WINNER", "presentation_score": 92.5,
     "award_category_id": cat_id, "decision_note": "Best measured result and a clean live demo."},
    {"entry_id": runner_row["entry_id"], "rank": 2, "result": "RUNNER_UP", "presentation_score": 85.0}]})
probe("admin", "POST", f"/manage/challenges/{CH}/results/actions/publish", 409, label="publish needs approval first")
call("admin", "POST", f"/manage/challenges/{CH}/results/actions/approve")
call("admin", "POST", f"/manage/challenges/{CH}/results/actions/publish")

section("13. Entrant view of the result + reward")
pub = call("lamia", "GET", "/results")
mine = next(c for c in pub["challenges"] if c["id"] == CH)
for w in mine["winners"]:
    print(f"       published: rank {w['rank']} {w['result']} score={w['score']} prize={w['prize']}")
winner_user = next(u for u in PARTICIPANTS if entries[u]["code"] == winner_row["code"])
fbk = call(winner_user, "GET", f"/entries/{entries[winner_user]['id']}/feedback")
print(f"       winner sees feedback: decision={fbk['items'][0]['decision_code']} score_shared={fbk['items'][0]['score_shared']}")

section("14. Winning entry continues as an initiative")
conv = call("admin", "POST", f"/entries/{entries[winner_user]['id']}/actions/convert-to-initiative")
print(f"       converted to {conv['code']}")
probe("admin", "POST", f"/entries/{entries[winner_user]['id']}/actions/convert-to-initiative", 409, label="cannot convert twice")
ini = call("admin", "GET", f"/initiatives/{conv['code']}")
print(f"       initiative state={ini['current_state_code']} awarded={ini.get('is_awarded')}")

# ---------------------------------------------------------------------------------------------
elapsed = (datetime.now(timezone.utc) - started).total_seconds()
print("\n" + "=" * 78)
print(f"E2E COMPLETE in {elapsed:.1f}s   challenge={created['code']} ({created['slug']})")
print(f"checks: {PASS} passed, {FAIL} failed")
print("=" * 78)
out = ROOT / "scripts" / "e2e_report.json"
out.write_text(json.dumps({"challenge": created, "entries": entries, "log": LOG,
                           "passed": PASS, "failed": FAIL, "elapsed_s": elapsed}, indent=2), encoding="utf-8")
print(f"request log written to {out}")
sys.exit(1 if FAIL else 0)
