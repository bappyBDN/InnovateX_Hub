# InnovateX Hub — Frontend UI/UX Specification

**Stack:** React + TypeScript · works with the FastAPI backend (see *InnovateX_Hub_Backend_Data_Model.md* v1.1)
**Version:** 1.0 (draft for team review) · **Date:** 04 Oct 2026

---

## 0. How to read this file

This file tells the frontend team **what to build and how it should look and behave**: the technology, the fixed roles and what each role sees, the menus, every page with its layout and states, the design system, the shared components, the rules for forms, errors and accessibility, and the build order.

Words used in this file:

| Word | Meaning |
| --- | --- |
| **Challenge** | A problem posted by the company, in any domain (operations, safety, HR, finance, energy, customer service, technology…) |
| **Entry** | One registration in a challenge — one person or one team |
| **Methodology** | The plan an entry submits after registration: how they will solve the problem |
| **Idea** | An open innovation submitted outside a challenge |
| **Judge** | A panel member who scores submissions |
| **Journey rail** | The stage tracker shown on every entry and idea (section 6.1) |

---

## 1. UX principles

1. **One clear next step.** Every page tells the user what to do next ("Submit your methodology by 20 Nov"). The most important action is always the most visible button.
2. **Show only what the role needs.** A participant never sees admin or judge menus. Menus and pages are built from the user's permissions.
3. **Privacy by default.** A participant sees only their own work and their team's work. Nothing on screen hints at other participants (no names, no lists, no counts per person).
4. **Never lose work.** Forms autosave every few seconds and warn before leaving with unsaved changes.
5. **Deadlines are always visible.** Countdown and exact date/time (Asia/Dhaka) on every page with a time limit.
6. **Plain language.** Short sentences, sentence case, no system words. "Send join request", not "Create membership request entity".
7. **Same word for the same action everywhere.** If the button says "Submit methodology", the toast says "Methodology submitted" and the email says "Your methodology was submitted".
8. **Works for everyone.** Bangla and English, phone and desktop, keyboard and screen reader (WCAG 2.1 AA).
9. **Fast.** Pages feel instant: skeleton loading, cached data, small bundles.
10. **Humans decide.** AI features (Release 3) only suggest; the user always clicks to accept.

---

## 2. Technology stack

| Area | Choice | Why |
| --- | --- | --- |
| Framework | React 18 + TypeScript (strict mode) | Team choice; type safety |
| Build tool | Vite | Fast dev server and builds |
| Routing | React Router v6 (data routers, lazy routes) | Code splitting per page |
| Server data | TanStack Query v5 | Caching, retries, background refresh, optimistic updates |
| API client | `openapi-typescript` + `openapi-fetch`, generated from FastAPI OpenAPI | Types always match the backend |
| Small UI state | Zustand | Sidebar, theme, language, draft UI state |
| Forms | React Hook Form + Zod | Fast forms, clear validation |
| Dynamic forms | Own `DynamicForm` renderer from backend form definitions | Each challenge has its own methodology form |
| UI components | Radix UI primitives + shadcn/ui pattern + Tailwind CSS | Accessible by default; full control of the look |
| Tables | TanStack Table + TanStack Virtual | Sorting, filters, big lists |
| Charts | Apache ECharts (`echarts-for-react`) | Rich dashboards, good performance |
| Rich text | TipTap (limited toolbar) + DOMPurify on display | Safe formatted text |
| Files | `react-dropzone`, direct upload to signed URL with progress | Large files without blocking the API |
| Dates | `date-fns` + `date-fns-tz` | All times shown in Asia/Dhaka |
| i18n | `react-i18next` (English + Bangla) | Bilingual UI |
| Auth | MSAL React (Microsoft Entra ID) | Company single sign-on |
| Drag and drop | `dnd-kit` | Form builder, scorecard order, milestones |
| Toasts | Sonner | Short confirmations |
| Icons | Lucide | Clean, consistent line icons |
| Tests | Vitest + React Testing Library, Playwright (end-to-end), `axe-core` (accessibility) | Quality |
| Component docs | Storybook | Shared design system |
| Quality | ESLint, Prettier, TypeScript strict, Husky pre-commit | Consistency |
| Monitoring | Sentry (or Azure App Insights) + Web Vitals | Errors and speed in production |

---

## 3. Fixed roles and what each role sees

The role list is **fixed**. Admins can only assign roles; they cannot create, rename or delete them. Team Leader and Team Member are not assigned — they come from creating or joining a team.

| Level | Role | Sees in the app |
| --- | --- | --- |
| 1 | **Super Admin** | Everything: all menus, all submissions, all settings, users and roles, audit log |
| 2 | **Program Owner** (Innovation Office) | All challenges, entries, submissions, scores; challenge builder; shortlist; results; dashboards |
| 2 | **Executive Viewer** | All submissions (read only) and executive dashboards |
| 3 | **Judge** | All innovation submissions (read only); review queue; scoring only for assigned entries |
| 4 | **Team Leader** | Own team: members, join link, join requests, team submissions, feedback, scores |
| 5 | **Team Member** | Own team's submissions, feedback, scores; can edit drafts |
| 6 | **Participant / Employee** | Open challenges (public info only), own entries, own ideas, own feedback |
| — | Supporting: Admin (master data), HR (rewards), Finance Verifier (impact), Sponsor | Only their own work area |

**Golden visibility rule:** Super Admin, privileged roles (Program Owner, Executive) and Judges see all submissions. Everyone else sees only their own, and their team's while they are a member. The frontend hides what the user cannot see, and the backend also blocks it (a forbidden record returns "not found").

**What a participant must never see:** other participants' names, other teams, other entries, other methodologies, other files, other scores, other feedback, or a ranking. Challenge pages show only the problem, rules, timeline, prizes, public Q&A and the total number of registrations. After results are published, winners' title, team name and short summary are shown (if the challenge allows).

### 3.1 Permission checks in React

The `/me` API returns the user's roles, permission codes, team memberships and feature flags. The UI uses three tools:

```tsx
// 1. Hide or disable a part of the page
<Can permission="shortlist.confirm">
  <Button onClick={confirm}>Confirm shortlist</Button>
</Can>

// 2. Protect a whole route
{ path: "/admin/*", element: <RequireRole roles={["SUPER_ADMIN"]} />, children: adminRoutes }

// 3. Check in code
const { can, hasRole, isMemberOf } = useAccess();
if (can("review.score") && assignment.reviewerId === me.id) { ... }
```

If a user opens a link they cannot access, show the **Not found** page (same as the backend), never "You are not allowed to see X", so the page does not confirm that X exists.

---

## 4. Navigation (information architecture)

### 4.1 Main menu by role

| Menu item | Participant | Team leader / member | Judge | Executive | Program Owner | Super Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Challenges | ✓ (public info) | ✓ | ✓ | ✓ | ✓ | ✓ |
| My entries | ✓ | ✓ | ✓ (own) | | ✓ (own) | ✓ (own) |
| My team | | ✓ | ✓ (own) | | | |
| Submit an idea | ✓ | ✓ | ✓ | | ✓ | ✓ |
| My ideas | ✓ | ✓ | ✓ | | ✓ | ✓ |
| Review queue | | | ✓ | | ✓ | ✓ |
| All submissions | | | ✓ (read) | ✓ (read) | ✓ | ✓ |
| Manage challenges | | | | | ✓ | ✓ |
| Results & awards | ✓ (published) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Impact | own | own | | ✓ | ✓ | ✓ |
| Dashboards | personal | personal | judge | executive | program | all |
| Notifications | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Admin | | | | | partial (challenge setup, templates) | ✓ full |

### 4.2 Layout of the app shell

