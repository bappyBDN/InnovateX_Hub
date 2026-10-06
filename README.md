# InnovateX Hub

Enterprise innovation management platform for Anwar Group (AES first): challenges with individual and team entries,
methodology submission, fair multi-judge scoring, shortlisting, build and demo, awards, open ideas from draft to verified
impact, dashboards and admin configuration.

Built from the documents in this folder:
`InnovateX_Hub_Backend_Data_Model.md`, `InnovateX_Hub_Frontend_UI_UX.md` and everything in `all doc/` (BRD, PRD, build plan, builder skill).

| Part | Stack |
| --- | --- |
| Backend | FastAPI, SQLAlchemy 2, Pydantic 2 — modular monolith in `backend/app/modules/*` |
| Frontend | React 18, TypeScript (strict), Vite, Tailwind, TanStack Query, React Router, react-i18next (English + Bangla) |
| Database | **PostgreSQL** (Neon), database `innovatex_hub`. The connection string is `DATABASE_URL` in `.env`; SQLite still works for offline use |
| Email | Mailpit container catches every email so you can read it in a browser |
| Run | Docker Compose; every URL and port comes from one `.env` file |

---

## 1. Start it

```bash
cp .env.example .env          # already done if .env exists
docker compose up --build
```

First start creates the tables in PostgreSQL and loads the demo data (about 20 seconds).
People can also create their own account at **/signup** (they start as Employee).

| What | URL (default ports from `.env`) |
| --- | --- |
| App | http://localhost:5173 |
| API docs (Swagger) | http://localhost:8000/api/v1/docs |
| API health | http://localhost:8000/health |
| Email inbox (Mailpit) | http://localhost:8026 |

