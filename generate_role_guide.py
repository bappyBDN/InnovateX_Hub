# -*- coding: utf-8 -*-
"""Generate InnovateX Hub role-based guide (English + Bangla) as .docx files."""
import docx
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

PRIMARY = RGBColor(0x0B, 0x6E, 0x6E)
INK = RGBColor(0x1B, 0x2A, 0x3A)
MUTED = RGBColor(0x55, 0x65, 0x7A)
SPARK = RGBColor(0xE8, 0xA3, 0x17)


def set_run_font(run, name, size=None, bold=None, color=None, italic=None):
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    rfonts.set(qn('w:ascii'), name)
    rfonts.set(qn('w:hAnsi'), name)
    rfonts.set(qn('w:cs'), name)
    rfonts.set(qn('w:eastAsia'), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    if italic is not None:
        run.font.italic = italic


def base_style(doc, font_name):
    style = doc.styles['Normal']
    style.font.name = font_name
    style.font.size = Pt(11)
    style.paragraph_format.space_after = Pt(6)
    style.paragraph_format.line_spacing = 1.15
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    for a in ('w:ascii', 'w:hAnsi', 'w:cs', 'w:eastAsia'):
        rfonts.set(qn(a), font_name)
    return style


class Report:
    def __init__(self, font="Calibri"):
        self.doc = Document()
        base_style(self.doc, font)
        self.font = font
        for s in self.doc.sections:
            s.left_margin = Inches(0.9)
            s.right_margin = Inches(0.9)
            s.top_margin = Inches(0.8)
            s.bottom_margin = Inches(0.8)

    def title(self, text, subtitle=None):
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(text)
        set_run_font(r, self.font, 22, True, PRIMARY)
        p.paragraph_format.space_after = Pt(2)
        if subtitle:
            p2 = self.doc.add_paragraph()
            p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r2 = p2.add_run(subtitle)
            set_run_font(r2, self.font, 12, False, MUTED)
            p2.paragraph_format.space_after = Pt(14)

    def h1(self, text):
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after = Pt(6)
        r = p.add_run(text)
        set_run_font(r, self.font, 16, True, PRIMARY)
        return p

    def h2(self, text):
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(10)
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run(text)
        set_run_font(r, self.font, 13, True, INK)
        return p

    def h3(self, text):
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(2)
        r = p.add_run(text)
        set_run_font(r, self.font, 11.5, True, MUTED)
        return p

    def p(self, text, bold=False):
        p = self.doc.add_paragraph()
        r = p.add_run(text)
        set_run_font(r, self.font, 11, bold, INK if not bold else INK)
        return p

    def bullet(self, text, bold_prefix=None):
        p = self.doc.add_paragraph(style='List Bullet')
        if bold_prefix:
            r = p.add_run(bold_prefix)
            set_run_font(r, self.font, 11, True, INK)
        r2 = p.add_run(text)
        set_run_font(r2, self.font, 11, False, INK)
        p.paragraph_format.space_after = Pt(2)
        return p

    def table(self, headers, rows, widths=None):
        t = self.doc.add_table(rows=1, cols=len(headers))
        t.style = 'Light Grid Accent 1'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        hdr = t.rows[0].cells
        for i, h in enumerate(headers):
            hdr[i].text = ''
            r = hdr[i].paragraphs[0].add_run(h)
            set_run_font(r, self.font, 10.5, True, RGBColor(0xFF, 0xFF, 0xFF))
            shd = OxmlElement('w:shd')
            shd.set(qn('w:val'), 'clear')
            shd.set(qn('w:fill'), '0B6E6E')
            hdr[i]._element.get_or_add_tcPr().append(shd)
        for row in rows:
            cells = t.add_row().cells
            for i, val in enumerate(row):
                cells[i].text = ''
                r = cells[i].paragraphs[0].add_run(str(val))
                set_run_font(r, self.font, 10, False, INK)
        if widths:
            for i, w in enumerate(widths):
                for row in t.rows:
                    row.cells[i].width = Inches(w)
        self.doc.add_paragraph().paragraph_format.space_after = Pt(2)
        return t

    def spacer(self):
        self.doc.add_paragraph()


EN = "Calibri"
BN = "Nirmala UI"


def build_english():
    r = Report(EN)
    r.title("InnovateX Hub — Role-Based System Guide",
            "Complete manual: Admin, Employee, Judge and Sponsor roles · Anwar Group (AES first)")

    r.h1("1. About InnovateX Hub")
    r.p("InnovateX Hub is the enterprise innovation-management platform for Anwar Group, starting with AES. "
        "It captures innovative ideas, routes them through transparent review and experimentation, sends automatic "
        "notifications, measures impact, supports awards and recognition, and builds a reusable innovation catalogue.")
    r.p("Core promise: from idea to evidence to impact.")
    r.bullet("a company-posted problem with dates, rules and prizes.", bold_prefix="Challenges — ")
    r.bullet("any employee can submit an idea at any time, outside a challenge.", bold_prefix="Open Ideas (Initiatives) — ")

    r.h1("2. Roles at a glance")
    r.p("Roles are fixed: they can only be assigned, never created, renamed or deleted. Team Leader and Team Member "
        "are not roles — they come from creating or joining a team.")
    r.table(
        ["Role", "Level", "What they see / do"],
        [
            ["Super Admin", "1", "Everything: settings, users, submissions, audit log"],
            ["DMD", "1", "Everything — same as Super Admin (full access)"],
            ["Program Owner", "2", "Runs challenges, shortlists, results, awards and dashboards"],
            ["Executive Viewer", "2", "All submissions (read only) + executive dashboards"],
            ["Judge", "3", "All submissions (read); scores only assigned entries"],
            ["Admin (master data)", "6", "Organization tree and master data"],
            ["HR", "6", "Rewards, certificates and recognition"],
            ["Finance Verifier", "6", "Verifies measured impact"],
            ["Sponsor", "6", "Confirms the problem, approves pilots, confirms value"],
            ["Employee / Participant", "9", "Public challenge info, own entries and own ideas"],
        ],
        widths=[1.7, 0.7, 4.4],
    )
    r.p("Visibility rule: Super Admin, DMD, Program Owner, Executive and Judge see all submissions. Everyone else sees "
        "only their own work and their team's. Anything outside that returns \"not found\", so a record's existence is "
        "never revealed.")

    r.h1("3. Admin — all features (Super Admin & DMD)")
    r.p("Super Admin and DMD have full access and also open the Admin panel at /admin. The Admin panel contains: "
        "Users & roles, Invitations, Roles & privileges, Settings, and Audit log.")

    r.h2("3.1 Users & roles")
    r.bullet("Search users and view their roles, org unit, grade and status.")
    r.bullet("Assign a role from the fixed list (Super Admin, Program Owner, Executive, Judge, Admin, HR, Finance Verifier, Sponsor) with a scope (all / org unit / challenge) and optional end date.")
    r.bullet("Remove a role. The last Super Admin can never be removed.")
    r.bullet("Deactivate or reactivate an account, and reset a password.")
    r.bullet("Assign a proxy submitter (someone who submits ideas on behalf of staff without a login).")

    r.h2("3.2 Invitations")
    r.bullet("Invite an email address to sign up as Judge (or any privileged role).")
    r.bullet("The person gets an email with a one-time link; the link is also shown once to copy.")
    r.bullet("Invitations can be re-sent or revoked.")

    r.h2("3.3 Organization tree")
    r.p("Tree of Group → Company → Function → Department → Team. Add, edit, move or deactivate units; see sync status from HR/Entra.")

    r.h2("3.4 Master data (shared with Admin role)")
    r.bullet("Domains (any business area), categories, innovation types, benefit types, risk types, KPI units and skills.")
    r.bullet("Add, edit, deactivate, reorder and set English/Bangla translations.")

    r.h2("3.5 Judges management (Admin → Judges)")
    r.p("One place with two lists: Challenge judges and Innovation judges. Judges are picked from dropdown lists; email "
        "invitations are behind \"Invite by email\".")
    r.bullet("Only the admin chooses judges (Super Admin; DMD counts as one).")
    r.bullet("Anyone with an account can be a judge — no role is needed first.")
    r.bullet("Per challenge: choose stages each judge scores (Methodology, Prototype, Final demo), or all stages.")
    r.bullet("Per idea: choose judges for that specific idea.")
    r.bullet("A person taking part in a challenge cannot be a judge of that same challenge.")

    r.h2("3.6 Form builder (with Program Owner)")
    r.p("Drag-and-drop sections and fields; field types; required/conditional rules; help text and examples in English "
        "and Bangla; link fields to judging criteria; live preview; versioning (publish creates a new version).")

    r.h2("3.7 Scorecard builder (with Program Owner)")
    r.p("Criteria with weights (must total 100%), rating scale and level descriptions, minimum ratings, comment rules, "
        "tie-breakers; version and publish.")

    r.h2("3.8 Workflows")
    r.p("View states and transitions per workflow; edit labels, allowed roles, required fields and SLA per state; visual state diagram.")

    r.h2("3.9 Notification templates & rules (with Program Owner)")
    r.bullet("Email templates in English and Bangla with variables and live preview; send a test email.")
    r.bullet("Rules: event → recipients, CC, delay; designated reviewer mailbox; delivery log with failed emails and Retry.")

    r.h2("3.10 Settings & feature flags")
    r.bullet("Appeal window, upload limits, retention, default join-link expiry, signup enabled/domains.")
    r.bullet("Feature flags: People's Choice, leaderboards, AI features (off by default).")

    r.h2("3.11 Audit log")
    r.p("Search by user, record, action or date; view old/new values; export. Append-only with a hash chain.")

    r.h2("3.12 System health")
    r.p("Failed emails, failed jobs, integration status, storage use.")

    r.h2("3.13 Challenge management (Program Owner & Super Admin)")
    r.bullet("Challenge builder wizard: basics, problem, eligibility, timeline, forms, judging, shortlist rules, prizes, notifications, review & publish.")
    r.bullet("Control centre: overview, entries, Q&A, rounds, shortlist, Demo Day, results, settings, activity log.")
    r.bullet("Round results & shortlist manager: propose, override (with reason), confirm, publish.")
    r.bullet("Results & awards decision: record jury decision, approve, publish; rewards split by credit share.")

    r.h1("4. Employee — all features & how to use")

    r.h2("4.1 Sign up & login")
    r.p("Sign in with your company account. New people can create their own account at /signup (they start as Employee) "
        "if signup is enabled. In the demo, every account uses password Password@123.")

    r.h2("4.2 Home page")
    r.p("Home starts with \"What needs you now\": drafts, submissions, actions due, clarification requests, join requests "
        "to approve, feedback to read, and open challenges.")

    r.h2("4.3 Browse challenges")
    r.bullet("Tabs: Open now, Upcoming, Closed; filters by domain, participation type and eligibility.")
    r.bullet("Each card shows domain, team size, prize summary, current phase and closing date, and an eligibility badge.")
    r.bullet("Challenge pages show only public info: problem, rules, timeline, prizes, Q&A and total registration count (no names).")

    r.h2("4.4 Register for a challenge")
    r.bullet("Choose Individual or Team (as the challenge allows).")
    r.bullet("Enter a working title, team name (if team), track, and answer registration questions.")
    r.bullet("Accept the rules, originality and idea-ownership declaration, then Register.")
    r.bullet("After success you get an entry code and the methodology deadline (teams also get a Create join link button).")

    r.h2("4.5 Teams & join links")
    r.bullet("The team leader creates a join link (expiry, optional max uses) and shares it.")
    r.bullet("Anyone with the link sends a join request with a short message; the leader approves or declines.")
    r.bullet("Credit shares must total 100% (default equal).")
    r.bullet("The leader can transfer leadership, remove members, revoke links, and lock the team at the deadline.")
    r.bullet("Members can leave; leaving removes access immediately.")

    r.h2("4.6 Submit a methodology")
    r.p("Inside the methodology window, fill the challenge's form (problem, approach, plan, impact, risks, team skills). "
        "It autosaves every few seconds; you can edit and resubmit until the deadline. Preview shows exactly what judges see.")

    r.h2("4.7 Prototype, final & build plan")
    r.bullet("Shortlisted entries open a build plan with milestones and weekly progress updates.")
    r.bullet("If prototype is required, submit the prototype form; otherwise that stage is skipped.")
    r.bullet("Finalists submit the final project and book a Demo Day slot.")

    r.h2("4.8 Feedback & appeals")
    r.p("Read your decision, strengths, improvements, next steps and scores (judges' names are never shown). You can raise "
        "an appeal within the appeal window (process issues only).")

    r.h2("4.9 Submit an open idea (6 steps)")
    r.bullet("1. About the idea — title, org/function, category, type.")
    r.bullet("2. Problem — statement, affected users, current process, baseline.")
    r.bullet("3. Proposed innovation — solution, technology/method, what is different.")
    r.bullet("4. Value & impact — main KPI, baseline, target, benefit types, scalability.")
    r.bullet("5. Team & governance — owner, contributors & credit shares, sponsor, risk flags, data classification.")
    r.bullet("6. Evidence & submit — files/links, declaration, preview, submit.")
    r.p("After submit you get a unique Innovation ID (e.g. INNO-2026-000123) and a tracking link.")

    r.h2("4.10 My ideas, results & notifications")
    r.bullet("My ideas: Drafts, Submitted, Closed; each with a journey rail and next action.")
    r.bullet("Results & hall of fame: published winners and awarded innovations.")
    r.bullet("Notifications centre: grouped list, filters, links to the exact page.")

    r.h2("4.11 Profile")
    r.p("Name, department, job title, skills (editable), language, notification settings, and My recognition (badges, "
        "certificates, rewards, points history).")

    r.h1("5. Badges & points — how to earn them")
    r.p("Badges and points are earned for quality steps in the lifecycle — never for raw submission count. They appear "
        "under Profile → My recognition.")

    r.h2("5.1 The seven badges")
    r.table(
        ["Badge", "Meaning"],
        [
            ["Contributor", "Submitted a qualified idea"],
            ["Shortlisted", "An entry or idea was shortlisted"],
            ["Finalist", "Reached the final or Demo Day"],
            ["Winner", "Won a challenge"],
            ["Pilot started", "An idea reached pilot"],
            ["Impact verified", "Impact confirmed by a verifier"],
            ["Reusable AES asset", "A solution reused by other teams"],
        ],
        widths=[2.0, 4.6],
    )

    r.h2("5.2 Points awarded")
    r.table(
        ["Event", "Points", "Badge"],
        [
            ["Entry shortlisted (methodology round)", "50", "Shortlisted"],
            ["Entry reaches the final (prototype round)", "80", "Finalist"],
            ["Challenge winner", "300", "Winner"],
            ["Challenge runner-up", "150", "Finalist"],
            ["Idea shortlisted", "50", "Shortlisted"],
            ["Idea reaches pilot", "80", "Pilot started"],
            ["Impact verified", "150", "Impact verified"],
            ["Idea scaled / reusable", "200", "Reusable AES asset"],
        ],
        widths=[3.4, 1.1, 2.1],
    )

    r.h2("5.3 How to earn each badge (step by step)")
    r.bullet("submit a complete idea or challenge methodology and have it pass triage/review.", bold_prefix="Contributor — ")
    r.bullet("your entry or idea is selected in the shortlist.", bold_prefix="Shortlisted — ")
    r.bullet("your entry passes the prototype round and is chosen as a finalist (or becomes runner-up).", bold_prefix="Finalist — ")
    r.bullet("your challenge entry is decided as the winner (needs working evidence).", bold_prefix="Winner — ")
    r.bullet("your idea moves to the Pilot stage (approved by a sponsor).", bold_prefix="Pilot started — ")
    r.bullet("a verifier confirms your measured impact.", bold_prefix="Impact verified — ")
    r.bullet("your solution is marked Scaled and published as a reusable asset.", bold_prefix="Reusable AES asset — ")

    r.h1("6. Judge — all features")
    r.h2("6.1 How a judge is chosen")
    r.bullet("Only the admin chooses judges (Super Admin / DMD). Program Owners can see but not change them.")
    r.bullet("Anyone with an account can be a judge; no Judge role is needed first.")
    r.bullet("People without an account are invited by email and become judges when they sign up with the link.")
    r.bullet("Per challenge a judge can score all stages or only the ones ticked (Methodology, Prototype, Final demo).")
    r.bullet("Per idea, judges are chosen on the idea's \"Choose judges\" screen.")
    r.bullet("A person taking part in a challenge cannot judge that same challenge.")

    r.h2("6.2 Review queue (My judging)")
    r.bullet("Split into Challenge judging and Innovation judging, with dropdown filters.")
    r.bullet("Summary chips: due today, due this week, overdue, done.")
    r.bullet("Table of assignments with entry code, title, round, due date and status; sorted by nearest due date.")
    r.bullet("Declare a conflict of interest from the row menu (own team, manager or direct report).")

    r.h2("6.3 Scoring workspace")
    r.bullet("Split screen: the submission on the left, the scorecard on the right.")
    r.bullet("Rate each criterion 1–5 (the meaning of each number is shown); comment is required for ratings 1 and 5.")
    r.bullet("A live weighted total updates as you score; criteria below their minimum show a warning.")
    r.bullet("Ask a clarification question — the review clock pauses until the owner replies.")
    r.bullet("You cannot see other judges' scores until you submit your own.")
    r.bullet("Submit review → read-only afterwards (the chair can reopen).")

    r.h2("6.4 All submissions browser")
    r.p("Judges can open every submission, file and idea read-only (including confidential ones), but can score only "
        "entries assigned to them.")

    r.h2("6.5 Fairness rules")
    r.bullet("Conflict-of-interest check (own team, manager, direct report).")
    r.bullet("Blind review option hides names and teams.")
    r.bullet("Every entry gets written feedback.")

    r.h1("7. Sponsor — all features")
    r.h2("7.1 Who is a sponsor")
    r.p("A Business Sponsor is an accountable business leader attached to a challenge or an idea. The sponsor confirms the "
        "problem is real and valuable, approves pilots, and confirms the delivered value.")

    r.h2("7.2 Permissions")
    r.bullet("Approve pilots (initiative.approve_pilot).")
    r.bullet("Verify impact (impact.verify).")
    r.bullet("Sees ideas that are in pilot or production.")

    r.h2("7.3 Approve a pilot")
    r.p("When an idea reaches the Demo/validation stage, moving it to Pilot requires a sponsor (guard: requires_sponsor) and a "
        "KPI baseline. The sponsor approves the pilot from the idea's workflow actions.")

    r.h2("7.4 Verify impact")
    r.p("The sponsor can verify, adjust (with a new value and note) or reject a recorded impact measurement. A measurement "
        "cannot be verified by the person who recorded it.")

    r.h2("7.5 Confirm problem & value")
    r.p("Sponsors validate business relevance and adoption, confirm business benefit, and endorse scaling — keeping "
        "innovation aligned with real business value.")

    r.h1("8. Quick reference")
    r.p("Demo password for every account: Password@123")
    r.table(
        ["Account", "Role", "Use it to"],
        [
            ["admin@anwargroup.example", "Super Admin", "Every feature + Admin panel"],
            ["dmd@anwargroup.example", "DMD", "Full access, same as Super Admin"],
            ["owner@anwargroup.example", "Program Owner", "Manage challenges, shortlists, results"],
            ["judge1–judge4@…", "Judge", "My judging and scoring"],
            ["sponsor@anwargroup.example", "Sponsor", "Approve pilots, verify impact"],
            ["sadia@…, karim@…, fahim@…", "Employee", "Own entries and ideas"],
        ],
        widths=[2.6, 1.4, 2.6],
    )
    r.spacer()
    r.p("— End of guide —", bold=True)
    return r.doc


def build_bangla():
    r = Report(BN)
    r.title("ইনোভেটেক্স হাব — রোল-ভিত্তিক সিস্টেম গাইড",
            "সম্পূর্ণ ম্যানুয়াল: অ্যাডমিন, কর্মী, বিচারক ও স্পন্সর রোল · আনোয়ার গ্রুপ (প্রথমে AES)")

    r.h1("১. ইনোভেটেক্স হাব সম্পর্কে")
    r.p("ইনোভেটেক্স হাব হলো আনোয়ার গ্রুপের (প্রথমে AES দিয়ে শুরু) এন্টারপ্রাইজ ইনোভেশন ম্যানেজমেন্ট প্ল্যাটফর্ম। এটি নতুন "
        "উদ্ভাবনী আইডিয়া সংগ্রহ করে, স্বচ্ছ পর্যালোচনা ও পরীক্ষা-নিরীক্ষার মধ্য দিয়ে নিয়ে যায়, স্বয়ংক্রিয় নোটিফিকেশন পাঠায়, "
        "ইমপ্যাক্ট পরিমাপ করে, পুরস্কার ও স্বীকৃতি দেয় এবং পুনর্ব্যবহারযোগ্য ইনোভেশন ক্যাটালগ তৈরি করে।")
    r.p("মূল প্রতিশ্রুতি: আইডিয়া থেকে প্রমাণ, প্রমাণ থেকে ইমপ্যাক্ট।")
    r.bullet("কোম্পানির দেওয়া একটি সমস্যা, যার তারিখ, নিয়ম ও পুরস্কার থাকে।", bold_prefix="চ্যালেঞ্জ — ")
    r.bullet("যে-কোনো কর্মী যেকোনো সময় চ্যালেঞ্জের বাইরে একটি আইডিয়া জমা দিতে পারেন।", bold_prefix="ওপেন আইডিয়া (ইনিশিয়েটিভ) — ")

    r.h1("২. রোলসমূহ এক নজরে")
    r.p("রোলগুলো ফিক্সড: শুধুমাত্র অ্যাসাইন করা যায়; তৈরি, নাম পরিবর্তন বা মুছে ফেলা যায় না। টিম লিডার ও টিম মেম্বার কোনো রোল "
        "নয় — এগুলো টিম তৈরি বা যোগদানের ফলে আসে।")
    r.table(
        ["রোল", "লেভেল", "যা দেখে / যা করে"],
        [
            ["সুপার অ্যাডমিন", "১", "সবকিছু: সেটিংস, ইউজার, সাবমিশন, অডিট লগ"],
            ["ডিএমডি", "১", "সবকিছু — সুপার অ্যাডমিনের মতোই (পূর্ণ অ্যাক্সেস)"],
            ["প্রোগ্রাম ওনার", "২", "চ্যালেঞ্জ, শর্টলিস্ট, ফলাফল, পুরস্কার ও ড্যাশবোর্ড পরিচালনা"],
            ["এক্সিকিউটিভ ভিউয়ার", "২", "সব সাবমিশন (শুধু পড়া) + এক্সিকিউটিভ ড্যাশবোর্ড"],
            ["বিচারক (জাজ)", "৩", "সব সাবমিশন (পড়া); শুধু অ্যাসাইন করা এন্ট্রি স্কোর করে"],
            ["অ্যাডমিন (মাস্টার ডেটা)", "৬", "প্রতিষ্ঠান-কাঠামো ও মাস্টার ডেটা"],
            ["এইচআর", "৬", "পুরস্কার, সার্টিফিকেট ও স্বীকৃতি"],
            ["ফাইন্যান্স ভেরিফায়ার", "৬", "পরিমাপকৃত ইমপ্যাক্ট যাচাই করে"],
            ["স্পন্সর", "৬", "সমস্যা নিশ্চিত করে, পাইলট অনুমোদন করে, মূল্য নিশ্চিত করে"],
            ["কর্মী / অংশগ্রহণকারী", "৯", "পাবলিক চ্যালেঞ্জ তথ্য, নিজের এন্ট্রি ও নিজের আইডিয়া"],
        ],
        widths=[1.8, 0.7, 4.3],
    )
    r.p("ভিজিবিলিটি নিয়ম: সুপার অ্যাডমিন, ডিএমডি, প্রোগ্রাম ওনার, এক্সিকিউটিভ ও জাজ সব সাবমিশন দেখেন। বাকিরা শুধু নিজের কাজ ও "
        "নিজের টিমের কাজ দেখেন। এর বাইরের কিছু দেখতে চাইলে \"পাওয়া যায়নি\" দেখানো হয়, ফলে রেকর্ডের অস্তিত্বও ফাঁস হয় না।")

    r.h1("৩. অ্যাডমিন — সব ফিচার (সুপার অ্যাডমিন ও ডিএমডি)")
    r.p("সুপার অ্যাডমিন ও ডিএমডির পূর্ণ অ্যাক্সেস থাকে এবং /admin-এ অ্যাডমিন প্যানেল খুলতে পারেন। অ্যাডমিন প্যানেলে থাকে: "
        "ইউজার ও রোল, ইনভাইটেশন, রোল ও অধিকার, সেটিংস এবং অডিট লগ।")

    r.h2("৩.১ ইউজার ও রোল")
    r.bullet("ইউজার খুঁজুন এবং তাদের রোল, বিভাগ, গ্রেড ও স্ট্যাটাস দেখুন।")
    r.bullet("ফিক্সড তালিকা থেকে রোল অ্যাসাইন করুন (সুপার অ্যাডমিন, প্রোগ্রাম ওনার, এক্সিকিউটিভ, জাজ, অ্যাডমিন, এইচআর, ফাইন্যান্স ভেরিফায়ার, স্পন্সর) — স্কোপ (সব / বিভাগ / চ্যালেঞ্জ) ও মেয়াদসহ।")
    r.bullet("রোল সরান। শেষ সুপার অ্যাডমিন কখনো সরানো যায় না।")
    r.bullet("অ্যাকাউন্ট নিষ্ক্রিয়/সক্রিয় করুন এবং পাসওয়ার্ড রিসেট করুন।")
    r.bullet("প্রক্সি সাবমিটার অ্যাসাইন করুন (লগইন-হীন কর্মীর পক্ষে আইডিয়া জমা দেওয়ার জন্য)।")

    r.h2("৩.২ ইনভাইটেশন")
    r.bullet("জাজ (বা অন্য বিশেষ রোল) হিসেবে সাইন-আপ করার জন্য ইমেইল ঠিকানায় আমন্ত্রণ পাঠান।")
    r.bullet("সেই ব্যক্তি এক-বার ব্যবহারযোগ্য লিংকসহ ইমেইল পায়; লিংকটি একবার দেখানো হয় কপি করার জন্য।")
    r.bullet("আমন্ত্রণ আবার পাঠানো বা বাতিল করা যায়।")

    r.h2("৩.৩ প্রতিষ্ঠান-কাঠামো")
    r.p("গ্রুপ → কোম্পানি → ফাংশন → ডিপার্টমেন্ট → টিম এর ট্রি। ইউনিট যোগ/সম্পাদনা/স্থানান্তর/নিষ্ক্রিয় করুন; HR/Entra থেকে সিংক স্ট্যাটাস দেখুন।")

    r.h2("৩.৪ মাস্টার ডেটা (অ্যাডমিন রোলের সাথে শেয়ার্ড)")
    r.bullet("ডোমেইন (যেকোনো ব্যবসা ক্ষেত্র), ক্যাটাগরি, ইনোভেশন টাইপ, বেনিফিট টাইপ, রিস্ক টাইপ, KPI ইউনিট ও স্কিল।")
    r.bullet("যোগ, সম্পাদনা, নিষ্ক্রিয়, ক্রম পরিবর্তন এবং ইংরেজি/বাংলা অনুবাদ দিন।")

    r.h2("৩.৫ জাজ ব্যবস্থাপনা (অ্যাডমিন → জাজ)")
    r.p("এক জায়গায় দুটি তালিকা: চ্যালেঞ্জ জাজ ও ইনোভেশন জাজ। ড্রপডাউন থেকে জাজ বাছাই করা হয়; ইমেইল আমন্ত্রণ থাকে \"ইমেইলে আমন্ত্রণ\"-এর পেছনে।")
    r.bullet("শুধু অ্যাডমিন জাজ নির্বাচন করেন (সুপার অ্যাডমিন; ডিএমডিও একজন হিসেবে গণ্য)।")
    r.bullet("যে-কারো অ্যাকাউন্ট থাকলেই জাজ হতে পারেন — আগে থেকে কোনো রোল লাগে না।")
    r.bullet("প্রতি চ্যালেঞ্জে: প্রতিটি জাজ কোন কোন ধাপ স্কোর করবেন তা বেছে নিন (মেথডলজি, প্রোটোটাইপ, ফাইনাল ডেমো) বা সব ধাপ।")
    r.bullet("প্রতি আইডিয়ায়: সেই নির্দিষ্ট আইডিয়ার জন্য জাজ বেছে নিন।")
    r.bullet("যিনি কোনো চ্যালেঞ্জে অংশ নিচ্ছেন তিনি সেই চ্যালেঞ্জের জাজ হতে পারবেন না।")

    r.h2("৩.৬ ফর্ম বিল্ডার (প্রোগ্রাম ওনারের সাথে)")
    r.p("ড্র্যাগ-অ্যান্ড-ড্রপ সেকশন ও ফিল্ড; ফিল্ড টাইপ; আবশ্যক/শর্তসাপেক্ষ নিয়ম; ইংরেজি ও বাংলায় হেল্প টেক্সট ও উদাহরণ; "
        "ফিল্ডকে জাজিং মানদণ্ডের সাথে যুক্ত করুন; লাইভ প্রিভিউ; ভার্সনিং (পাবলিশ করলে নতুন ভার্সন তৈরি হয়)।")

    r.h2("৩.৭ স্কোরকার্ড বিল্ডার (প্রোগ্রাম ওনারের সাথে)")
    r.p("ওজনসহ মানদণ্ড (মোট ১০০% হতে হবে), রেটিং স্কেল ও লেভেল বর্ণনা, ন্যূনতম রেটিং, মন্তব্যের নিয়ম, টাই-ব্রেকার; ভার্সন ও পাবলিশ।")

    r.h2("৩.৮ ওয়ার্কফ্লো")
    r.p("প্রতি ওয়ার্কফ্লোতে স্টেট ও ট্রানজিশন দেখুন; লেবেল, অনুমোদিত রোল, আবশ্যক ফিল্ড ও প্রতি স্টেটের SLA সম্পাদনা করুন; ভিজ্যুয়াল স্টেট ডায়াগ্রাম।")

    r.h2("৩.৯ নোটিফিকেশন টেমপ্লেট ও নিয়ম (প্রোগ্রাম ওনারের সাথে)")
    r.bullet("ইংরেজি ও বাংলায় ইমেইল টেমপ্লেট, ভ্যারিয়েবল ও লাইভ প্রিভিউ সহ; টেস্ট ইমেইল পাঠান।")
    r.bullet("নিয়ম: ইভেন্ট → প্রাপক, CC, বিলম্ব; নির্ধারিত রিভিউয়ার মেইলবক্স; ব্যর্থ ইমেইলসহ ডেলিভারি লগ এবং রিট্রাই।")

    r.h2("৩.১০ সেটিংস ও ফিচার ফ্ল্যাগ")
    r.bullet("আপিলের সময়সীমা, আপলোড সীমা, রিটেনশন, ডিফল্ট জয়েন-লিংক মেয়াদ, সাইন-আপ চালু/ডোমেইন।")
    r.bullet("ফিচার ফ্ল্যাগ: পিপলস চয়েস, লিডারবোর্ড, AI ফিচার (ডিফল্ট বন্ধ)।")

    r.h2("৩.১১ অডিট লগ")
    r.p("ইউজার, রেকর্ড, অ্যাকশন বা তারিখ দিয়ে খুঁজুন; পুরনো/নতুন মান দেখুন; এক্সপোর্ট করুন। হ্যাশ-চেইনসহ অ্যাপেন্ড-অনলি।")

    r.h2("৩.১২ সিস্টেম হেলথ")
    r.p("ব্যর্থ ইমেইল, ব্যর্থ জব, ইন্টিগ্রেশন স্ট্যাটাস, স্টোরেজ ব্যবহার।")

    r.h2("৩.১৩ চ্যালেঞ্জ ব্যবস্থাপনা (প্রোগ্রাম ওনার ও সুপার অ্যাডমিন)")
    r.bullet("চ্যালেঞ্জ বিল্ডার উইজার্ড: বেসিক, সমস্যা, যোগ্যতা, টাইমলাইন, ফর্ম, জাজিং, শর্টলিস্ট নিয়ম, পুরস্কার, নোটিফিকেশন, পর্যালোচনা ও পাবলিশ।")
    r.bullet("কন্ট্রোল সেন্টার: ওভারভিউ, এন্ট্রি, প্রশ্নোত্তর, রাউন্ড, শর্টলিস্ট, ডেমো ডে, ফলাফল, সেটিংস, অ্যাক্টিভিটি লগ।")
    r.bullet("রাউন্ড ফলাফল ও শর্টলিস্ট ম্যানেজার: প্রস্তাব, ওভাররাইড (কারণসহ), নিশ্চিতকরণ, পাবলিশ।")
    r.bullet("ফলাফল ও পুরস্কারের সিদ্ধান্ত: জুরির সিদ্ধান্ত রেকর্ড, অনুমোদন, পাবলিশ; ক্রেডিট শেয়ার অনুযায়ী পুরস্কার ভাগ।")

    r.h1("৪. কর্মী — সব ফিচার ও ব্যবহারের নিয়ম")

    r.h2("৪.১ সাইন-আপ ও লগইন")
    r.p("কোম্পানি অ্যাকাউন্ট দিয়ে সাইন ইন করুন। নতুনরা /signup-এ নিজের অ্যাকাউন্ট তৈরি করতে পারেন (তারা কর্মী হিসেবে শুরু করেন) "
        "যদি সাইন-আপ চালু থাকে। ডেমোতে প্রতিটি অ্যাকাউন্টের পাসওয়ার্ড Password@123।")

    r.h2("৪.২ হোম পেজ")
    r.p("হোম শুরু হয় \"এখন আপনার কী করা দরকার\" দিয়ে: ড্রাফট, সাবমিশন, বকেয়া কাজ, ক্লারিফিকেশন অনুরোধ, অনুমোদনের অপেক্ষায় "
        "জয়েন রিকোয়েস্ট, পড়ার মতো ফিডব্যাক এবং খোলা চ্যালেঞ্জ।")

    r.h2("৪.৩ চ্যালেঞ্জ ব্রাউজ করুন")
    r.bullet("ট্যাব: এখন খোলা, আসন্ন, বন্ধ; ডোমেইন, অংশগ্রহণের ধরন ও যোগ্যতা দিয়ে ফিল্টার।")
    r.bullet("প্রতিটি কার্ডে ডোমেইন, টিম সাইজ, পুরস্কারের সারাংশ, বর্তমান ধাপ ও শেষ তারিখ এবং যোগ্যতার ব্যাজ দেখায়।")
    r.bullet("চ্যালেঞ্জ পেজে শুধু পাবলিক তথ্য থাকে: সমস্যা, নিয়ম, টাইমলাইন, পুরস্কার, প্রশ্নোত্তর ও মোট রেজিস্ট্রেশন সংখ্যা (নাম নয়)।")

    r.h2("৪.৪ চ্যালেঞ্জে রেজিস্ট্রেশন")
    r.bullet("Individual বা Team বেছে নিন (চ্যালেঞ্জ যা অনুমতি দেয়)।")
    r.bullet("ওয়ার্কিং টাইটেল, টিমের নাম (টিম হলে), ট্র্যাক এবং রেজিস্ট্রেশন প্রশ্নের উত্তর দিন।")
    r.bullet("নিয়ম, মৌলিকত্ব ও আইডিয়া-মালিকানা ঘোষণা মেনে নিয়ে Register চাপুন।")
    r.bullet("সফল হলে এন্ট্রি কোড ও মেথডলজির শেষ তারিখ পাবেন (টিম হলে Create join link বাটনও পাবেন)।")

    r.h2("৪.৫ টিম ও জয়েন লিংক")
    r.bullet("টিম লিডার একটি জয়েন লিংক তৈরি করেন (মেয়াদ, ঐচ্ছিক সর্বোচ্চ ব্যবহার) এবং শেয়ার করেন।")
    r.bullet("লিংকধারী যে-কেউ ছোট মেসেজসহ জয়েন রিকোয়েস্ট পাঠান; লিডার অনুমোদন বা প্রত্যাখ্যান করেন।")
    r.bullet("ক্রেডিট শেয়ার মোট ১০০% হতে হবে (ডিফল্ট সমান)।")
    r.bullet("লিডার নেতৃত্ব হস্তান্তর, সদস্য বাদ দেওয়া, লিংক বাতিল এবং ডেডলাইনে টিম লক করতে পারেন।")
    r.bullet("সদস্যরা টিম ছেড়ে যেতে পারেন; ছাড়লেই সেই টিমের ডেটার অ্যাক্সেস সাথে সাথে শেষ হয়।")

    r.h2("৪.৬ মেথডলজি জমা দিন")
    r.p("মেথডলজি সময়সীমার মধ্যে চ্যালেঞ্জের ফর্ম পূরণ করুন (সমস্যা, পদ্ধতি, পরিকল্পনা, ইমপ্যাক্ট, ঝুঁকি, টিম দক্ষতা)। এটি প্রতি "
        "কয়েক সেকেন্ডে অটোসেভ হয়; ডেডলাইন পর্যন্ত সম্পাদনা ও পুনরায় জমা দিতে পারেন। প্রিভিউতে জাজরা ঠিক কী দেখবেন তা দেখা যায়।")

    r.h2("৪.৭ প্রোটোটাইপ, ফাইনাল ও বিল্ড প্ল্যান")
    r.bullet("শর্টলিস্টেড এন্ট্রি বিল্ড প্ল্যান খোলে — মাইলস্টোন ও সাপ্তাহিক প্রগ্রেস আপডেটসহ।")
    r.bullet("প্রোটোটাইপ আবশ্যক হলে প্রোটোটাইপ ফর্ম জমা দিন; না হলে ধাপটি এড়িয়ে যাওয়া হয়।")
    r.bullet("ফাইনালিস্টরা চূড়ান্ত প্রজেক্ট জমা দেন এবং ডেমো ডে-র স্লট বুক করেন।")

    r.h2("৪.৮ ফিডব্যাক ও আপিল")
    r.p("আপনার সিদ্ধান্ত, শক্তি, উন্নতির জায়গা, পরবর্তী ধাপ ও স্কোর পড়ুন (জাজদের নাম কখনো দেখানো হয় না)। আপিলের সময়সীমার মধ্যে "
        "আপিল করতে পারেন (শুধু প্রক্রিয়াগত সমস্যার জন্য)।")

    r.h2("৪.৯ ওপেন আইডিয়া জমা দিন (৬ ধাপ)")
    r.bullet("১. আইডিয়া সম্পর্কে — টাইটেল, বিভাগ/ফাংশন, ক্যাটাগরি, ধরন।")
    r.bullet("২. সমস্যা — বিবরণ, ক্ষতিগ্রস্ত ইউজার, বর্তমান প্রক্রিয়া, বেসলাইন।")
    r.bullet("৩. প্রস্তাবিত উদ্ভাবন — সমাধান, প্রযুক্তি/পদ্ধতি, পার্থক্য কী।")
    r.bullet("৪. মূল্য ও ইমপ্যাক্ট — মূল KPI, বেসলাইন, লক্ষ্য, বেনিফিট টাইপ, স্কেলেবিলিটি।")
    r.bullet("৫. টিম ও গভর্নেন্স — মালিক, অবদানকারী ও ক্রেডিট শেয়ার, স্পন্সর, রিস্ক ফ্ল্যাগ, ডেটা ক্লাসিফিকেশন।")
    r.bullet("৬. প্রমাণ ও জমা — ফাইল/লিংক, ঘোষণা, প্রিভিউ, জমা দিন।")
    r.p("জমা দিলে একটি ইউনিক ইনোভেশন আইডি (যেমন INNO-2026-000123) ও ট্র্যাকিং লিংক পাবেন।")

    r.h2("৪.১০ আমার আইডিয়া, ফলাফল ও নোটিফিকেশন")
    r.bullet("আমার আইডিয়া: ড্রাফট, জমাকৃত, বন্ধ; প্রতিটিতে জার্নি-রেল ও পরবর্তী ধাপ।")
    r.bullet("ফলাফল ও হল অব ফেম: প্রকাশিত বিজয়ী ও পুরস্কৃত উদ্ভাবন।")
    r.bullet("নোটিফিকেশন সেন্টার: গ্রুপ করা তালিকা, ফিল্টার, সঠিক পেজের লিংক।")

    r.h2("৪.১১ প্রোফাইল")
    r.p("নাম, বিভাগ, পদবি, স্কিল (সম্পাদনাযোগ্য), ভাষা, নোটিফিকেশন সেটিংস এবং আমার স্বীকৃতি (ব্যাজ, সার্টিফিকেট, পুরস্কার, পয়েন্টের ইতিহাস)।")

    r.h1("৫. ব্যাজ ও পয়েন্ট — কীভাবে অর্জন করবেন")
    r.p("লাইফসাইকেলের মানসম্মত ধাপে ব্যাজ ও পয়েন্ট পাওয়া যায় — কখনোই শুধু জমার সংখ্যার জন্য নয়। এগুলো প্রোফাইল → আমার স্বীকৃতি-তে দেখা যায়।")

    r.h2("৫.১ সাতটি ব্যাজ")
    r.table(
        ["ব্যাজ", "অর্থ"],
        [
            ["কন্ট্রিবিউটর", "একটি যোগ্য আইডিয়া জমা দিয়েছেন"],
            ["শর্টলিস্টেড", "একটি এন্ট্রি বা আইডিয়া শর্টলিস্ট হয়েছে"],
            ["ফাইনালিস্ট", "ফাইনাল বা ডেমো ডে-তে পৌঁছেছেন"],
            ["উইনার", "একটি চ্যালেঞ্জ জিতেছেন"],
            ["পাইলট শুরু", "একটি আইডিয়া পাইলট পর্যায়ে পৌঁছেছে"],
            ["ইমপ্যাক্ট ভেরিফায়েড", "ভেরিফায়ার দ্বারা ইমপ্যাক্ট নিশ্চিত হয়েছে"],
            ["পুনর্ব্যবহারযোগ্য AES অ্যাসেট", "সমাধান অন্য টিম পুনরায় ব্যবহার করছে"],
        ],
        widths=[2.4, 4.2],
    )

    r.h2("৫.২ পয়েন্ট")
    r.table(
        ["ঘটনা", "পয়েন্ট", "ব্যাজ"],
        [
            ["এন্ট্রি শর্টলিস্ট (মেথডলজি রাউন্ড)", "৫০", "শর্টলিস্টেড"],
            ["এন্ট্রি ফাইনালে পৌঁছেছে (প্রোটোটাইপ রাউন্ড)", "৮০", "ফাইনালিস্ট"],
            ["চ্যালেঞ্জ বিজয়ী", "৩০০", "উইনার"],
            ["চ্যালেঞ্জ রানার-আপ", "১৫০", "ফাইনালিস্ট"],
            ["আইডিয়া শর্টলিস্ট", "৫০", "শর্টলিস্টেড"],
            ["আইডিয়া পাইলটে পৌঁছেছে", "৮০", "পাইলট শুরু"],
            ["ইমপ্যাক্ট ভেরিফায়েড", "১৫০", "ইমপ্যাক্ট ভেরিফায়েড"],
            ["আইডিয়া স্কেলড / পুনর্ব্যবহারযোগ্য", "২০০", "পুনর্ব্যবহারযোগ্য AES অ্যাসেট"],
        ],
        widths=[3.4, 1.1, 2.1],
    )

    r.h2("৫.৩ প্রতিটি ব্যাজ কীভাবে অর্জন করবেন (ধাপে ধাপে)")
    r.bullet("একটি সম্পূর্ণ আইডিয়া বা চ্যালেঞ্জ মেথডলজি জমা দিন এবং ট্রায়াজ/রিভিউ পাস করুন।", bold_prefix="কন্ট্রিবিউটর — ")
    r.bullet("আপনার এন্ট্রি বা আইডিয়া শর্টলিস্টে নির্বাচিত হয়।", bold_prefix="শর্টলিস্টেড — ")
    r.bullet("আপনার এন্ট্রি প্রোটোটাইপ রাউন্ড পাস করে ফাইনালিস্ট হয় (বা রানার-আপ হয়)।", bold_prefix="ফাইনালিস্ট — ")
    r.bullet("আপনার চ্যালেঞ্জ এন্ট্রি বিজয়ী ঘোষিত হয় (কার্যকর প্রমাণ থাকা আবশ্যক)।", bold_prefix="উইনার — ")
    r.bullet("আপনার আইডিয়া পাইলট পর্যায়ে যায় (স্পন্সর কর্তৃক অনুমোদিত)।", bold_prefix="পাইলট শুরু — ")
    r.bullet("একজন ভেরিফায়ার আপনার পরিমাপকৃত ইমপ্যাক্ট নিশ্চিত করেন।", bold_prefix="ইমপ্যাক্ট ভেরিফায়েড — ")
    r.bullet("আপনার সমাধান স্কেলড হিসেবে চিহ্নিত হয় এবং পুনর্ব্যবহারযোগ্য অ্যাসেট হিসেবে প্রকাশিত হয়।", bold_prefix="পুনর্ব্যবহারযোগ্য AES অ্যাসেট — ")

    r.h1("৬. বিচারক (জাজ) — সব ফিচার")
    r.h2("৬.১ কীভাবে জাজ নির্বাচিত হন")
    r.bullet("শুধু অ্যাডমিন জাজ নির্বাচন করেন (সুপার অ্যাডমিন / ডিএমডি)। প্রোগ্রাম ওনার দেখতে পারেন কিন্তু পরিবর্তন করতে পারেন না।")
    r.bullet("অ্যাকাউন্ট থাকলে যে-কেউ জাজ হতে পারেন; আগে থেকে কোনো জাজ রোল লাগে না।")
    r.bullet("অ্যাকাউন্ট নেই এমন ব্যক্তিকে ইমেইলে আমন্ত্রণ জানানো হয়; লিংক দিয়ে সাইন-আপ করলেই তিনি জাজ হন।")
    r.bullet("প্রতি চ্যালেঞ্জে একজন জাজ সব ধাপ বা শুধু টিক দেওয়া ধাপ (মেথডলজি, প্রোটোটাইপ, ফাইনাল ডেমো) স্কোর করতে পারেন।")
    r.bullet("প্রতি আইডিয়ায়, আইডিয়ার \"জাজ বাছাই\" স্ক্রিনে জাজ নির্বাচন করা হয়।")
    r.bullet("যিনি কোনো চ্যালেঞ্জে অংশ নিচ্ছেন তিনি সেই চ্যালেঞ্জের জাজ হতে পারবেন না।")

    r.h2("৬.২ রিভিউ কিউ (আমার জাজিং)")
    r.bullet("চ্যালেঞ্জ জাজিং ও ইনোভেশন জাজিং-এ ভাগ করা, ড্রপডাউন ফিল্টারসহ।")
    r.bullet("সারাংশ চিপ: আজ ডিউ, এই সপ্তাহে ডিউ, ওভারডিউ, সম্পন্ন।")
    r.bullet("এন্ট্রি কোড, টাইটেল, রাউন্ড, ডিউ ডেট ও স্ট্যাটাসসহ অ্যাসাইনমেন্টের টেবিল; নিকটতম ডিউ ডেট অনুযায়ী সাজানো।")
    r.bullet("সারির মেনু থেকে স্বার্থের সংঘাত ঘোষণা করুন (নিজের টিম, ম্যানেজার বা সরাসরি অধস্তন)।")

    r.h2("৬.৩ স্কোরিং ওয়ার্কস্পেস")
    r.bullet("বিভক্ত স্ক্রিন: বাঁয়ে সাবমিশন, ডানে স্কোরকার্ড।")
    r.bullet("প্রতিটি মানদণ্ডে ১–৫ রেটিং দিন (প্রতিটি সংখ্যার অর্থ দেখানো হয়); ১ ও ৫ রেটিংয়ে মন্তব্য আবশ্যক।")
    r.bullet("স্কোরের সাথে লাইভ ওয়েটেড টোটাল হালনাগাদ হয়; ন্যূনতমের নিচের মানদণ্ডে সতর্কতা দেখায়।")
    r.bullet("ক্লারিফিকেশন প্রশ্ন করুন — মালিক উত্তর না দেওয়া পর্যন্ত রিভিউ ক্লক থেমে থাকে।")
    r.bullet("নিজের স্কোর জমা দেওয়ার আগে অন্য জাজের স্কোর দেখতে পাবেন না।")
    r.bullet("রিভিউ জমা দিন → পরে শুধু-পড়া (চেয়ার পুনরায় খুলতে পারেন)।")

    r.h2("৬.৪ সব সাবমিশন ব্রাউজার")
    r.p("জাজ প্রতিটি সাবমিশন, ফাইল ও আইডিয়া শুধু-পড়া হিসেবে খুলতে পারেন (গোপনীয়সহ), তবে শুধু অ্যাসাইন করা এন্ট্রি স্কোর করতে পারেন।")

    r.h2("৬.৫ ন্যায্যতার নিয়ম")
    r.bullet("স্বার্থের সংঘাত পরীক্ষা (নিজের টিম, ম্যানেজার, সরাসরি অধস্তন)।")
    r.bullet("ব্লাইন্ড রিভিউ অপশনে নাম ও টিম গোপন থাকে।")
    r.bullet("প্রতিটি এন্ট্রিতে লিখিত ফিডব্যাক দেওয়া হয়।")

    r.h1("৭. স্পন্সর — সব ফিচার")
    r.h2("৭.১ স্পন্সর কে")
    r.p("বিজনেস স্পন্সর হলেন একজন দায়িত্বশীল ব্যবসায়িক নেতা, যিনি কোনো চ্যালেঞ্জ বা আইডিয়ার সাথে যুক্ত থাকেন। স্পন্সর নিশ্চিত করেন "
        "সমস্যাটি বাস্তব ও মূল্যবান, পাইলট অনুমোদন করেন এবং অর্জিত মূল্য নিশ্চিত করেন।")

    r.h2("৭.২ অনুমতি")
    r.bullet("পাইলট অনুমোদন (initiative.approve_pilot)।")
    r.bullet("ইমপ্যাক্ট যাচাই (impact.verify)।")
    r.bullet("পাইলট বা প্রোডাকশন পর্যায়ের আইডিয়া দেখেন।")

    r.h2("৭.৩ পাইলট অনুমোদন")
    r.p("কোনো আইডিয়া ডেমো/ভ্যালিডেশন পর্যায়ে এলে, পাইলটে নেওয়ার জন্য স্পন্সর আবশ্যক (গার্ড: requires_sponsor) এবং KPI বেসলাইনও "
        "প্রয়োজন। স্পন্সর আইডিয়ার ওয়ার্কফ্লো অ্যাকশন থেকে পাইলট অনুমোদন করেন।")

    r.h2("৭.৪ ইমপ্যাক্ট যাচাই")
    r.p("স্পন্সর একটি রেকর্ডকৃত ইমপ্যাক্ট পরিমাপ যাচাই, সমন্বয় (নতুন মান ও নোটসহ) বা প্রত্যাখ্যান করতে পারেন। যে ব্যক্তি পরিমাপটি "
        "রেকর্ড করেছেন তিনি সেটি নিজে যাচাই করতে পারবেন না।")

    r.h2("৭.৫ সমস্যা ও মূল্য নিশ্চিতকরণ")
    r.p("স্পন্সর ব্যবসায়িক প্রাসঙ্গিকতা ও গ্রহণযোগ্যতা যাচাই করেন, ব্যবসায়িক সুবিধা নিশ্চিত করেন এবং স্কেলিং অনুমোদন করেন — যাতে "
        "উদ্ভাবন বাস্তব ব্যবসায়িক মূল্যের সাথে সামঞ্জস্যপূর্ণ থাকে।")

    r.h1("৮. দ্রুত রেফারেন্স")
    r.p("প্রতিটি অ্যাকাউন্টের ডেমো পাসওয়ার্ড: Password@123")
    r.table(
        ["অ্যাকাউন্ট", "রোল", "যা দেখাতে ব্যবহার করবেন"],
        [
            ["admin@anwargroup.example", "সুপার অ্যাডমিন", "প্রতিটি ফিচার + অ্যাডমিন প্যানেল"],
            ["dmd@anwargroup.example", "ডিএমডি", "পূর্ণ অ্যাক্সেস, সুপার অ্যাডমিনের মতোই"],
            ["owner@anwargroup.example", "প্রোগ্রাম ওনার", "চ্যালেঞ্জ, শর্টলিস্ট, ফলাফল ব্যবস্থাপনা"],
            ["judge1–judge4@…", "জাজ", "আমার জাজিং ও স্কোরিং"],
            ["sponsor@anwargroup.example", "স্পন্সর", "পাইলট অনুমোদন, ইমপ্যাক্ট যাচাই"],
            ["sadia@…, karim@…, fahim@…", "কর্মী", "নিজের এন্ট্রি ও আইডিয়া"],
        ],
        widths=[2.6, 1.4, 2.6],
    )
    r.spacer()
    r.p("— গাইডের সমাপ্তি —", bold=True)
    return r.doc


def save(doc, path):
    doc.save(path)
    print("Saved:", path)


if __name__ == "__main__":
    en = build_english()
    save(en, "InnovateX_Hub_Role_Guide_EN.docx")
    bn = build_bangla()
    save(bn, "InnovateX_Hub_Role_Guide_BN.docx")
    print("Done.")