```
Desktop (≥ 1024 px)
┌───────────────────────────────────────────────────────────────────┐
│ Logo  InnovateX Hub      [ Search ideas & challenges ]  EN|বাং 🔔 👤│
├────────────┬──────────────────────────────────────────────────────┤
│ Home       │ Breadcrumb: Challenges / Cut energy use              │
│ Challenges │ ┌──────────────────────────────────────────────────┐ │
│ My entries │ │ Page title                     [Primary action]  │ │
│ My team    │ │ One-line purpose                                 │ │
│ Ideas      │ ├──────────────────────────────────────────────────┤ │
│ Review     │ │                                                  │ │
│ ...        │ │ Page content                                     │ │
│            │ │                                                  │ │
│ ─────────  │ └──────────────────────────────────────────────────┘ │
│ Help       │                                                      │
└────────────┴──────────────────────────────────────────────────────┘

Phone (< 768 px)
┌─────────────────────────┐
│ ☰  InnovateX     🔔  👤 │
├─────────────────────────┤
│ Page title              │
│ [Primary action — full] │
│ Content (one column)    │
│                         │
├─────────────────────────┤
│ Home Challenges Mine  ⋯ │  ← bottom bar, 4 most-used items
└─────────────────────────┘
```

- Sidebar collapses to icons on tablets; becomes a drawer on phones.
- Global search searches only what the user is allowed to see.
- Language switch (EN / বাংলা) is always one click away.
- Help link opens short guides and a contact for the innovation office.

---

## 5. Route map

| Route | Page | Who |
| --- | --- | --- |
| `/login` | Login (company account) | Everyone |
| `/` | Home (role-based) | Everyone |
| `/challenges` | Challenge list | Everyone |
| `/challenges/:slug` | Challenge detail (tabs) | Everyone (public info) |
| `/challenges/:slug/register` | Register (individual or team) | Eligible employees |
| `/join/:token` | Join a team through link | Logged-in employees |
| `/entries` | My entries | Participants |
| `/entries/:id` | Entry overview with journey rail | Entry members, privileged, judges |
| `/entries/:id/methodology` | Methodology form | Entry members |
| `/entries/:id/prototype` | Prototype submission | Shortlisted entries that need it |
| `/entries/:id/final` | Final project submission | Finalists |
| `/entries/:id/milestones` | Build plan and progress | Shortlisted entries |
| `/entries/:id/demo` | Demo slot booking | Finalists |
| `/entries/:id/feedback` | Feedback and scores | Entry members |
| `/teams/:id` | Team page (members, link, requests) | Team members; leader manages |
| `/ideas/new` | Submit an idea (6 steps) | Everyone |
| `/ideas` | My ideas | Everyone |
| `/ideas/:code` | Idea detail | Owner, team, privileged, judges |
| `/review` | Review queue | Judges |
| `/review/:assignmentId` | Scoring workspace | Assigned judge |
| `/submissions` | All submissions browser | Super Admin, privileged, judges |
| `/manage/challenges` | Challenge management list | Program Owner, Super Admin |
| `/manage/challenges/new` | Challenge builder wizard | Program Owner, Super Admin |
| `/manage/challenges/:id` | Challenge control centre (tabs) | Program Owner, Super Admin |
| `/manage/challenges/:id/rounds/:roundId` | Round results & ranking | Program Owner, Super Admin |
| `/manage/challenges/:id/shortlist/:shortlistId` | Shortlist manager | Program Owner, Super Admin |
| `/manage/challenges/:id/results` | Results & awards decision | Program Owner, Super Admin |
| `/results` | Published results & hall of fame | Everyone |
| `/impact` | Impact tracking | Owners, verifiers, privileged |
| `/dashboards/:type` | Dashboards | By role |
| `/notifications` | Notification centre | Everyone |
| `/profile` | My profile, skills, badges, rewards | Everyone |
| `/admin/users` | Users & role assignment | Super Admin |
| `/admin/org` | Organization hierarchy | Super Admin, Admin |
| `/admin/master-data` | Domains, categories, lookups, skills | Super Admin, Admin |
| `/admin/forms` | Form builder | Super Admin, Program Owner |
| `/admin/scorecards` | Scorecard builder | Super Admin, Program Owner |
| `/admin/workflows` | Workflow states & transitions | Super Admin |
| `/admin/notifications` | Email templates & rules | Super Admin, Program Owner |
| `/admin/settings` | System settings & feature flags | Super Admin |
| `/admin/audit` | Audit log | Super Admin |
| `/admin/ai` | AI agents & policies (Release 3) | Super Admin |
| `*` | Not found | Everyone |

---

## 6. Design system

### 6.1 Visual direction

InnovateX Hub serves an industrial group (cement, steel, textiles, real estate, finance, technology). The look should feel **clear, confident and practical** — like a well-run control room, not a startup landing page. Calm surfaces, strong readable type, and colour used only to show meaning (status, deadlines, rewards).

**The one memorable element: the journey rail.** Every entry and idea shows a horizontal track of its stages (Registered → Methodology → Review → Shortlisted → Build → Prototype → Demo → Result). Past stages are solid, the current stage is highlighted with its deadline, future stages are outlined. It appears on cards (small), entry pages (large) and in emails (as a static image). Users learn the whole process just by seeing it. Everything else stays quiet so this element stands out.

```
 ●━━━━━━━●━━━━━━━◉━━━━━━━○───────○───────○
 Registered  Methodology  In review  Shortlist  Build   Result
             Submitted    Due 28 Nov
             12 Nov
```

### 6.2 Colour tokens

Replace these with Anwar Group brand colours if the brand team provides them; keep the roles.

| Token | Hex (light) | Use |
| --- | --- | --- |
| `ink` | `#1B2A3A` | Main text, headings |
| `ink-muted` | `#55657A` | Secondary text, labels |
| `canvas` | `#F5F7F8` | Page background (cool grey, not cream) |
| `surface` | `#FFFFFF` | Panels, forms, tables |
| `line` | `#D9E0E6` | Borders, dividers |
| `primary` | `#0B6E6E` | Main buttons, links, current stage on the journey rail |
| `primary-soft` | `#E3F1F0` | Selected rows, active menu |
| `spark` | `#E8A317` | **Only** for rewards, winners, badges — rare on purpose |
| `success` | `#1E7F4F` | Approved, shortlisted, submitted |
| `warning` | `#B26B00` | Due soon, needs attention |
| `danger` | `#B42318` | Overdue, declined, errors |
| `info` | `#2459A6` | Information notes |

Dark mode: same tokens with dark values (`canvas #0F1720`, `surface #16202B`, `ink #E6ECF1`). Every colour pair must reach 4.5:1 contrast for text.

**Status badge colours (used the same everywhere):**

| Status group | Colour | Examples |
| --- | --- | --- |
| Draft / not started | Grey | Draft, Registered |
| Waiting on others | Blue (`info`) | Submitted, In review |
| Needs your action | Amber (`warning`) | Clarification needed, Due in 2 days |
| Positive | Green (`success`) | Shortlisted, Approved, Finalist |
| Negative / closed | Red or grey | Not shortlisted, Declined, Withdrawn |
| Winner | `spark` | Winner, Award |

Status is never shown by colour alone: always colour + text (+ icon).

### 6.3 Typography

- **Noto Sans** (Latin) + **Noto Sans Bengali** (Bangla): one family designed to match across both scripts, so bilingual pages look even. Load via Google Fonts with `font-display: swap`; fallback `system-ui, "Segoe UI", sans-serif`.
- Scale (rem): 0.75 (caption) · 0.875 (small/labels) · 1 (body) · 1.25 (section title) · 1.5 (page title) · 2 (dashboard hero number).
- Weights: 400 body, 500 labels and buttons, 600 titles. No all-caps labels.
- Line height: 1.5 body, 1.3 titles. Bangla text gets 1.6 line height for readability.
- Text width: max ~75 characters per line in reading areas (challenge descriptions, feedback).
- Numbers in tables use tabular figures so columns line up.

### 6.4 Spacing, shape and depth

- 4 px spacing grid (4, 8, 12, 16, 24, 32, 48).
- Corner radius by importance, not one value for everything: inputs and buttons 6 px, panels 10 px, dialogs 14 px, badges fully rounded.
- Depth: borders first; shadow only for floating items (menus, dialogs, toasts).
- Content max width 1280 px; reading pages 760 px.
- Layout grid: 12 columns desktop, 8 tablet, 4 phone.

### 6.5 Motion

