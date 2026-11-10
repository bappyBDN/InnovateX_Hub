"""Reference data: roles, permissions, master data, forms, scorecards, workflows, templates, settings.

This is the part a real deployment keeps (it would live in Alembic data migrations).
Demo people, challenges and ideas are in seed.py.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.admin.models import FeatureFlag, SystemSetting, WorkflowDefinition, WorkflowState, WorkflowTransition
from app.modules.delivery.models import AwardCategory, Badge
from app.modules.evaluation.models import RatingScale, Scorecard, ScorecardCriterion
from app.modules.identity.models import Permission, Role, RolePermission
from app.modules.masterdata.models import (Category, ChallengeDomain, FormField, FormSection, FormTemplate, LookupType,
                                           LookupValue, Skill)
from app.modules.notifications.models import NotificationRule, NotificationTemplate

ROLES = [  # code, level, sees all submissions, English, Bangla, description, assignable
    ("SUPER_ADMIN", 1, True, "Super Admin", "সুপার অ্যাডমিন", "Everything: settings, users, submissions, audit log.", True),
    ("DMD", 1, True, "DMD (full access)", "ডিএমডি (পূর্ণ অ্যাক্সেস)", "Deputy Managing Director: every feature, same as Super Admin.", True),
    ("PROGRAM_OWNER", 2, True, "Program Owner", "প্রোগ্রাম ওনার", "Runs challenges, shortlists, results and dashboards.", True),
    ("EXECUTIVE", 2, True, "Executive Viewer", "এক্সিকিউটিভ", "Reads all submissions and executive dashboards.", True),
    ("JUDGE", 3, True, "Judge", "বিচারক", "Reads all submissions; scores only assigned entries.", True),
    ("ADMIN", 6, False, "Admin (master data)", "অ্যাডমিন", "Organization and master data.", True),
    ("HR", 6, False, "HR", "এইচআর", "Rewards, certificates and recognition.", True),
    ("FINANCE_VERIFIER", 6, False, "Finance Verifier", "ফাইন্যান্স ভেরিফায়ার", "Verifies measured impact.", True),
    ("SPONSOR", 6, False, "Sponsor", "স্পন্সর", "Confirms the problem, approves pilots and confirms value.", True),
    ("EMPLOYEE", 9, False, "Participant / Employee", "কর্মী", "Public challenge info, own entries and own ideas.", False),
]

PERMISSIONS = {  # permission code: roles that hold it
    "challenge.manage": ["SUPER_ADMIN", "PROGRAM_OWNER"], "challenge.view_all": ["SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE", "JUDGE"],
    "submission.view_all": ["SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE", "JUDGE"], "review.score": ["JUDGE", "SUPER_ADMIN", "PROGRAM_OWNER"],
    "review.assign": ["SUPER_ADMIN", "PROGRAM_OWNER"], "shortlist.confirm": ["SUPER_ADMIN", "PROGRAM_OWNER"],
    "award.publish": ["SUPER_ADMIN", "PROGRAM_OWNER"], "initiative.triage": ["SUPER_ADMIN", "PROGRAM_OWNER"],
    "initiative.decide": ["SUPER_ADMIN", "PROGRAM_OWNER"], "initiative.approve_pilot": ["SUPER_ADMIN", "PROGRAM_OWNER", "SPONSOR"],
    "impact.verify": ["SUPER_ADMIN", "PROGRAM_OWNER", "FINANCE_VERIFIER", "SPONSOR"],
    "dashboard.program": ["SUPER_ADMIN", "PROGRAM_OWNER"], "dashboard.executive": ["SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE"],
    "export.create": ["SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE"], "reward.manage": ["SUPER_ADMIN", "HR"],
    "admin.users": ["SUPER_ADMIN"], "admin.settings.edit": ["SUPER_ADMIN"], "admin.audit.view": ["SUPER_ADMIN"],
    "admin.masterdata": ["SUPER_ADMIN", "ADMIN"], "admin.forms": ["SUPER_ADMIN", "PROGRAM_OWNER"],
    "admin.scorecards": ["SUPER_ADMIN", "PROGRAM_OWNER"], "admin.notifications": ["SUPER_ADMIN", "PROGRAM_OWNER"],
    "idea.submit": ["EMPLOYEE"], "challenge.register": ["EMPLOYEE"],
}

LOOKUPS = {
    "INNOVATION_TYPE": [("AI_AGENTIC", "AI / Agentic AI"), ("AUTOMATION", "Automation"), ("PROCESS_IMPROVEMENT", "Process improvement"),
                        ("PRODUCT", "Product"), ("PLATFORM_REUSE", "Platform / Reuse"), ("DATA_ANALYTICS", "Data / Analytics"),
                        ("UX", "User experience"), ("QUALITY_DEVSECOPS", "Quality / DevSecOps"),
                        ("BUSINESS_TRANSFORMATION", "Business transformation / FDE"), ("OTHER", "Other")],
    "BENEFIT_TYPE": [("PRODUCTIVITY", "Productivity"), ("QUALITY", "Quality"), ("COST_SAVING", "Cost saving"),
                     ("COST_AVOIDANCE", "Cost avoidance"), ("REVENUE", "Revenue"), ("CYCLE_TIME", "Cycle time / speed"),
                     ("USER_EXPERIENCE", "User experience"), ("RISK_REDUCTION", "Risk reduction"),
                     ("SUSTAINABILITY", "Sustainability"), ("COMPLIANCE", "Compliance"), ("OTHER", "Other")],
    "RISK_TYPE": [("SECURITY", "Security"), ("LEGAL", "Legal"), ("PRIVACY", "Privacy"), ("FINANCE", "Finance"),
                  ("SAFETY", "Safety"), ("AI", "AI"), ("NONE", "None")],
    "DATA_CLASSIFICATION": [("PUBLIC", "Public"), ("INTERNAL", "Internal"), ("CONFIDENTIAL", "Confidential"), ("RESTRICTED", "Restricted")],
    "SCALABILITY_LEVEL": [("TEAM", "Team"), ("FUNCTION", "Function"), ("BUSINESS", "Business unit"), ("COMPANY", "Company"), ("GROUP", "Group")],
    "KPI_UNIT": [("hours", "Hours"), ("BDT", "BDT"), ("%", "Percent"), ("count", "Count"), ("days", "Days"), ("kWh", "kWh")],
    "EVIDENCE_TYPE": [("DOCUMENT", "Document"), ("SCREENSHOT", "Screenshot"), ("VIDEO", "Video"), ("DATASET", "Dataset"),
                      ("CALCULATION", "Calculation"), ("SOURCE_CODE", "Source code")],
}

CATEGORIES = [("AI_AGENTIC", "AI & Agentic AI", "এআই ও এজেন্টিক এআই", "#0B6E6E"), ("ENG_PRODUCTIVITY", "Engineering Productivity", "ইঞ্জিনিয়ারিং উৎপাদনশীলতা", "#2459A6"),
              ("QUALITY_DEVSECOPS", "Quality & DevSecOps", "কোয়ালিটি ও ডেভসেকঅপস", "#1E7F4F"),
              ("AUTOMATION", "Automation & Process Improvement", "অটোমেশন ও প্রক্রিয়া উন্নয়ন", "#B26B00"),
              ("PLATFORM_REUSE", "Platform & Reuse", "প্ল্যাটফর্ম ও পুনর্ব্যবহার", "#55657A"),
              ("BUSINESS_TRANSFORMATION", "Business Transformation / FDE", "ব্যবসায়িক রূপান্তর", "#7A4FB5"),
              ("DATA_INTELLIGENCE", "Data & Intelligence", "ডেটা ও ইন্টেলিজেন্স", "#0E7490"), ("USER_EXPERIENCE", "User Experience", "ব্যবহারকারীর অভিজ্ঞতা", "#B42318")]

DOMAINS = [("OPERATIONS", "Operations", "অপারেশনস"), ("ENERGY", "Energy", "জ্বালানি"), ("SAFETY", "Safety", "নিরাপত্তা"),
           ("HR", "Human Resources", "মানবসম্পদ"), ("FINANCE", "Finance", "অর্থ"), ("PROCUREMENT", "Procurement", "ক্রয়"),
           ("SALES", "Sales", "বিক্রয়"), ("CUSTOMER_SERVICE", "Customer Service", "গ্রাহক সেবা"),
           ("SUSTAINABILITY", "Sustainability", "টেকসই উন্নয়ন"), ("TECHNOLOGY", "Technology", "প্রযুক্তি")]

SKILLS = [("PROCESS_ENGINEERING", "Process engineering", "Operations"), ("MAINTENANCE", "Maintenance", "Operations"),
          ("ENERGY_AUDIT", "Energy audit", "Operations"), ("DATA_ANALYSIS", "Data analysis", "Data"),
          ("MACHINE_LEARNING", "Machine learning", "Data"), ("SOFTWARE_DEV", "Software development", "Technology"),
          ("TESTING", "Software testing", "Technology"), ("UX_DESIGN", "UX design", "Technology"),
          ("PROJECT_MGMT", "Project management", "Business"), ("FINANCE_ANALYSIS", "Financial analysis", "Business"),
          ("SAP", "SAP / ERP", "Technology"), ("SAFETY_MGMT", "Safety management", "Operations")]

SCALE_LEVELS = [
    {"value": 1, "label": "No evidence", "description": "Nothing supports this point."},
    {"value": 2, "label": "Weak", "description": "Some claims, little support."},
    {"value": 3, "label": "Acceptable", "description": "Reasonable and believable."},
    {"value": 4, "label": "Strong", "description": "Clear evidence with data."},
    {"value": 5, "label": "Outstanding", "description": "Outstanding, with proof."},
]

SCORECARD_A = [  # idea / methodology review (before any prototype)
    ("PROBLEM_IMPORTANCE", "Problem importance", 25, None, False, "Is this a real, painful problem for the business?"),
    ("EXPECTED_VALUE", "Expected value", 25, None, True, "How much time, cost or quality could it improve?"),
    ("TRANSFORMATION_FIT", "Fit with transformation goals", 15, None, False, "Does it support our approved priorities?"),
    ("ORIGINALITY", "Originality", 15, None, False, "Is it new, or a clear improvement on what we do today?"),
    ("FEASIBILITY", "Feasibility", 10, 2, False, "Can we build it with our skills, data and tools?"),
    ("REUSE_POTENTIAL", "Reuse potential", 10, None, False, "Could other teams or businesses use it too?"),
]
SCORECARD_B = [  # demo and final judging (official InnovateX model)
    ("TRANSFORMATION_IMPACT", "Business / AES transformation impact", 25, None, True, "Magnitude and relevance of the problem and value."),
    ("ALIGNMENT", "Alignment with transformation journey", 15, None, False, "Alignment to approved strategic priorities."),
    ("INNOVATION", "Innovation / originality", 15, None, False, "Newness or meaningful improvement over current practice."),
    ("WORKING_PROTOTYPE", "Working prototype / technical quality", 15, 2, False, "Evidence, feasibility, quality and robustness."),
    ("IMPROVEMENT", "Productivity / quality / cost improvement", 15, None, False, "Measurable improvement potential or evidence."),
    ("SCALABILITY", "Scalability & reusability", 10, None, False, "Potential to reuse across teams, functions and businesses."),
    ("ADOPTION_UX", "Adoption & user experience", 5, None, False, "Usability and likelihood of sustained adoption."),
]

FORMS = {
    "METHODOLOGY_STD": ("Standard methodology form", "METHODOLOGY", [
        ("problem", "Your understanding of the problem", "Show that you understand who has the problem and how big it is.", ["Problem importance"], [
            ("problem_understanding", "What is the problem, in your own words?", "LONG_TEXT", True, 3000, "Say who is affected and how often it happens. Good example: \"Kiln 2 runs about 40 minutes a day on high heat while the raw mill is stopped.\""),
            ("current_situation", "How is it handled today?", "LONG_TEXT", True, 2000, "Describe the current process and any numbers you have.")]),
        ("approach", "Your approach", "Explain the steps in simple words.", ["Feasibility", "Originality"], [
            ("approach", "How will you solve the problem?", "LONG_TEXT", True, 3000, "Explain the steps in simple words."),
            ("data_systems", "Data or systems you need", "LONG_TEXT", False, 1500, "For example: SAP PM orders, sensor logs, HR records."),
            ("tools", "Tools, methods or technology", "TEXT", False, 300, "Any method counts — it does not have to be IT.")]),
        ("plan", "Work plan", "A realistic plan that fits the build phase.", ["Feasibility"], [
            ("work_plan", "Milestones and timing", "LONG_TEXT", True, 2000, "List 3 to 6 milestones with weeks."),
            ("duration_weeks", "Total duration (weeks)", "NUMBER", False, None, "")]),
        ("impact", "Expected impact", "Judges look for a number, a baseline and a target.", ["Expected value"], [
            ("expected_impact", "What will improve, and by how much?", "LONG_TEXT", True, 2000, "Give the baseline and your target."),
            ("kpis", "KPIs", "KPI_TABLE", False, None, "Add one row per KPI: name, baseline, target and unit.")]),
        ("risks", "Risks and resources", "Be honest about what could go wrong.", ["Feasibility"], [
            ("risks", "Main risks and how you will handle them", "LONG_TEXT", True, 1500, ""),
            ("resources_needed", "Resources you need", "LONG_TEXT", False, 1000, "People, access, budget, equipment.")]),
        ("team", "Team skills", "Who does what.", ["Reuse potential"], [
            ("team_skills", "Skills in your team and any gaps", "LONG_TEXT", True, 1500, "If you work alone, describe your own skills."),
            ("reuse", "Who else could use this?", "LONG_TEXT", False, 1000, "Other plants, teams or businesses.")]),
        ("declaration", "Declaration", "", [], [
            ("declaration", "This is my or my team's original work, and it contains no secret client or third-party data.", "DECLARATION", True, None, "")]),
    ]),
    "PROTOTYPE_STD": ("Standard prototype form", "PROTOTYPE", [
        ("built", "What you built", "", ["Working prototype / technical quality"], [
            ("what_built", "What did you build?", "LONG_TEXT", True, 3000, "Describe what works today."),
            ("how_to_try", "Link to try it", "URL", False, None, "Add access notes in the next field, never passwords."),
            ("access_notes", "How to try it", "LONG_TEXT", False, 1000, ""),
            ("demo_video", "Demo video link", "URL", False, None, "")]),
        ("results", "Results so far", "", ["Productivity / quality / cost improvement"], [
            ("results_so_far", "What results have you seen?", "LONG_TEXT", True, 2000, "Use numbers where you can."),
            ("changes_from_methodology", "What changed from your methodology?", "LONG_TEXT", False, 1500, "")]),
    ]),
    "FINAL_STD": ("Standard final project form", "FINAL", [
        ("solution", "Your solution", "", ["Business / AES transformation impact", "Working prototype / technical quality"], [
            ("solution_summary", "Summary of the working solution", "LONG_TEXT", True, 3000, ""),
            ("demo_link", "Demo or repository link", "URL", False, None, "")]),
        ("evidence", "Evidence and results", "", ["Productivity / quality / cost improvement"], [
            ("results", "Measured results", "LONG_TEXT", True, 2500, "Baseline, what you measured and how."),
            ("kpis", "KPIs", "KPI_TABLE", False, None, "")]),
        ("next", "Pilot plan", "", ["Scalability & reusability", "Adoption & user experience"], [
            ("pilot_plan", "How would a pilot run?", "LONG_TEXT", True, 2000, "Where, with whom, for how long."),
            ("support_needed", "Support you need", "LONG_TEXT", False, 1000, "")]),
    ]),
}

INITIATIVE_STATES = [  # code, name, group, initial, terminal, SLA hours, label for the owner
    ("DRAFT", "Draft", "DRAFT", True, False, None, "Draft"),
    ("UNDER_REVIEW", "In review", "ACTIVE", False, False, 240, "With the judges"),
    ("SHORTLISTED", "Shortlisted", "SUCCESS", False, False, None, "Shortlisted: build your demo"),
    ("NOT_SELECTED", "Not selected (Idea Bank)", "CLOSED", False, False, None, "In the Idea Bank"),
    ("PROTOTYPE", "Demo in review", "ACTIVE", False, False, None, "Demo with the judges"),
    ("PILOT", "Pilot", "ACTIVE", False, False, None, "In pilot"),
    ("PRODUCTION", "Live", "SUCCESS", False, False, None, "Live"),
    ("IMPACT_VERIFIED", "Impact verified", "SUCCESS", False, False, None, "Impact verified"),
    ("CLOSED", "Closed", "CLOSED", False, True, None, "Closed"),
]
# Only the decisions a person makes are buttons. Submitting, sending a demo to the judges and the judges' verdict on
# the demo and the pilot move the idea on by themselves (see evaluation/gates.py).
INITIATIVE_TRANSITIONS = [  # from, to, action, button text, permission (None = owner), comment required, guard, event
    ("DRAFT", "UNDER_REVIEW", "SUBMIT", "Submit idea", None, False, {}, "INITIATIVE_SUBMITTED"),
    ("UNDER_REVIEW", "SHORTLISTED", "SHORTLIST", "Shortlist", "initiative.decide", True, {}, "ENTRY_SHORTLISTED"),
    ("UNDER_REVIEW", "NOT_SELECTED", "REJECT", "Not selected", "initiative.decide", True, {}, None),
    ("UNDER_REVIEW", "NOT_SELECTED", "MARK_DUPLICATE", "Duplicate of an earlier idea", "initiative.decide", True, {}, "DUPLICATE_LINKED"),
    ("NOT_SELECTED", "UNDER_REVIEW", "REOPEN", "Reopen from Idea Bank", "initiative.decide", True, {}, None),
    ("PILOT", "PRODUCTION", "GO_LIVE", "Mark as live", "initiative.approve_pilot", False, {"requires_measurement": True}, None),
    ("PILOT", "CLOSED", "STOP", "Stop pilot", "initiative.approve_pilot", True, {}, None),
    ("PRODUCTION", "IMPACT_VERIFIED", "VERIFY_IMPACT", "Mark impact verified", "impact.verify", False,
     {"requires_verified_measurement": True}, "IMPACT_VERIFIED"),
    ("PRODUCTION", "CLOSED", "CLOSE", "Close", "initiative.decide", True, {}, None),
    ("IMPACT_VERIFIED", "CLOSED", "CLOSE", "Close", "initiative.decide", False, {}, None),
]
# Older idea states and the state each one became when the workflow was simplified.
RETIRED_IDEA_STATES = {"SUBMITTED": "UNDER_REVIEW", "TRIAGE": "UNDER_REVIEW", "CLARIFICATION_REQUESTED": "UNDER_REVIEW",
                       "ON_HOLD": "NOT_SELECTED", "DUPLICATE": "NOT_SELECTED", "DEMO_VALIDATION": "PROTOTYPE",
                       "SCALED": "IMPACT_VERIFIED"}
FOOTER = "\n\nOpen: {{secure_link}}\n\nThis is an automatic message from {{app_name}}. Details are shown only after you sign in."
TEMPLATES = [
    ("EM-01", "INITIATIVE_SUBMITTED", "[InnovateX] {{innovation_id}} submitted successfully",
     "Your idea was submitted.\n\nInnovation ID: {{innovation_id}}\nTitle: {{title}}\nSubmitted: {{submitted_at}}\nStatus: {{status}}\n\nNext step: the innovation office will check it within {{review_sla}}." + FOOTER),
    ("EM-02", "INITIATIVE_NEEDS_REVIEW", "[InnovateX] New initiative requires review - {{innovation_id}}",
     "A new idea was submitted.\n\nInnovation ID: {{innovation_id}}\nTitle: {{title}}\nSubmitter: {{submitter}}\nOwner: {{owner}}\nFunction: {{function}}\nClassification: {{classification}}\nSummary: {{summary}}\nReview SLA: {{review_sla}}" + FOOTER),
    ("EM-03", "REVIEW_ASSIGNED", "[InnovateX] Review assigned - {{entry_code}}",
     "A review was assigned to you.\n\nItem: {{entry_code}}\nRound: {{round}}\nDue: {{due_date}}" + FOOTER),
    ("EM-04", "CLARIFICATION_REQUESTED", "[InnovateX] Clarification required - {{code}}",
     "The panel asked a question about {{code}}.\n\nPlease reply by {{due_date}}. The review is paused until you answer." + FOOTER),
    ("EM-04B", "CLARIFICATION_ANSWERED", "[InnovateX] Reply received - {{code}}", "The owner replied to your question on {{code}}. You can continue the review." + FOOTER),
    ("EM-05", "INITIATIVE_STATE_CHANGED", "[InnovateX] Status update - {{innovation_id}}",
     "The status of {{innovation_id}} ({{title}}) changed.\n\nFrom: {{old_status}}\nTo: {{new_status}}" + FOOTER),
    ("EM-06", "REVIEW_DUE_SOON", "[InnovateX] Review due - {{round}}", "You have reviews waiting in {{round}}. Due: {{due_date}}" + FOOTER),
    ("EM-07", "ENTRY_SHORTLISTED", "[InnovateX] {{decision}} - {{entry_code}}",
     "Good news about your entry in {{challenge}}.\n\n{{message}}\n\nDecision: {{decision}}\nChallenge: {{challenge}}\nEntry: {{entry_code}}\n\nThe judges' written feedback and your next steps are ready. Sign in to read them." + FOOTER),
    ("EM-07B", "ENTRY_NOT_SHORTLISTED", "[InnovateX] {{decision}} - {{entry_code}}",
     "Thank you for taking part in {{challenge}}.\n\n{{message}}\n\nDecision: {{decision}}\nChallenge: {{challenge}}\nEntry: {{entry_code}}\n\nThe judges wrote feedback on what worked well and what to improve. Sign in to read it." + FOOTER),
    ("EM-08", "AWARD_PUBLISHED", "[InnovateX] {{headline}} - {{challenge}}",
     "The results of {{challenge}} are published.\n\n{{message}}\n\nResult: {{result}}\nChallenge: {{challenge}}\nEntry: {{entry_code}}\n\nSign in to see the full results, your scores and the judges' feedback." + FOOTER),
    ("EM-09", "ENTRY_REGISTERED", "[InnovateX] You're registered - {{entry_code}}", "You are registered for {{challenge}}.\n\nEntry: {{entry_code}}" + FOOTER),
    ("EM-10", "TEAM_JOIN_REQUESTED", "[InnovateX] Join request for {{team}}", "{{requester}} asked to join {{team}}. Approve or decline the request." + FOOTER),
    ("EM-11", "TEAM_JOIN_APPROVED", "[InnovateX] You're in: {{team}}", "Your request to join {{team}} was approved." + FOOTER),
    ("EM-12", "METHODOLOGY_SUBMITTED", "[InnovateX] Methodology submitted - {{entry_code}}", "Version {{version}} of the methodology for {{entry_code}} was submitted. You can edit and resubmit until the deadline." + FOOTER),
    ("EM-13", "CHALLENGE_PUBLISHED", "[InnovateX] New challenge: {{challenge}}", "A new challenge is open: {{challenge}}." + FOOTER),
]

# The first wording of the templates that were rewritten. A database that still holds exactly this text gets the new
# wording at start; a template the admin edited is left alone.
OLD_TEMPLATES = {
    "EM-07": ("[InnovateX] {{decision}} - {{entry_code}}",
              "{{decision}} in {{challenge}}.\n\nEntry: {{entry_code}}\nSign in to read the next steps and your feedback." + FOOTER),
    "EM-07B": ("[InnovateX] {{decision}} - {{entry_code}}",
               "{{decision}} for {{challenge}}.\n\nEntry: {{entry_code}}\nSign in to read your written feedback." + FOOTER),
    "EM-08": ("[InnovateX] Results published - {{challenge}}", "Results for {{challenge}} are published.\n\nEntry: {{entry_code}}" + FOOTER),
}


def ensure_templates(db: Session) -> None:
    current = {code: (subject, body) for code, _, subject, body in TEMPLATES}
    changed = False
    for tpl in db.scalars(select(NotificationTemplate).where(NotificationTemplate.code.in_(list(OLD_TEMPLATES)))).all():
        if (tpl.subject_template, tpl.body_template) == OLD_TEMPLATES[tpl.code]:
            tpl.subject_template, tpl.body_template = current[tpl.code]
            tpl.version = (tpl.version or 1) + 1
            changed = True
    if changed:
        db.commit()


SETTINGS = [
    ("designated_reviewer_mailbox", "innovation.office@anwargroup.example", "Mailbox that receives every new idea (not one person's email)."),
    ("escalation_mailbox", "dt.head@anwargroup.example", "Receives overdue-review escalations."),
    ("appeal_window_days", 5, "Working days an entrant has to raise an appeal."),
    ("max_upload_mb", 25, "Largest file that can be uploaded."),
    ("default_join_link_days", 7, "Default expiry of a team join link."),
    ("triage_sla_days", 5, "Working days for the first response to a new idea."),
    ("review_sla_days", 10, "Working days for a review."),
    ("retention_years_closed", 3, "Years closed ideas are kept."),
    ("signup_enabled", True, "Let employees create their own account on the sign-up page."),
    ("signup_allowed_domains", "", "Comma-separated email domains allowed to sign up (empty = any). Invitations ignore this."),
    ("team_submit_leader_only", False, "If on, only the team leader can press Submit on team submissions."),
]
# Added after the first release: created on start when missing, so existing databases get them too.
LATER_SETTINGS = [
    ("aes_team_lead_name", "Asim Ibne Ilyus", "AES team lead: Team Lead of every AES project in Project Rewards and "
     "one of the people a reward challenge can go to."),
    ("aes_team_lead_email", "asim.ilyus@anwargroup.com", "Email of the AES team lead; reward challenge emails go here."),
    ("aes_team_lead_designation", "Lead Product", "Designation of the AES team lead."),
    ("aes_team_lead_employee_id", "013812", "Employee number of the AES team lead."),
    ("projects_auto_sync_enabled", True, "Import and sync the Project Rewards projects from ProjectFlow and Process "
     "Brain automatically once a day. Projects removed there are removed here too."),
    ("projects_auto_sync_time", "06:00", "Time of the daily automatic project import and sync (HH:MM, Asia/Dhaka)."),
    ("projects_last_auto_sync", "", "Filled in by the system: when the daily project import last ran and its result."),
]


def ensure_settings(db: Session) -> None:
    have = set(db.scalars(select(SystemSetting.key)).all())
    missing = [(k, v, d) for k, v, d in LATER_SETTINGS if k not in have]
    for key, value, desc in missing:
        db.add(SystemSetting(key=key, value=value, description=desc))
    # The first release shipped a placeholder AES lead ("Asim", no email): fill in the real details once.
    upgraded = False
    for key, placeholder in PLACEHOLDER_SETTINGS.items():
        row = db.scalar(select(SystemSetting).where(SystemSetting.key == key))
        if row and row.value == placeholder:
            row.value = next(v for k, v, _ in LATER_SETTINGS if k == key)
            upgraded = True
    if missing or upgraded:
        db.commit()


PLACEHOLDER_SETTINGS = {"aes_team_lead_name": "Asim", "aes_team_lead_email": ""}
FLAGS = [("PEOPLES_CHOICE", False, "People's Choice voting (shows finalists' public summaries)."),
         ("LEADERBOARDS", False, "Leaderboards per challenge. Off by default for privacy."),
         ("AI_IDEA_COACH", False, "AI idea coach (Release 3)."), ("AI_REVIEW_SUMMARY", False, "AI review summary (Release 3)."),
         ("TEAMS_NOTIFY", False, "Microsoft Teams notifications (Release 2).")]
AWARDS = [("INNOVATION_OF_YEAR", "AES Transformation Innovation of the Year"), ("BEST_AI", "Best AI / Agentic Innovation"),
          ("BEST_BUSINESS_IMPACT", "Best Business Impact Innovation"), ("BEST_ENG_PRODUCTIVITY", "Best Engineering Productivity Innovation"),
          ("BEST_AUTOMATION", "Best Automation Innovation"), ("BEST_REUSABLE_ASSET", "Best Reusable AES Asset"),
          ("RISING_INNOVATOR", "Rising Innovator Award"), ("PEOPLES_CHOICE", "People's Choice Award")]
BADGES = [("CONTRIBUTOR", "Contributor", "Submitted a qualified idea.", "sprout"), ("SHORTLISTED", "Shortlisted", "An entry or idea was shortlisted.", "list-checks"),
          ("FINALIST", "Finalist", "Reached the final or Demo Day.", "presentation"), ("WINNER", "Winner", "Won a challenge.", "trophy"),
          ("PILOT_STARTED", "Pilot started", "An idea reached pilot.", "flask-conical"), ("IMPACT_VERIFIED", "Impact verified", "Impact confirmed by a verifier.", "badge-check"),
          ("REUSABLE_ASSET", "Reusable AES asset", "A solution reused by other teams.", "recycle")]


def seed_reference(db: Session) -> dict:
    """Returns handy lookups: roles, scorecards, forms, categories, domains."""
    ref: dict = {"roles": {}, "scorecards": {}, "forms": {}, "categories": {}, "domains": {}, "skills": {}, "awards": {}}

    for code, level, sees_all, name, bn, desc, assignable in ROLES:
        ref["roles"][code] = Role(code=code, hierarchy_level=level, sees_all_submissions=sees_all, name_i18n={"en": name, "bn": bn},
                                  description=desc, is_assignable=assignable)
        db.add(ref["roles"][code])
    db.flush()
    for code, roles in PERMISSIONS.items():
        perm = Permission(code=code, module=code.split(".")[0], description=code.replace(".", " ").replace("_", " "))
        db.add(perm)
        db.flush()
        for r in roles:
            db.add(RolePermission(role_id=ref["roles"][r].id, permission_id=perm.id))

    for type_code, values in LOOKUPS.items():
        lt = LookupType(code=type_code, name=type_code.replace("_", " ").title())
        db.add(lt)
        db.flush()
        for i, (code, label) in enumerate(values):
            db.add(LookupValue(lookup_type_id=lt.id, code=code, label_i18n={"en": label}, sort_order=i))
    for code, name, bn, color in CATEGORIES:
        ref["categories"][code] = Category(code=code, name_i18n={"en": name, "bn": bn}, color=color)
        db.add(ref["categories"][code])
    for code, name, bn in DOMAINS:
        ref["domains"][code] = ChallengeDomain(code=code, name_i18n={"en": name, "bn": bn})
        db.add(ref["domains"][code])
    for code, name, cat in SKILLS:
        ref["skills"][code] = Skill(code=code, name_i18n={"en": name}, category=cat)
        db.add(ref["skills"][code])

    scale = RatingScale(code="ONE_TO_FIVE", min_value=1, max_value=5, step=1, levels=SCALE_LEVELS)
    db.add(scale)
    db.flush()
    for code, name, purpose, criteria in (("IDEA_REVIEW_A", "Scorecard A — idea and methodology review", "METHODOLOGY", SCORECARD_A),
                                          ("FINAL_JURY_B", "Scorecard B — demo and final judging", "FINAL_JURY", SCORECARD_B)):
        card = Scorecard(code=code, name_i18n={"en": name}, purpose=purpose, version=1, status="PUBLISHED",
                         rating_scale_id=scale.id, total_weight=100)
        db.add(card)
        db.flush()
        for i, (c_code, c_name, weight, minimum, tie, guidance) in enumerate(criteria):
            db.add(ScorecardCriterion(scorecard_id=card.id, code=c_code, name_i18n={"en": c_name}, guidance_i18n={"en": guidance},
                                      weight_pct=weight, min_rating=minimum, is_tie_breaker=tie, comment_required_at=[1, 5], sort_order=i))
        ref["scorecards"][code] = card

    for code, (name, purpose, sections) in FORMS.items():
        tpl = FormTemplate(code=code, name_i18n={"en": name}, purpose=purpose, version=1, status="PUBLISHED")
        db.add(tpl)
        db.flush()
        for si, (s_code, title, help_text, scored_on, fields) in enumerate(sections):
            sec = FormSection(form_template_id=tpl.id, code=s_code, title_i18n={"en": title}, help_i18n={"en": help_text},
                              sort_order=si, scored_on=scored_on)
            db.add(sec)
            db.flush()
            for fi, (key, label, kind, required, max_len, help_) in enumerate(fields):
                db.add(FormField(form_section_id=sec.id, field_key=key, label_i18n={"en": label}, help_i18n={"en": help_},
                                 field_type=kind, is_required=required, validation={"max_len": max_len} if max_len else {},
                                 sort_order=fi, placeholder_i18n={}, options=[]))
        ref["forms"][code] = tpl

    wf = WorkflowDefinition(code="INITIATIVE_STD", entity_type="initiative", description="Standard open-idea lifecycle with four decision gates.")
    db.add(wf)
    db.flush()
    for i, (code, name, group, initial, terminal, sla, owner_label) in enumerate(INITIATIVE_STATES):
        db.add(WorkflowState(workflow_definition_id=wf.id, code=code, name_i18n={"en": name}, state_group=group, is_initial=initial,
                             is_terminal=terminal, sla_hours=sla, visible_to_owner_as_i18n={"en": owner_label}, sort_order=i))
    for i, (src, dst, action, label, perm, comment, guard, event) in enumerate(INITIATIVE_TRANSITIONS):
        db.add(WorkflowTransition(workflow_definition_id=wf.id, from_state=src, to_state=dst, action_code=action,
                                  label_i18n={"en": label}, allowed_permission=perm, requires_comment=comment, guard_rules=guard,
                                  emits_event=event, sort_order=i))
    for code, event, subject, body in TEMPLATES:
        db.add(NotificationTemplate(code=code, event_type=event, channel="EMAIL", locale="en", subject_template=subject, body_template=body))
    db.add(NotificationRule(event_type="INITIATIVE_NEEDS_REVIEW", channel="EMAIL", recipient_type="SETTING",
                            recipient_value="designated_reviewer_mailbox", template_code="EM-02"))
    db.add(NotificationRule(event_type="REVIEW_DUE_SOON", channel="EMAIL", recipient_type="SETTING",
                            recipient_value="escalation_mailbox", template_code="EM-06", is_active=False))
    for key, value, desc in SETTINGS + LATER_SETTINGS:
        db.add(SystemSetting(key=key, value=value, description=desc))
    for code, on, desc in FLAGS:
        db.add(FeatureFlag(code=code, is_enabled=on, description=desc, rules={}))
    for code, name in AWARDS:
        ref["awards"][code] = AwardCategory(code=code, name_i18n={"en": name}, description_i18n={},
                                            eligibility_rules={"requires_working_evidence": True})
        db.add(ref["awards"][code])
    for code, name, desc, icon in BADGES:
        db.add(Badge(code=code, name_i18n={"en": name}, description_i18n={"en": desc}, icon=icon, rule={}))
    db.flush()
    return ref


def ensure_simple_workflow(db: Session) -> None:
    """Moves an existing database to the simplified idea workflow. Safe to run on every start.

    1. The idea workflow rows are replaced when they still hold the older states.
    2. Ideas in a retired state move to the state that replaced it (with a history line).
    3. The two workflow definitions for challenges and entries, which no code read, are removed.
    4. The open-idea review round and its default judge panel exist, so new ideas can go straight to judges."""
    from app.core.events import record_history
    from app.modules.evaluation.models import Panel, ReviewRound
    from app.modules.initiatives.models import Initiative

    changed = False
    wf = db.scalar(select(WorkflowDefinition).where(WorkflowDefinition.code == "INITIATIVE_STD"))
    if wf:
        codes = set(db.scalars(select(WorkflowState.code).where(WorkflowState.workflow_definition_id == wf.id)).all())
        if codes != {s[0] for s in INITIATIVE_STATES}:
            for model in (WorkflowState, WorkflowTransition):
                for row_ in db.scalars(select(model).where(model.workflow_definition_id == wf.id)).all():
                    db.delete(row_)
            db.flush()
            for i, (code, name, group, initial, terminal, sla, owner_label) in enumerate(INITIATIVE_STATES):
                db.add(WorkflowState(workflow_definition_id=wf.id, code=code, name_i18n={"en": name}, state_group=group,
                                     is_initial=initial, is_terminal=terminal, sla_hours=sla,
                                     visible_to_owner_as_i18n={"en": owner_label}, sort_order=i))
            for i, (src, dst, action, label, perm, comment, guard, event) in enumerate(INITIATIVE_TRANSITIONS):
                db.add(WorkflowTransition(workflow_definition_id=wf.id, from_state=src, to_state=dst, action_code=action,
                                          label_i18n={"en": label}, allowed_permission=perm, requires_comment=comment,
                                          guard_rules=guard, emits_event=event, sort_order=i))
            wf.description = "Simplified open-idea lifecycle: review, shortlist, demo, pilot, live, impact."
            changed = True

    for ini in db.scalars(select(Initiative).where(Initiative.current_state_code.in_(list(RETIRED_IDEA_STATES)))).all():
        old, new = ini.current_state_code, RETIRED_IDEA_STATES[ini.current_state_code]
        record_history(db, "initiative", ini.id, old, new, "WORKFLOW_SIMPLIFIED", None,
                       f"The {old.replace('_', ' ').lower()} step was merged into {new.replace('_', ' ').lower()}.")
        ini.current_state_code = new
        ini.is_in_idea_bank = new == "NOT_SELECTED"
        changed = True

    for code in ("CHALLENGE_ENTRY_STD", "CHALLENGE_LIFECYCLE"):
        d = db.scalar(select(WorkflowDefinition).where(WorkflowDefinition.code == code))
        if d:
            for model in (WorkflowState, WorkflowTransition):
                for row_ in db.scalars(select(model).where(model.workflow_definition_id == d.id)).all():
                    db.delete(row_)
            db.delete(d)
            changed = True

    rnd = db.scalar(select(ReviewRound).where(ReviewRound.round_type == "IDEA_REVIEW", ReviewRound.challenge_id.is_(None)))
    if not rnd:
        card = db.scalar(select(Scorecard).where(Scorecard.code == "IDEA_REVIEW_A")) or db.scalar(select(Scorecard).limit(1))
        if card:
            panel = Panel(name="Idea judges", panel_type="REVIEW")
            db.add(panel)
            db.flush()
            db.add(ReviewRound(round_type="IDEA_REVIEW", name_i18n={"en": "Idea review"}, scorecard_id=card.id,
                               panel_id=panel.id, reviewers_per_entry=2, aggregation_method="MEAN",
                               disagreement_threshold=2, status="IN_PROGRESS", show_scores_to_entrants="TOTAL_ONLY"))
            changed = True
    elif not rnd.panel_id:
        panel = Panel(name="Idea judges", panel_type="REVIEW")
        db.add(panel)
        db.flush()
        rnd.panel_id = panel.id
        changed = True
    if changed:
        db.commit()
