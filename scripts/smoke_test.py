"""End-to-end smoke test against a running backend with fresh demo data.

    python scripts/smoke_test.py

Reads BACKEND_URL, API_PREFIX and DEMO_PASSWORD from the root .env (or the environment).
It changes data (registers, submits, scores, shortlists, publishes), so run it on a fresh seed
and reset afterwards:  docker compose down -v && docker compose up -d
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
env = {}
if (ROOT / ".env").exists():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
cfg = lambda k, d: os.environ.get(k) or env.get(k) or d   # noqa: E731
BASE = cfg("BACKEND_URL", "http://localhost:8000").rstrip("/") + cfg("API_PREFIX", "/api/v1")
PASSWORD = cfg("DEMO_PASSWORD", "Password@123")
DOMAIN = "anwargroup.example"

tokens: dict[str, str] = {}
passed = failed = 0


def raw(method, path, token=None, body=None, files=None):
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if files:
        boundary = uuid.uuid4().hex
        parts = []
        for name, value in files.items():
            if isinstance(value, tuple):
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{value[0]}"\r\n'
                             f"Content-Type: text/plain\r\n\r\n".encode() + value[1] + b"\r\n")
            else:
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        data = b"".join(parts) + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        payload, status = e.read(), e.code
    try:
        return status, json.loads(payload)
    except Exception:
        return status, payload


def login(user):
    if user not in tokens:
        status, data = raw("POST", "/auth/login", body={"email": f"{user}@{DOMAIN}", "password": PASSWORD})
        assert status == 200, f"login {user}: {status} {data}"
        tokens[user] = data["access_token"]
    return tokens[user]


def call(user, method, path, body=None, expect=200, files=None, label=None):
    global passed, failed
    status, data = raw(method, path, login(user) if user else None, body, files)
    ok = status == expect
    passed += ok
    failed += not ok
    if not ok:
        detail = json.dumps(data)[:300] if not isinstance(data, bytes) else data[:200]
        print(f"  FAIL [{user}] {method} {path} -> {status} (expected {expect}) {label or ''}\n       {detail}")
    return data


def section(name):
    print(f"\n== {name}")


# ---------------------------------------------------------------------------------------------
section("Login and read-only pages for every role")
USERS = ["admin", "dmd", "owner", "executive", "judge1", "judge2", "masterdata", "hr", "finance", "sponsor", "rahim", "nusrat",
         "sadia", "karim", "fahim", "lamia", "anika"]
call(None, "GET", "/auth/demo-accounts")
for u in USERS:
    me = call(u, "GET", "/me")
    for path in ("/home", "/challenges?tab=open", "/challenges?tab=upcoming", "/challenges?tab=closed", "/me/entries",
                 "/initiatives?scope=mine", "/me/notifications", "/dashboards/me", "/results", "/catalogue/assets", "/impact",
                 "/me/profile", "/search?q=kiln", "/org-units", "/lookups", "/categories", "/domains", "/skills", "/roles",
                 "/forms", "/scorecards", "/users?q=ra"):
        call(u, "GET", path)
print(f"  roles: " + ", ".join(f"{u}={'/'.join(r for r in call(u, 'GET', '/me')['roles'] if r != 'EMPLOYEE') or 'EMPLOYEE'}" for u in USERS[:10]))

open_ch = call("rahim", "GET", "/challenges?tab=open")["items"]
by_title = {c["title_i18n"]["en"]: c for c in call("owner", "GET", "/manage/challenges")["items"]}
C1, C2 = by_title["Cut kiln energy use by 10%"], by_title["Faster employee onboarding"]
C3, C4 = by_title["Cut procurement paperwork by half"], by_title["Zero harm: safer shift handover"]
C5, C6 = by_title["Cut water use in textile dyeing"], by_title["AES developer productivity challenge"]
print("  statuses:", {t[:22]: c["status_code"] for t, c in by_title.items()})

section("Role dashboards and admin pages")
call("judge1", "GET", "/dashboards/judge")
call("owner", "GET", "/dashboards/program")
call("owner", "GET", f"/dashboards/challenge?challenge_id={C2['id']}")
call("executive", "GET", "/dashboards/executive")
call("rahim", "GET", "/dashboards/program", expect=404)
call("rahim", "GET", "/dashboards/executive", expect=404)
for path in ("/admin/users", "/settings", "/feature-flags", "/workflows", "/audit-logs", "/admin/system-health",
             "/notification-templates", "/notification-rules", "/notification-deliveries"):
    call("admin", "GET", path)
    call("rahim", "GET", path, expect=404)
call("owner", "GET", "/notification-templates")
call("owner", "GET", "/settings", expect=404)
call("masterdata", "POST", "/domains", {"name": "Logistics", "name_bn": "লজিস্টিকস"})
call("rahim", "POST", "/domains", {"name": "Nope"}, expect=404)

section("Privacy: a participant never sees other participants' work")
rahim_entries = call("rahim", "GET", "/me/entries")["items"]
spark = next(e for e in rahim_entries if e["team"] and e["team"]["name"] == "Team Spark")
karim_entries = call("karim", "GET", "/me/entries")["items"]
nova = next(e for e in karim_entries if e["team"] and e["team"]["name"] == "Team Nova")
call("rahim", "GET", f"/entries/{nova['id']}", expect=404)
call("rahim", "GET", f"/teams/{nova['team']['id']}", expect=404)
call("rahim", "GET", f"/entries/{nova['id']}/submissions/methodology", expect=404)
call("rahim", "GET", f"/entries/{nova['id']}/feedback", expect=404)
call("rahim", "GET", f"/attachments?entity_type=challenge_entry&entity_id={nova['id']}", expect=404)
call("rahim", "GET", "/submissions", expect=404)
call("rahim", "GET", "/manage/challenges", expect=404)
call("rahim", "GET", f"/challenges/{C1['id']}/entries", expect=404)
call("judge1", "GET", f"/entries/{nova['id']}")            # judges read all
call("executive", "GET", f"/entries/{nova['id']}")
call("judge1", "GET", "/submissions")
detail = call("anika", "GET", f"/challenges/{C1['slug']}")
assert "entries" not in detail and detail["registration"]["count"] == 3, detail["registration"]
ideas_all = call("owner", "GET", "/initiatives?scope=all")["items"]
fraud = next(i for i in ideas_all if i["title"] == "Supplier payment fraud signals")
for u in ("anika", "executive", "rahim"):
    call(u, "GET", f"/initiatives/{fraud['code']}", expect=404, label="confidential idea")
    assert not any(i["code"] == fraud["code"] for i in call(u, "GET", "/initiatives?scope=all")["items"]), "confidential leaked in list"
    assert not call(u, "GET", "/search?q=fraud")["items"], "confidential leaked in search"
call("owner", "GET", f"/initiatives/{fraud['code']}")
call("judge1", "GET", f"/initiatives/{fraud['code']}", label="judges view all participant documents and info")
call("judge1", "GET", f"/challenges/{C1['id']}/entries")
call("dmd", "GET", f"/initiatives/{fraud['code']}")
call("omar", "GET", f"/initiatives/{fraud['code']}")

section("Team join link flow")
TOKEN = "demo-spark-join-link-2026"
assert call("sadia", "GET", f"/join/{TOKEN}")["state"] == "REQUEST_PENDING"
card = call("anika", "GET", f"/join/{TOKEN}")
assert card["state"] == "OK" and "members" not in card and card["team_name"] == "Team Spark", card
assert call("karim", "GET", f"/join/{TOKEN}")["state"] == "ALREADY_IN_CHALLENGE"
assert call("anika", "GET", "/join/not-a-real-token")["state"] == "LINK_INVALID"
call("anika", "POST", f"/join/{TOKEN}/requests", {"message": ""}, expect=400)
call("anika", "POST", f"/join/{TOKEN}/requests", {"message": "I can help with data entry and testing."})
call("karim", "POST", f"/join/{TOKEN}/requests", {"message": "hello"}, expect=409)
team_id = spark["team"]["id"]
call("nusrat", "GET", f"/teams/{team_id}/join-requests", expect=404, label="member is not the leader")
requests = call("rahim", "GET", f"/teams/{team_id}/join-requests")
assert len(requests) == 2
sadia_req = next(r for r in requests if r["user"]["full_name"] == "Sadia Islam")
anika_req = next(r for r in requests if r["user"]["full_name"] == "Anika Tabassum")
call("nusrat", "POST", f"/join-requests/{sadia_req['id']}/actions/approve", {}, expect=404)
call("rahim", "POST", f"/join-requests/{sadia_req['id']}/actions/approve", {})
call("rahim", "POST", f"/join-requests/{anika_req['id']}/actions/decline", {"reason": "We have the skills we need, thank you."})
team = call("sadia", "GET", f"/teams/{team_id}")
assert team["member_count"] == 4 and team["credit_total"] == 100 and "invite_links" not in team, team
assert len(call("sadia", "GET", "/me")["teams"]) >= 1
new_link = call("rahim", "POST", f"/teams/{team_id}/invite-links", {"expires_in_days": 3, "max_uses": 2})
assert "url" in new_link and new_link["token"] in new_link["url"]
call("rahim", "POST", f"/invite-links/{new_link['id']}/actions/revoke")
assert call("anika", "GET", f"/join/{new_link['token']}")["state"] in ("LINK_INVALID", "REQUEST_PENDING")
call("rahim", "PUT", f"/teams/{team_id}/credit-shares", {"shares": {m["user_id"]: 20 for m in team["members"]}}, expect=400)
call("rahim", "PUT", f"/teams/{team_id}/credit-shares", {"shares": {m["user_id"]: 25 for m in team["members"]}})
call("rahim", "POST", f"/teams/{team_id}/actions/leave", expect=400, label="leader can't leave")

section("Methodology: draft, validation, submit, resubmit")
form = call("rahim", "GET", f"/entries/{spark['id']}/submissions/methodology")
assert form["can_edit"] and form["status"] == "DRAFT", form["read_only_reason"]
content = dict(form["content"])
call("tanvir", "PUT", f"/entries/{spark['id']}/submissions/methodology", {"content": content})
call("rahim", "POST", f"/entries/{spark['id']}/submissions/methodology/actions/submit", {"content": content}, expect=422)
content.update({"work_plan": "Week 1-2 baseline. Week 3-6 build. Week 7-10 trial.", "expected_impact": "10% lower specific heat.",
                "risks": "Quality drift; we keep the lab checks.", "team_skills": "Process, data, maintenance.", "declaration": True})
r = call("rahim", "POST", f"/entries/{spark['id']}/submissions/methodology/actions/submit", {"content": content})
assert r["version_no"] == 1
content["tools"] = "Heat balance model"
assert call("nusrat", "POST", f"/entries/{spark['id']}/submissions/methodology/actions/submit", {"content": content})["version_no"] == 2
call("karim", "PUT", f"/entries/{spark['id']}/submissions/methodology", {"content": {}}, expect=404)
up = call("rahim", "POST", "/attachments", files={"entity_type": "challenge_entry", "entity_id": spark["id"],
                                                 "file": ("heat-balance.txt", b"kiln heat balance")})
assert len(call("tanvir", "GET", f"/attachments?entity_type=challenge_entry&entity_id={spark['id']}")) == 1
assert raw("GET", f"/attachments/{up['id']}/download", login("rahim"))[1] == b"kiln heat balance"
call("karim", "GET", f"/attachments/{up['id']}/download", expect=404)
call("rahim", "POST", "/attachments", expect=400, files={"entity_type": "challenge_entry", "entity_id": spark["id"], "file": ("x.exe", b"MZ")})

section("Registration rules")
call("rahim", "POST", f"/challenges/{C1['id']}/entries", {"entry_type": "INDIVIDUAL", "title": "Second go", "accept_declaration": True}, expect=409)
call("judge1", "POST", f"/challenges/{C1['id']}/entries", {"entry_type": "INDIVIDUAL", "title": "Judge entry", "accept_declaration": True}, expect=400)
call("priya", "POST", f"/challenges/{C2['id']}/entries", {"entry_type": "INDIVIDUAL", "title": "Late", "accept_declaration": True}, expect=400, label="registration closed")
call("priya", "POST", f"/challenges/{C1['id']}/entries", {"entry_type": "TEAM", "title": "Kiln door seals", "accept_declaration": False, "team_name": "Seal Team"}, expect=400)
reg = call("priya", "POST", f"/challenges/{C1['id']}/entries", {"entry_type": "TEAM", "title": "Kiln door seals", "team_name": "Seal Team",
                                                               "summary": "Stop false air at the kiln hood.", "accept_declaration": True})
assert reg["code"].startswith("ENT-") and reg["team"]["name"] == "Seal Team"
call("priya", "POST", f"/challenges/{C1['slug']}/questions", {"question": "Will lab data be shared with registered teams?"})
qs = call("owner", "GET", f"/challenges/{C1['id']}/questions")
call("owner", "POST", f"/questions/{qs[0]['id']}/answer", {"answer": "Yes, weekly lab data is included."})
assert all(q["asked_by"] is None for q in call("anika", "GET", f"/challenges/{C1['slug']}/questions"))

section("Judge: queue, scoring workspace, submit review")
queue = call("judge1", "GET", "/me/review-queue")
todo = [a for a in queue["items"] if a["status"] != "SUBMITTED" and a["round_type"] == "METHODOLOGY"]
print(f"  judge1 queue: {queue['summary']}")
assert todo and queue["summary"]["overdue"] >= 1
other = next(a for a in call("judge2", "GET", "/me/review-queue")["items"])
call("judge1", "GET", f"/review-assignments/{other['id']}", expect=404, label="another judge's assignment")
call("rahim", "GET", f"/review-assignments/{todo[0]['id']}", expect=404)
for a in todo:
    ws = call("judge1", "GET", f"/review-assignments/{a['id']}")
    assert not ws["round"]["blind"] and ws["entity"]["entrant"] and ws["entity"]["code"].startswith("ENT-"), ws["entity"]
    criteria = ws["scorecard"]["criteria"]
    scores = [{"criterion_id": c["id"], "rating": 4, "comment": None} for c in criteria]
    call("judge1", "PUT", f"/review-assignments/{a['id']}/scores", {"scores": scores[:2]})
    call("judge1", "POST", f"/review-assignments/{a['id']}/actions/submit", {"scores": scores}, expect=422)
    scores[0] = {**scores[0], "rating": 5, "comment": None}
    body = {"scores": scores, "recommendation": "YES", "strengths": "Clear plan with owners.", "improvements": "Add a baseline."}
    call("judge1", "POST", f"/review-assignments/{a['id']}/actions/submit", body, expect=422, label="comment required at 5")
    scores[0]["comment"] = "Backed by three months of data."
    done = call("judge1", "POST", f"/review-assignments/{a['id']}/actions/submit", body)
    assert done["weighted_score"] == 85.0, done   # 5/5*25 + 4/5*75
    call("judge1", "PUT", f"/review-assignments/{a['id']}/scores", {"scores": scores}, expect=409)
j4 = [a for a in call("judge4", "GET", "/me/review-queue")["items"] if a["status"] != "SUBMITTED" and a["round_type"] == "METHODOLOGY"]
if j4:
    call("judge4", "POST", f"/review-assignments/{j4[0]['id']}/clarification", {"question": "Who will own the form after go-live?"})
    call("judge4", "POST", f"/review-assignments/{j4[0]['id']}/actions/declare-conflict", {"reason": "FAMILY", "note": "Relative on the team"})

section("Program owner: results, disagreement, shortlist override, confirm, publish (C2)")
mc2 = call("owner", "GET", f"/manage/challenges/{C2['id']}")
round2 = next(r for r in mc2["rounds"] if r["round_type"] == "METHODOLOGY")
call("owner", "POST", f"/review-rounds/{round2['id']}/actions/assign", expect=404, label="only the admin shares entries among judges")
call("admin", "POST", f"/review-rounds/{round2['id']}/actions/assign")
call("owner", "POST", f"/review-rounds/{round2['id']}/actions/remind")
res = call("owner", "GET", f"/review-rounds/{round2['id']}/results")
print("  blockers:", res["propose_blockers"])
call("owner", "POST", f"/review-rounds/{round2['id']}/shortlist/actions/propose", expect=400, label="blocked until reviews + disagreements done")
for row in res["results"]:
    if row["needs_discussion"]:
        call("owner", "POST", f"/round-results/{row['id']}/resolve-discussion", {"resolution": "SCORES_KEPT", "note": "Panel call: both views noted."})
for u in ("judge1", "judge2", "judge3", "judge4"):
    for a in call(u, "GET", "/me/review-queue")["items"]:
        if a["status"] == "SUBMITTED" or a["round_type"] != "METHODOLOGY":
            continue
        ws = call(u, "GET", f"/review-assignments/{a['id']}")
        scores = [{"criterion_id": c["id"], "rating": 3} for c in ws["scorecard"]["criteria"]]
        call(u, "POST", f"/review-assignments/{a['id']}/actions/submit",
             {"scores": scores, "recommendation": "MAYBE", "strengths": "Useful idea.", "improvements": "Needs numbers."})
for c in call("sadia", "GET", "/me/entries")["items"] + call("omar", "GET", "/me/entries")["items"]:
    pass
res = call("owner", "GET", f"/review-rounds/{round2['id']}/results")
for row in res["results"]:
    if row["needs_discussion"]:
        call("owner", "POST", f"/round-results/{row['id']}/resolve-discussion", {"resolution": "CHAIR_DECISION", "note": "Resolved by the chair."})
res = call("owner", "GET", f"/review-rounds/{round2['id']}/results")
assert res["can_propose"], res["propose_blockers"]
# One entry, one or many judges chosen by the admin - the same way as for an idea.
eid = res["results"][0]["entry"]["id"]
users = {u["full_name"]: u["id"] for u in call("owner", "GET", "/users?q=&limit=50")["items"]}
before = call("owner", "GET", f"/entries/{eid}/judges")
call("owner", "POST", f"/entries/{eid}/judges", {"user_ids": [users["Tahmina Begum"]]}, expect=404, label="only the admin chooses judges")
call("admin", "POST", f"/entries/{eid}/judges", {"user_ids": []}, expect=400, label="choose someone")
added = call("admin", "POST", f"/entries/{eid}/judges", {"user_ids": [users["Tahmina Begum"], users["Jahid Islam"]], "due_days": 7})
assert added["created"] == 2, added
after = call("owner", "GET", f"/entries/{eid}/judges")
assert after["total"] == before["total"] + 2 and not after["can_edit"]
assert any(x["id"] for x in call("finance", "GET", "/me/review-queue")["items"] if x["entity"]["id"] == eid)
call("admin", "DELETE", f"/entries/{eid}/judges/{users['Tahmina Begum']}")
call("admin", "DELETE", f"/entries/{eid}/judges/{users['Jahid Islam']}")
assert call("owner", "GET", f"/entries/{eid}/judges")["total"] == before["total"]
submitted = next((j for j in after["judges"] if j["status"] == "SUBMITTED"), None)
if submitted:
    call("admin", "DELETE", f"/entries/{eid}/judges/{submitted['user']['id']}", expect=409, label="submitted scores stay")
n_now = res["rule"]["top_n"]
call("judge1", "PATCH", f"/review-rounds/{round2['id']}/shortlist-rule", {"top_n": n_now}, expect=404, label="judges can't change the rule")
call("owner", "PATCH", f"/review-rounds/{round2['id']}/shortlist-rule", {"top_n": 0}, expect=422, label="Top N is at least 1")
assert call("owner", "PATCH", f"/review-rounds/{round2['id']}/shortlist-rule", {"top_n": n_now})["rule"]["top_n"] == n_now
sl = call("owner", "POST", f"/review-rounds/{round2['id']}/shortlist/actions/propose")
shortlist = call("owner", "GET", f"/shortlists/{sl['id']}")
print("  C2 shortlist:", shortlist["counts"], shortlist["rule"]["text"])

section("Shortlist manager on the seeded proposal (C3)")
mc3 = call("owner", "GET", f"/manage/challenges/{C3['id']}")
r3 = next(r for r in mc3["rounds"] if r["round_type"] == "METHODOLOGY")
s3 = call("owner", "GET", f"/shortlists/{r3['shortlist']['id']}")
assert s3["status"] == "PROPOSED" and s3["counts"] == {"IN": 3, "WAITLIST": 1, "OUT": 2}, s3["counts"]
wait = next(e for e in s3["entries"] if e["system_decision"] == "WAITLIST")
call("owner", "PATCH", f"/shortlists/{s3['id']}/entries/{wait['id']}", {"final_decision": "IN"}, expect=400, label="override needs a reason")
call("owner", "PATCH", f"/shortlists/{s3['id']}/entries/{wait['id']}", {"final_decision": "IN", "override_reason": "Strong safety value; panel vote 4–1"})
call("owner", "PATCH", f"/shortlists/{s3['id']}/entries/{wait['id']}", {"prototype_required": True, "prototype_reason": "high technical risk"})
call("executive", "PATCH", f"/shortlists/{s3['id']}/entries/{wait['id']}", {"final_decision": "OUT", "override_reason": "x"}, expect=404)
call("owner", "POST", f"/shortlists/{s3['id']}/actions/publish", expect=409, label="must confirm first")
call("owner", "POST", f"/shortlists/{s3['id']}/actions/confirm")
call("owner", "PATCH", f"/shortlists/{s3['id']}/entries/{wait['id']}", {"final_decision": "OUT", "override_reason": "late"}, expect=409)
fb = call("owner", "GET", f"/review-rounds/{r3['id']}/feedback")
call("owner", "PUT", f"/feedback/{fb['items'][0]['id']}", {"strengths": "• Clear numbers", "improvements": "• Add a rollout plan", "next_steps": "Start your build plan."})
call("owner", "POST", f"/shortlists/{s3['id']}/actions/publish")
omar = next(e for e in call("omar", "GET", "/me/entries")["items"] if e["challenge"]["id"] == C3["id"])
priya3 = next(e for e in call("priya", "GET", "/me/entries")["items"] if e["challenge"]["id"] == C3["id"])
tanvir3 = next(e for e in call("tanvir", "GET", "/me/entries")["items"] if e["challenge"]["id"] == C3["id"])
print("  C3 statuses:", omar["status_code"], tanvir3["status_code"], priya3["status_code"])
assert omar["status_code"] == "SHORTLISTED" and priya3["status_code"] == "NOT_SHORTLISTED"
f = call("priya", "GET", f"/entries/{priya3['id']}/feedback")["items"][0]
assert f["decision_code"] == "NOT_SHORTLISTED" and f["strengths"] and f["criterion_scores"], f
call("priya", "POST", "/appeals", {"feedback_id": f["id"], "reason": "short"}, expect=400)
call("priya", "POST", "/appeals", {"feedback_id": f["id"], "reason": "Only two of the three judges had scored when the result was published."})
ap = call("owner", "GET", "/appeals")
call("owner", "POST", f"/appeals/{ap[0]['id']}/actions/decide", {"status": "DISMISSED", "decision_note": "All three reviews were in before confirmation."})

section("Build phase: shortlisted entry, milestones, prototype (C4)")
r4 = next(e for e in rahim_entries if e["challenge"]["id"] == C4["id"])
d4 = call("rahim", "GET", f"/entries/{r4['id']}")
assert d4["status_code"] == "SHORTLISTED" and d4["prototype_required"] and d4["show_shortlist_moment"], d4["status_code"]
assert not call("rahim", "GET", f"/entries/{r4['id']}")["show_shortlist_moment"], "moment shown once"
call("rahim", "POST", "/milestones", {"entity_id": r4["id"], "title": "Checklist agreed with supervisors", "due_date": "2026-11-01"})
ms = call("rahim", "GET", f"/milestones?entity_type=challenge_entry&entity_id={r4['id']}")
call("rahim", "PATCH", f"/milestones/{ms['milestones'][0]['id']}", {"status": "DONE"})
call("rahim", "POST", "/progress-updates", {"entity_id": r4["id"], "update_text": "Checklist agreed.", "percent_complete": 20})
proto = call("rahim", "GET", f"/entries/{r4['id']}/submissions/prototype")
assert proto["can_edit"], proto["read_only_reason"]
call("rahim", "POST", f"/entries/{r4['id']}/submissions/prototype/actions/submit",
     {"content": {"what_built": "Phone checklist working offline.", "results_so_far": "Used on 12 handovers."}})
# Demo review of an entry: submit the demo link + how to use it, the admin chooses judges, approval makes it eligible for the pilot.
call("rahim", "PUT", f"/gates/challenge_entry/{r4['id']}/PILOT", {"content": {"summary": "x", "results": "y"}, "submit": True}, expect=409,
     label="the pilot form opens only after the demo is approved")
eg = call("rahim", "PUT", f"/gates/challenge_entry/{r4['id']}/PROTOTYPE",
          {"content": {"link": "https://demo.example.org/handover", "how_to_use": "**Open** the link, then:\n- tap Start\n- scan a tag"}, "submit": True})
assert eg["status"] == "SUBMITTED"
call("admin", "POST", f"/gates/{eg['id']}/send-for-review", {"user_ids": []}, expect=422, label="judges are chosen first")
panel = [u["id"] for u in call("admin", "GET", f"/gates/challenge_entry/{r4['id']}")["stages"][0]["suggested_judges"]]
assert panel, "the challenge judges are suggested"
ov0 = call("admin", "GET", f"/gates/challenge_entry/{r4['id']}")["stages"][0]
assert ov0["scored"] and ov0["deadline"], "the demo is scored and has a deadline"
call("admin", "POST", f"/gates/{eg['id']}/send-for-review", {"user_ids": panel})
call("admin", "POST", f"/gates/{eg['id']}/decide", {"decision": "APPROVE", "note": "Works well for the handover team."}, expect=409,
     label="judges give a score and comment; the shortlist decides")
# The judges score the demo (score + comment), then the second shortlist (top N) makes the finalists.
pr4 = next(r for r in call("owner", "GET", f"/manage/challenges/{C4['id']}")["rounds"] if r["round_type"] == "PROTOTYPE")
scored = 0
for u in ("judge1", "judge2", "judge3", "judge4"):
    for a_ in call(u, "GET", "/me/review-queue")["items"]:
        if a_.get("gate") or a_["status"] == "SUBMITTED" or a_["round_type"] != "PROTOTYPE" or a_["entity"]["id"] != r4["id"]:
            continue
        w_ = call(u, "GET", f"/review-assignments/{a_['id']}")
        assert w_["submission"]["content"]["link"] == "https://demo.example.org/handover", "the judge sees the demo link"
        call(u, "POST", f"/review-assignments/{a_['id']}/actions/submit",
             {"scores": [{"criterion_id": c["id"], "rating": 4} for c in w_["scorecard"]["criteria"]], "recommendation": "YES",
              "strengths": "Works as described.", "improvements": "Add an offline mode."})
        scored += 1
assert scored >= 1, "the chosen judges had the demo in My judging"
sl4 = call("owner", "POST", f"/review-rounds/{pr4['id']}/shortlist/actions/propose")
call("owner", "POST", f"/shortlists/{sl4['id']}/actions/confirm")
call("owner", "POST", f"/shortlists/{sl4['id']}/actions/publish")
assert call("rahim", "GET", f"/entries/{r4['id']}")["status_code"] == "FINALIST"
# Presentation: the finalist proposes a time inside the final-submission period; the admin accepts or suggests another.
pres = call("rahim", "GET", f"/entries/{r4['id']}/presentation")
assert pres["can_propose"] and pres["window"]["opens_at"], pres
from datetime import datetime, timedelta
w_open = datetime.fromisoformat(pres["window"]["opens_at"].replace("Z", ""))
w_close = datetime.fromisoformat(pres["window"]["closes_at"].replace("Z", ""))
future = max(w_open, datetime.utcnow() + timedelta(days=1)) + timedelta(hours=1)
call("rahim", "POST", f"/entries/{r4['id']}/presentation", {"proposed_at": (w_close + timedelta(days=3)).isoformat()}, expect=422, label="outside the period")
if future < w_close:
    pr = call("rahim", "POST", f"/entries/{r4['id']}/presentation", {"proposed_at": future.isoformat(), "note": "After the morning shift."})
    call("rahim", "POST", f"/presentation-requests/{pr['id']}/accept", expect=404, label="only the admin accepts")
    call("admin", "POST", f"/presentation-requests/{pr['id']}/suggest", {"suggested_at": (w_close + timedelta(days=3)).isoformat()}, expect=422)
    other = min(future + timedelta(hours=3), w_close)
    call("admin", "POST", f"/presentation-requests/{pr['id']}/suggest", {"suggested_at": other.isoformat(), "note": "Room is busy then."})
    assert call("rahim", "GET", f"/entries/{r4['id']}/presentation")["can_accept_suggestion"]
    call("rahim", "POST", f"/presentation-requests/{pr['id']}/accept-suggestion")
    done = call("admin", "GET", f"/entries/{r4['id']}/presentation")
    assert done["scheduled_at"], "the time is confirmed"
    pr2 = call("rahim", "POST", f"/entries/{r4['id']}/presentation", {"proposed_at": future.isoformat()})
    call("admin", "POST", f"/presentation-requests/{pr2['id']}/accept")
    ov4 = call("owner", "GET", f"/manage/challenges/{C4['id']}/presentations")
    assert any(i["current"] and i["current"]["status"] == "ACCEPTED" for i in ov4["items"])
else:
    print("  (final-submission window already over for this demo challenge: scheduling accept path skipped)")
ov = call("rahim", "GET", f"/gates/challenge_entry/{r4['id']}")
assert [x["stage"] for x in ov["stages"]] == ["PROTOTYPE", "PILOT"] and ov["stages"][1]["can_edit"], "eligible for the pilot"
eg2 = call("rahim", "PUT", f"/gates/challenge_entry/{r4['id']}/PILOT",
           {"content": {"summary": "Two shifts for two weeks.", "results": "Handover misses down 40%."}, "submit": True})
call("admin", "POST", f"/gates/{eg2['id']}/send-for-review", {"user_ids": panel})
call("admin", "POST", f"/gates/{eg2['id']}/decide", {"decision": "APPROVE", "note": "Results are clear and measured."})
assert call("rahim", "GET", f"/entries/{r4['id']}")["status_code"] == "FINALIST"
# Final stage: the finalist presents live; the admin records the panel's score and result, and it shows in the system.
res4 = call("admin", "GET", f"/manage/challenges/{C4['id']}/results")
row4 = next(x for x in res4["entries"] if x["entry_id"] == r4["id"])
assert row4["has_working_evidence"] and row4["demo_status"] == "APPROVED", "an approved demo counts as working evidence"
call("admin", "PUT", f"/manage/challenges/{C4['id']}/results/decisions",
     {"decisions": [{"entry_id": r4["id"], "rank": 1, "result": "WINNER", "presentation_score": 140}]}, expect=422, label="score is 0-100")
call("admin", "PUT", f"/manage/challenges/{C4['id']}/results/decisions",
     {"decisions": [{"entry_id": r4["id"], "rank": 1, "result": "WINNER", "presentation_score": 91.5,
                     "decision_note": "Clear live demo; handover time cut in half."}]})
row4 = next(x for x in call("admin", "GET", f"/manage/challenges/{C4['id']}/results")["entries"] if x["entry_id"] == r4["id"])
assert row4["decision"]["presentation_score"] == 91.5
call("admin", "POST", f"/manage/challenges/{C4['id']}/results/actions/approve")
call("admin", "POST", f"/manage/challenges/{C4['id']}/results/actions/publish")
pub = next(c for c in call("rahim", "GET", "/results")["challenges"] if c["id"] == C4["id"])
assert pub["winners"][0]["score"] == 91.5 and pub["winners"][0]["jury_note"], "the final output shows in the system"
fbk = call("rahim", "GET", f"/entries/{r4['id']}/feedback")["items"]
assert fbk and fbk[0]["decision_code"] == "WINNER" and fbk[0]["score_shared"] == 91.5, fbk
jf = call("admin", "GET", f"/judge-feedback/challenge_entry/{r4['id']}")
assert len(jf["gates"]) == 2 and jf["rounds"], "judge feedback shows scores and the demo and pilot decisions"
omar4 = next(e for e in call("omar", "GET", "/me/entries")["items"] if e["challenge"]["id"] == C4["id"])
call("omar", "POST", "/milestones", {"entity_id": omar4["id"], "title": "x"}, expect=409)
assert not call("omar", "GET", f"/entries/{omar4['id']}/submissions/prototype")["can_edit"]

section("Finalist: demo booking, final submission; jury; results decision, approve, publish (C5)")
aqua = next(e for e in call("nusrat", "GET", "/me/entries")["items"] if e["challenge"]["id"] == C5["id"])
demo = call("nusrat", "GET", f"/entries/{aqua['id']}/demo")
free = [s for s in demo["slots"] if s["available"]]
assert demo["can_book"] and len(free) == 5 and all("entry" not in s for s in demo["slots"])
taken = next(s for s in demo["slots"] if not s["available"])
call("nusrat", "POST", f"/entries/{aqua['id']}/demo/slots/{taken['id']}/book", expect=409)
call("nusrat", "POST", f"/entries/{aqua['id']}/demo/slots/{free[0]['id']}/book")
call("sadia", "POST", f"/entries/{aqua['id']}/submissions/final/actions/submit",
     {"content": {"solution_summary": "Rinse loop live on two machines.", "results": "110 → 88 litres per kg.", "pilot_plan": "Dye house 2, eight weeks."}})
mc5 = call("owner", "GET", f"/manage/challenges/{C5['id']}")
jury = next(r for r in mc5["rounds"] if r["round_type"] == "FINAL_JURY")
assign = call("admin", "POST", f"/review-rounds/{jury['id']}/actions/assign")
print("  jury assign:", {k: v for k, v in assign.items() if k != "exclusions"}, "exclusions:", len(assign["exclusions"]))
for u in ("judge1", "judge2", "judge3", "judge4"):
    for a in call(u, "GET", "/me/review-queue")["items"]:
        if a["status"] == "SUBMITTED":
            continue
        ws = call(u, "GET", f"/review-assignments/{a['id']}")
        scores = [{"criterion_id": c["id"], "rating": 4} for c in ws["scorecard"]["criteria"]]
        call(u, "POST", f"/review-assignments/{a['id']}/actions/submit",
             {"scores": scores, "recommendation": "YES", "strengths": "Works in the dye house.", "improvements": "Plan the rollout."})
work = call("owner", "GET", f"/manage/challenges/{C5['id']}/results")
assert work["pending_reviews"] == 0 and len(work["entries"]) == 3, (work["pending_reviews"], len(work["entries"]))
ranked = work["entries"]
call("owner", "POST", f"/manage/challenges/{C5['id']}/results/actions/approve", expect=409)
call("owner", "PUT", f"/manage/challenges/{C5['id']}/results/decisions", {"decisions": [
    {"entry_id": ranked[0]["entry_id"], "rank": 1, "result": "WINNER", "award_category_id": work["award_categories"][0]["id"], "decision_note": "Best measured result."},
    {"entry_id": ranked[1]["entry_id"], "rank": 2, "result": "RUNNER_UP"}]})
call("owner", "POST", f"/manage/challenges/{C5['id']}/results/actions/publish", expect=409, label="approval first")
call("owner", "POST", f"/manage/challenges/{C5['id']}/results/actions/approve")
call("owner", "POST", f"/manage/challenges/{C5['id']}/results/actions/publish")
pub = call("anika", "GET", "/results")
water = next(c for c in pub["challenges"] if c["id"] == C5["id"])
assert len(water["winners"]) == 2 and len(pub["challenges"]) == 3, "only winners are listed"
winner_entry = ranked[0]["entry_id"]
conv = call("owner", "POST", f"/entries/{winner_entry}/actions/convert-to-initiative")
print("  winner converted to", conv["code"])
call("owner", "POST", f"/entries/{winner_entry}/actions/convert-to-initiative", expect=409)

section("Open idea: draft, submit, triage, review, clarification, decision")
draft = call("anika", "POST", "/initiatives", {"title": "Fabric offcut exchange"})
call("anika", "POST", f"/initiatives/{draft['id']}/actions/submit", expect=422)
cats = call("anika", "GET", "/categories")
me = call("anika", "GET", "/me")
call("anika", "PATCH", f"/initiatives/{draft['id']}", {
    "problem_statement": "Cutting rooms throw away about 6% of fabric as offcuts.", "current_process": "Offcuts are sold as waste by weight.",
    "proposed_solution": "List offcuts by size so sample rooms can reuse them.", "category_id": cats[0]["id"], "innovation_type_code": "PROCESS_IMPROVEMENT",
    "expected_benefit": "Lower sample fabric cost.", "primary_kpi": "Sample fabric cost per month", "scalability_level_code": "BUSINESS",
    "data_classification_code": "INTERNAL", "expected_timeline": "Prototype in 4 weeks", "declaration_accepted": True,
    "risk_flags": ["NONE"], "benefit_types": ["COST_SAVING"], "org_unit_id": me["org_unit"]["id"]})
sub = call("anika", "POST", f"/initiatives/{draft['id']}/actions/submit")
code = sub["code"]
assert code.startswith("INNO-") and len(code) == 16, code
call("anika", "PATCH", f"/initiatives/{code}", {"title": "changed"}, expect=409, label="locked after submit")
call("anika", "POST", f"/initiatives/{code}/actions/start_triage", {}, expect=404, label="owner can't triage")
call("owner", "POST", f"/initiatives/{code}/actions/start_triage", {})
call("owner", "POST", f"/initiatives/{code}/actions/send_to_review", {})
users = {u["full_name"]: u["id"] for u in call("owner", "GET", "/users?q=&limit=50")["items"]}
call("owner", "POST", f"/initiatives/{code}/judges", {"user_ids": [users["Dr. Kamal Hossain"]]}, expect=404, label="only the admin chooses judges")
ar = call("admin", "POST", f"/initiatives/{code}/assign-reviewers", {"user_ids": [users["Dr. Kamal Hossain"], users["Rezaul Karim"]], "due_days": 7})
assert ar["created"] == 2
call("owner", "POST", f"/initiatives/{code}/clarifications", {"question": "How many kg of offcuts per week?"})
d = call("anika", "GET", f"/initiatives/{code}")
assert d["current_state_code"] == "CLARIFICATION_REQUESTED" and "reviews" not in d
call("anika", "POST", f"/clarifications/{d['clarifications'][0]['id']}/answer", {"answer": "About 300 kg per week across two floors."})
a = next(x for x in call("judge1", "GET", "/me/review-queue")["items"] if x["entity"]["code"] == code)
ws = call("judge1", "GET", f"/review-assignments/{a['id']}")
call("judge1", "POST", f"/review-assignments/{a['id']}/actions/submit", {
    "scores": [{"criterion_id": c["id"], "rating": 4} for c in ws["scorecard"]["criteria"]],
    "recommendation": "YES", "strengths": "Simple and cheap.", "improvements": "Measure the baseline."})
call("owner", "POST", f"/initiatives/{code}/actions/shortlist", {}, expect=400, label="comment required")
call("owner", "POST", f"/initiatives/{code}/actions/shortlist", {"comment": "Simple, cheap and reusable in all cutting rooms."})
call("owner", "POST", f"/initiatives/{code}/actions/start_prototype", {})
# Prototype review: the candidate sends a form (link + how to use it); judges approve, send back or reject. No score.
call("anika", "POST", f"/initiatives/{code}/actions/request_demo", {}, expect=409, label="decided in the prototype review")
call("anika", "PUT", f"/gates/initiative/{code}/PROTOTYPE", {"content": {"link": "no-scheme.example"}, "submit": True}, expect=422,
     label="link and how-to-use are checked")
gate = call("anika", "PUT", f"/gates/initiative/{code}/PROTOTYPE",
            {"content": {"link": "https://demo.example.org/fabric", "how_to_use": "Open the link and press Start."}, "submit": True})
assert gate["status"] == "SUBMITTED" and call("anika", "GET", f"/initiatives/{code}")["current_state_code"] == "DEMO_VALIDATION"
assert not any(x.get("gate") and x["entity"]["code"] == code for x in call("judge1", "GET", "/me/review-queue")["items"]), "judges see it only after it is sent"
call("owner", "POST", f"/gates/{gate['id']}/send-for-review", {"user_ids": [users["Shirin Sultana"]]}, expect=404, label="only the admin sends it for review")
call("admin", "POST", f"/gates/{gate['id']}/send-for-review", {"user_ids": []}, expect=422, label="at least one judge is needed")
suggested = [u["id"] for u in call("admin", "GET", f"/gates/initiative/{code}")["stages"][0]["suggested_judges"]]
assert suggested, "the people who judged the idea before are suggested"
sent = call("admin", "POST", f"/gates/{gate['id']}/send-for-review", {"user_ids": suggested + [users["Shirin Sultana"]]})
assert sent["status"] == "IN_REVIEW"
call("admin", "POST", f"/gates/{gate['id']}/send-for-review", {"user_ids": []}, expect=409, label="already sent")
call("owner", "POST", f"/initiatives/{code}/actions/approve_pilot", {}, expect=409, label="judges decide, not a button")


def decide(judge, decision, feedback=""):
    item = next(x for x in call(judge, "GET", "/me/review-queue")["items"] if x.get("gate") and x["entity"]["code"] == code and x["status"] == "ASSIGNED")
    assert call(judge, "GET", f"/gate-votes/{item['id']}")["can_decide"]
    return call(judge, "POST", f"/gate-votes/{item['id']}", {"decision": decision, "feedback": feedback})


call("judge1", "POST", "/gate-votes/not-a-real-id", {"decision": "APPROVE"}, expect=404)
assert decide("judge1", "REVISE", "Add a short user guide.")["status"] == "IN_REVIEW"
assert decide("judge2", "REVISE", "The link needs a login; share test access.")["status"] == "CHANGES_REQUESTED", "most judges sent it back"
seen = call("anika", "GET", f"/gates/initiative/{code}")["stages"][0]
assert seen["can_edit"] and all(f["judge"] is None for f in seen["gate"]["feedback"]), "candidate sees feedback without judge names"
assert call("anika", "GET", f"/initiatives/{code}")["current_state_code"] == "PROTOTYPE"
call("anika", "PUT", f"/gates/initiative/{code}/PROTOTYPE",
     {"content": {"link": "https://demo.example.org/fabric", "how_to_use": "Guide added. Sign in as guest / guest."}, "submit": True})
resent = call("admin", "GET", f"/gates/initiative/{code}")["stages"][0]
assert resent["gate"]["status"] == "SUBMITTED" and resent["gate"]["round_no"] == 2, "a new round waits for the admin again"
call("admin", "POST", f"/gates/{resent['gate']['id']}/send-for-review", {"user_ids": []})   # the same judges carry over
decide("judge1", "APPROVE")
assert decide("judge4", "APPROVE", "Works well.")["status"] == "APPROVED", "most judges approved"
assert call("anika", "GET", f"/initiatives/{code}")["current_state_code"] == "PILOT"
call("owner", "POST", f"/initiatives/{code}/actions/go_live", {}, expect=409, label="pilot review comes first")
# Pilot review: a short report, the same judges, and the admin can make the final call.
pilot = call("anika", "PUT", f"/gates/initiative/{code}/PILOT",
             {"content": {"summary": "Two cutting rooms for three weeks.", "results": "Sample fabric cost down 22%."}, "submit": True})
assert pilot["status"] == "SUBMITTED"
call("admin", "POST", f"/gates/{pilot['id']}/send-for-review", {"user_ids": [users["Shirin Sultana"]]})
fb = call("admin", "GET", f"/judge-feedback/initiative/{code}")
assert fb["gates"] and any(j["feedback"] for g in fb["gates"] for j in g["judges"]), "staff see each judge's feedback"
call("anika", "GET", f"/judge-feedback/initiative/{code}", expect=404, label="candidates can't read judge feedback")
call("owner", "POST", f"/gates/{pilot['id']}/decide", {"decision": "APPROVE", "note": "Results beat the target."}, expect=404)
call("admin", "POST", f"/gates/{pilot['id']}/decide", {"decision": "APPROVE", "note": ""}, expect=422, label="final call needs a reason")
assert call("admin", "POST", f"/gates/{pilot['id']}/decide", {"decision": "APPROVE", "note": "Results beat the target in both rooms."})["status"] == "APPROVED"
assert len(call("admin", "GET", "/admin/gates")["items"]) >= 2
call("owner", "PATCH", f"/initiatives/{code}", {"sponsor_user_id": users["Nasrin Ahmed"]})
iid = call("anika", "GET", f"/initiatives/{code}")["id"]
k = call("anika", "POST", "/kpis", {"entity_id": iid, "name": "Sample fabric cost", "unit_code": "BDT", "baseline_value": 400000, "target_value": 300000})
call("owner", "POST", f"/initiatives/{code}/actions/go_live", {}, expect=409, label="needs a measurement")
call("anika", "POST", f"/kpis/{k['id']}/measurements", {"measured_value": 310000, "note": "October"})
call("owner", "POST", f"/initiatives/{code}/actions/go_live", {})
call("owner", "POST", f"/initiatives/{code}/actions/verify_impact", {}, expect=409, label="needs a verified measurement")
# Nobody is picked automatically: the admin chooses the verifier, and it then shows in that person's judging panel.
assert not any(x["initiative"]["code"] == code for x in call("finance", "GET", "/impact")["verify_queue"]), "not assigned yet"
m = next(x for x in call("admin", "GET", "/impact")["verify_queue"] if x["initiative"]["code"] == code)
mid = m["measurement"]["id"]
call("finance", "POST", f"/measurements/{mid}/verify", {"status": "VERIFIED"}, expect=404, label="only the chosen verifier")
call("owner", "POST", f"/measurements/{mid}/verifier", {"user_id": users["Jahid Islam"]}, expect=404, label="only the admin chooses")
call("admin", "POST", f"/measurements/{mid}/verifier", {"user_id": users["Tahmina Begum"]})
call("admin", "POST", f"/measurements/{mid}/verifier", {"user_id": users["Jahid Islam"]})   # changed her mind
call("admin", "POST", f"/measurements/{mid}/verifier", {"user_id": users["Anika Tabassum"]}, expect=422, label="not the owner")
assert not any(x.get("kpi") for x in call("hr", "GET", "/me/review-queue")["items"]), "the first choice no longer sees it"
mine = [x for x in call("finance", "GET", "/me/review-queue")["items"] if x.get("kpi") and x["id"] == mid]
assert mine and mine[0]["status"] == "ASSIGNED", "it shows in the verifier's judging panel"
assert call("finance", "GET", f"/kpi-verifications/{mid}")["can_decide"]
call("hr", "GET", f"/kpi-verifications/{mid}", expect=404)
call("anika", "POST", f"/measurements/{mid}/verify", {"status": "VERIFIED"}, expect=404)
call("finance", "POST", f"/measurements/{mid}/verify", {"status": "ADJUSTED", "verification_type": "FINANCE"}, expect=400)
call("finance", "POST", f"/measurements/{mid}/verify",
     {"status": "ADJUSTED", "verification_type": "FINANCE", "verified_value": 320000, "note": "Excluded one-off stock sale."})
call("finance", "POST", f"/initiatives/{code}/actions/verify_impact", {})
call("owner", "POST", f"/initiatives/{code}/catalogue", {"asset_type": "PROCESS", "impact_summary": "BDT 80,000 saved per month."})
hist = call("anika", "GET", f"/initiatives/{code}/history")
print(f"  {code}: {len(hist)} history rows, final state {call('anika', 'GET', f'/initiatives/{code}')['current_state_code']}")
assert any(i["innovation_id"] == code for i in call("rahim", "GET", "/catalogue/assets")["items"])
assert raw("GET", "/exports/initiatives", login("executive"))[0] == 200
call("rahim", "GET", "/exports/initiatives", expect=404)

section("Sign-up, invitations and the admin panel")
opts = call(None, "GET", "/auth/signup-options")
assert opts["signup_enabled"] and opts["org_units"]
call(None, "POST", "/auth/signup", {"full_name": "Al", "email": "bad", "password": "123"}, expect=422)
call(None, "POST", "/auth/signup", {"full_name": "Dup User", "email": f"rahim@{DOMAIN}", "password": "Passw0rd!x"}, expect=409)
su = call(None, "POST", "/auth/signup", {"full_name": "Nadia Rahman", "email": "nadia.rahman@example.org", "password": "Passw0rd!x",
                                         "job_title": "Shift Engineer", "org_unit_id": opts["org_units"][-1]["id"]})
assert su["user"]["roles"] == ["EMPLOYEE"], su["user"]["roles"]
tokens["__nadia"] = su["access_token"]
status, _ = raw("GET", "/admin/users", su["access_token"])
assert status == 404, "a new employee has no admin access"
for u in ("admin", "dmd"):
    for path in ("/admin/overview", "/admin/invitations", "/admin/privileges", "/admin/users", "/settings", "/audit-logs",
                 "/manage/challenges", "/me/review-queue", "/dashboards/executive", "/dashboards/program", "/submissions"):
        call(u, "GET", path, label="full access")
for u in ("owner", "executive", "judge1", "rahim"):
    call(u, "GET", "/admin/invitations", expect=404)
    call(u, "POST", "/admin/invitations", {"email": "x@example.org", "role_codes": ["JUDGE"]}, expect=404)
call("admin", "POST", "/admin/invitations", {"email": "x@example.org", "role_codes": ["EMPLOYEE"]}, expect=400)
call("admin", "POST", "/admin/invitations", {"email": f"rahim@{DOMAIN}", "role_codes": ["JUDGE"]}, expect=409)
inv = call("admin", "POST", "/admin/invitations", {"email": "new.judge@example.org", "full_name": "Selina Hayat", "role_codes": ["JUDGE"],
                                                   "message": "Please join the panel for the energy challenge."})
tok = inv["invite_url"].split("invite=")[1]
shown = call(None, "GET", f"/auth/signup-options?invite={tok}")["invitation"]
assert shown["valid"] and shown["email"] == "new.judge@example.org" and shown["roles"] == ["Judge"], shown
call(None, "POST", "/auth/signup", {"full_name": "Selina Hayat", "email": "someone.else@example.org", "password": "Passw0rd!x",
                                    "invite_token": tok}, expect=422, label="invite is tied to the email")
sj = call(None, "POST", "/auth/signup", {"full_name": "Selina Hayat", "email": "new.judge@example.org", "password": "Passw0rd!x", "invite_token": tok})
assert "JUDGE" in sj["user"]["roles"], sj["user"]["roles"]
assert raw("GET", "/me/review-queue", sj["access_token"])[0] == 200
call(None, "POST", "/auth/signup", {"full_name": "Again", "email": "new.judge2@example.org", "password": "Passw0rd!x", "invite_token": tok},
     expect=400, label="invite works once")
inv2 = call("dmd", "POST", "/admin/invitations", {"email": "new.owner@example.org", "role_codes": ["PROGRAM_OWNER"]})
call("dmd", "POST", f"/admin/invitations/{inv2['id']}/actions/revoke")
assert not call(None, "GET", "/auth/signup-options?invite=" + inv2["invite_url"].split("invite=")[1])["invitation"]["valid"]
re2 = call("admin", "POST", f"/admin/invitations/{inv2['id']}/actions/resend")
assert call(None, "GET", "/auth/signup-options?invite=" + re2["invite_url"].split("invite=")[1])["invitation"]["valid"]
priv = call("admin", "GET", "/admin/privileges")
hr = next(r for r in priv["roles"] if r["code"] == "HR")
call("admin", "PUT", "/admin/privileges/SUPER_ADMIN", {"permissions": []}, expect=400, label="locked role")
call("admin", "PUT", "/admin/privileges/HR", {"permissions": hr["permissions"] + ["impact.verify"]})
tokens.pop("hr", None)
assert "impact.verify" in call("hr", "GET", "/me")["permissions"]
call("admin", "PUT", "/admin/privileges/HR", {"permissions": hr["permissions"]})
nadia_id = su["user"]["id"]
call("admin", "PATCH", f"/admin/users/{nadia_id}", {"is_active": False})
assert raw("GET", "/me", su["access_token"])[0] == 401, "a deactivated account is signed out"
assert raw("POST", "/auth/login", body={"email": "nadia.rahman@example.org", "password": "Passw0rd!x"})[0] == 401
call("admin", "PATCH", f"/admin/users/{nadia_id}", {"is_active": True, "new_password": "NewPassw0rd!"})
assert raw("POST", "/auth/login", body={"email": "nadia.rahman@example.org", "password": "NewPassw0rd!"})[0] == 200
admin_id = call("admin", "GET", "/me")["id"]
call("admin", "PATCH", f"/admin/users/{admin_id}", {"is_active": False}, expect=400, label="can't deactivate yourself")

section("Super admin: roles, settings, scoring weights, audit")
anika_id = call("anika", "GET", "/me")["id"]
ra = call("admin", "POST", "/admin/role-assignments", {"user_id": anika_id, "role": "JUDGE", "scope_type": "CHALLENGE", "scope_id": C1["id"]})
tokens.pop("anika")
assert "JUDGE" in call("anika", "GET", "/me")["roles"]
call("admin", "DELETE", f"/admin/role-assignments/{ra['id']}")
call("admin", "POST", "/admin/role-assignments", {"user_id": anika_id, "role": "EMPLOYEE"}, expect=400, label="fixed role list")
admins = [a for u in call("admin", "GET", "/admin/users")["items"] for a in u["assignments"] if a["role"] == "SUPER_ADMIN"]
call("admin", "DELETE", f"/admin/role-assignments/{admins[0]['id']}", expect=400, label="last super admin")
call("admin", "PATCH", "/settings/designated_reviewer_mailbox", {"value": "new.office@anwargroup.example"})
call("admin", "PATCH", "/feature-flags/PEOPLES_CHOICE", {"is_enabled": True})
cards = call("owner", "GET", "/scorecards")
card = cards[0]
crit = [{"id": c["id"], "name": c["name"], "guidance": c["guidance"], "weight_pct": c["weight_pct"], "min_rating": c["min_rating"],
         "is_tie_breaker": c["is_tie_breaker"]} for c in card["criteria"]]
crit[0]["weight_pct"] += 5
call("owner", "PUT", f"/scorecards/{card['id']}/criteria", {"criteria": crit}, expect=400, label="weights must total 100")
crit[1]["weight_pct"] -= 5
call("owner", "PUT", f"/scorecards/{card['id']}/criteria", {"criteria": crit})
tpl = call("admin", "GET", "/notification-templates")[0]
call("admin", "PUT", f"/notification-templates/{tpl['id']}", {"subject_template": tpl["subject_template"] + " ✓", "body_template": tpl["body_template"]})
logs = call("admin", "GET", "/audit-logs?action=CONFIG_CHANGE")
assert logs["total"] >= 5
failed_mail = call("admin", "GET", "/notification-deliveries?status=FAILED")["items"]
if failed_mail:
    call("admin", "POST", f"/notification-deliveries/{failed_mail[0]['id']}/retry")

section("Challenge builder: draft, checklist, publish")
forms, scs = call("owner", "GET", "/forms"), call("owner", "GET", "/scorecards")
import datetime as _dt
now = _dt.datetime.now(_dt.timezone.utc)
iso = lambda d: (now + _dt.timedelta(days=d)).isoformat()   # noqa: E731
payload = {"title": "Reduce dust at the packing line", "domain_id": call("owner", "GET", "/domains")[0]["id"],
           "problem_statement": "Dust levels are above target at the packing line.", "expected_outcome": "Dust below the limit.",
           "phases": [{"phase_type": "REGISTRATION", "opens_at": iso(-1), "closes_at": iso(10)},
                      {"phase_type": "METHODOLOGY", "opens_at": iso(2), "closes_at": iso(20)},
                      {"phase_type": "METHODOLOGY_REVIEW", "opens_at": iso(20), "closes_at": iso(30)},
                      {"phase_type": "SHORTLIST", "opens_at": iso(30), "closes_at": iso(33)}],
           "methodology_form_id": next(f["id"] for f in forms if f["purpose"] == "METHODOLOGY"),
           "methodology_scorecard_id": scs[0]["id"], "final_scorecard_id": scs[-1]["id"], "judge_user_ids": [users["Dr. Kamal Hossain"]],
           "prizes": [{"rank_from": 1, "rank_to": 1, "description": "Winner", "amount": 100000}]}
new = call("owner", "POST", "/challenges", payload)
call("anika", "GET", f"/challenges/{new['slug']}", expect=404, label="drafts are hidden")
# Publishing does not wait for judges: the admin chooses them on the Judges tab, at any time.
assert call("owner", "POST", f"/challenges/{new['id']}/actions/publish")["status_code"] == "OPEN_FOR_REGISTRATION"
assert call("owner", "GET", f"/challenges/{new['id']}/judges")["judges"] == [], "the builder no longer sets judges"
call("owner", "POST", f"/challenges/{new['id']}/judges", {"user_ids": [users["Dr. Kamal Hossain"]]}, expect=404, label="only the admin chooses judges")
# Anyone can be chosen (no Judge role needed), for all stages or only some; people without an account are invited by email.
jr = call("admin", "POST", f"/challenges/{new['id']}/judges",
          {"user_ids": [users["Dr. Kamal Hossain"], users["Anika Tabassum"]], "emails": "guest.judge@example.org", "stages": ["METHODOLOGY"]})
assert len(jr["added"]) == 2 and len(jr["invited"]) == 1, jr
jl = call("admin", "GET", f"/challenges/{new['id']}/judges")
assert all(j["stages"] == ["METHODOLOGY"] for j in jl["judges"]) and len(jl["invites"]) == 1, jl
assert call("anika", "GET", "/me")["is_judge"] is True
call("anika", "GET", "/me/review-queue")
call("admin", "PATCH", f"/challenges/{new['id']}/judges/{users['Anika Tabassum']}", {"stages": []})
call("admin", "DELETE", f"/challenges/{new['id']}/judges/{users['Anika Tabassum']}")
assert call("anika", "GET", "/me")["is_judge"] is False
call("admin", "DELETE", f"/judge-invites/{jl['invites'][0]['id']}")
call("anika", "GET", f"/challenges/{new['slug']}")
call("owner", "POST", f"/challenges/{new['id']}/actions/extend-deadline", {"phase_type": "REGISTRATION", "new_closes_at": iso(12), "reason": "Plant shutdown week"})
call("owner", "POST", f"/challenges/{new['id']}/actions/announce", {"message": "Data set updated."})
call("owner", "GET", f"/challenges/{new['id']}/activity")
call("owner", "GET", f"/challenges/{new['id']}/entries")

section("Notifications reach people (outbox worker)")
import time
time.sleep(int(cfg("OUTBOX_POLL_SECONDS", "5")) + 3)
n = call("rahim", "GET", "/me/notifications")
print(f"  rahim: {len(n['items'])} notifications, {n['unread']} unread; first: {n['items'][0]['title']}")
call("rahim", "POST", f"/me/notifications/{n['items'][0]['id']}/read")
call("rahim", "POST", "/me/notifications/read-all")
assert call("rahim", "GET", "/me/notifications")["unread"] == 0
sent = call("admin", "GET", "/notification-deliveries")
print(f"  email deliveries logged: {sent['total']}; health: {call('admin', 'GET', '/admin/system-health')}")
for u in USERS:
    call(u, "GET", "/home")

print(f"\n{'ALL PASSED' if not failed else 'FAILURES'}: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