- Motion only to answer a user action: opening a panel, expanding a row, confirming a submit (a short check mark), moving on the journey rail when a stage changes.
- 150–250 ms, ease-out. Respect `prefers-reduced-motion` (turn motion off).
- One celebratory moment only: when a user is shortlisted or wins, the journey rail stage fills with `spark` and a short message appears. No confetti on every action.

### 6.6 Writing style (UI copy)

- Sentence case for everything: "Submit methodology", "Team join link".
- Buttons say exactly what happens: "Send join request", "Approve", "Save draft", "Submit for review".
- Errors explain what happened and how to fix it: "The methodology window closed on 20 Nov at 5:00 PM. Contact the innovation office if you had a system problem."
- Empty states invite action: "You haven't joined a challenge yet. Browse open challenges."
- No blame, no jokes in errors, no apology filler.
- Dates: "20 Nov 2026, 5:00 PM" (Asia/Dhaka). Relative time only when helpful: "Closes in 2 days".
- All text comes from translation files (`en.json`, `bn.json`); no hard-coded text in components.

---
## 7. Shared components (build once, use everywhere)

All components live in `src/components/ui` (basic) and `src/components/domain` (InnovateX-specific), each with a Storybook story and tests.

**Basic UI components**

| Component | Notes |
| --- | --- |
| Button | Variants: primary, secondary, ghost, danger. Loading state with spinner; disabled state explains why in a tooltip |
| Input, Textarea, Select, Combobox, MultiSelect, DatePicker, DateTimePicker, NumberInput, MoneyInput | Label always visible (no placeholder-only labels), help text, error text, required mark |
| Checkbox, Radio, Switch | |
| Dialog, ConfirmDialog, Drawer | Confirm dialogs repeat the action name: "Withdraw entry?" → [Withdraw entry] [Cancel] |
| Tabs, Accordion, Stepper | |
| DataTable | Sorting, filters, column chooser, saved views, pagination or virtual scroll, row selection, export |
| Badge, StatusBadge | Colour + text + icon (section 6.2) |
| Avatar, AvatarGroup | Initials fallback |
| Toast | Success/info/error; actions like "Undo" where possible |
| Skeleton, Spinner, ProgressBar | Skeleton for page loading, never a blank page |
| EmptyState | Icon, one sentence, one action |
| ErrorState | What went wrong + retry button + request ID for support |
| Tooltip, Popover, DropdownMenu | Keyboard accessible (Radix) |
| FileUploader | Drag and drop, type/size check before upload, progress, virus-scan status, replace/remove |
| RichTextEditor / RichTextView | Limited toolbar (bold, lists, links, headings); sanitized output |
| Pagination, Breadcrumbs, PageHeader | |

**Domain components**

| Component | Purpose |
| --- | --- |
| `JourneyRail` | Stage tracker (sizes: compact for cards, full for pages); shows dates, current deadline, skipped stages (e.g. no prototype phase) |
| `DeadlineCountdown` | "Closes in 2 days 4 h" + exact date; turns amber at < 48 h, red at < 6 h; updates every minute; uses server time offset |
| `ChallengeCard` | Banner, title, domain, participation type (individual/team), key date, status, "Register" or "View my entry" |
| `EntryCard` | Entry code, title, team/individual, compact journey rail, next action |
| `IdeaCard` | Idea code, title, category, stage, next action |
| `TeamPanel` | Members, roles, credit share, leader actions |
| `InviteLinkManager` | Create, copy, see expiry and uses, revoke (leader only) |
| `JoinRequestList` | Approve / decline with message |
| `DynamicForm` | Renders any backend form (methodology, idea, prototype, final) with steps, conditional fields, autosave, validation |
| `ScorecardForm` | Criteria with weight, rating buttons (1–5) with level descriptions, comment boxes, live weighted total |
| `ScoreSummary` | Total score, per-criterion bars (if allowed), feedback text |
| `FeedbackCard` | Strengths, improvements, decision, next steps |
| `StatusTimeline` | History of changes (who, when, what, comment) — privileged view |
| `KpiEditor` | Baseline, target, actual, unit, period |
| `AttachmentList` | Files and links with type icons, download (signed URL) |
| `CommentThread` | Comments with visibility label (team only / judges only) |
| `OrgUnitPicker`, `UserPicker`, `DomainPicker` | Searchable pickers |
| `ConfidentialBanner` | Shown on confidential records: "Confidential — do not share outside the panel" |
| `AISuggestionCard` (R3) | Suggestion + "Use this" / "Edit" / "Dismiss" |

---

## 8. Page specifications — everyone and participants

Each page lists: **purpose**, **who**, **layout**, **actions**, and **states** (loading, empty, error, special cases).

### 8.1 Login

- **Purpose:** sign in with company account (Microsoft Entra ID).
- **Layout:** product name, one sentence ("Share ideas, join challenges, and turn them into real results."), **Sign in with company account** button, language switch, help contact.
- **States:** signing in (spinner on button); account not found → "Your account isn't set up yet. Contact the innovation office."; account disabled → same message, no detail.
- Staff without company login are submitted for by a proxy (no separate login page in Release 1).

### 8.2 Home (role-based)

The Home page changes by role. All versions start with **"What needs you now"**.

**Participant / team member**

```
┌──────────────────────────────────────────────────────────────┐
│ Good morning, Rahim                                          │
├──────────────────────────────────────────────────────────────┤
│ What needs you now                                           │
│ ⚠ Submit methodology — Energy Saving Challenge  Closes in 2d │ [Continue]
│ ● 2 join requests waiting — Team Spark                       │ [Review]
│ ● Feedback ready — Idea INNO-2026-000123                     │ [Read]
├──────────────────────────────────────────────────────────────┤
│ My entries                                                   │
│ ┌ ENT-2026-007-0042  Smart kiln scheduling ───────────────┐  │
│ │ ●━━━●━━━◉───○───○   In review · result by 28 Nov        │  │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ Open challenges (3)                              [See all]   │
│ [Card] [Card] [Card]                                         │
├──────────────────────────────────────────────────────────────┤
│ My ideas · My badges and rewards                             │
└──────────────────────────────────────────────────────────────┘
```

**Judge:** reviews due (count, nearest due date), "Start next review", challenges they judge, overdue warnings.
**Program Owner:** challenges by phase, registrations and submissions today, reviews overdue, shortlists waiting for confirmation, results waiting for approval.
**Executive:** key numbers (active challenges, entries, shortlisted, pilots, verified value) and link to dashboards.
**Super Admin:** all of the above plus system health (failed emails, failed jobs).

- **Empty state (new user):** "Welcome to InnovateX Hub. Join an open challenge or share an idea." with two buttons.

### 8.3 Challenge list

- **Purpose:** find challenges to join.
- **Layout:** tabs **Open now · Upcoming · Closed**; filters: domain (any business area), participation type (individual / team / both), eligible for me (on by default); search box. Grid of `ChallengeCard` (list view option).
- **Card shows:** banner, title, domain, "Team of 1–5" or "Individual", prize summary, current phase and its closing date, eligibility badge ("You can join" / "Not eligible: AES staff only"), button **Register** or **View my entry**.
- **Never shows:** names of participants or teams. Only "48 registered" if the program owner enables the count.
- **Empty:** "No open challenges right now. You can still share an idea." [Submit an idea]

### 8.4 Challenge detail

```
┌──────────────────────────────────────────────────────────────┐
│ [Banner image]                                               │
│ Cut kiln energy use by 10%            Domain: Energy         │
│ Sponsor: Head of Operations   Team of 1–5   Prize pool shown │
│ ⏱ Registration closes in 5 days (15 Nov, 5:00 PM) [Register] │
├──────────────────────────────────────────────────────────────┤
│ Overview | Timeline | Rules & prizes | Resources | Q&A | My entry │
├──────────────────────────────────────────────────────────────┤
│ The problem / What success looks like / Who can join         │
│ How you will be judged (criteria + weights, shown openly)    │
└──────────────────────────────────────────────────────────────┘
```

