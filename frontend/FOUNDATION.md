# Frontend foundation — what page authors can use

Import alias `@/` = `src/`. Env (root `.env`, read via `envDir: '..'`): `VITE_API_BASE_URL`, `VITE_APP_NAME`, `VITE_DISPLAY_TIMEZONE`, `FRONTEND_PORT`.
Pages are **default exports** in `src/features/<area>/<Name>Page.tsx` (paths fixed in `src/app/router.tsx`; overwrite the placeholder). They render inside `<AppShell>` (already padded, max-width 1280) — start with `<PageHeader>`. All text via `useTranslation()`; add keys to `src/i18n/en.json` + `bn.json`.

## API — `@/api/client`, `@/api/queryKeys`
- `api.get<T>(path, params?)`, `api.post<T>(path, body?)`, `api.put`, `api.patch`, `api.del(path, params?)`, `api.upload<T>(path, FormData)`, `api.download(path, filename?)`
- `class ApiError { status, code, message, details, requestId }`, `errorMessage(e)`, `idempotencyKey()`, `type Page<T> = {items,total,page}`, `getToken/setToken/clearToken`
- `queryKeys.*` — factory for every feature (challenges, entries, teams, ideas, review, shortlists, submissions, manage, admin, masterdata…). 4xx is never retried. 401 → redirect to `/login?next=`.

## Auth — `@/auth`
- `useMe()` → `{ data: Me | undefined, isLoading }`; `useAuth()` → `{ me, login(email,pw), logout(), refetchMe() }`
- `useAccess()` → `{ me, roles, hasRole(...roles), can(perm), seesAllSubmissions, isPrivileged, isTeamLeader(teamId), isTeamMember(teamId), flag(code) }`
- `<Can permission? roles? fallback?>`, `<RequireRole roles>` (renders NotFound), `<RequireAuth>`; types `Me, MeTeam, Role, Permission`
- A record the API answers 404/403 for: `if (isNotFound(query.error)) return <NotFoundPage />` (`@/features/misc/NotFoundPage`).

## Utils / hooks
- `@/utils/i18n`: `tr(obj_i18n, fallback?)`, `isFallbackLanguage(obj)`
- `@/utils/dates`: `formatDateTime(v)` "20 Nov 2026, 5:00 PM", `formatDate`, `formatDayMonth`, `relativeFromNow`, `parseServerDate`, `serverNow()`, `countdownParts`, `dayKey`, `toLocalInputValue(iso)` / `fromLocalInputValue(str)` for `datetime-local` inputs
- `@/utils/format`: `money(n, cur='BDT')`, `num(n, digits)`, `pct(n, isRatio?)`, `statusLabel(CODE)`, `initials(name)`, `fileSize(bytes)`; `@/utils/cn`: `cn(...)`
- `@/hooks`: `useAutosave(value, save, delayMs=5000, enabled=true)` → `'idle'|'saving'|'saved'|'error'` (first value counts as saved), `useDebounce(v, ms)`, `useServerTime(tickMs)`, `useUnsavedChangesGuard(dirty, msg?)`, `useOnline()`
- Toasts: `import { toast } from 'sonner'` → `toast.success('Methodology submitted')`.

## UI — `@/components/ui`
- `Button {variant:'primary'|'secondary'|'ghost'|'danger', size:'sm'|'md'|'lg', loading, icon, disabledReason, fullWidth}`; `ButtonLink {to, variant, size, icon}`
- `Field {label, help?, error?, required?, hint?}` wraps ONE control and wires id/aria; `Input`, `Textarea`, `Select {options:[{value,label}], placeholder?}`, `Checkbox {label, description?}`, `Switch {checked, onChange(bool), label, description?}`; plain controls can use class `control`
- `Dialog {open, onOpenChange, title, description?, footer?, size:'sm'|'md'|'lg'}`; `ConfirmDialog {open, onOpenChange, title, description?, confirmLabel, variant?, loading?, onConfirm}`
- `Tabs {tabs:[{value,label,count?,disabled?}], value, onChange, ariaLabel?}` (controlled; render the panel yourself)
- `Badge {tone:'neutral'|'info'|'warning'|'success'|'danger'|'spark'|'primary', icon?}`, `Card {padded?}`, `CardHeader {title, subtitle?, actions?}`, `PageHeader {title, subtitle?, actions?, breadcrumbs:[{label,to?}], meta?}`, `Avatar {name, size}`, `Stat {label, value, hint?, icon?, tone?, to?}`
- `Skeleton {className}`, `PageSkeleton {rows?}`, `Spinner {label?}`, `ProgressBar {value, max?, label?, showValue?, tone?}`, `EmptyState {icon?, title, description?, action?}`, `ErrorState {error?, message?, onRetry?}` (shows request id), `isNotFound(error)`
- `DataTable<T> {columns:[{key, header, render?(row), sortValue?(row), align?, hideOnMobile?}], rows, rowKey(row), onRowClick?, loading?, empty?, initialSort?, rowClassName?}` — cards under 768px

## Domain — `@/components/domain`
- `StatusBadge {status, label?, tone?}` (any status code → colour + icon + text; WINNER = spark), `statusTone(code)`
- `JourneyRail {stages:[{code,label,state:'done'|'current'|'upcoming'|'skipped'|'won',date?,note?}], size:'compact'|'full'}`
- `DeadlineCountdown {closesAt, prefix?, closedLabel?, compact?}`
- `DynamicForm {form, value, onChange, readOnly?, errors?, lastStepAction?, children?}`; `DynamicFormView {form, value, hideEmpty?}`; `validateForm(form, value)` → `{field_key: msg}`; `completeness(form, value)` → 0–100; types `FormDefinition, FormValue, FormErrors`
- `ScoreSummary {total, criteria?:[{code?,name,value,max?,weight?}], caption?}`; `FeedbackCard {feedback:{strengths,improvements,decision_code,decision_reason,next_steps,score_shared,published_at}, title?, footer?}`
- `AttachmentList {entityType, entityId, canEdit?, canDownload?, title?}`
- `ConfidentialBanner {message?}`, `UserChip {name, subtitle?, size?}`, `SaveIndicator {status}`, `Callout {tone:'info'|'warning'|'success'|'danger'|'spark', title?, action?}`
- Charts: `BarChart {data:[{label,value,hint?}], title?, summary?, format?, maxValue?}`, `FunnelChart {stages:[{label,value}], title?, summary?}`, `StatTile {label, value, hint?, spark?, to?}`

## Tailwind tokens
Colours: `ink`, `ink-muted`, `canvas`, `surface`, `line`, `primary` (`-soft`, `-fg`), `spark` (`-soft`, `-ink`), `success|warning|danger|info` (+ `-soft`), `neutral-soft`. Radius: `rounded-control` 6, `rounded-panel` 10, `rounded-dialog` 14. Widths: `max-w-content`, `max-w-reading`. Helpers: `.tabular`, `.reading`, `shadow-float`. Dark mode via `data-theme="dark"` (tokens swap automatically; don't use raw hex).