Stop: `docker compose down` (data stays in PostgreSQL).
Fresh demo data: `docker compose exec backend python -m app.seed --reset` (wipes this project's database and reloads it).

---

## 2. Demo accounts (one or more for every role)

Password for every account: **`Password@123`** (`DEMO_PASSWORD` in `.env`). The login page lists them for one-click sign-in.

| Role | Sign in as | What to look at |
| --- | --- | --- |
| **Super Admin** | `admin@anwargroup.example` — Waeez Rahman | Every feature, plus the **Admin panel**: users and roles, invitations, roles and privileges, settings, audit log |
| **DMD (full access)** | `dmd@anwargroup.example` — Mahmud Hasan | Every feature, the same as Super Admin |
| **Program Owner** | `owner@anwargroup.example` — Farhana Akter | Manage challenges, control centre, round results, shortlist manager, results and awards, ideas portfolio, program dashboard |
| **Executive Viewer** | `executive@anwargroup.example` — Shahana Parvin | All submissions (read only), executive dashboard |
| **Judge** | `judge1@…` Dr. Kamal Hossain (5 entries to score, 1 overdue) · `judge2@…` · `judge3@…` · `judge4@…` | My judging, scoring page, and every participant's documents and information (names are not hidden) |
| **Admin (master data)** | `masterdata@anwargroup.example` — Arif Mahmud | Organization tree, domains, categories, lookups, skills |
| **HR** | `hr@anwargroup.example` — Tahmina Begum | Supporting role (rewards) |
| **Finance Verifier** | `finance@anwargroup.example` — Jahid Islam | Impact → queue of measurements to verify |
| **Sponsor** | `sponsor@anwargroup.example` — Nasrin Ahmed | Approves pilots, sees ideas in pilot/production |
| **Team Leader** | `rahim@anwargroup.example` — Rahim Uddin | Leads *Team Spark*: draft methodology, join link, 1 join request waiting; a shortlisted entry that needs a prototype; a draft idea; a reviewer's question to answer |
| **Team Member** | `nusrat@…` and `tanvir@…` (Team Spark) | Team page, shared methodology; Nusrat also leads a finalist team (demo booking) |
| **Participant** | `sadia@…` (pending join request) · `karim@…` (leads *Team Nova*) · `fahim@…`, `lamia@…`, `sabbir@…`, `priya@…`, `omar@…`, `mitu@…`, `tania@…` | Own entries and ideas only |
| **New employee** | `anika@anwargroup.example` — Anika Tabassum | Empty state; good for trying registration and the join link |

Team Leader and Team Member are not assigned roles — they come from creating or joining a team (as the data-model document says).

Team join link in the demo data: `http://localhost:5173/join/demo-spark-join-link-2026`

### Demo challenges — one at every stage

| Challenge | Domain | Stage | Use it to show |
| --- | --- | --- | --- |
| Cut kiln energy use by 10% | Energy | Registration + methodology open | Register, teams, join link and requests, methodology form with autosave, privacy between teams |
| Faster employee onboarding | HR | Methodology review (blind) | Judge queue, scoring, overdue review, judge disagreement |
| Cut procurement paperwork by half | Procurement | Shortlisting | Proposed shortlist (3 in, 1 waitlist, 2 out), override with reason, prototype decision, confirm, publish |
| Zero harm: safer shift handover | Safety | Build | Shortlisted moment, build plan and milestones, prototype submission, feedback for not-shortlisted |
| Cut water use in textile dyeing | Sustainability | Demo and judging | Demo slot booking, final submission, final jury, results decision → approve → publish |
| AES developer productivity challenge | Technology | Results published | Winners, rewards split by credit share, hall of fame |
| Faster customer complaint resolution | Customer service | Upcoming | Scheduled challenge |
| Close the month in five days | Finance | Draft | Builder wizard and publish checklist |

Open ideas cover the whole lifecycle too: draft, submitted (on behalf of a colleague without a login), triage, a **confidential** idea,
under review, clarification requested, shortlisted, on hold, Idea Bank, prototype, pilot, production, impact verified, scaled, plus two catalogue entries.

---

## 2a. Accounts, roles and the admin panel

- **Sign up** (`/signup`): anyone creates an Employee account. `signup_enabled` and `signup_allowed_domains` in Admin → Settings control it.
- **Admin panel** (`/admin`, Super Admin and DMD only):
  - *Users and roles* — give or remove roles, deactivate or reactivate an account, reset a password.
  - *Invitations* — invite an email address to sign up as Judge (or any other privileged role). The person gets an email
    with a one-time link; the link is also shown once to copy. Invitations can be re-sent or revoked.
  - *Roles and privileges* — tick what each role may do. Super Admin and DMD always have everything.
- **Judges** can open every entry, submission, file and idea, including confidential ones.

## 2b. Judges

- **Only the admin chooses judges** (Super Admin; the DMD counts as one). Program Owners can see the judges but not change them.
- **Anyone can be a judge.** No Judge role is needed first: pick any person with an account, one or many at a time.
  People without an account are **invited by email**; they become a judge when they sign up with the link.
- **Per challenge:** Manage challenges → open a challenge → **Judges** tab. Each judge scores **all stages** or only the
  ones you tick (Methodology, Prototype, Final demo). You can change the stages or remove a judge later; scores already
  submitted always stay.
- **Per idea:** open the idea → **Choose judges**.
- **One place for both:** Admin → **Judges** has two lists, *Challenge judges* and *Innovation judges*. Everything is picked
  from dropdown lists (challenge or idea, person, stage or days). Email invitations are behind **Invite by email**.
- **My judging** (what a judge sees) is split into *Challenge judging* and *Innovation judging*, with dropdown filters.
- Entries are shared among the judges automatically when judges change (or with **Share entries now**). A judge added while
  scoring is under way gets every entry that is waiting in their stages.
- A person chosen this way sees only what they judge, under **My judging** — not every submission. (People who hold the
  Judge *role* still see all submissions, as before.)
- A person who takes part in a challenge can't be a judge of that same challenge.
- Publishing a challenge no longer waits for judges; they can be added at any time.

## 2c-0. Rich text, demo → pilot flow, judge feedback (latest)

- **Rich text:** methodology answers (long text), every long field of the idea form, the demo/pilot forms and judge comments have a toolbar:
  **bold**, *italic*, bullet and numbered lists, clickable links (Ctrl+B / Ctrl+I / Ctrl+K, Write/Preview tabs). Stored as a small
  Markdown subset in the same text fields and rendered safely (no HTML is ever injected); old plain text still displays.
- **Shortlisted → demo form:** a shortlisted entry or idea gets the **Demo link + How to use it** form. After the candidate submits it
  waits as *Submitted*; the **Super Admin / DMD chooses the judges and presses Send to judges** (judges see it only then).
  Judges approve / send back / reject with feedback. **Approved → eligible for the pilot**, and the pilot form opens (ideas and entries);
  it is submitted and reviewed the same way. Everything else is unchanged.
- **Judge feedback for staff:** every judge's score, recommendation, comment per criterion, strengths, suggestions and private note, plus
  demo/pilot decisions — on the idea page (Feedback tab), in Admin → Judges → *Judge feedback*, in each challenge's *Judge feedback* tab and
  inside the Feedback composer. Entrants still never see judge names.

- **KPI verification is chosen by the admin:** when a KPI measurement is recorded, the Super Admin / DMD is told and picks the verifier
  (Impact → To verify, or the KPI on the idea's Impact tab → *Choose who verifies this*). Nothing is assigned automatically. The chosen
  person sees it in **My judging** (Innovation judging), checks the number and verifies, adjusts or rejects it. Others can't.

## 2c-1. Challenge flow, start to finish

1. **Methodology submitted** → the Super Admin / DMD chooses one or many judges (challenge → *Judges* tab; stage *Methodology*). Entries are shared out automatically.
2. **Judges score** the methodology. **Top N:** on the round results page the admin sets *Change Top N* (and waitlist), then the system proposes the shortlist; a person confirms and publishes.
3. **Shortlisted candidates get the demo form** (demo link + how to use it) on their *Demo & pilot* page. The admin chooses the judges and sends it; judges **approve or reject** (or send back) with feedback. Approved → *Finalist* (and eligible for the pilot).
4. **Final presentation is given live (offline).** Afterwards, in *Results and awards*, the admin enters each finalist's **final presentation score**, rank, winner / runner-up and a note (*Rank by presentation score* helps), approves and publishes.
5. **Final output in the system:** *Results & awards* lists the winners with score, jury note and prize; each entrant sees their result and score under their entry's feedback. An approved demo counts as working evidence for a top award.

## 2c. Prototype review and pilot review

- When a prototype is allowed, the candidate fills a short **prototype form**: the link and how to use it. They send it for review.
- **Judges decide, with feedback and no score:** approve, send back for changes, or reject. Most judges decide; if everyone
  has decided without a majority it goes back for changes. The **admin can make the final call** (a reason is required).
- The admin chooses the judges of each review (any people, several at once). It starts with the people who already judged
  the work, so the admin only changes them when needed.
- Sent back: the candidate reads the feedback (without judge names), updates the form and sends it again as a new round.
- **Ideas:** approved prototype → **Pilot**. In pilot the candidate sends a **pilot report**, reviewed the same way; only an
  approved pilot review can move to production (which still needs a KPI measurement). Rejected prototype → Idea Bank;
  rejected pilot → closed.
- **Challenge entries:** approved prototype → **Finalist**; sent back → back to building; rejected → not selected. A winning
  entry that continues as an idea has its pilot reviewed there.
- Where: the idea page (Overview), the entry's Prototype page, **My judging** for judges, and
  Admin → Judges → **Prototype & pilot reviews** for the admin.
- The old "Request demo", "Approve pilot" and "Ask for rework" buttons on ideas are replaced by this review.

## 3. The `.env` file

One file in the project root is read by Docker Compose, the backend and the frontend build. Nothing else holds a URL or port.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `BACKEND_PORT`, `FRONTEND_PORT` | Docker, Vite dev server | Ports on your machine |
| `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT` | Docker | Email inbox ports (8026 / 1026 by default because 8025 / 1025 are often taken) |
| `FRONTEND_URL` | Backend | Base of links in emails and team join links |
| `BACKEND_URL`, `API_PREFIX` | Smoke test, docs | Where the API lives |
| `CORS_ORIGINS` | Backend | Browser origins allowed to call the API |
| `VITE_API_BASE_URL`, `VITE_APP_NAME`, `VITE_DISPLAY_TIMEZONE` | Frontend | Baked in at build time |
| `DATABASE_URL`, `DB_POOL_SIZE` | Backend | PostgreSQL connection string (Neon pooled URL) — **keep it out of git** |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | Backend | Attachment folder (inside the `innovatex_data` volume) |
| `SIGNUP_ENABLED`, `INVITATION_EXPIRY_DAYS` | Backend | Defaults for sign-up and invitation links |
| `JWT_SECRET`, `JWT_EXPIRE_MINUTES` | Backend | Sign-in tokens — **change the secret** |
| `DEMO_MODE`, `SEED_ON_START`, `DEMO_PASSWORD` | Backend | Demo accounts and data |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Backend | Email server (empty host = log only) |
| `OUTBOX_POLL_SECONDS` | Backend | How often the worker sends notifications |

If you change a port, change the matching URL too (for example `FRONTEND_PORT=3000` → `FRONTEND_URL`, `CORS_ORIGINS`), then
`docker compose up --build` (the frontend bakes `VITE_API_BASE_URL` in at build time).

---

## 4. Run without Docker (development)

```bash
# Backend
cd backend
python -m venv .venv && .venv\Scripts\activate          # Windows;  source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
copy .env.local.example .env.local                      # local SQLite path and SMTP port
uvicorn app.main:app --reload --port 8000

# Frontend (reads the same root .env)
cd frontend
npm install
npm run dev
```

Useful commands:

```bash
python -m app.seed --reset        # (in backend/) wipe and reload the demo data
python scripts/smoke_test.py      # 770+ API checks across every role and flow (run on fresh data; it changes data)
```

---

## 5. Project layout

```
backend/app/
  core/            config (env), db, security (JWT), permissions + visibility filters, events/outbox/audit, errors
  shared/          base model (standard columns), access checks for polymorphic records
  modules/
    identity/      users, org tree, fixed roles, permissions, role assignment
    masterdata/    lookups, categories, domains, skills, dynamic forms, scorecards
    challenges/    challenges, phases, eligibility, Q&A, registration, phase clock, journey rail
    teams/         teams, join links (token stored hashed), join requests
    submissions/   methodology / prototype / final with versions, all-submissions browser, attachments
    evaluation/    review queue, scoring, round results, conflict of interest, shortlist, feedback, appeals
    initiatives/   open ideas, configurable workflow engine, clarifications, comments, export
    delivery/      milestones, Demo Day, KPIs and verification, results and awards, catalogue
    analytics/     home ("What needs you now"), dashboards, search
    notifications/ templates, rules, outbox dispatcher
    admin/         settings, feature flags, workflows, audit log, system health
  workers/         background thread: outbox dispatcher + phase scheduler
  seed_reference.py  roles, permissions, master data, forms, scorecards, workflows, email templates
  seed.py            demo people, challenges and ideas
frontend/src/
  app/             router (lazy routes + guards), providers, app shell
  api/ auth/ hooks/ utils/ i18n/
  components/ui    Button, Field, Dialog, DataTable, …
  components/domain JourneyRail, DeadlineCountdown, DynamicForm, StatusBadge, charts, …
  features/        one folder per area (challenges, teams, entries, ideas, review, manage, admin, …)
scripts/smoke_test.py
docker-compose.yml  .env.example
```

---

## 6. Rules from the documents that the code enforces

- **Visibility (data model §4.6).** Super Admin, Program Owner, Executive and Judges see all submissions. Everyone else sees only
  their own entries and their team's. Anything else returns **404, not 403**, and the UI shows the same "Page not found".
  Challenge pages show only public information and a registration count.
- **Fixed roles.** Roles are seeded and can only be assigned; the last Super Admin can't be removed. The DMD role has full access.
- **Team join links (§4.7).** Random token, only its SHA-256 is stored, shown once, expiry never after registration closes,
  optional maximum uses, revoke works immediately, the join page shows only team name, challenge, leader and size.
- **Server decides time.** Submission windows, deadline lock and phase changes use the server clock.
- **Score maths (§4.5).** Reviewer score = Σ(rating ÷ max × weight). Aggregation MEAN / MEDIAN / TRIMMED_MEAN / WEIGHTED,
  optional z-score normalisation, minimum-rating gates, disagreement flag, tie-breaks, shortlist methods, waitlist.
  The system only *proposes*; a human overrides (reason required), confirms and publishes.
- **Fairness.** Conflict-of-interest check (own team, manager, direct report), comment required for ratings 1 and 5,
  judges can't open each other's reviews, written feedback for every entry, one appeal within the appeal window.
- **Evidence.** No top award without a working submission; a pilot starts only after the prototype review is approved; production needs an approved pilot review and a
  measurement; "impact verified" needs a verifier who is not the person who measured.
- **Confidential ideas** never appear in lists, search, the catalogue or email bodies for people outside the restricted group.
- **Notifications** use the outbox pattern: the change commits first, a worker sends afterwards, failures are logged and retried.
  Recipients (for example the designated reviewer mailbox) and templates are edited in Admin, not in code.
- **Audit log** is append-only with a hash chain.

---

## 7. What is simplified in this version

| Document says | This build | To change later |
| --- | --- | --- |
| PostgreSQL (JSONB, ltree, pgvector) | PostgreSQL on Neon with plain JSON columns; org path stored as text. Small tables are read once per request because every query is a network round trip | Add Alembic migrations; move to JSONB / ltree when needed |
| Alembic migrations | Tables are created from the models at start | Add Alembic before the schema starts changing in production |
| Microsoft Entra ID login (MSAL) | Email + password with JWT, demo accounts | Replace `core/security.py` token check and the login page |
| Redis + Celery/ARQ workers | One background thread in the API process | Move `workers/scheduler.py` functions into real workers |
| Azure Blob with signed URLs, virus scan | Files on the Docker volume, downloads need the auth header, scan status always "clean" | Swap the storage functions in `submissions/router.py` |
| 141 tables | 80 tables and 156 API routes — everything Release 1 needs plus impact, badges, points and catalogue from Release 2 | AI tables (Release 3) are not built |
| ECharts, TipTap, Storybook, Playwright | Small built-in charts, plain text areas, no Storybook; API smoke test instead of browser tests | Add as needed |
| Emails | Sent to Mailpit; deliveries logged in Admin → Notifications | Point `SMTP_*` at the company server or add Microsoft Graph |