- **Tabs:**
  - *Overview:* problem, background, expected outcome, eligibility, judging criteria with weights (transparency builds trust).
  - *Timeline:* every phase with open/close dates; current phase highlighted; prototype phase marked "only if the panel asks" when policy is `PANEL_DECIDES`.
  - *Rules & prizes:* rules, IP and originality terms, prize table.
  - *Resources:* datasets, templates, sandbox links (some unlock only after registration or shortlist — show a lock with "Available after shortlisting").
  - *Q&A:* published questions and answers; **Ask a question** (can be anonymous to other users; the program owner sees the name).
  - *My entry:* only if registered — compact entry summary and next action.
- **Primary action changes by state:** Register → Continue methodology → View my entry → See results.
- **Not eligible:** button disabled with the reason ("This challenge is for AES staff only").

### 8.5 Register for a challenge

Short wizard (2–3 steps, one screen on desktop):

1. **How will you take part?** Individual or Team (only options the challenge allows). Team explains: "You will be the team leader. You can invite members with a join link."
2. **Entry details:** working title, team name (if team), track/sub-domain if the challenge has tracks, any registration questions (dynamic form).
3. **Agree and register:** rules, originality and idea-ownership declaration (checkbox with link to full text). Button **Register**.

- **After success:** confirmation page with entry code, the journey rail, the methodology deadline, and (for teams) a prominent **Create team join link** button.
- **Blocks:** already registered → go to entry; already in a team in this challenge → message with link to that team; registration closed → message with closing date.

### 8.6 Team page (`/teams/:id`)

Visible only to team members (and privileged roles/judges). The leader sees management tools.

```
┌──────────────────────────────────────────────────────────────┐
│ Team Spark · Cut kiln energy use by 10%     3 of 5 members   │
├──────────────────────────────────────────────────────────────┤
│ Members                                                      │
│ 👤 Rahim Uddin   Leader   Process engineer   Credit 34%      │
│ 👤 Nusrat Jahan  Member   Data analyst       Credit 33%  [⋯] │
│ 👤 Tanvir Ahmed  Member   Maintenance        Credit 33%  [⋯] │
│                                       [Edit credit shares]   │
├──────────────────────────────────────────────────────────────┤
│ Team join link                         (leader only)         │
│ https://innovatex.anwar.../join/••••••••  [Copy link]        │
│ Expires 15 Nov, 5:00 PM · Used 4 times    [Revoke] [New link]│
├──────────────────────────────────────────────────────────────┤
│ Join requests (2)                      (leader only)         │
│ 👤 Sadia Islam — "I work in energy audits and know SAP PM."  │
│                                   [Approve]  [Decline]       │
├──────────────────────────────────────────────────────────────┤
│ Team activity · Leave team                                   │
└──────────────────────────────────────────────────────────────┘
```

- **Create join link:** opens a dialog: expiry (default 7 days, cannot pass registration close), maximum uses (optional). After creating, the full link is shown **once** with a **Copy link** button and share shortcuts (Email, Teams, WhatsApp). Later the link is shown masked; to share again, the leader creates a new link (the old one can stay active or be revoked).
- **Revoke:** confirm dialog "Revoke this link? People who have it can no longer send join requests." Existing pending requests stay.
- **Join requests:** each shows the requester's name, department, message, and request time. **Approve** adds them at once (if team not full). **Decline** asks for an optional reason (sent politely).
- **Team full:** link section shows "Team is full (5 of 5). Links are paused." Approve buttons disabled with tooltip.
- **Credit shares:** must total 100%; default equal; inline error if not 100. Changes after submission need all members to see a notice.
- **Member menu (leader):** Make leader (transfer), Remove from team (confirm; removed member loses access immediately).
- **Member:** sees members, team work and **Leave team** (confirm). The leader cannot leave without transferring leadership.
- **Locked team** (after registration closes): banner "Team is locked. Member changes are closed." Link and request sections hidden.

### 8.7 Join a team through a link (`/join/:token`)

The person must sign in first; after sign-in they return to this page automatically.

```
┌───────────────────────────────────────────┐
│ Join Team Spark                           │
│ Challenge: Cut kiln energy use by 10%     │
│ Team leader: Rahim Uddin                  │
│ Team size: 3 of 5                         │
│                                           │
│ Message to the leader (required)          │
│ ┌───────────────────────────────────────┐ │
│ │ Tell them your skills and why you     │ │
│ │ want to join.                         │ │
│ └───────────────────────────────────────┘ │
│ 0 / 500                                   │
│ [Send join request]                       │
└───────────────────────────────────────────┘
```

- Shows **only** team name, challenge, leader name and team size — no member list, no submissions.
- **After sending:** "Join request sent. We'll notify you when Rahim responds." The page then shows request status (Pending / Approved / Declined) and a **Cancel request** option while pending.
- **Problem states (each with a clear message and a next step):**
  - Link expired or revoked → "This join link no longer works. Ask the team leader for a new one."
  - Team full → "This team is full."
  - Registration closed → "Registration for this challenge closed on 15 Nov."
  - Already in a team in this challenge → "You're already in Team Nova for this challenge." [Go to my team]
  - Not eligible → "This challenge is open to AES staff only."
  - Request already pending → show its status.
- **On approval:** email + notification; the new member lands on the team page.

### 8.8 My entries

- **Purpose:** all challenge entries of the user (individual and team).
- **Layout:** tabs Active · Finished; `EntryCard` list with compact journey rail and next action button.
- **Empty:** "You haven't joined a challenge yet." [Browse challenges]

### 8.9 Entry overview (`/entries/:id`)

The home of one entry. Visible to entry members, privileged roles and judges.

```
┌──────────────────────────────────────────────────────────────┐
│ ENT-2026-007-0042 · Smart kiln scheduling        Team Spark  │
│ Cut kiln energy use by 10%                                   │
│ ●━━━━━━●━━━━━━◉──────○──────○──────○──────○                  │
│ Registered Methodology In review Shortlist Build Demo Result │
│            12 Nov       Result by 28 Nov                     │
├──────────────────────────────────────────────────────────────┤
│ Next step                                                    │
│ Your methodology is with the judges. You'll hear by 28 Nov.  │
├──────────────────────────────────────────────────────────────┤
│ Submissions        Methodology  Submitted 12 Nov  [View]     │
│                    Prototype    Not required                 │
│ Feedback           Not yet available                         │
│ Team               3 members    [Open team]                  │
│ Messages           Clarification questions from the panel    │
└──────────────────────────────────────────────────────────────┘
```

- **Next step box** always says one thing, based on status:

| Status | Next step text | Button |
| --- | --- | --- |
| Registered | Submit your methodology by 20 Nov, 5:00 PM | Continue methodology |
| Methodology submitted | You can still edit until 20 Nov, 5:00 PM | Edit methodology |
| In review | Your methodology is with the judges | — |
| Clarification needed | The panel asked a question. Reply by 24 Nov | Reply |
| Shortlisted (prototype required) | Build and submit your prototype by 15 Jan | Open build plan |
| Shortlisted (no prototype) | Prepare your final project by 30 Jan | Open build plan |
| Waitlisted | You're on the waitlist. We'll tell you if a place opens | — |
| Not shortlisted | Read your feedback. Your idea can still be submitted as an open idea | Read feedback |
| Finalist | Book your demo slot | Book demo |
| Winner / runner-up / participant | See results and your feedback | See results |

- **Shortlisted moment:** the rail fills the Shortlist stage in `spark`, with a short message: "Your team is shortlisted." Shown once.

### 8.10 Methodology form (`/entries/:id/methodology`)

The most important form. Built with `DynamicForm` from the challenge's methodology template.

