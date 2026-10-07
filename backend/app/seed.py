"""Demo data: people for every role, challenges at every stage, and ideas across the whole lifecycle.

All dates are relative to "now", so the demo always has open windows and live deadlines.
Loaded automatically on first start when the database is empty (SEED_ON_START=true).
Run by hand:  python -m app.seed            (add --reset to wipe and reload)
"""
import random
import sys
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.events import audit, next_code, publish_event, record_history
from app.core.security import hash_password, sha256
from app.modules.admin.models import IdSequence
from app.modules.challenges import service as csvc
from app.modules.challenges.models import (Challenge, ChallengeEntry, ChallengeQuestion, ChallengeResource,
                                           EntrySubmission, SubmissionVersion, Team, TeamInviteLink, TeamJoinRequest,
                                           TeamMember)
from app.modules.delivery.models import (AwardDecision, DemoEvent, DemoSlot, Kpi, KpiMeasurement, Milestone,
                                         ProgressUpdate, ReusableAsset, Reward)
from app.modules.evaluation import service as esvc
from app.modules.evaluation.models import (Feedback, Panel, PanelMember, ReviewAssignment, ReviewRound, ReviewScore,
                                           ReviewSummary, Shortlist, ShortlistEntry)
from app.modules.identity.models import Organization, OrgUnit, User, UserRoleAssignment
from app.modules.identity.sbu import SBUS
from app.modules.initiatives import service as isvc
from app.modules.initiatives.models import ClarificationRequest, Comment, Initiative, InitiativeVersion
from app.modules.masterdata.models import UserSkill
from app.modules.masterdata.router import form_completeness, form_definition
from app.modules.notifications.models import InAppNotification, NotificationDelivery
from app.modules.notifications.service import process_outbox
from app.seed_reference import seed_reference
from app.shared.models.base import Base, row, utcnow

rng = random.Random(2026)
EMAIL_DOMAIN = "anwargroup.example"

STRENGTHS = ["Clear problem with real numbers from the floor.", "The plan is realistic and fits the build window.",
             "Strong link to the transformation priorities.", "Good use of data that already exists.",
             "The team has the right mix of skills.", "Easy to reuse in other plants and teams."]
IMPROVEMENTS = ["Add a measured baseline so the target can be checked.", "Explain who will own it after the pilot.",
                "Show how users will be trained and supported.", "The cost estimate needs more detail.",
                "Name the main risk and a fallback plan.", "Say how results will be measured each month."]