```
┌──────────────────────────────────────────────────────────────┐
│ Methodology · Smart kiln scheduling      ⏱ Closes in 2d 4h   │
│ Saved 10 seconds ago ✓                    [Preview] [Submit] │
├───────────────┬──────────────────────────────────────────────┤
│ Steps         │ 2. Your approach                             │
│ ✓ 1 Problem   │                                              │
│ ● 2 Approach  │ How will you solve the problem? *            │
│ ○ 3 Plan      │ ┌──────────────────────────────────────────┐ │
│ ○ 4 Impact    │ │                                          │ │
│ ○ 5 Risks     │ └──────────────────────────────────────────┘ │
│ ○ 6 Team      │ Explain the steps in simple words. 0/3000    │
│ ○ 7 Review    │                                              │
│               │ Data or systems you need                     │
│ 64% complete  │ [ + Add ]                                    │
│               │                                              │
│               │ Judges score this section on: Feasibility    │
│               │                         [Back]  [Next step]  │
└───────────────┴──────────────────────────────────────────────┘
```

- **Typical sections** (configured per challenge, not hard-coded): understanding of the problem; proposed approach; work plan and milestones; expected impact (KPI, baseline, target); resources and data needed; risks and how to handle them; team skills; attachments (diagrams, calculations, documents); declaration.
- **Helpful touches:**
  - Each section shows which judging criteria it supports, so participants write what matters.
  - Help text and an example for each field ("Good example").
  - Character counters; required marks; validation on leaving a field, not while typing.
  - Autosave every 5 seconds and on field blur; "Saved" indicator; works offline briefly and syncs back.
  - Two team members editing: the form shows "Nusrat is editing section 3" and locks that section for others (soft lock) to prevent overwrites; conflicts show a merge dialog.
  - **Preview** shows exactly what judges will see.
  - **Submit** opens a checklist dialog: all required fields done, files scanned clean, declaration ticked. Then "Submit methodology".
- **After submit:** success page with time stamp and version number; "You can edit and resubmit until 20 Nov, 5:00 PM. Judges see only your last version."
- **Deadline behaviour:** banner turns amber at 48 h and red at 6 h; 15-minute warning toast; at the deadline the form becomes read-only with "The submission window closed. Your last submitted version (v3, 20 Nov 4:52 PM) will be reviewed." A draft never submitted shows "Not submitted".
- **Role differences:** leader and members can edit; only the leader (or any member, as the challenge setting decides) can press Submit.

### 8.11 Prototype and final submission

- Same `DynamicForm` pattern with the prototype/final template: what was built, how to try it (link, credentials note, video), results so far, evidence files, changes from the methodology.
- **Prototype page appears only for entries with prototype required** (or optional). Others see "No prototype needed for your entry" on the rail (stage shown as skipped).
- Large file upload: progress per file, resume on failure, scan status ("Checking file for viruses…" → "Ready").

### 8.12 Build plan and milestones (shortlisted entries)

- Milestone list (title, due date, owner, status) with drag to reorder; weekly progress update box ("What we did, what's next, where we need help"); mentor comments.
- Resources unlocked after shortlist.

### 8.13 Demo booking (finalists)

- Calendar of available slots; pick one; confirm. Shows location/online link, duration, what to prepare (checklist). Reschedule until 48 h before.

### 8.14 Feedback and scores (`/entries/:id/feedback`)

- **Shows:** decision, strengths, improvements, next steps; total score and per-criterion scores if the challenge allows ("You scored 78 out of 100"). Judges' names are never shown.
- **No comparison** with other entries; no rank unless the challenge chooses to show "Top 10" style information.
- **Raise an appeal** (within the appeal window): only for process problems; short form; status shown.
- Marks the feedback as read (for program owner tracking).

### 8.15 Submit an idea (open ideas, 6 steps)

Same layout as the methodology form, with fixed steps from the PRD:

1. About the idea — title, organization, function/team, category, type, challenge link (optional)
2. Problem — problem statement, affected users, current process, pain points, baseline
3. Proposed innovation — solution, technology or method used (any — not only IT), what's different, process change
4. Value and impact — main KPI, baseline, target, benefit types, expected value, scalability
5. Team and governance — owner, contributors and credit shares, sponsor, risk flags, data classification, dependencies
6. Evidence and submit — files and links, declaration, preview, **Submit idea**

- **Submit on behalf** (proxy users): a toggle at step 1 "I'm submitting for a colleague" with a colleague picker; the colleague is the owner and gets credit.
- **After submit:** confirmation page with Innovation ID (e.g. INNO-2026-000123), tracking link, journey rail, and "We've emailed you a copy".

### 8.16 My ideas and idea detail

- **My ideas:** tabs Drafts · Submitted · Closed; card list with stage and next action.
- **Idea detail:** header with code, title, stage badge, journey rail (Draft → Submitted → Triage → Review → Prototype → Demo → Pilot → Production → Impact verified → Scaled); tabs **Overview · Team · Evidence · Feedback · Impact · History**. Clarification questions appear at the top as an amber box with a **Reply** button.

### 8.17 Results and hall of fame (`/results`)

- Published results only. For each challenge: winners by award category with title, team name, short summary, photo (optional), prize.
- Hall of fame: implemented and awarded innovations (non-confidential) with impact numbers once verified.
- Never lists non-winning entries.

### 8.18 Notifications centre

- List grouped by Today / Earlier; filters: All · Needs action · Updates; mark all as read. Each item links to the exact page.
- Bell icon shows unread count; dropdown shows latest 5.
- Notification settings in profile (email digest for non-urgent updates; deadline and decision alerts cannot be turned off).

### 8.19 Profile

- Name, department, job title (from HR/Entra, read only), skills (editable), language, notification settings.
- **My recognition:** badges, certificates (download PDF), rewards and their status, points history.
- **My activity:** ideas and entries summary.

---
## 9. Page specifications — judges

### 9.1 Review queue (`/review`)

- **Purpose:** the judge's to-do list.
- **Layout:** summary chips (Due today · Due this week · Overdue · Done); table: entry code (or anonymous alias in blind rounds), title, challenge, round (Methodology / Prototype / Final), due date, status (Not started / In progress / Submitted), **Start** / **Continue** button.
- **Sorting default:** nearest due date first. Overdue rows in red with "2 days overdue".
- **Declare conflict:** row menu → "I have a conflict of interest" → reason → the item is removed and reassigned.
- **Empty:** "No reviews assigned to you right now."

### 9.2 Scoring workspace (`/review/:assignmentId`)

Split screen: submission on the left, scorecard on the right. On phones the two become tabs.

```
┌───────────────────────────────────────┬──────────────────────────────┐
│ ENT-...-0042 (or "Entry #42" blind)   │ Methodology scorecard        │
│ Smart kiln scheduling   v3 · 20 Nov   │ Due 28 Nov · Saved ✓         │
│ ─────────────────────────────────────  │ ──────────────────────────── │
│ 1. Problem understanding              │ Problem importance  25%      │
│ ...text...                            │ (1)(2)(3)(●4)(5)  Strong     │
│ 2. Approach                           │ "Clear evidence of the       │
│ ...text...                            │  problem with data."         │
│ [Attachments: 3]  [Links: 1]          │ Comment ________________     │
│                                       │                              │
│ Section jump: Problem|Approach|Plan|… │ Feasibility  10%   min 2     │
│                                       │ (1)(2)(●3)(4)(5)             │
│                                       │ ...                          │
│                                       │ ──────────────────────────── │
│                                       │ Total: 74.0 / 100            │
│                                       │ Recommendation: ○Yes ●Maybe  │
│                                       │ Strengths (shared) ________  │
│                                       │ Improvements (shared) _____  │
│                                       │ Private note (panel) ______  │
│                                       │ [Save draft] [Submit review] │
└───────────────────────────────────────┴──────────────────────────────┘
```

- Rating buttons show the meaning of each number on hover/focus (from the scale levels); keyboard 1–5 shortcuts.
- Comment becomes required when a rating is 1 or 5 (as configured); clear inline message.
- Live weighted total updates as the judge scores; criteria below their minimum show an amber note "Below minimum (2)".
- Judges cannot see other judges' scores until they submit their own (then optionally visible to the panel chair only).
- **Ask a clarification:** button opens a question box; the entry is notified; the review clock pauses.
- **Submit review** → confirm dialog with summary → read-only afterwards (the chair can reopen).
- Blind rounds: names, team and department hidden; files show a note "Names in attachments may be visible — score only the content".
- Autosave scores as drafts.

### 9.3 All submissions browser (`/submissions`)

Visible to **Super Admin, Program Owner, Executive and Judges** only.

- **Filters:** challenge, phase/submission type, domain, status, org unit, date, score range (privileged only), keyword.
- **Table:** code, title, entrant (name or team; hidden in blind rounds for judges), challenge, submitted date, status, score (privileged only).
- Opening a row shows the read-only submission view. Judges see a banner "Read only. You can score only entries assigned to you."
- **Confidential** submissions show the `ConfidentialBanner`; export disabled for judges.

---

## 10. Page specifications — program owner and super admin (challenge management)

### 10.1 Manage challenges list

- Table: code, title, domain, status/phase, registrations, submissions, reviews done %, next date, owner. Filters by status and domain. **Create challenge** button.

### 10.2 Challenge builder wizard (`/manage/challenges/new`)

A guided wizard with a live preview of how the challenge page will look. Can save as draft at any step.

| Step | What the program owner sets |
| --- | --- |
| 1. Basics | Title (EN/BN), domain (any business area), category, banner, sponsor, program owner |
| 2. Problem | Problem statement, background, expected outcome, rules, resources |
| 3. Who can join | Eligibility rules (org units, grades, joined after, exclude list), individual/team/both, team size min–max, cross-company teams allowed |
| 4. Timeline | Phases with open/close date and time: Registration, Methodology, Methodology review, Shortlist, Build, Prototype (optional), Prototype review, Final submission, Demo, Judging, Results. Drag to reorder; add/remove optional phases; visual timeline preview; warnings for overlaps or gaps |
| 5. Forms | Choose or build the methodology form, prototype form and final form (opens form builder) |
| 6. Judging | Scorecard per review round, panel members, judges per entry, blind review on/off, aggregation method, what entrants see (total only / per criterion / nothing) |
| 7. Shortlist rules | Method (top N, minimum score, top %, manual, per-track quota), waitlist size, tie-break order, prototype policy (none / optional / required for all / panel decides) |
| 8. Prizes & awards | Prize table, award categories, publish winner summaries on/off, People's Choice and leaderboard (off by default with a privacy note) |
| 9. Notifications | Which emails go out and when (defaults pre-filled) |
| 10. Review & publish | Checklist (all phases dated, forms published, scorecard weights total 100, panel has at least 3 judges) → **Publish challenge** or **Schedule publish** |

### 10.3 Challenge control centre (`/manage/challenges/:id`)

Tabs:

- **Overview:** current phase, key numbers (registered entries, teams, methodologies submitted, reviews done, shortlisted), phase timeline with "Now" marker, quick actions (extend deadline for everyone, send announcement, close phase early).
- **Entries:** table of all entries with status, team, submission status, score; open any entry; actions: withdraw on behalf (with reason), grant individual extension (with reason, audited).
- **Q&A:** answer and publish questions.
- **Rounds:** each review round with progress bar (assigned / submitted / overdue), **Auto-assign judges** (shows conflict-of-interest exclusions), manual reassign, send reminder.
- **Shortlist:** see 10.4.
- **Demo Day:** create event, slots, see bookings.
- **Results:** see 10.5.
- **Settings:** edit challenge (some fields locked after publish, with explanation).
- **Activity log:** every change in this challenge.

### 10.4 Round results and shortlist manager

**Round results page**

- Ranked table: rank, entry, final score, raw vs normalized score (toggle), per-criterion averages (heat-map cells), reviews done (3/3), flags: failed minimum, judges disagree.
- Rows with **judges disagree** open a side panel showing each judge's ratings for the criterion; the chair records the resolution.
- Shortlist can't be proposed until all reviews are in and disagreements are resolved (button disabled with the reason).

**Shortlist manager**

```
┌──────────────────────────────────────────────────────────────────┐
│ Methodology shortlist · Rule: Top 10 with score ≥ 65   PROPOSED  │
│ 10 in · 3 waitlist · 35 out                                      │
├──────────────────────────────────────────────────────────────────┤
│ Rank  Entry                    Score  System  Final   Prototype  │
│ 1     Smart kiln scheduling    86.2   In      In      [✓] needed │
│ 2     Dust-free packing line   84.0   In      In      [ ]        │
│ ...                                                              │
│ 11    Solar dryer              64.8   Wait    In ⚠    [✓]        │
│       Override reason: "Strong safety value; panel vote 4–1"     │
│ 12    ...                                                        │
├──────────────────────────────────────────────────────────────────┤
│ [Re-run rule]   [Confirm shortlist]   [Publish results to entrants]│
└──────────────────────────────────────────────────────────────────┘
```

- **System** column shows what the rule decided; **Final** column can be changed by the program owner. Any change requires a reason (dialog) and is marked with ⚠.
- **Prototype needed** checkbox per entry (shown when policy is "panel decides"; pre-filled from policy otherwise), with optional reason.
- **Confirm shortlist** locks scores and decisions. **Publish results to entrants** sends emails and shows feedback — with a preview of the email and of what a shortlisted and a not-shortlisted entrant will see.
- Before publishing: check "Feedback written for all entries" (count of missing feedback with a link to the feedback composer).

### 10.5 Feedback composer

- One page per round listing entries without published feedback.
- For each entry: judges' shared strengths/improvements gathered automatically; the program owner edits into one clear message (strengths, improvements, decision, next steps). AI draft button in Release 3.
- Bulk publish when all are ready.

### 10.6 Results and awards decision

- Final judging results table, award categories with nominated entries, jury decision per category (winner, runners-up), approval step (Head of Digital Transformation), then **Publish results**. Preview of the public results page.
- Rewards: create reward records per winner (split by credit share automatically), send to HR.

---

## 11. Impact and dashboards

### 11.1 Impact tracking (`/impact`)

- For owners: list of their ideas/entries in pilot or production with KPI cards (baseline → target → actual, trend line), **Add measurement**, upload evidence.
- For verifiers: queue of measurements to verify; **Verify**, **Adjust** (new value + note) or **Reject** (reason).
- Verified values show a check icon with verifier and date.

### 11.2 Dashboards

All charts have a text summary above them (one sentence with the key number) and a "View data" table toggle for accessibility.

| Dashboard | Who | Main content |
| --- | --- | --- |
| My dashboard | Everyone | My entries and ideas by stage, my feedback, my badges and rewards |
| Judge | Judges | Assigned vs done, due soon, overdue, my average review time |
| Program | Program Owner, Super Admin | Funnel (registered → methodology → shortlisted → prototype → finalist → winner), phase progress per challenge, review SLA, participation by org unit and domain, drop-off points, feedback published % |
| Executive | Executive, Super Admin | Active challenges, conversion rates, pilots, production innovations, verified value (BDT, hours saved), top domains, reuse across businesses, trend by quarter |
| Challenge | Program Owner | One challenge in detail: registrations over time, submissions by deadline hour, score distribution, judge agreement |

- Filters: date range, company/org unit, domain, challenge. Saved views. Export to Excel/PDF (privileged only).
- Participation numbers are shown as totals; individual names appear only for privileged roles.

---

## 12. Admin pages (Super Admin unless noted)