def seed_all(db: Session) -> None:
    now = utcnow()
    D = lambda days, hours=0: now + timedelta(days=days, hours=hours)   # noqa: E731
    ref = seed_reference(db)

    # ---- Organization -----------------------------------------------------------------------------
    org = Organization(code="ANWAR", name_i18n={"en": "Anwar Group of Industries", "bn": "আনোয়ার গ্রুপ অব ইন্ডাস্ট্রিজ"})
    db.add(org)
    db.flush()
    units: dict[str, OrgUnit] = {}

    def unit(code, name, kind, parent=None, bn=None):
        p = units.get(parent)
        slug = code.lower()
        u = OrgUnit(organization_id=org.id, parent_id=p.id if p else None, unit_type=kind, code=code,
                    name_i18n={"en": name, **({"bn": bn} if bn else {})}, path=f"{p.path}.{slug}" if p else slug)
        db.add(u)
        db.flush()
        units[code] = u
        return u

    unit("ANWAR", "Anwar Group", "GROUP", bn="আনোয়ার গ্রুপ")
    unit("AES", "Anwar Enterprise Systems (AES)", "COMPANY", "ANWAR", "আনোয়ার এন্টারপ্রাইজ সিস্টেমস")
    unit("AES_DTO", "Digital Transformation Office", "FUNCTION", "AES")
    unit("AES_ENG", "Delivery & Engineering", "FUNCTION", "AES")
    unit("AES_QA", "Quality & DevSecOps", "DEPARTMENT", "AES_ENG")
    unit("AES_DATA", "Data & AI", "DEPARTMENT", "AES_ENG")
    unit("AES_SUPPORT", "Application Support", "DEPARTMENT", "AES_ENG")
    unit("CEMENT", "Anwar Cement LTD", "COMPANY", "ANWAR", "আনোয়ার সিমেন্ট লিমিটেড")
    unit("CEMENT_OPS", "Cement Operations", "FUNCTION", "CEMENT")
    unit("CEMENT_KILN", "Kiln & Process", "DEPARTMENT", "CEMENT_OPS")
    unit("CEMENT_MAINT", "Maintenance", "DEPARTMENT", "CEMENT_OPS")
    for code, name, bn in SBUS:      # the remaining SBUs (the group and Anwar Cement are added above)
        if code not in units:
            unit(code, name, "COMPANY", "ANWAR", bn)
    unit("GROUP_HR", "Group HR", "FUNCTION", "ANWAR")
    unit("GROUP_FIN", "Group Finance", "FUNCTION", "ANWAR")
    unit("GROUP_PROC", "Group Procurement", "FUNCTION", "ANWAR")

    # ---- People (one or more for every role) ------------------------------------------------------
    password = hash_password(settings.demo_password)
    U: dict[str, User] = {}

    def person(key, name, title, unit_code, roles=(), grade="M2", manager=None, login=True, joined=(2019, 3, 1), skills=()):
        u = User(organization_id=org.id, employee_no=f"E{1000 + len(U) + 1}", full_name=name, job_title=title, grade=grade,
                 email=f"{key}@{EMAIL_DOMAIN}" if login else None, password_hash=password if login else None,
                 primary_org_unit_id=units[unit_code].id, manager_id=U[manager].id if manager else None,
                 has_corporate_login=login, joined_on=date(*joined), locale="en")
        db.add(u)
        db.flush()
        U[key] = u
        for r in roles:
            db.add(UserRoleAssignment(user_id=u.id, role_id=ref["roles"][r].id, scope_type="GLOBAL", valid_from=now))
        for s in skills:
            db.add(UserSkill(user_id=u.id, skill_id=ref["skills"][s].id, level=4))
        return u

    person("admin", "Waeez Rahman", "Head of Digital Transformation", "AES_DTO", ["SUPER_ADMIN"], "E1")
    person("owner", "Farhana Akter", "Innovation Program Owner", "AES_DTO", ["PROGRAM_OWNER"], "M4", "admin")
    person("dmd", "Mahmud Hasan", "Deputy Managing Director", "ANWAR", ["DMD"], "E2")
    person("executive", "Shahana Parvin", "Director, Strategy", "ANWAR", ["EXECUTIVE"], "E2")
    person("sponsor", "Nasrin Ahmed", "Head of Operations, Anwar Cement", "CEMENT_OPS", ["SPONSOR"], "M5")
    person("judge1", "Dr. Kamal Hossain", "Chief Architect", "AES_DTO", ["JUDGE"], "M5", "admin", skills=["SOFTWARE_DEV", "MACHINE_LEARNING"])
    person("judge2", "Shirin Sultana", "Head of Quality & DevSecOps", "AES_QA", ["JUDGE"], "M4", "admin", skills=["TESTING"])
    person("judge3", "Imran Chowdhury", "Engineering Lead, Data & AI", "AES_DATA", ["JUDGE"], "M4", "admin", skills=["DATA_ANALYSIS", "MACHINE_LEARNING"])
    person("judge4", "Rezaul Karim", "Plant Manager, Anwar Ispat", "ISPAT", ["JUDGE"], "M5", skills=["PROCESS_ENGINEERING", "SAFETY_MGMT"])
    person("masterdata", "Arif Mahmud", "IT Support Lead", "AES_SUPPORT", ["ADMIN"], "M3", "admin")
    person("hr", "Tahmina Begum", "HR Business Partner", "GROUP_HR", ["HR"], "M3")
    person("finance", "Jahid Islam", "Finance Controller", "GROUP_FIN", ["FINANCE_VERIFIER"], "M4", skills=["FINANCE_ANALYSIS"])
    # Participants (Team Leader / Team Member come from creating or joining a team, not from a role)
    person("rahim", "Rahim Uddin", "Process Engineer", "CEMENT_KILN", grade="M2", manager="sponsor", skills=["PROCESS_ENGINEERING", "ENERGY_AUDIT"])
    person("nusrat", "Nusrat Jahan", "Data Analyst", "CEMENT_OPS", grade="M1", manager="sponsor", skills=["DATA_ANALYSIS"])
    person("tanvir", "Tanvir Ahmed", "Maintenance Engineer", "CEMENT_MAINT", grade="M1", manager="sponsor", skills=["MAINTENANCE", "SAP"])
    person("sadia", "Sadia Islam", "Energy Auditor", "CEMENT_OPS", grade="M1", manager="sponsor", skills=["ENERGY_AUDIT", "SAP"])
    person("karim", "Karim Sheikh", "Production Supervisor", "ISPAT", grade="M2", manager="judge4", skills=["PROCESS_ENGINEERING"])
    person("mitu", "Mitu Roy", "Safety Officer", "ISPAT", grade="M1", manager="judge4", skills=["SAFETY_MGMT"])
    person("fahim", "Fahim Reza", "Senior Software Engineer", "AES_DATA", grade="M2", manager="judge3", skills=["SOFTWARE_DEV", "MACHINE_LEARNING"])
    person("lamia", "Lamia Khan", "QA Engineer", "AES_QA", grade="M1", manager="judge2", skills=["TESTING"])
    person("sabbir", "Sabbir Hossain", "Software Engineer", "AES_SUPPORT", grade="M1", manager="masterdata", skills=["SOFTWARE_DEV"])
    person("tania", "Tania Sarker", "DevOps Engineer", "AES_QA", grade="M1", manager="judge2", skills=["SOFTWARE_DEV"])
    person("priya", "Priya Das", "HR Officer", "GROUP_HR", grade="M1", manager="hr", skills=["PROJECT_MGMT"])
    person("omar", "Omar Faruk", "Procurement Officer", "GROUP_PROC", grade="M1", skills=["SAP", "FINANCE_ANALYSIS"])
    person("anika", "Anika Tabassum", "Graduate Trainee", "TEXTILE", grade="J1", joined=(2026, 8, 15))
    person("jabbar", "Abdul Jabbar", "Packing Line Operator", "CEMENT_OPS", grade="W2", manager="rahim", login=False)
    units["AES"].head_user_id, units["CEMENT_OPS"].head_user_id = U["admin"].id, U["sponsor"].id
    PO = U["owner"]
    JUDGES = [U["judge1"].id, U["judge2"].id, U["judge3"].id, U["judge4"].id]
    A, B = ref["scorecards"]["IDEA_REVIEW_A"], ref["scorecards"]["FINAL_JURY_B"]
    F = ref["forms"]

    # ---- Open-idea review round (not tied to a challenge) -------------------------------------------
    idea_panel = Panel(name="Open idea reviewers", panel_type="REVIEW", chair_user_id=U["judge1"].id)
    db.add(idea_panel)
    db.flush()
    for j in JUDGES:
        db.add(PanelMember(panel_id=idea_panel.id, user_id=j, vote_weight=1))
    idea_round = ReviewRound(round_type="IDEA_REVIEW", name_i18n={"en": "Idea review"}, scorecard_id=A.id, panel_id=idea_panel.id,
                             reviewers_per_entry=2, aggregation_method="MEAN", disagreement_threshold=2, status="IN_PROGRESS",
                             show_scores_to_entrants="TOTAL_ONLY")
    db.add(idea_round)
    db.flush()

    # ---- Helpers ------------------------------------------------------------------------------------
    def make_challenge(title, bn, domain, cat, status, phases, *, sponsor="sponsor", problem, background, outcome,
                       mode="BOTH", team=(1, 5), policy="PANEL_DECIDES", prizes=None, top_n=3, waitlist=1, judges=JUDGES,
                       blind=False, color="#0B6E6E", units_only=(), published_days_ago=10, show="TOTAL_ONLY", forms=True) -> Challenge:
        slug = title.lower().replace("%", "").replace(":", "").replace(",", "").replace("'", "")
        ch = Challenge(code=next_code(db, "CHL", 3), slug="-".join(slug.split())[:80], status_code="DRAFT",
                       program_owner_user_id=PO.id, org_unit_id=units["AES_DTO"].id, created_by=PO.id, title_i18n={"en": title})
        db.add(ch)
        db.flush()
        csvc.apply_config(db, ch, {
            "title": title, "title_bn": bn, "domain_id": ref["domains"][domain].id, "category_id": ref["categories"][cat].id,
            "sponsor_user_id": U[sponsor].id, "banner_color": color, "problem_statement": problem, "background": background,
            "expected_outcome": outcome,
            "rules": "One entry per person. The work must be your own or your team's. Ideas made for work belong to the company; "
                     "you always keep public credit. No client or third-party secret data. Late entries are not accepted unless "
                     "the deadline is extended for everyone.",
            "participation_mode": mode, "team_min_size": team[0], "team_max_size": team[1], "prototype_policy": policy,
            "blind_review": blind, "eligibility_org_unit_ids": [units[u].id for u in units_only],
            "phases": [{"phase_type": k, "opens_at": D(a), "closes_at": D(b)} for k, a, b in phases],
            "methodology_form_id": F["METHODOLOGY_STD"].id if forms else None, "prototype_form_id": F["PROTOTYPE_STD"].id,
            "final_form_id": F["FINAL_STD"].id, "methodology_scorecard_id": A.id, "final_scorecard_id": B.id,
            "judge_user_ids": judges, "reviewers_per_entry": 3, "aggregation_method": "MEAN", "show_scores_to_entrants": show,
            "shortlist_method": "TOP_N", "top_n": top_n, "waitlist_size": waitlist,
            "prizes": prizes if prizes is not None else [
                {"rank_from": 1, "rank_to": 1, "prize_type": "CASH", "description": "Winner: trophy and cash prize", "amount": 150000},
                {"rank_from": 2, "rank_to": 2, "prize_type": "CASH", "description": "Runner-up: cash prize", "amount": 75000},
                {"rank_from": 3, "rank_to": 3, "prize_type": "TRAINING", "description": "Third place: training sponsorship", "amount": 30000}],
        }, PO.id)
        if status != "DRAFT":
            ch.status_code, ch.published_at = "SCHEDULED", D(-published_days_ago)
            record_history(db, "challenge", ch.id, "DRAFT", "SCHEDULED", "PUBLISH", PO.id, at=ch.published_at)
        db.add(ChallengeResource(challenge_id=ch.id, resource_type="DOC", title="Challenge brief (PDF)", url="https://intranet.anwargroup.example/innovatex/brief.pdf", access_level="PUBLIC"))
        db.add(ChallengeResource(challenge_id=ch.id, resource_type="DATASET", title="Sample data set (12 months)", url="https://intranet.anwargroup.example/innovatex/data.xlsx", access_level="REGISTERED"))
        db.add(ChallengeResource(challenge_id=ch.id, resource_type="SANDBOX", title="Sandbox access and mentor contact", url="https://intranet.anwargroup.example/innovatex/sandbox", access_level="SHORTLISTED"))
        db.flush()
        return ch

    def methodology(title: str, complete: bool = True) -> dict:
        c = {
            "problem_understanding": f"{title}: the problem happens every week and costs the team hours of rework. We spoke to the people who do the job and collected three months of records.",
            "current_situation": "Today the work is done by hand with spreadsheets and phone calls. Nobody sees the full picture until the end of the month.",
            "approach": "1) Map the current steps with the people who do them. 2) Remove the steps that add no value. 3) Build a simple tool or checklist for the rest. 4) Test with one shift for four weeks. 5) Measure and adjust.",
            "data_systems": "SAP records for the last 12 months, shift logs and the existing Excel trackers.",
            "tools": "Process mapping, Power BI, simple scripts",
            "work_plan": "Week 1–2: mapping and baseline. Week 3–5: build first version. Week 6–9: trial with one team. Week 10: results and handover.",
            "duration_weeks": 10,
            "expected_impact": "We expect at least a 20% improvement on the main KPI within the trial, and more after rollout.",
            "kpis": [{"name": "Time per cycle", "baseline": "50", "target": "35", "unit": "minutes"}],
            "risks": "People may keep the old habit. We will involve supervisors from day one and keep the old process as a fallback for two weeks.",
            "resources_needed": "Half a day per week from two operators; read access to SAP reports.",
            "team_skills": "Process knowledge, data analysis and hands-on maintenance experience. We need light support for dashboards.",
            "reuse": "The same approach works for other plants with the same line setup.",
            "declaration": True,
        }
        if not complete:
            for k in ("work_plan", "expected_impact", "risks", "team_skills", "declaration", "kpis", "duration_weeks"):
                c.pop(k)
        return c

    def register(ch: Challenge, lead: str, title: str, summary: str, team_name: str | None = None, members: tuple = (),
                 days_ago: float = 5) -> ChallengeEntry:
        when = D(-days_ago)
        team = None
        if team_name:
            team = Team(name=team_name, challenge_id=ch.id, lead_user_id=U[lead].id, created_by=U[lead].id, created_at=when)
            db.add(team)
            db.flush()
            people = [lead, *members]
            share = round(100 / len(people), 2)
            for i, m in enumerate(people):
                db.add(TeamMember(team_id=team.id, user_id=U[m].id, member_role="LEAD" if i == 0 else "MEMBER", status="ACTIVE",
                                  joined_at=when, credit_share_pct=round(100 - share * (len(people) - 1), 2) if i == 0 else share))
        code = next_code(db, f"ENT-{ch.code[4:]}", 4)
        e = ChallengeEntry(code=code, challenge_id=ch.id, entry_type="TEAM" if team else "INDIVIDUAL", team_id=team.id if team else None,
                           lead_user_id=U[lead].id, title=title, summary=summary, status_code="REGISTERED", registered_at=when,
                           declarations_accepted_at=when, org_unit_id=U[lead].primary_org_unit_id, created_by=U[lead].id,
                           anonymous_alias=f"Entry #{int(code.rsplit('-', 1)[1])}")
        db.add(e)
        db.flush()
        record_history(db, "challenge_entry", e.id, None, "REGISTERED", "REGISTER", U[lead].id, at=when)
        return e

    def submit(entry: ChallengeEntry, kind: str, content: dict, days_ago: float, status="SUBMITTED", draft=False) -> EntrySubmission:
        ch = db.get(Challenge, entry.challenge_id)
        phase = csvc.phase_of(db, ch.id, {"METHODOLOGY": "METHODOLOGY", "PROTOTYPE": "PROTOTYPE", "FINAL_PROJECT": "FINAL_SUBMISSION"}[kind])
        when = D(-days_ago)
        definition = form_definition(db, phase.submission_form_template_id)
        sub = EntrySubmission(challenge_entry_id=entry.id, challenge_phase_id=phase.id, submission_type=kind,
                              status="DRAFT" if draft else status, current_version_no=0 if draft else 1,
                              form_template_id=phase.submission_form_template_id, content=content,
                              submitted_at=None if draft else when, submitted_by=None if draft else entry.lead_user_id,
                              completeness_pct=form_completeness(definition, content), org_unit_id=entry.org_unit_id,
                              created_by=entry.lead_user_id)
        db.add(sub)
        db.flush()
        if not draft:
            db.add(SubmissionVersion(entry_submission_id=sub.id, version_no=1, content=content, submitted_at=when,
                                     submitted_by=entry.lead_user_id, content_hash=sha256(str(sorted(content.items())))))
            new = {"METHODOLOGY": "METHODOLOGY_SUBMITTED", "PROTOTYPE": "PROTOTYPE_SUBMITTED", "FINAL_PROJECT": "FINAL_SUBMITTED"}[kind]
            record_history(db, "challenge_entry", entry.id, entry.status_code, new, f"SUBMIT_{kind}", entry.lead_user_id, at=when)
            entry.status_code = new
        return sub

    def fill_reviews(rnd: ReviewRound, quality: dict[str, float], leave_open=lambda a: False, hours_ago: float = 30) -> None:
        """Turn assignments into submitted reviews. Ratings stay within one point of each other (no disagreement)."""
        criteria = esvc.criteria_of(db, rnd.scorecard_id)
        for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == rnd.id,
                                                           ReviewAssignment.status == "ASSIGNED")).all():
            if leave_open(a):
                continue
            q = quality.get(a.entity_id, 3.2)
            ratings = {}
            for c in criteria:
                r = int(max(1, min(5, round(q + rng.choice([-0.4, 0.0, 0.3, 0.6])))))
                ratings[c.id] = r
                db.add(ReviewScore(review_assignment_id=a.id, scorecard_criterion_id=c.id, rating=r,
                                   comment="Clear evidence with data." if r == 5 else "No evidence given for this point." if r == 1 else None))
            done = now - timedelta(hours=hours_ago + rng.randint(0, 40))
            a.status, a.submitted_at, a.started_at = "SUBMITTED", done, done - timedelta(minutes=rng.randint(25, 70))
            db.add(ReviewSummary(review_assignment_id=a.id, weighted_score=esvc.weighted_score(ratings, criteria, 5),
                                 recommendation="STRONG_YES" if q >= 4.2 else "YES" if q >= 3.6 else "MAYBE" if q >= 2.9 else "NO",
                                 strengths=rng.choice(STRENGTHS), improvements=rng.choice(IMPROVEMENTS),
                                 private_note="Worth a closer look in the panel discussion." if q >= 4 else None))
        db.flush()
        esvc.calculate_round(db, rnd)

    def set_rating(a: ReviewAssignment, criterion, rating: int, comment: str) -> None:
        s = db.scalar(select(ReviewScore).where(ReviewScore.review_assignment_id == a.id, ReviewScore.scorecard_criterion_id == criterion.id))
        s.rating, s.comment = rating, comment
        db.flush()
        rnd = db.get(ReviewRound, a.review_round_id)
        given = {cid: x.rating for cid, x in esvc.ratings_of(db, a.id).items()}
        summary = db.scalar(select(ReviewSummary).where(ReviewSummary.review_assignment_id == a.id))
        summary.weighted_score = esvc.weighted_score(given, esvc.criteria_of(db, rnd.scorecard_id), 5)

    def run_methodology_round(ch: Challenge, quality: dict[str, float], leave_open=lambda a: False) -> ReviewRound:
        csvc.sync_challenge(db, ch)                 # deadline lock: submissions LOCKED, entries UNDER_REVIEW
        rnd = csvc.round_of(db, ch.id, "METHODOLOGY")
        esvc.auto_assign(db, rnd, PO.id)            # includes the conflict-of-interest check
        fill_reviews(rnd, quality, leave_open)
        return rnd

    # =================================================================================================
    # C1 — registration and methodology open (join links, team privacy, methodology form)
    # =================================================================================================
    c1 = make_challenge(
        "Cut kiln energy use by 10%", "কিলনের জ্বালানি ব্যবহার ১০% কমান", "ENERGY", "AUTOMATION", "OPEN",
        [("REGISTRATION", -6, 8), ("METHODOLOGY", -3, 12), ("METHODOLOGY_REVIEW", 12, 22), ("SHORTLIST", 22, 25), ("BUILD", 25, 60),
         ("PROTOTYPE", 40, 60), ("PROTOTYPE_REVIEW", 60, 67), ("FINAL_SUBMISSION", 67, 75), ("DEMO", 77, 78), ("JUDGING", 78, 82), ("RESULTS", 82, 86)],
        problem="Kiln fuel is our largest production cost. Specific heat consumption at Kiln 2 is about 8% above the design value, and it swings from shift to shift.",
        background="You will get 12 months of kiln logs, fuel records and stoppage reports after you register. Changes must not reduce clinker quality or safety margins.",
        outcome="A tested way to cut specific heat consumption by 10% within six months, with a measurement method the plant team trusts.", color="#B26B00")
    spark = register(c1, "rahim", "Smart kiln scheduling", "Match kiln firing to raw-mill running hours so the kiln never idles on high heat.",
                     "Team Spark", ("nusrat", "tanvir"), days_ago=4)
    submit(spark, "METHODOLOGY", methodology("Smart kiln scheduling", complete=False), 1, draft=True)
    token = "demo-spark-join-link-2026"
    link = TeamInviteLink(team_id=spark.team_id, token_hash=sha256(token), token_hint=token[:4], expires_at=D(7), use_count=1,
                          status="ACTIVE", created_by=U["rahim"].id, created_at=D(-3))
    db.add(link)
    db.flush()
    db.add(TeamJoinRequest(team_id=spark.team_id, invite_link_id=link.id, user_id=U["sadia"].id, status="PENDING",
                           message="I work in energy audits and know SAP PM. I can build the fuel baseline for the team.",
                           created_by=U["sadia"].id, created_at=D(0, -5)))
    publish_event(db, "TEAM_JOIN_REQUESTED", "team", spark.team_id, U["sadia"].id, users=[U["rahim"].id],
                  title="Sadia Islam asked to join Team Spark", body="I work in energy audits and know SAP PM.",
                  link=f"/teams/{spark.team_id}", needs_action=True, vars={"team": "Team Spark", "requester": "Sadia Islam"})
    nova = register(c1, "karim", "Waste-heat pre-drying of raw meal", "Use preheater exhaust to dry raw meal before the mill.",
                    "Team Nova", ("mitu",), days_ago=5)
    submit(nova, "METHODOLOGY", methodology("Waste-heat pre-drying"), 0.5)
    register(c1, "fahim", "AI kiln anomaly detector", "Detect unstable burning early from sensor patterns.", days_ago=2)
    db.add(ChallengeQuestion(challenge_id=c1.id, asked_by=U["tanvir"].id, question="Can we use the kiln shell scanner data?",
                             answer="Yes. The last 12 months of scanner data are in the data set you get after registering.",
                             answered_by=PO.id, answered_at=D(-2), is_published=True, is_anonymous=True, created_at=D(-3)))
    db.add(ChallengeQuestion(challenge_id=c1.id, asked_by=U["sadia"].id, question="Is a solution that needs new sensors allowed?",
                             is_published=False, is_anonymous=True, created_at=D(0, -8)))

    # =================================================================================================
    # C2 — methodology review in progress (judge queue, overdue review, judge disagreement)
    # =================================================================================================
    c2 = make_challenge(
        "Faster employee onboarding", "নতুন কর্মীর অনবোর্ডিং দ্রুত করুন", "HR", "BUSINESS_TRANSFORMATION", "OPEN",
        [("REGISTRATION", -30, -12), ("METHODOLOGY", -25, -2), ("METHODOLOGY_REVIEW", -2, 8), ("SHORTLIST", 8, 11), ("BUILD", 11, 45),
         ("FINAL_SUBMISSION", 40, 50), ("DEMO", 52, 53), ("JUDGING", 53, 57), ("RESULTS", 57, 60)],
        sponsor="hr", policy="NONE", top_n=3, waitlist=1, color="#2459A6", published_days_ago=35,
        problem="A new joiner needs about 15 working days before they have accounts, equipment, training and a first task. Managers chase five teams by email.",
        background="HR, IT, Admin and Finance each have their own checklist. There is no single view of what is done.",
        outcome="A new joiner is fully ready within 5 working days, and the manager can see progress at any time.")
    c2e = [register(c2, "priya", "One onboarding checklist for all teams", "A single shared checklist with owners and due dates.", days_ago=20),
           register(c2, "lamia", "Day-one ready kit", "Accounts and equipment requested automatically from the offer letter.", days_ago=19),
           register(c2, "sabbir", "Onboarding status board", "A live board for managers showing each new joiner's progress.", days_ago=18),
           register(c2, "omar", "Pre-joining paperwork by phone", "Collect documents before day one with a mobile form.", days_ago=18),
           register(c2, "sadia", "Buddy programme with weekly check-ins", "Pair each joiner with a trained buddy.", "People First", ("mitu",), days_ago=17),
           register(c2, "fahim", "Self-service access requests", "New joiners request system access from one screen.", days_ago=16)]
    for i, e in enumerate(c2e):
        submit(e, "METHODOLOGY", methodology(e.title), 4 + i * 0.5)
    q2 = dict(zip([e.id for e in c2e], [4.3, 3.9, 3.6, 3.1, 4.0, 3.4]))
    j1, j4 = U["judge1"].id, U["judge4"].id
    # Dr. Kamal has not started his reviews yet; Rezaul has one left.
    r2 = run_methodology_round(c2, q2, lambda a: a.reviewer_user_id == j1 or (a.reviewer_user_id == j4 and a.entity_id == c2e[3].id))
    waiting = db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == r2.id, ReviewAssignment.status == "ASSIGNED")
                         .order_by(ReviewAssignment.created_at)).all()
    for i, a in enumerate([a for a in waiting if a.reviewer_user_id == j1]):
        a.due_at = D(-1) if i == 0 else D(1) if i == 1 else a.due_at        # one overdue, one due tomorrow
    # A judge disagreement (2 points or more on one criterion) that the program owner must resolve
    feas = next(c for c in esvc.criteria_of(db, A.id) if c.code == "FEASIBILITY")
    done5 = db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == r2.id, ReviewAssignment.entity_id == c2e[5].id,
                                                      ReviewAssignment.status == "SUBMITTED")).all()
    if len(done5) >= 2:
        set_rating(done5[0], feas, 2, "Depends on an access system the team does not control.")
        set_rating(done5[1], feas, 5, "Already proven in the support team.")
        esvc.calculate_round(db, r2)

    # =================================================================================================
    # C3 — shortlisting: all reviews in, shortlist PROPOSED and waiting for the program owner
    # =================================================================================================
    c3 = make_challenge(
        "Cut procurement paperwork by half", "ক্রয়ের কাগজপত্র অর্ধেকে নামান", "PROCUREMENT", "AUTOMATION", "OPEN",
        [("REGISTRATION", -40, -22), ("METHODOLOGY", -35, -12), ("METHODOLOGY_REVIEW", -12, -1), ("SHORTLIST", -1, 4), ("BUILD", 4, 40),
         ("PROTOTYPE", 20, 40), ("PROTOTYPE_REVIEW", 40, 46), ("FINAL_SUBMISSION", 46, 54), ("DEMO", 56, 57), ("JUDGING", 57, 61), ("RESULTS", 61, 64)],
        sponsor="finance", top_n=3, waitlist=1, color="#55657A", published_days_ago=45, show="PER_CRITERION",
        problem="A purchase under BDT 50,000 needs 7 signatures and takes 9 working days. Most time is spent waiting, not deciding.",
        background="About 60% of requests are repeat items from approved suppliers.", outcome="Half the steps and half the waiting time for low-value purchases, with the same control.")
    c3e = [register(c3, "omar", "Pre-approved catalogue for repeat items", "Skip quotes for approved repeat items.", days_ago=30),
           register(c3, "karim", "Two-signature rule under BDT 50,000", "Risk-based approval levels.", days_ago=29),
           register(c3, "tanvir", "Spare-parts request from the shop floor", "Request spares by scanning the machine tag.", days_ago=28),
           register(c3, "lamia", "Automatic three-way match", "Match PO, receipt and invoice automatically.", days_ago=28),
           register(c3, "sabbir", "Supplier self-service portal", "Suppliers upload invoices and track payment.", days_ago=27),
           register(c3, "priya", "Paperless requisition form", "Replace the paper form with a phone form.", days_ago=26)]
    for i, e in enumerate(c3e):
        submit(e, "METHODOLOGY", methodology(e.title), 14 + i * 0.4)
    r3 = run_methodology_round(c3, dict(zip([e.id for e in c3e], [4.5, 4.1, 3.7, 3.4, 2.9, 2.3])))
    for a in db.scalars(select(ReviewAssignment).where(ReviewAssignment.review_round_id == r3.id, ReviewAssignment.entity_id == c3e[5].id)).all():
        set_rating(a, feas, 1, "No evidence that the team can get the system access it needs.")   # fails the Feasibility gate
    esvc.propose_shortlist(db, r3, PO.id)
    publish_event(db, "ROUND_COMPLETED", "review_round", r3.id, None, users=[PO.id], title="Shortlist proposed: Cut procurement paperwork by half",
                  body="Review the system's proposal, override with a reason if needed, then confirm and publish.",
                  link=f"/manage/challenges/{c3.id}", needs_action=True)

    # =================================================================================================
    # C4 — build phase: shortlist published, feedback out, prototype required for one entry
    # =================================================================================================
    c4 = make_challenge(
        "Zero harm: safer shift handover", "শূন্য দুর্ঘটনা: নিরাপদ শিফট হস্তান্তর", "SAFETY", "BUSINESS_TRANSFORMATION", "OPEN",
        [("REGISTRATION", -50, -35), ("METHODOLOGY", -45, -25), ("METHODOLOGY_REVIEW", -25, -12), ("SHORTLIST", -12, -3), ("BUILD", -3, 30),
         ("PROTOTYPE", -3, 30), ("PROTOTYPE_REVIEW", 30, 37), ("FINAL_SUBMISSION", 30, 45), ("DEMO", 47, 48), ("JUDGING", 48, 52), ("RESULTS", 52, 56)],
        top_n=2, waitlist=1, color="#B42318", published_days_ago=55,
        problem="One in three near-misses happens in the first hour of a shift. Handover notes are spoken or written on paper and important warnings get lost.",
        background="Three plants use different handover books. Supervisors want something that works on a phone and offline.",
        outcome="Every open hazard and isolation is seen and accepted by the incoming shift, with a record.")
    c4e = [register(c4, "rahim", "Digital shift handover board", "A phone checklist that carries open hazards to the next shift.", days_ago=40),
           register(c4, "mitu", "Lock-out tag photo log", "Photo proof of every isolation at handover.", days_ago=39),
           register(c4, "sabbir", "Voice notes for handover", "Record handover as voice and turn it into a list.", days_ago=38),
           register(c4, "omar", "Handover scorecard", "Weekly score of handover quality per shift.", days_ago=38),
           register(c4, "priya", "Safety buddy at shift start", "A named buddy walks the line with the incoming lead.", days_ago=37)]
    for i, e in enumerate(c4e):
        submit(e, "METHODOLOGY", methodology(e.title), 27 + i * 0.3)
    r4 = run_methodology_round(c4, dict(zip([e.id for e in c4e], [4.5, 4.1, 3.6, 2.9, 2.5])))
    s4 = esvc.propose_shortlist(db, r4, PO.id)
    first = db.scalar(select(ShortlistEntry).where(ShortlistEntry.shortlist_id == s4.id, ShortlistEntry.entity_id == c4e[0].id))
    first.prototype_required, first.prototype_reason = True, "works offline on the shop floor — the panel wants to see it running"
    s4.status, s4.confirmed_by, s4.confirmed_at = "CONFIRMED", PO.id, D(-4)
    esvc.publish_shortlist(db, s4, r4, PO.id)
    c4e[1].status_code = "BUILDING"
    for i, (title, due, status) in enumerate([("Agree the handover checklist with three supervisors", -1, "DONE"),
                                              ("Photo log working on two test phones", 6, "IN_PROGRESS"),
                                              ("Trial on night shift for two weeks", 20, "PLANNED")]):
        db.add(Milestone(entity_type="challenge_entry", entity_id=c4e[1].id, title=title, due_date=D(due).date(), status=status,
                         owner_user_id=U["mitu"].id, sort_order=i, completed_at=D(-1) if status == "DONE" else None, created_by=U["mitu"].id))
    db.add(ProgressUpdate(entity_type="challenge_entry", entity_id=c4e[1].id, posted_by=U["mitu"].id, percent_complete=35,
                          update_text="Checklist agreed with all three supervisors. Photo upload works on Android.",
                          blockers="Wi-Fi is weak near furnace 2.", help_needed="A rugged test phone for the night shift.", created_at=D(-1)))

    # =================================================================================================
    # C5 — demo and judging: finalists, demo slots, final jury in progress
    # =================================================================================================
    c5 = make_challenge(
        "Cut water use in textile dyeing", "টেক্সটাইল ডাইংয়ে পানির ব্যবহার কমান", "SUSTAINABILITY", "DATA_INTELLIGENCE", "OPEN",
        [("REGISTRATION", -90, -75), ("METHODOLOGY", -85, -65), ("METHODOLOGY_REVIEW", -65, -55), ("SHORTLIST", -55, -50), ("BUILD", -50, -12),
         ("FINAL_SUBMISSION", -12, 2), ("JUDGING", -1, 7), ("DEMO", 3, 4), ("RESULTS", 7, 10)],
        sponsor="executive", policy="NONE", top_n=3, waitlist=0, color="#0E7490", published_days_ago=95,
        problem="Dyeing uses about 110 litres of water per kg of fabric. Peers run at 70–80 litres. Water and effluent treatment cost is rising every year.",
        background="Batch records, water meter readings and recipe data are available for two dye houses.",
        outcome="A proven way to reach 85 litres per kg without lowering shade quality.")
    c5e = [register(c5, "nusrat", "Rinse-water reuse loop", "Reuse the last rinse as the first rinse of the next batch.", "Team AquaLoop", ("sadia",), days_ago=80),
           register(c5, "lamia", "Right-first-time shade prediction", "Predict shade from the recipe to avoid re-dyeing.", days_ago=79),
           register(c5, "fahim", "Live water meter dashboard", "Show litres per kg per machine every hour.", days_ago=78),
           register(c5, "karim", "Low-liquor machine settings", "Standard low-water settings per fabric type.", days_ago=77)]
    for i, e in enumerate(c5e):
        submit(e, "METHODOLOGY", methodology(e.title), 68 + i * 0.3)
    r5 = run_methodology_round(c5, dict(zip([e.id for e in c5e], [4.4, 4.2, 3.9, 2.8])))
    s5 = esvc.propose_shortlist(db, r5, PO.id)
    s5.status, s5.confirmed_by, s5.confirmed_at = "CONFIRMED", PO.id, D(-51)
    esvc.publish_shortlist(db, s5, r5, PO.id)
    final_content = lambda t: {"solution_summary": f"{t}: a working version ran in dye house 1 for four weeks.",   # noqa: E731
                               "demo_link": "https://intranet.anwargroup.example/demo", "results": "Water use fell from 110 to 91 litres per kg across 46 batches. Shade pass rate stayed at 96%.",
                               "kpis": [{"name": "Water per kg", "baseline": "110", "target": "85", "unit": "litres"}],
                               "pilot_plan": "Run in dye house 2 for eight weeks with the day shift, then both shifts."}
    for e in c5e[:3]:
        e.status_code, e.shortlist_moment_seen = "FINALIST", True
    submit(c5e[1], "FINAL_PROJECT", final_content(c5e[1].title), 3)
    submit(c5e[2], "FINAL_PROJECT", final_content(c5e[2].title), 2)
    demo = DemoEvent(challenge_id=c5.id, title="Demo Day — water challenge", starts_at=D(3, 3), ends_at=D(3, 5),
                     location="Innovation Lab, Anwar Tower (level 9)", online_link="https://teams.example/demo-day", created_by=PO.id)
    db.add(demo)
    db.flush()
    for i in range(6):
        booked = c5e[1] if i == 1 else None
        db.add(DemoSlot(demo_event_id=demo.id, starts_at=demo.starts_at + timedelta(minutes=20 * i), duration_min=20,
                        status="BOOKED" if booked else "OPEN", entity_type="challenge_entry" if booked else None,
                        entity_id=booked.id if booked else None))
    csvc.sync_challenge(db, c5)
    r5f = csvc.round_of(db, c5.id, "FINAL_JURY")
    esvc.auto_assign(db, r5f, PO.id)   # Imran is Fahim's manager, so the system excludes him from Fahim's entry
    fill_reviews(r5f, {c5e[1].id: 4.3, c5e[2].id: 3.9},
                 lambda a: not (a.reviewer_user_id == U["judge1"].id or (a.reviewer_user_id == U["judge2"].id and a.entity_id == c5e[1].id)), 6)

    # =================================================================================================
    # C6 — results published: winners, rewards split by credit share, badges, hall of fame
    # =================================================================================================
    c6 = make_challenge(
        "AES developer productivity challenge", "এইএস ডেভেলপার প্রোডাক্টিভিটি চ্যালেঞ্জ", "TECHNOLOGY", "ENG_PRODUCTIVITY", "OPEN",
        [("REGISTRATION", -150, -135), ("METHODOLOGY", -145, -125), ("METHODOLOGY_REVIEW", -125, -115), ("SHORTLIST", -115, -110),
         ("BUILD", -110, -70), ("FINAL_SUBMISSION", -75, -65), ("DEMO", -62, -61), ("JUDGING", -61, -56), ("RESULTS", -56, -50)],
        sponsor="admin", policy="NONE", top_n=3, waitlist=0, color="#0B6E6E", published_days_ago=155, units_only=("AES",),
        problem="Engineers lose about a day a week searching old code, waiting for environments and writing repeat tests.",
        background="Open to AES staff. Usage data from the delivery tools is available.", outcome="A working tool that gives engineers measurable time back.")
    c6e = [register(c6, "fahim", "AES Codebase Knowledge Assistant", "Ask questions about any AES codebase in plain language and get answers with file links.",
                    "Code Compass", ("sabbir",), days_ago=140),
           register(c6, "lamia", "AI Test Engineer", "Generates and maintains regression tests from requirements and code changes.", days_ago=139),
           register(c6, "tania", "One-click test environments", "Spin up a full test environment from a pull request.", days_ago=138)]
    for i, e in enumerate(c6e):
        submit(e, "METHODOLOGY", methodology(e.title), 128 + i * 0.3)
    r6 = run_methodology_round(c6, dict(zip([e.id for e in c6e], [4.6, 4.2, 3.6])))
    s6 = esvc.propose_shortlist(db, r6, PO.id)
    s6.status, s6.confirmed_by, s6.confirmed_at = "CONFIRMED", PO.id, D(-111)
    esvc.publish_shortlist(db, s6, r6, PO.id)
    for e in c6e:
        e.status_code, e.shortlist_moment_seen = "FINALIST", True
        submit(e, "FINAL_PROJECT", final_content(e.title), 66)
    r6f = csvc.round_of(db, c6.id, "FINAL_JURY")
    for e in c6e:   # the whole panel judges, minus anyone with a conflict of interest (e.g. a finalist's manager)
        for j in [j for j in JUDGES if not esvc.conflict_reason(db, j, "challenge_entry", e.id)]:
            db.add(ReviewAssignment(review_round_id=r6f.id, reviewer_user_id=j, entity_type="challenge_entry", entity_id=e.id,
                                    status="ASSIGNED", due_at=D(-56), reviewer_weight=1))
    db.flush()
    fill_reviews(r6f, dict(zip([e.id for e in c6e], [4.7, 4.2, 3.5])), hours_ago=24 * 58)
    esvc.ensure_feedback_drafts(db, r6f, PO.id)
    published = D(-50)
    for e, (rank, result, award) in zip(c6e, [(1, "WINNER", "BEST_ENG_PRODUCTIVITY"), (2, "RUNNER_UP", "BEST_AI"), (3, None, None)]):
        res = next(r for r in esvc.calculate_round(db, r6f) if r.entity_id == e.id)
        res.is_frozen = True
        new = result or "PARTICIPANT"
        record_history(db, "challenge_entry", e.id, e.status_code, new, "RESULTS_PUBLISHED", PO.id, at=published)
        e.status_code, e.final_rank = new, rank
        fb = db.scalar(select(Feedback).where(Feedback.review_round_id == r6f.id, Feedback.entity_id == e.id))
        fb.decision_code, fb.published_at, fb.read_at = new, published, published + timedelta(hours=3)
        fb.next_steps = "Your solution continues as an initiative towards pilot and production." if result else "Thank you for presenting at Demo Day."
        if not result:
            continue
        db.add(AwardDecision(challenge_id=c6.id, award_category_id=ref["awards"][award].id, entity_type="challenge_entry", entity_id=e.id,
                             rank=rank, result=result, jury_score=res.final_score, decision_note="Unanimous jury decision after the live demo.",
                             approved_by=U["admin"].id, approved_at=published, publication_status="PUBLISHED", published_at=published))
        shares = esvc.team_shares(db, e)
        amount = 150000 if rank == 1 else 75000
        for uid, pct in shares.items():
            db.add(Reward(recipient_user_id=uid, source_type="challenge_prize", source_id=e.id, reward_type="CASH",
                          title=f"{'Winner' if rank == 1 else 'Runner-up'} — AES developer productivity challenge",
                          amount=round(amount * pct / 100, 2), share_pct=pct, status="PAID" if rank == 1 else "SENT_TO_HR",
                          hr_reference=f"HR-RW-{2000 + rank}", approved_by=U["admin"].id, approved_at=published))
        esvc.award_points(db, list(shares), 300 if rank == 1 else 150, new, "WINNER" if rank == 1 else "FINALIST", "challenge_entry", e.id)
    c6.status_code, c6.results_published_at, c6.results_approved_by, c6.results_approved_at = "RESULTS_PUBLISHED", published, U["admin"].id, published
    r6f.status = "PUBLISHED"

    # =================================================================================================
    # C7 upcoming, C8 draft
    # =================================================================================================
    make_challenge("Faster customer complaint resolution", "গ্রাহকের অভিযোগ দ্রুত সমাধান", "CUSTOMER_SERVICE", "USER_EXPERIENCE", "OPEN",
                   [("REGISTRATION", 5, 20), ("METHODOLOGY", 10, 30), ("METHODOLOGY_REVIEW", 30, 40), ("SHORTLIST", 40, 43), ("BUILD", 43, 80),
                    ("FINAL_SUBMISSION", 75, 85), ("DEMO", 87, 88), ("JUDGING", 88, 92), ("RESULTS", 92, 95)],
                   sponsor="executive", policy="OPTIONAL", color="#7A4FB5", published_days_ago=1,
                   problem="A customer complaint takes 6 days on average to close, and customers are not told what is happening.",
                   background="Complaints arrive by phone, email and dealers. There is no single list.", outcome="Complaints closed in 2 days with updates to the customer at each step.")
    make_challenge("Close the month in five days", None, "FINANCE", "AUTOMATION", "DRAFT",
                   [("REGISTRATION", 20, 35), ("METHODOLOGY", 25, 45), ("METHODOLOGY_REVIEW", 45, 55)],
                   sponsor="finance", judges=[], color="#1E7F4F", prizes=[],
                   problem="Month-end closing takes 11 working days across companies.", background="", outcome="Close in 5 working days.")

    for ch in db.scalars(select(Challenge)).all():
        csvc.sync_challenge(db, ch)

    # =================================================================================================
    # Open ideas across the whole lifecycle (the eight sample innovations from the PRD, plus a few more)
    # =================================================================================================
    db.add(IdSequence(prefix="INNO", year=now.year, last_value=116))
    db.flush()
    PATH = ["DRAFT", "SUBMITTED", "TRIAGE", "UNDER_REVIEW", "SHORTLISTED", "PROTOTYPE", "DEMO_VALIDATION", "PILOT", "PRODUCTION",
            "IMPACT_VERIFIED", "SCALED"]
    ACTIONS = {"SUBMITTED": "SUBMIT", "TRIAGE": "START_TRIAGE", "UNDER_REVIEW": "SEND_TO_REVIEW", "SHORTLISTED": "SHORTLIST",
               "PROTOTYPE": "START_PROTOTYPE", "DEMO_VALIDATION": "REQUEST_DEMO", "PILOT": "APPROVE_PILOT", "PRODUCTION": "GO_LIVE",
               "IMPACT_VERIFIED": "VERIFY_IMPACT", "SCALED": "MARK_SCALED"}
    ideas: dict[str, Initiative] = {}

    def idea(key, owner, title, state, days_ago, *, cat="AI_AGENTIC", kind="AI_AGENTIC", cls="INTERNAL", scale="COMPANY", score=None,
             members=(), sponsor=None, side=None, comment=None, on_behalf=None, awarded=False, tech="LLM with retrieval over internal sources",
             problem=None, solution=None, kpi="Hours saved per month", baseline=None, target=None, risks=("AI",), benefits=("PRODUCTIVITY",)):
        submitter = U[owner]
        real_owner = U[on_behalf] if on_behalf else submitter
        started = D(-days_ago)
        ini = Initiative(
            title=title, summary=(solution or f"{title} to remove repeated manual work.")[:280],
            problem_statement=problem or f"Teams repeat the same manual steps for {title.lower()} every week, and knowledge sits with a few people.",
            affected_users="Delivery teams, support engineers and project managers.",
            current_process="Done by hand with documents, spreadsheets and chat messages. No baseline is tracked centrally.",
            proposed_solution=solution or f"{title}: an assistant that does the first draft and lets people review and approve.",
            technology_used=tech, differentiator="Uses our own data and standards instead of a generic tool.",
            category_id=ref["categories"][cat].id, innovation_type_code=kind, owner_user_id=real_owner.id, submitted_by_user_id=submitter.id,
            on_behalf_of_user_id=real_owner.id if on_behalf else None, sponsor_user_id=U[sponsor].id if sponsor else None,
            data_classification_code=cls, scalability_level_code=scale, risk_flags=list(risks), benefit_types=list(benefits),
            primary_kpi=kpi, baseline_value=baseline, target_value=target, expected_benefit="Less rework, faster delivery and fewer errors.",
            expected_timeline="Prototype in 6 weeks; pilot in the following quarter.", estimated_cost=250000, dependencies="Access to the source repositories.",
            current_state_code="DRAFT", current_stage_entered_at=started, org_unit_id=real_owner.primary_org_unit_id, declaration_accepted=True,
            score_latest=score, is_awarded=awarded, created_by=submitter.id, created_at=started, content={}, updated_at=started)
        db.add(ini)
        db.flush()
        isvc.set_members(db, ini, [{"user_id": U[m].id} for m in members])
        record_history(db, "initiative", ini.id, None, "DRAFT", "CREATE_DRAFT", submitter.id, at=started)
        target_state = side[0] if side else state
        stop = PATH.index(side[1]) if side else PATH.index(state)
        steps = PATH[1:stop + 1]
        gap = days_ago / (len(steps) + 2) if steps else 0
        prev, when = "DRAFT", started
        for s in steps:
            when = when + timedelta(days=gap)
            actor = submitter.id if s in ("SUBMITTED", "DEMO_VALIDATION") else PO.id
            record_history(db, "initiative", ini.id, prev, s, ACTIONS[s], actor, "Panel decision recorded." if s == "SHORTLISTED" else None, at=when)
            if s == "SUBMITTED":
                ini.code, ini.submitted_at = next_code(db, "INNO", 6), when
                db.add(InitiativeVersion(initiative_id=ini.id, version_no=1, snapshot=row(ini, exclude=("extra",)), reason="SUBMIT"))
            if s == "PRODUCTION":
                ini.implemented_on = when
            prev = s
        if side:
            when = when + timedelta(days=gap)
            record_history(db, "initiative", ini.id, prev, target_state, side[2], PO.id, comment, at=when)
            prev = target_state
        ini.current_state_code, ini.current_stage_entered_at = prev, when
        ini.is_in_idea_bank = prev == "NOT_SELECTED"
        if prev in ("SHORTLISTED", "NOT_SELECTED", "ON_HOLD") or (not side and PATH.index(state) >= 4):
            db.add(Feedback(entity_type="initiative", entity_id=ini.id,
                            decision_code="SHORTLISTED" if prev in PATH and PATH.index(prev) >= 4 else prev,
                            decision_reason=comment or "Strong problem evidence and a realistic plan.", strengths="• Clear problem with numbers\n• Reusable across teams",
                            improvements="• Add a measured baseline before the pilot", next_steps=isvc.NEXT.get(prev, ("",))[0],
                            score_shared=score, written_by=PO.id, published_at=when, read_at=when))
        ideas[key] = ini
        return ini

    idea("r2d", "fahim", "Requirement-to-Delivery Agent", "UNDER_REVIEW", 12, members=("sabbir",), score=None,
         solution="An agent that turns an approved requirement into user stories, test cases and a first code skeleton for review.")
    idea("kb", "fahim", "AES Codebase Knowledge Assistant", "PILOT", 60, members=("sabbir",), sponsor="admin", score=88.4, awarded=True,
         cat="ENG_PRODUCTIVITY", solution="Ask questions about any AES codebase in plain language and get answers with file links.", baseline="18", target="6")
    idea("ate", "lamia", "AI Test Engineer", "PROTOTYPE", 45, cat="QUALITY_DEVSECOPS", kind="QUALITY_DEVSECOPS", score=81.0, sponsor="judge2",
         solution="Generates and maintains regression tests from requirements and code changes.")
    idea("pmo", "sabbir", "PMO Early-Warning Agent", "SHORTLISTED", 25, cat="DATA_INTELLIGENCE", kind="DATA_ANALYTICS", score=77.5,
         solution="Reads project plans, timesheets and risks every night and warns the PMO about projects drifting off track.")
    idea("support", "sabbir", "Application Support Agent", "PRODUCTION", 150, cat="AUTOMATION", kind="AUTOMATION", score=84.0, sponsor="masterdata",
         solution="Answers level-1 support tickets from the knowledge base and routes the rest with a summary.", baseline="420", target="250")
    idea("dyn", "fahim", "Dynamics Implementation Assistant", "IMPACT_VERIFIED", 210, cat="BUSINESS_TRANSFORMATION", kind="BUSINESS_TRANSFORMATION",
         score=86.5, sponsor="admin", awarded=True, members=("lamia",), baseline="30", target="18",
         solution="Guides consultants through Dynamics configuration with checked templates for each module.", kpi="Days per module rollout")
    idea("dsp", "sabbir", "Developer Self-Service Platform", "SCALED", 300, cat="PLATFORM_REUSE", kind="PLATFORM_REUSE", score=90.2, sponsor="admin",
         awarded=True, scale="GROUP", baseline="16", target="2", kpi="Hours to get a new environment",
         solution="Engineers create environments, pipelines and access from one portal without raising tickets.", tech="Internal developer portal, templates, pipelines")
    idea("debt", "lamia", "Technical Debt Intelligence", "UNDER_REVIEW", 70, cat="QUALITY_DEVSECOPS", kind="DATA_ANALYTICS", score=58.0,
         side=("NOT_SELECTED", "UNDER_REVIEW", "REJECT"), comment="Good idea, but it overlaps with the code quality gates already planned for next quarter. Kept in the Idea Bank.",
         solution="Scores each system for technical debt and suggests the cheapest fixes first.")
    draft = idea("heat", "rahim", "Kiln shell heat recovery for raw-mill drying", "DRAFT", 3, cat="AUTOMATION", kind="PROCESS_IMPROVEMENT",
                 risks=("SAFETY",), tech="Heat exchanger and ducting; no IT needed", benefits=("COST_SAVING", "SUSTAINABILITY"), scale="BUSINESS")
    draft.expected_timeline, draft.primary_kpi, draft.declaration_accepted = None, None, False
    permit = idea("permit", "rahim", "Digital permit-to-work", "UNDER_REVIEW", 15, cat="BUSINESS_TRANSFORMATION", kind="PROCESS_IMPROVEMENT",
                  risks=("SAFETY",), sponsor="sponsor", tech="Phone form with QR tags on equipment", benefits=("RISK_REDUCTION",),
                  solution="Raise, approve and close work permits on a phone, with isolation points checked by QR code.")
    idea("qr", "rahim", "QR tracking for reusable packing bags", "SUBMITTED", 1.2, on_behalf="jabbar", cat="AUTOMATION", kind="PROCESS_IMPROVEMENT",
         risks=("NONE",), tech="QR labels and a phone scanner", benefits=("COST_SAVING",), scale="BUSINESS",
         solution="Each jumbo bag gets a QR label so we know how many times it was reused and where it is.")
    idea("fraud", "omar", "Supplier payment fraud signals", "TRIAGE", 6, cat="DATA_INTELLIGENCE", kind="DATA_ANALYTICS", cls="CONFIDENTIAL",
         risks=("FINANCE", "PRIVACY"), benefits=("RISK_REDUCTION",), solution="Flags unusual supplier bank changes and split invoices before payment.")
    idea("buddy", "priya", "Onboarding buddy chatbot", "UNDER_REVIEW", 40, cat="USER_EXPERIENCE", kind="UX", score=66.0,
         side=("ON_HOLD", "UNDER_REVIEW", "HOLD"), comment="Good fit, but it depends on the HR system upgrade. Review again on 15 January.",
         solution="Answers new joiners' common questions and books their first-week sessions.")
    idea("audit", "sadia", "Energy audit mobile checklist", "TRIAGE", 4, cat="AUTOMATION", kind="PROCESS_IMPROVEMENT", risks=("NONE",),
         tech="Phone checklist with photos", benefits=("PRODUCTIVITY", "SUSTAINABILITY"), scale="BUSINESS")

    # Idea review assignments for the Requirement-to-Delivery Agent (one done, one waiting)
    for j, key in (("judge1", "done"), ("judge2", "open")):
        db.add(ReviewAssignment(review_round_id=idea_round.id, reviewer_user_id=U[j].id, entity_type="initiative", entity_id=ideas["r2d"].id,
                                status="ASSIGNED", due_at=D(4), reviewer_weight=1))
    db.flush()
    fill_reviews(idea_round, {ideas["r2d"].id: 4.1}, lambda a: a.reviewer_user_id == U["judge2"].id, 20)

    # Clarification waiting for Rahim
    record_history(db, "initiative", permit.id, "UNDER_REVIEW", "CLARIFICATION_REQUESTED", "REQUEST_CLARIFICATION", PO.id, at=D(-1))
    permit.current_state_code, permit.current_stage_entered_at = "CLARIFICATION_REQUESTED", D(-1)
    db.add(ClarificationRequest(entity_type="initiative", entity_id=permit.id, requested_by=PO.id, status="OPEN", due_at=D(4),
                                question="How many permits are raised per week today, and how long does one take from request to approval?",
                                resume_state="UNDER_REVIEW", created_at=D(-1)))
    publish_event(db, "CLARIFICATION_REQUESTED", "initiative", permit.id, PO.id, users=[U["rahim"].id],
                  title=f"A reviewer asked a question: {permit.code}", body="How many permits are raised per week today?",
                  link=f"/ideas/{permit.code}", needs_action=True, vars={"code": permit.code, "due_date": D(4).isoformat()})
    db.add(Comment(entity_type="initiative", entity_id=ideas["ate"].id, body="Prototype covers the billing module. Next: the HR module.", created_by=U["lamia"].id))

    # Milestones, KPIs, measurements, verification
    for i, (t, due, st) in enumerate([("Generate tests for the billing module", -10, "DONE"), ("Run nightly in the pipeline", 5, "IN_PROGRESS"), ("Demo to the QA guild", 18, "PLANNED")]):
        db.add(Milestone(entity_type="initiative", entity_id=ideas["ate"].id, title=t, due_date=D(due).date(), status=st, sort_order=i,
                         owner_user_id=U["lamia"].id, completed_at=D(-10) if st == "DONE" else None))

    def kpi(key, name, unit, baseline, target, measures, benefit="PRODUCTIVITY", primary=True):
        k = Kpi(entity_type="initiative", entity_id=ideas[key].id, name=name, unit_code=unit, direction="DECREASE", baseline_value=baseline,
                baseline_period="Monthly average, last quarter", target_value=target, target_date=D(60).date(), is_primary=primary, benefit_type_code=benefit)
        db.add(k)
        db.flush()
        for days, value, status in measures:
            owner_id = ideas[key].owner_user_id
            db.add(KpiMeasurement(kpi_id=k.id, period_start=D(-days - 30).date(), period_end=D(-days).date(), measured_value=value,
                                  source="MANUAL", measured_by=owner_id, note="From the monthly service report.", verification_status=status,
                                  verification_type="FINANCE" if status != "UNVERIFIED" else None,
                                  verified_value=value if status == "VERIFIED" else None,
                                  verifier_user_id=U["finance"].id if status != "UNVERIFIED" else None,
                                  verified_at=D(-days + 3) if status != "UNVERIFIED" else None,
                                  verification_note="Checked against the time-sheet export." if status != "UNVERIFIED" else None))
        return k

    kpi("kb", "Hours searching code per engineer per month", "hours", 18, 6, [(8, 9, "UNVERIFIED")])
    kpi("support", "Support hours on level-1 tickets per month", "hours", 420, 250, [(45, 300, "VERIFIED"), (12, 262, "UNVERIFIED")])
    kpi("dyn", "Consultant hours per module rollout", "hours", 240, 150, [(70, 170, "VERIFIED"), (35, 156, "VERIFIED")])
    kpi("dyn", "Rework cost per rollout", "BDT", 900000, 500000, [(35, 540000, "VERIFIED")], "COST_SAVING", False)
    kpi("dsp", "Hours to get a new environment (per month, all teams)", "hours", 640, 80, [(120, 150, "VERIFIED"), (30, 96, "VERIFIED")])
    kpi("dsp", "Cloud spend on idle environments per month", "BDT", 1400000, 800000, [(30, 860000, "VERIFIED")], "COST_SAVING", False)

    for key, kind_, impact, reused in (("dsp", "COMPONENT", "544 engineering hours saved per month; idle cloud spend down BDT 540,000 per month.", ["Anwar Cement IT", "Group Finance systems"]),
                                       ("dyn", "TEMPLATE", "Module rollout effort down 35%; rework cost down BDT 360,000 per rollout.", ["Anwar Ispat ERP team"])):
        ini = ideas[key]
        ini.is_published_to_catalogue = True
        db.add(ReusableAsset(code=f"AST-{ini.code[5:]}", title=ini.title, description=ini.proposed_solution, asset_type=kind_,
                             source_initiative_id=ini.id, owner_user_id=ini.owner_user_id, maturity="PRODUCTION", technology=ini.technology_used,
                             impact_summary=impact, reused_by=reused, repo_url="https://git.anwargroup.example/aes/" + key,
                             is_published=True, published_at=ini.current_stage_entered_at))
        esvc.award_points(db, [ini.owner_user_id], 150, "IMPACT_VERIFIED", "IMPACT_VERIFIED", "initiative", ini.id)
    esvc.award_points(db, [ideas["dsp"].owner_user_id], 200, "SCALED", "REUSABLE_ASSET", "initiative", ideas["dsp"].id)
    esvc.award_points(db, [ideas["kb"].owner_user_id], 80, "PILOT", "PILOT_STARTED", "initiative", ideas["kb"].id)
    c6e[0].converted_initiative_id, ideas["kb"].challenge_entry_id = ideas["kb"].id, c6e[0].id

    # A few audit rows so the audit log is not empty on first open
    audit(db, U["admin"].id, "CONFIG_CHANGE", "system_setting", None, "Changed setting designated_reviewer_mailbox",
          {"designated_reviewer_mailbox": ["waeez.rahman@anwargroup.example", "innovation.office@anwargroup.example"]})
    audit(db, U["owner"].id, "CONFIG_CHANGE", "scorecard", A.id, "Changed scorecard A weights", {"FEASIBILITY": [15, 10], "EXPECTED_VALUE": [20, 25]})
    audit(db, U["admin"].id, "CONFIG_CHANGE", "user", U["judge4"].id, "Assigned role JUDGE to Rezaul Karim", {"role": [None, "JUDGE"]})
    audit(db, U["owner"].id, "OVERRIDE", "challenge", c4.id, "Extended METHODOLOGY deadline for everyone: network outage at the plant", {})
    audit(db, U["executive"].id, "EXPORT", "initiative", None, "Exported 11 ideas to CSV", {})
    db.commit()

    # Turn the events above into in-app notifications and a delivery log, without sending real email.
    smtp, settings.smtp_host = settings.smtp_host, ""
    try:
        while process_outbox(db, 200):
            pass
    finally:
        settings.smtp_host = smtp
    for n in db.scalars(select(InAppNotification).where(InAppNotification.created_at <= utcnow())).all():
        if n.event_type in ("REVIEW_ASSIGNED",) and rng.random() < 0.8:
            n.is_read = True
    db.add(NotificationDelivery(event_type="REVIEW_DUE_SOON", recipient_address="old.mailbox@anwargroup.example", channel="EMAIL",
                                template_code="EM-06", rendered_subject="[InnovateX] Review due - Methodology review",
                                rendered_body="You have reviews waiting.", status="FAILED", attempts=5,
                                error="550 5.1.1 mailbox unavailable (demo failure — use Retry)"))
    db.commit()