| Page | Main features |
| --- | --- |
| **Users & roles** | Search users; see their roles; **Assign role** (fixed list: Super Admin, Program Owner, Executive, Judge, Admin, HR, Finance Verifier, Sponsor) with scope (all / company / challenge) and optional end date; remove role (confirm); proxy submitter assignment. Role list is read-only: no create/rename/delete. A Super Admin cannot remove the last Super Admin |
| **Organization** | Tree view of Group > Company > Function > Department > Team; add/edit/move units; sync status from HR/Entra |
| **Master data** (Admin) | Domains (any business area), categories, innovation types, benefit types, risk types, KPI units, skills — add, edit, deactivate, reorder, translations |
| **Form builder** (Program Owner) | Drag-and-drop sections and fields; field types; required/conditional rules; help text and examples in EN/BN; link fields to judging criteria; live preview (desktop/phone); versioning: publish creates a new version, published forms are read-only |
| **Scorecard builder** (Program Owner) | Criteria with weights (must total 100% — live counter), rating scale and level descriptions, minimum ratings, comment rules, tie-breakers; version and publish |
| **Workflows** | View states and transitions per workflow; edit labels, allowed roles, required fields, SLA per state; visual state diagram |
| **Notifications** (Program Owner) | Email templates (EN/BN) with variables and live preview; send test email; rules (event → recipients, CC, delay); designated reviewer mailbox; delivery log with failed emails and **Retry** |
| **Settings** | Appeal window, upload limits, retention, default join-link expiry, feature flags (People's Choice, leaderboards, AI features) |
| **Audit log** | Search by user, record, action, date; view old/new values; export (audited) |
| **System health** | Failed emails, failed jobs, integration status, storage use |
| **AI settings** (Release 3) | Agents on/off, which data levels each agent may use, monthly budget and usage, prompt versions, AI run log |

All admin forms show who last changed a setting and when.

---
## 13. Behaviour rules for every page

### 13.1 Loading, empty and error states

Every page and panel must design all four states:

| State | Rule |
| --- | --- |
| Loading | Skeleton that matches the final layout; no layout jump when data arrives |
| Empty | One sentence that explains + one action button |
| Error | What failed, a **Try again** button, and a short request ID for support. Keep the user's typed data |
| Not found / no access | Same "Page not found" page for both (no hint that a record exists) |
| Offline | Top banner "You're offline. Changes will save when you reconnect." Autosave queues changes |
| Session expired | Silent token refresh; if it fails, a dialog "Please sign in again" that returns to the same page without losing form data |

### 13.2 Forms

- Label above each field, always visible; required fields marked with * and the text "Required" for screen readers.
- Validate when the user leaves a field and on submit; never block typing.
- On submit with errors: scroll to the first error, show an error summary at the top with links to each field.
- Autosave long forms; warn before leaving with unsaved changes.
- Disable the submit button only while sending (with a spinner), not to hide validation problems.
- Use the `Idempotency-Key` header on submits so double-clicks never create two submissions.
- Server errors map to fields when the API returns a field path.

### 13.3 Time and deadlines

- Show all dates in **Asia/Dhaka** time with the format "20 Nov 2026, 5:00 PM".
- Countdown uses server time (offset from the `Date` header) so a wrong computer clock doesn't mislead users.
- The server decides if a deadline has passed; the UI only displays.

### 13.4 Privacy in the UI

- No participant list, team list or entry list on any participant-facing page.
- Search for participants returns only their own items and public challenges.
- Join-link page shows only team name, challenge, leader and size.
- People pickers for participants (e.g. "I'm submitting for a colleague") show name and department only, never their entries.
- Copy-to-clipboard of join links shows a toast "Link copied. Anyone with this link can ask to join your team."
- Confidential records show the confidential banner and hide download/export for judges.
- No personal data or tokens in `localStorage`; MSAL token cache in memory/sessionStorage; clear all caches on sign-out.

### 13.5 Accessibility (WCAG 2.1 AA)

- All actions work with keyboard only; visible focus ring (2 px `primary`, offset 2 px).
- Semantic HTML: headings in order, landmarks (`header`, `nav`, `main`), real buttons and links.
- Forms: labels linked to inputs, errors announced (`aria-live="polite"`), descriptions with `aria-describedby`.
- Colour contrast ≥ 4.5:1 for text; status never by colour alone.
- Dialogs trap focus and return focus on close; `Esc` closes.
- Charts have text summaries and data tables.
- Touch targets at least 44 × 44 px on phones.
- Respect reduced motion; support 200% zoom without breaking layout.
- Automated `axe` checks in CI; manual screen-reader test (NVDA, VoiceOver) before each release.

### 13.6 Responsive design

| Breakpoint | Width | Behaviour |
| --- | --- | --- |
| Phone | < 768 px | One column, bottom navigation, tables become cards, scoring workspace becomes tabs, sticky primary action at bottom |
| Tablet | 768–1023 px | Collapsed sidebar (icons), two columns where useful |
| Desktop | ≥ 1024 px | Full sidebar, split views, wide tables |

Must work fully on phones: challenge browsing, registration, join link, team management, methodology form, notifications, feedback, review queue and scoring.

### 13.7 Language (English and Bangla)

- All UI text in translation files; keys by feature (`challenge.register.button`).
- Content from the backend in `_i18n` fields shows the user's language, falling back to English with a small "Shown in English" note.
- Numbers and dates formatted per language (Bangla digits optional setting).
- Test every page in Bangla for text overflow (Bangla text is often longer).

### 13.8 Performance targets

| Measure | Target |
| --- | --- |
| Largest Contentful Paint | < 2.5 s on 4G |
| Interaction to Next Paint | < 200 ms |
| Cumulative Layout Shift | < 0.1 |
| Initial JS bundle | < 250 KB gzipped |

How: lazy-load each route and heavy parts (charts, rich text editor, form builder); TanStack Query caching with sensible `staleTime`; virtual scrolling for long tables; image sizes via `srcset`; prefetch the next likely page (e.g. methodology form from entry overview).

### 13.9 Security in the frontend

- Sign in with MSAL (authorization code + PKCE). Access token sent as Bearer; refresh silently.
- Never trust the UI for permissions — the backend checks every request; the UI only hides.
- Sanitize all rich text with DOMPurify before showing; never use `dangerouslySetInnerHTML` without it.
- Content Security Policy headers (set by the web server); no inline scripts.
- File downloads only through short-lived signed URLs from the API.
- Join-link tokens are read from the URL, sent to the API once, then removed from the browser address bar (`history.replaceState`).
- Don't log personal data to Sentry; scrub request bodies.

---

## 14. Code structure

### 14.1 Folder structure (feature-based)

```
frontend/
├── src/
│   ├── app/
│   │   ├── main.tsx
│   │   ├── router.tsx              # all routes, lazy loaded, guards
│   │   ├── providers.tsx           # QueryClient, MSAL, i18n, theme, toasts
│   │   └── layout/                 # AppShell, Sidebar, TopBar, BottomNav
│   ├── api/
│   │   ├── schema.d.ts             # generated from FastAPI OpenAPI
│   │   ├── client.ts               # openapi-fetch client + auth + error mapping
│   │   └── queryKeys.ts            # central query key factory
│   ├── auth/                       # MSAL config, useMe, useAccess, <Can>, <RequireRole>
│   ├── components/
│   │   ├── ui/                     # Button, Input, Dialog, DataTable ...
│   │   └── domain/                 # JourneyRail, DeadlineCountdown, DynamicForm ...
│   ├── features/
│   │   ├── home/
│   │   ├── challenges/             # list, detail, register
│   │   ├── teams/                  # team page, invite links, join requests, join page
│   │   ├── entries/                # overview, methodology, prototype, final, milestones, demo, feedback
│   │   ├── ideas/
│   │   ├── review/                 # queue, scoring workspace
│   │   ├── submissions/            # all-submissions browser
│   │   ├── manage/                 # challenge builder, control centre, rounds, shortlist, results
│   │   ├── impact/
│   │   ├── dashboards/
│   │   ├── notifications/
│   │   ├── profile/
│   │   ├── admin/                  # users, org, master data, forms, scorecards, workflows, settings, audit
│   │   └── ai/                     # Release 3
│   ├── hooks/                      # useAutosave, useServerTime, useUnsavedChangesGuard ...
│   ├── i18n/                       # en.json, bn.json, setup
│   ├── styles/                     # tokens.css (colour, type, spacing), tailwind.css
│   ├── utils/                      # dates, numbers, formatters
│   └── test/                       # test utils, MSW handlers (mock API)
├── e2e/                            # Playwright tests
├── .storybook/
└── vite.config.ts
```

Each feature folder contains `pages/`, `components/`, `api.ts` (queries and mutations for that feature), `schemas.ts` (Zod), and `routes.tsx`.

### 14.2 Examples

**Query and mutation hooks**

```ts
// features/teams/api.ts
export const useTeam = (teamId: string) =>
  useQuery({
    queryKey: queryKeys.teams.detail(teamId),
    queryFn: () => api.GET("/teams/{id}", { params: { path: { id: teamId } } }).then(unwrap),
  });

export const useCreateInviteLink = (teamId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { expires_at: string; max_uses?: number }) =>
      api.POST("/teams/{id}/invite-links", { params: { path: { id: teamId } }, body }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teams.inviteLinks(teamId) }),
  });
};

export const useDecideJoinRequest = (teamId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: "approve" | "decline"; reason?: string }) =>
      api.POST(`/join-requests/{id}/actions/${action}`, { params: { path: { id } }, body: { reason } }).then(unwrap),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams.detail(teamId) });
      qc.invalidateQueries({ queryKey: queryKeys.teams.joinRequests(teamId) });
    },
  });
};
```

**Access hook**

```ts
// auth/useAccess.ts
export function useAccess() {
  const { data: me } = useMe();
  const roles = new Set(me?.roles ?? []);
  const perms = new Set(me?.permissions ?? []);
  return {
    hasRole: (...r: Role[]) => r.some((x) => roles.has(x)),
    can: (p: Permission) => perms.has(p),
    seesAllSubmissions: ["SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE", "JUDGE"].some((r) => roles.has(r as Role)),
    isTeamLeader: (teamId: string) => me?.teams.some((t) => t.id === teamId && t.role === "LEAD") ?? false,
    isTeamMember: (teamId: string) => me?.teams.some((t) => t.id === teamId) ?? false,
  };
}
```

**Autosave hook**

```ts
// hooks/useAutosave.ts
export function useAutosave<T>(value: T, save: (v: T) => Promise<void>, delayMs = 5000) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const debounced = useDebounce(value, delayMs);
  useEffect(() => {
    if (debounced === undefined) return;
    setStatus("saving");
    save(debounced).then(() => setStatus("saved")).catch(() => setStatus("error"));
  }, [debounced]);
  return status; // shown as "Saving…", "Saved ✓", "Couldn't save — retrying"
}
```

**Dynamic form field mapping**

```tsx
// components/domain/DynamicForm/FieldRenderer.tsx
const FIELD_COMPONENTS: Record<FieldType, React.FC<FieldProps>> = {
  TEXT: TextField, LONG_TEXT: TextAreaField, RICH_TEXT: RichTextField, NUMBER: NumberField,
  MONEY: MoneyField, DATE: DateField, SELECT: SelectField, MULTI_SELECT: MultiSelectField,
  LOOKUP: LookupField, USER: UserField, ORG_UNIT: OrgUnitField, FILE: FileField, URL: UrlField,
  KPI_TABLE: KpiTableField, CHECKBOX: CheckboxField, DECLARATION: DeclarationField,
};
// New field type later = add one component + one line here. Backend form definitions do the rest.
```

---

## 15. AI features in the UI (Release 3)

AI appears as a helper, never as the decision maker. Pattern for every AI feature:

```
┌ Suggestion from AI assistant ─────────────────────────┐
│ Your problem statement doesn't mention how often the   │
│ delay happens. Judges score "Problem importance" on    │
│ evidence. Consider adding: "Happens about 12 times a   │
│ month, costing about 30 hours."                        │
│                       [Use this]  [Edit]  [Dismiss]    │
└───────────────────────────────────────────────────────┘
```

| Feature | Where | What the user sees |
| --- | --- | --- |
| Idea / methodology coach | Idea form, methodology form | "Improve this section" button per field; suggestions shown as cards |
| Similar ideas check | Before submitting an idea | "3 similar ideas exist" (only ones the user may see, e.g. published catalogue items) |
| Review summary | Scoring workspace | Short summary and suggested questions for the judge; no suggested score shown by default |
| Feedback draft | Feedback composer | Draft combining judges' comments; program owner edits before publishing |
| Smart search | Global search | Search by meaning ("ideas to reduce dust") within allowed records |
| Insights | Executive dashboard | Plain-language summary of trends, with links to the numbers |

Rules: label every AI output "AI suggestion"; show thumbs up/down; never auto-fill without a click; hide AI buttons on confidential records unless policy allows; respect the feature flag.

---

## 16. Testing and quality

| Type | Tool | Must cover |
| --- | --- | --- |
| Unit | Vitest | Utils (dates, score totals), hooks (autosave, countdown, access) |
| Component | React Testing Library | Forms, JourneyRail, ScorecardForm, InviteLinkManager, DynamicForm field types |
| API mocking | MSW | All feature tests run without the real backend |
| End-to-end | Playwright | Critical journeys below, on desktop and phone sizes, in EN and BN |
| Accessibility | axe-core in CI + manual screen reader | Every page |
| Visual | Storybook + visual snapshots | Design system components |
| Performance | Lighthouse CI | Targets in 13.8 |

**Critical end-to-end journeys (must pass before every release):**

1. Employee registers for a challenge as a team leader, creates a join link, copies it.
2. Another employee opens the link, sends a join request; leader approves; new member sees the team.
3. A third employee from a different team opens the link → blocked with the right message; tries to open the first team's entry URL directly → "Page not found".
4. Team writes and submits the methodology; edits and resubmits before the deadline; form locks after the deadline.
5. Judge scores an assigned methodology; cannot score an unassigned one; sees all submissions read-only.
6. Program owner proposes shortlist, overrides one entry with a reason, sets prototype required, confirms and publishes.
7. Shortlisted entry sees shortlist moment and prototype task; not-shortlisted entry sees feedback only.
8. Finalist books a demo slot; jury decides; results are published; participants see only winners' public summaries.
9. Employee submits an open idea; receives confirmation with ID.
10. Super Admin assigns the Judge role with scope to a challenge; the judge's menu updates.

---

## 17. Build order (aligned with backend sprints)

| Sprint | Frontend scope |
| --- | --- |
| 0 (design, 3–4 weeks) | Design tokens, Figma screens for key flows, clickable prototype tested with 5–10 employees, Storybook setup, API client generation |
| 1 | App shell, login (MSAL), `/me`, access hooks and guards, i18n, basic UI components, Not found/error pages, Super Admin users & roles page |
| 2 | DynamicForm, autosave, file uploader, idea submission (6 steps), confirmation, My ideas, idea detail, JourneyRail |
| 3 | Notifications centre, bell, profile and notification settings, admin email templates and rules |
| 4 | Review queue, scoring workspace, all-submissions browser, feedback view, scorecard builder |
| 5 | Challenge list and detail, registration, team page, join links, join page, join requests, methodology form, entry overview, challenge builder, control centre, round results, shortlist manager |
| 6 | Prototype/final submission, milestones, demo booking, results & awards pages, dashboards, exports, polishing, accessibility fixes |
| R2 | Impact tracking, catalogue, badges and rewards pages, form builder advanced rules, workflow editor, Teams deep links, Power BI embeds |
| R3 | AI suggestion cards, coach, review summary, feedback draft, smart search, AI admin |

---

## 18. Definition of done for each page

- [ ] Matches the page spec and design tokens; reviewed by the designer
- [ ] Loading, empty, error and no-access states done
- [ ] Works on phone, tablet and desktop
- [ ] Works in English and Bangla without text overflow
- [ ] Keyboard and screen reader tested; axe shows no serious issues
- [ ] Permission checks in place (`<Can>` / route guard) and tested with each role
- [ ] Participant cannot see other participants' data on this page
- [ ] All text from translation files; copy follows section 6.6
- [ ] Unit/component tests; critical journeys covered in Playwright
- [ ] No console errors; bundle size within budget

---

## 19. Open points for the team

1. Confirm brand colours and logo with the Anwar Group brand team (tokens in 6.2 are placeholders with fixed roles).
2. Confirm whether only the team leader or any member can press **Submit** on team submissions.
3. Confirm whether entrants see per-criterion scores or only the total.
4. Confirm the default join-link expiry (proposed 7 days) and whether a maximum number of uses is needed.
5. Confirm whether the total registration count is shown on challenge pages.
6. Confirm the UI component approach (Radix + shadcn/ui + Tailwind proposed) with the frontend team.