def seed_database(db: Session) -> None:
    """Load the demo data into whatever database the app uses.

    For a remote PostgreSQL the data is first built in a throw-away in-memory SQLite database and then copied
    over in bulk, table by table. That takes seconds instead of the minutes thousands of small round trips would."""
    from sqlalchemy import create_engine, insert
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    if db.get_bind().dialect.name == "sqlite":
        seed_all(db)
        return
    scratch = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(scratch)
    local = sessionmaker(bind=scratch, expire_on_commit=False)()
    seed_all(local)
    local.close()
    with scratch.connect() as src, db.get_bind().begin() as dst:
        for table in Base.metadata.sorted_tables:
            rows = [dict(r) for r in src.execute(select(table)).mappings().all()]
            for i in range(0, len(rows), 500):
                dst.execute(insert(table), rows[i:i + 500])
    scratch.dispose()


def reset(db: Session) -> None:
    from app.core.db import engine
    db.close()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


if __name__ == "__main__":
    from app.core.db import SessionLocal, engine
    import app.main  # noqa: F401  (registers every model on Base.metadata)

    session = SessionLocal()
    if "--reset" in sys.argv:
        reset(session)
        session = SessionLocal()
    else:
        Base.metadata.create_all(engine)
    if session.scalar(select(User.id).limit(1)):
        print("Database already has data. Use --reset to wipe and reload.")
    else:
        seed_database(session)
        print("Demo data loaded.")
    session.close()
