import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import {
  CheckCircle2, ChevronDown, Clock, Database, DownloadCloud, Gift, RefreshCw, Search, Trophy, Users,
} from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Stat, Tabs,
  Textarea,
} from '@/components/ui';
import { useServerTime } from '@/hooks';
import { cn } from '@/utils/cn';
import { DISPLAY_TZ, formatDate, formatDateTime, relativeFromNow } from '@/utils/dates';

type ChallengeStatus = 'Active' | 'Achieved' | 'Expired';

interface Member {
  id: string;
  full_name: string;
  email: string | null;
  designation: string | null;
  role: 'Project Manager' | 'Team Lead' | 'Developer';
  assigned_manually: boolean;
}

interface Challenge {
  id: string;
  challenge_id: string;
  reward_amount: number;
  target_date: string;
  deadline_source: 'projectflow' | 'custom';
  target_percentage: number;
  status: ChallengeStatus;
  note: string | null;
  achieved_at: string | null;
  notified: { name: string; email: string; role: string }[];
  recipients: { key: string; name: string; email: string | null; role: string }[];
  created_at: string;
}

type Team = 'AI' | 'AES';

interface RaciPerson {
  role: string;
  name: string;
  email: string | null;
  designation: string | null;
}

interface ProcessLink {
  process_id: string | null;
  sbu: string;
  company: string | null;
  wing: string;
  wing_code: string;
  process_group: string | null;
  subprocesses: string[];
  raci: RaciPerson[];
}

/** Someone a reward can go to: a project member, a RACI person of the project's processes, or the AES team lead. */
interface Candidate {
  key: string;
  name: string;
  email: string | null;
  designation: string | null;
  source: 'project' | 'raci' | 'aes_lead';
  role: string;
  roles: string[];
  processes: string[];
}

interface Project {
  id: string;
  code: string;
  name: string;
  objective: string | null;
  company: string | null;
  department: string | null;
  function: string | null;
  status: string | null;
  health: string | null;
  due_date: string | null;
  completion_percentage: number;
  remaining_percentage: number;
  projectflow_completion: number | null;
  tasks_total: number | null;
  tasks_completed: number | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  members: Member[];
  challenge: Challenge | null;
  details: ProjectDetails;
  tasks: Task[];
  people: { responsible: string[]; accountable: string[]; reviewer: string[]; informed: string[] };
  team: Team | null;
  pb_id: string | null;
  progress_source: 'projectflow' | 'process_brain' | null;
  phases: Partial<Record<'req' | 'dev' | 'test' | 'go', number>>;
  processes: ProcessLink[];
  candidates: Candidate[];
}

interface ProjectDetails {
  strategic_objective?: string | null;
  objective?: string | null;
  expected_outcome?: string | null;
  project_type?: string | null;
  priority?: string | null;
  methodology?: string | null;
  criticality?: string | null;
  budget?: number | null;
  sponsor_name?: string | null;
  start_date?: string | null;
  baseline_due_date?: string | null;
  approved_due_date?: string | null;
  forecast_due_date?: string | null;
  actual_due_date?: string | null;
}

interface Task {
  id: number;
  code: string;
  title: string;
  status: string;
  progress: number;
  blocker: boolean;
  blocker_details: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_on: string | null;
  responsible: string[];
  accountable: string | null;
  reviewer: string | null;
  informed: string | null;
}

interface ListResponse {
  items: Project[];
  can_manage: boolean;
  aes_lead: { key: string; name: string; email: string | null } | null;
}

interface ImportResult {
  matched: number;
  created: number;
  updated: number;
  removed: number;
  removed_projects: string[];
  errors: { source: 'projectflow' | 'process_brain'; message: string }[];
}

interface Meta {
  projectflow: boolean;
  process_brain: boolean;
  can_manage: boolean;
  filter: { department: string; function: string };
  last_import: string | null;
  auto_sync: { enabled: boolean; time: string; last: string | null };
  timezone: string;
}

const ALMOST = 75;
const bdt = (n: number) => `৳${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ---- Small pieces ------------------------------------------------------------------------------------------------

function ProgressBar({ value, label }: { value: number; label: string }) {
  const tone = value >= 100 ? 'bg-success' : value >= ALMOST ? 'bg-warning' : 'bg-primary';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-3 w-full overflow-hidden rounded-full bg-neutral-soft"
    >
      <div className={cn('h-full rounded-full transition-[width] duration-700', tone)} style={{ width: `${value}%` }} />
    </div>
  );
}

function AlmostBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning shadow-[0_0_14px_rgba(245,158,11,0.55)] ring-1 ring-warning/40 motion-safe:animate-pulse"
      role="status"
    >
      {t('projectRewards.almost')}
    </span>
  );
}

/** "12 days 5 hours" — ticks every minute (server time). */
function Countdown({ to }: { to: string }) {
  const { t } = useTranslation();
  const now = useServerTime(60_000);
  const ms = new Date(to).getTime() - now.getTime();
  if (ms <= 0) return <span className="font-semibold">{t('projectRewards.deadlinePassed')}</span>;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return (
    <span className="tabular inline-flex items-baseline gap-2" aria-label={t('projectRewards.timeLeft', { days, hours })}>
      <span>
        <span className="text-2xl font-bold">{days}</span> <span className="text-xs">{t('projectRewards.days', { count: days })}</span>
      </span>
      <span>
        <span className="text-2xl font-bold">{hours}</span> <span className="text-xs">{t('projectRewards.hours', { count: hours })}</span>
      </span>
    </span>
  );
}

function RewardBanner({ c, canManage, onEdit }: { c: Challenge; canManage: boolean; onEdit: () => void }) {
  const { t } = useTranslation();
  if (c.status !== 'Active') {
    const achieved = c.status === 'Achieved';
    return (
      <div className={cn('flex flex-wrap items-center justify-between gap-2 rounded-control p-3 text-sm', achieved ? 'bg-success-soft text-ink' : 'bg-neutral-soft text-ink-muted')}>
        <span className="flex items-center gap-2">
          {achieved ? <Trophy className="h-4 w-4 text-success" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
          {achieved
            ? t('projectRewards.achieved', { amount: bdt(c.reward_amount), date: formatDate(c.achieved_at) })
            : t('projectRewards.expired', { amount: bdt(c.reward_amount), date: formatDate(c.target_date) })}
        </span>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            {t('projectRewards.newChallenge')}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-control bg-gradient-to-r from-spark-soft to-warning-soft p-4 text-ink">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-spark-ink">
            <Gift className="h-4 w-4" aria-hidden /> {t('projectRewards.bonus')} · {c.challenge_id}
          </div>
          <div className="tabular text-3xl font-bold">{bdt(c.reward_amount)}</div>
          <div className="text-sm">
            {t('projectRewards.reachBy', { pct: c.target_percentage, date: formatDateTime(c.target_date) })}
          </div>
          <div className="mt-1">
            <Badge tone={c.deadline_source === 'projectflow' ? 'info' : 'spark'} icon={c.deadline_source === 'projectflow' ? <Database className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}>
              {t(c.deadline_source === 'projectflow' ? 'projectRewards.deadlineFromPf' : 'projectRewards.deadlineByAdmin')}
            </Badge>
          </div>
          {c.note && <div className="mt-1 text-sm text-ink-muted">{c.note}</div>}
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-muted">{t('projectRewards.timeLeftLabel')}</div>
          <Countdown to={c.target_date} />
        </div>
      </div>
      {canManage && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={onEdit}>
            {t('projectRewards.updateChallenge')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Live sync from ProjectFlow -------------------------------------------------------------------------------------

function SyncPanel({ p, canManage }: { p: Project; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () => api.post<Project | { deleted: true; code: string; name: string }>(`/projects/${p.id}/sync`),
    onSuccess: (r) => {
      if ('deleted' in r) toast.warning(t('projectRewards.removedOne', { code: r.code, name: r.name }));
      else toast.success(t('projectRewards.synced', { code: r.code, pct: r.completion_percentage }));
      void qc.invalidateQueries({ queryKey: queryKeys.projectRewards.all });
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      void qc.invalidateQueries({ queryKey: queryKeys.projectRewards.all });
    },
  });
  const total = p.tasks_total ?? 0;
  const done = p.tasks_completed ?? 0;
  return (
    <div className="rounded-control border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
            <Database className="h-3.5 w-3.5" aria-hidden />{' '}
            {t('projectRewards.liveSource', { source: t(`projectRewards.sources.${p.progress_source ?? 'projectflow'}`) })}
          </div>
          <div className="mt-1 text-ink">
            {total > 0
              ? t('projectRewards.tasksDone', { done, total })
              : p.progress_source === 'process_brain'
                ? t('projectRewards.noTasksPb')
                : t('projectRewards.noTasks')}
          </div>
          {p.last_synced_at && (
            <div className="text-xs text-ink-muted">{t('projectRewards.lastSync', { when: relativeFromNow(p.last_synced_at) })}</div>
          )}
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" icon={<RefreshCw className={cn('h-4 w-4', sync.isPending && 'motion-safe:animate-spin')} aria-hidden />} loading={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? t('projectRewards.syncing') : t('projectRewards.syncNow')}
          </Button>
        )}
      </div>
      {p.last_sync_error && (
        <p className="mt-2 rounded-control bg-danger-soft p-2 text-xs text-danger" role="alert">
          {p.last_sync_error}
        </p>
      )}
    </div>
  );
}

// ---- Project card ------------------------------------------------------------------------------------------------

function ProjectCard({ p, canManage, onChallenge }: {
  p: Project; canManage: boolean; onChallenge: () => void;
}) {
  const { t } = useTranslation();
  const pm = p.members.filter((m) => m.role === 'Project Manager');
  const tl = p.members.filter((m) => m.role === 'Team Lead');
  const devs = p.members.filter((m) => m.role === 'Developer');
  return (
    <Card className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="tabular text-xs text-ink-muted">
            {p.code}
            {p.company ? ` · ${p.company}` : ''}
          </p>
          <h2 className="text-lg font-semibold text-ink">{p.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.completion_percentage >= ALMOST && <AlmostBadge />}
          {p.team && <Badge tone={p.team === 'AES' ? 'spark' : 'info'}>{t(`projectRewards.teamBadge.${p.team}`)}</Badge>}
          {p.status && <Badge tone={p.status === 'completed' ? 'success' : p.status === 'active' ? 'primary' : 'neutral'}>{t(`projectRewards.status.${p.status}`, p.status)}</Badge>}
          {p.health && <Badge tone={p.health === 'green' ? 'success' : p.health === 'amber' ? 'warning' : 'danger'}>{t(`projectRewards.health.${p.health}`, p.health)}</Badge>}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="tabular text-2xl font-bold text-ink">{p.completion_percentage}%</span>
          <span className="text-sm text-ink-muted">{t('projectRewards.remaining', { pct: p.remaining_percentage })}</span>
        </div>
        <ProgressBar value={p.completion_percentage} label={t('projectRewards.progressOf', { name: p.name })} />
        {p.due_date && <p className="mt-1 text-xs text-ink-muted">{t('projectRewards.dueOn', { date: formatDate(p.due_date) })}</p>}
      </div>

      <Phases phases={p.phases} />

      {p.challenge ? (
        <RewardBanner c={p.challenge} canManage={canManage} onEdit={onChallenge} />
      ) : (
        canManage && (
          <Button variant="secondary" icon={<Gift className="h-4 w-4" aria-hidden />} onClick={onChallenge}>
            {t('projectRewards.setChallenge')}
          </Button>
        )
      )}

      {/* Same card for every team: ProjectFlow's details and task list fold away like the processes. */}
      {p.tasks.length > 0 ? (
        <details className="group border-t border-line pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span>
              <span className="block text-xs font-medium uppercase tracking-wide text-ink-muted">{t('projectRewards.tasks.section')}</span>
              <span className="text-sm text-ink">{t('projectRewards.tasksDone', { done: p.tasks_completed ?? 0, total: p.tasks_total ?? p.tasks.length })}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-3 space-y-3 [&>section]:border-t-0 [&>section]:pt-0">
            <DetailsSection d={p.details} />
            <TaskList tasks={p.tasks} />
          </div>
        </details>
      ) : (
        <DetailsSection d={p.details} />
      )}

      <ProcessList processes={p.processes} />

      <section aria-label={t('projectRewards.peopleTitle')} className="border-t border-line pt-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">{t('projectRewards.peopleTitle')}</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <PersonRow label={t('projectRewards.roles.pm')} names={pm.map((m) => m.full_name)} />
          <PersonRow label={t('projectRewards.roles.tl')} names={tl.map((m) => m.full_name)} />
          {p.people.responsible.length > 0 && <PersonRow label={t('projectRewards.raci.responsible')} names={p.people.responsible} />}
          {p.people.accountable.length > 0 && <PersonRow label={t('projectRewards.raci.accountable')} names={p.people.accountable} />}
          {p.people.reviewer.length > 0 && <PersonRow label={t('projectRewards.raci.reviewer')} names={p.people.reviewer} />}
          {p.people.informed.length > 0 && <PersonRow label={t('projectRewards.raci.informed')} names={p.people.informed} />}
          {devs.length > 0 && <PersonRow label={t('projectRewards.roles.dev')} names={devs.map((m) => m.full_name)} wide />}
        </dl>
      </section>

      <div className="mt-auto">
        <SyncPanel p={p} canManage={canManage} />
      </div>
    </Card>
  );
}

function PersonRow({ label, names, wide }: { label: string; names: string[]; wide?: boolean }) {
  return (
    <div className={cn(wide && 'sm:col-span-2')}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-ink">{names.length ? names.join(', ') : '—'}</dd>
    </div>
  );
}

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const PHASES = ['req', 'dev', 'test', 'go'] as const;

/** Requirements → Development → Testing → Go-live, each 0..1 in Process Brain. */
function Phases({ phases }: { phases: Project['phases'] }) {
  const { t } = useTranslation();
  if (!PHASES.some((k) => phases?.[k] != null)) return null;
  return (
    <section aria-label={t('projectRewards.phases.title')}>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">{t('projectRewards.phases.title')}</h3>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PHASES.map((k) => {
          const pct = Math.round(Math.max(0, Math.min(1, phases[k] ?? 0)) * 100);
          return (
            <li key={k} className="min-w-0">
              <div className="flex items-baseline justify-between gap-1 text-xs">
                <span className="truncate text-ink-muted">{t(`projectRewards.phases.${k}`)}</span>
                <span className="tabular font-medium text-ink">{pct}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={t(`projectRewards.phases.${k}`)}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-soft"
              >
                <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const RACI_ORDER = ['R', 'A', 'C', 'I', 'DO'];

/** The process groups the project touches, their sub-processes and the RACI people of each (collapsed by default). */
function ProcessList({ processes }: { processes: ProcessLink[] }) {
  const { t } = useTranslation();
  if (!processes.length) return null;
  const subs = processes.reduce((n, g) => n + g.subprocesses.length, 0);
  const people = new Set(processes.flatMap((g) => g.raci.map((r) => (r.email ?? r.name).toLowerCase()))).size;
  return (
    <details className="group border-t border-line pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span>
          <span className="block text-xs font-medium uppercase tracking-wide text-ink-muted">{t('projectRewards.processes.title')}</span>
          <span className="text-sm text-ink">{t('projectRewards.processes.summary', { groups: processes.length, subs, people })}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ol className="mt-3 space-y-3">
        {processes.map((g) => {
          const byRole = RACI_ORDER.map((role) => [role, g.raci.filter((r) => r.role === role)] as const).filter(([, rs]) => rs.length);
          return (
            <li key={`${g.sbu}|${g.wing_code}|${g.process_group}`} className="rounded-control bg-neutral-soft/60 p-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium text-ink">{g.process_group ?? t('projectRewards.processes.wholeWing')}</span>
                <span className="tabular text-xs text-ink-muted">{g.process_id ?? ''}</span>
              </div>
              <p className="text-xs text-ink-muted">{[g.company ?? g.sbu, g.wing].filter(Boolean).join(' · ')}</p>
              {g.subprocesses.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {g.subprocesses.map((s) => (
                    <li key={s} className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink ring-1 ring-line">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
              {byRole.length ? (
                <dl className="mt-2 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
                  {byRole.map(([role, rs]) => (
                    <div key={role}>
                      <dt className="inline text-ink-muted">{t(`projectRewards.raciRoles.${role}`, role)}: </dt>
                      <dd className="inline text-ink">{rs.map((r) => r.name).join(', ')}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-xs text-ink-muted">{t('projectRewards.processes.noRaci')}</p>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function DetailsSection({ d }: { d: ProjectDetails }) {
  const { t } = useTranslation();
  const due = d.approved_due_date ?? d.forecast_due_date ?? d.baseline_due_date;
  const facts: [string, string | null | undefined][] = [
    [t('projectRewards.details.type'), d.project_type && humanize(d.project_type)],
    [t('projectRewards.details.priority'), d.priority && humanize(d.priority)],
    [t('projectRewards.details.methodology'), d.methodology && humanize(d.methodology)],
    [t('projectRewards.details.criticality'), d.criticality && humanize(d.criticality)],
    [t('projectRewards.details.sponsor'), d.sponsor_name],
    [t('projectRewards.details.budget'), d.budget != null ? bdt(d.budget) : null],
    [t('projectRewards.details.dates'), d.start_date || due ? `${formatDate(d.start_date)} → ${formatDate(due)}` : null],
    [t('projectRewards.details.forecast'), d.forecast_due_date && d.forecast_due_date !== due ? formatDate(d.forecast_due_date) : null],
  ];
  const texts: [string, string | null | undefined][] = [
    [t('projectRewards.details.strategic'), d.strategic_objective],
    [t('projectRewards.details.objective'), d.objective],
    [t('projectRewards.details.outcome'), d.expected_outcome],
  ];
  if (!facts.some(([, v]) => v) && !texts.some(([, v]) => v)) return null;
  return (
    <section aria-label={t('projectRewards.details.title')} className="border-t border-line pt-3">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">{t('projectRewards.details.title')}</h3>
      <div className="space-y-2 text-sm">
        {texts
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <p key={label} className="text-ink">
              <span className="font-medium">{label}: </span>
              {v}
            </p>
          ))}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {facts
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <div key={label}>
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

function taskTone(status: string, progress: number): 'success' | 'primary' | 'warning' | 'danger' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'completed') return 'success';
  if (s === 'blocked') return 'danger';
  if (s === 'on_hold' || s === 'waiting') return 'warning';
  if (s === 'in_progress' || s === 'ongoing' || s === 'in_review' || progress > 0) return 'primary';
  return 'neutral';
}

function TaskList({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslation();
  if (!tasks.length) return null;
  return (
    <section aria-label={t('projectRewards.tasks.title')} className="border-t border-line pt-3">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
        {t('projectRewards.tasks.title')} ({tasks.length})
      </h3>
      <ol className="space-y-3">
        {tasks.map((task, i) => {
          const tone = taskTone(task.status, task.progress);
          const bar = tone === 'success' ? 'bg-success' : tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-primary';
          return (
            <li key={task.id} className="rounded-control bg-neutral-soft/60 p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="tabular mr-1.5 text-xs text-ink-muted">{i + 1}.</span>
                  <span className="font-medium text-ink">{task.title}</span>
                  <span className="tabular ml-1.5 text-xs text-ink-muted">{task.code}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {task.blocker && <Badge tone="danger">{t('projectRewards.tasks.blocked')}</Badge>}
                  <Badge tone={tone}>{t(`projectRewards.taskStatus.${task.status.toLowerCase()}`, humanize(task.status))}</Badge>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  role="progressbar"
                  aria-label={t('projectRewards.progressOf', { name: task.title })}
                  aria-valuenow={task.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface"
                >
                  <div className={cn('h-full rounded-full', bar)} style={{ width: `${Math.min(100, task.progress)}%` }} />
                </div>
                <span className="tabular w-10 text-right text-xs font-medium text-ink">{task.progress}%</span>
              </div>
              <dl className="mt-1.5 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
                <div>
                  <dt className="inline text-ink-muted">{t('projectRewards.raci.responsible')}: </dt>
                  <dd className="inline text-ink">{task.responsible.length ? task.responsible.join(', ') : '—'}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-muted">{t('projectRewards.raci.accountable')}: </dt>
                  <dd className="inline text-ink">{task.accountable ?? '—'}</dd>
                </div>
                <div className="text-ink-muted sm:col-span-2">
                  {task.completed_on
                    ? t('projectRewards.tasks.doneOn', { date: formatDate(task.completed_on) })
                    : task.due_date
                      ? t('projectRewards.tasks.dueOn', { date: formatDate(task.due_date) })
                      : t('projectRewards.tasks.noDate')}
                </div>
              </dl>
              {task.blocker && task.blocker_details && <p className="mt-1 text-xs text-danger">{task.blocker_details}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---- Dialogs -----------------------------------------------------------------------------------------------------

function RecipientPicker({ p, aesLeadSet, chosen, onChange }: {
  p: Project; aesLeadSet: boolean; chosen: Set<string>; onChange: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => [
    { id: 'project', title: t('projectRewards.form.groupProject'), items: p.candidates.filter((c) => c.source === 'project') },
    { id: 'raci', title: t('projectRewards.form.groupRaci', { count: p.candidates.filter((c) => c.source === 'raci').length }), items: p.candidates.filter((c) => c.source === 'raci') },
    { id: 'aes', title: t('projectRewards.form.groupAes'), items: p.candidates.filter((c) => c.source === 'aes_lead') },
    // On AES projects the AES team lead is already the Team Lead (listed under the project team), so no extra group.
  ].filter((g) => g.id !== 'aes' || g.items.length > 0 || !aesLeadSet), [p.candidates, aesLeadSet, t]);
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(chosen);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    onChange(next);
  };
  const roleText = (c: Candidate) =>
    c.source === 'raci'
      ? c.roles.map((r) => t(`projectRewards.raciRoles.${r}`, r)).join(', ')
      : c.source === 'aes_lead'
        ? t('projectRewards.form.groupAes')
        : t(`projectRewards.memberRoles.${c.role}`, c.role);

  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1 text-sm font-medium text-ink">
        {t('projectRewards.form.recipients')} <span className="text-danger">*</span>
      </legend>
      <p className="mb-2 text-xs text-ink-muted">{t('projectRewards.form.recipientsHelp')}</p>
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-control border border-line p-3">
        {groups.map((g) => {
          const keys = g.items.map((c) => c.key);
          return (
            <section key={g.id} aria-label={g.title}>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">{g.title}</h4>
                {keys.length > 1 && (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggle(keys, true)}>{t('projectRewards.form.selectAll')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(keys, false)}>{t('projectRewards.form.clear')}</Button>
                  </span>
                )}
              </div>
              {g.items.length === 0 ? (
                <p className="text-sm text-ink-muted">{g.id === 'aes' ? t('projectRewards.form.aesNotSet') : '—'}</p>
              ) : (
                <ul className="space-y-2">
                  {g.items.map((c) => (
                    <li key={c.key}>
                      <Checkbox
                        checked={chosen.has(c.key)}
                        onChange={(e) => toggle([c.key], e.target.checked)}
                        label={
                          <span>
                            <span className="font-medium">{c.name}</span>
                            <span className="text-ink-muted"> · {roleText(c)}</span>
                            {!c.email && <Badge tone="warning" className="ml-1.5 align-middle">{t('projectRewards.form.noEmail')}</Badge>}
                          </span>
                        }
                        description={[c.email, c.designation, c.processes.slice(0, 3).join('; ') + (c.processes.length > 3 ? ` +${c.processes.length - 3}` : '')]
                          .filter(Boolean)
                          .join(' · ') || undefined}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </fieldset>
  );
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatInTimeZone(new Date(iso), DISPLAY_TZ, "yyyy-MM-dd'T'HH:mm");
}

function ChallengeDialog({ p, aesLeadSet, onClose }: { p: Project; aesLeadSet: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const active = p.challenge?.status === 'Active' ? p.challenge : null;
  const [amount, setAmount] = useState(active ? String(active.reward_amount) : '');
  // The ProjectFlow deadline is the default; it can only be used while it is still ahead.
  const pfUsable = !!p.due_date && new Date(p.due_date).getTime() > Date.now();
  const [source, setSource] = useState<'projectflow' | 'custom'>(
    active?.deadline_source ?? (pfUsable ? 'projectflow' : 'custom'),
  );
  const [target, setTarget] = useState(
    toLocalInput(active?.deadline_source === 'custom' ? active.target_date : pfUsable ? p.due_date : null),
  );
  const sourceGroup = useId();
  const [pct, setPct] = useState(String(active?.target_percentage ?? 100));
  const [note, setNote] = useState(active?.note ?? '');
  const lead = p.members.find((m) => m.role === 'Team Lead');
  const [leadId, setLeadId] = useState('');
  const candidates = p.members.filter((m, i, all) => all.findIndex((x) => x.full_name === m.full_name) === i);
  // Who gets the reward: the earlier choice when updating; otherwise every RACI person of the project's processes,
  // the Project Manager and Team Lead, and the AES team lead on AES projects.
  const [chosen, setChosen] = useState<Set<string>>(() => {
    const known = new Set(p.candidates.map((c) => c.key));
    const before = (active?.recipients ?? []).map((r) => r.key).filter((k) => known.has(k));
    if (before.length) return new Set(before);
    return new Set(
      p.candidates
        .filter((c) => c.source === 'raci' || (c.source === 'project' && c.role !== 'Developer') || (c.source === 'aes_lead' && p.team === 'AES'))
        .map((c) => c.key),
    );
  });
  const picked = p.candidates.filter((c) => chosen.has(c.key));
  const emailCount = new Set(picked.filter((c) => c.email).map((c) => c.email!.toLowerCase())).size;

  const save = useMutation({
    mutationFn: async () => {
      let keys = [...chosen];
      if (leadId) {
        const pick = p.members.find((m) => m.id === leadId);
        if (pick && pick.full_name !== lead?.full_name) {
          // The Team Lead is re-created on the server, so its key changes: swap the old one for the new one.
          const updated = await api.post<Project>(`/projects/${p.id}/team-lead`, { member_id: leadId });
          const newLead = updated.candidates.find((c) => c.source === 'project' && c.role === 'Team Lead');
          const still = new Set(updated.candidates.map((c) => c.key));
          keys = keys.filter((k) => still.has(k));
          if (newLead && !keys.includes(newLead.key)) keys.push(newLead.key);
        }
      }
      return api.post<{ notified: Challenge['notified']; action: string; code: string }>(`/projects/${p.id}/challenge`, {
        reward_amount: Number(amount),
        deadline_source: source,
        target_date: source === 'custom' ? fromZonedTime(target, DISPLAY_TZ).toISOString() : null,
        target_percentage: Number(pct),
        note: note.trim() || null,
        recipient_keys: keys,
      });
    },
    onSuccess: (r) => {
      if (r.notified.length) {
        toast.success(t(r.action === 'updated' ? 'projectRewards.form.updated' : 'projectRewards.form.saved'), {
          description: t('projectRewards.form.emailed', { people: r.notified.map((n) => `${n.name} (${n.role})`).join(', ') }),
        });
      } else {
        toast.warning(t('projectRewards.form.savedNoEmail'));
      }
      void qc.invalidateQueries({ queryKey: queryKeys.projectRewards.all });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!chosen.size) {
      toast.error(t('projectRewards.form.noneChosen'));
      return;
    }
    save.mutate();
  };
  const minDate = formatInTimeZone(new Date(Date.now() + 3600_000), DISPLAY_TZ, "yyyy-MM-dd'T'HH:mm");

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={active ? t('projectRewards.form.editTitle', { code: p.code }) : t('projectRewards.form.title', { code: p.code })}
      description={p.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="challenge-form" loading={save.isPending}>
            {t('projectRewards.form.submit')}
          </Button>
        </>
      }
    >
      <form id="challenge-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('projectRewards.form.amount')} required>
          <Input type="number" required min={1} step="0.01" inputMode="decimal" placeholder="50000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t('projectRewards.form.targetPct')} required help={t('projectRewards.form.targetPctHelp', { now: p.completion_percentage })}>
          <Input type="number" required min={1} max={100} value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
        <fieldset className="sm:col-span-2" aria-describedby={`${sourceGroup}-help`}>
          <legend className="mb-1.5 text-sm font-medium text-ink">
            {t('projectRewards.form.deadline')} <span className="text-danger">*</span>
          </legend>
          <div className="grid gap-2">
            <label className={cn('flex cursor-pointer gap-3 rounded-control border p-3', source === 'projectflow' ? 'border-primary bg-primary-soft' : 'border-line', !pfUsable && 'cursor-not-allowed opacity-60')}>
              <input
                type="radio"
                name={sourceGroup}
                className="mt-1"
                checked={source === 'projectflow'}
                disabled={!pfUsable}
                onChange={() => setSource('projectflow')}
              />
              <span>
                <span className="block font-medium text-ink">{t('projectRewards.form.usePf')}</span>
                <span className="block text-sm text-ink-muted">
                  {p.due_date
                    ? pfUsable
                      ? t('projectRewards.form.usePfHelp', { date: formatDateTime(p.due_date) })
                      : t('projectRewards.form.pfPassed', { date: formatDateTime(p.due_date) })
                    : t('projectRewards.form.pfNone')}
                </span>
              </span>
            </label>
            <label className={cn('flex cursor-pointer gap-3 rounded-control border p-3', source === 'custom' ? 'border-primary bg-primary-soft' : 'border-line')}>
              <input type="radio" name={sourceGroup} className="mt-1" checked={source === 'custom'} onChange={() => setSource('custom')} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{t('projectRewards.form.useCustom')}</span>
                <span className="block text-sm text-ink-muted">{t('projectRewards.form.useCustomHelp')}</span>
                {source === 'custom' && (
                  <Input
                    type="datetime-local"
                    required
                    min={minDate}
                    aria-label={t('projectRewards.form.customDate')}
                    className="mt-2"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                )}
              </span>
            </label>
          </div>
          <p id={`${sourceGroup}-help`} className="mt-1 text-xs text-ink-muted">
            {t('projectRewards.form.deadlineHelp', { tz: DISPLAY_TZ })}
          </p>
        </fieldset>
        <Field label={t('projectRewards.form.teamLead')} help={t('projectRewards.form.teamLeadHelp')} className="sm:col-span-2">
          <Select
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            placeholder={lead ? t('projectRewards.form.keepLead', { name: lead.full_name }) : t('projectRewards.form.noLead')}
            options={candidates.filter((m) => m.full_name !== lead?.full_name).map((m) => ({ value: m.id, label: `${m.full_name} (${t(`projectRewards.memberRoles.${m.role}`, m.role)})` }))}
          />
        </Field>
        <Field label={t('projectRewards.form.note')} className="sm:col-span-2">
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <RecipientPicker p={p} aesLeadSet={aesLeadSet} chosen={chosen} onChange={setChosen} />
        <div className="flex gap-2 rounded-control bg-info-soft p-3 text-sm text-ink sm:col-span-2" role="status">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <span>{chosen.size ? t('projectRewards.form.chosen', { count: chosen.size, emails: emailCount }) : t('projectRewards.form.noneChosen')}</span>
        </div>
      </form>
    </Dialog>
  );
}

// ---- Page --------------------------------------------------------------------------------------------------------

export default function ProjectRewardsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [view, setView] = useState<'all' | 'almost' | 'challenge' | 'none'>('all');
  const [team, setTeam] = useState<'all' | Team>('all');
  const [challengeFor, setChallengeFor] = useState<Project | null>(null);

  const list = useQuery({ queryKey: queryKeys.projectRewards.list, queryFn: () => api.get<ListResponse>('/projects') });
  const meta = useQuery({ queryKey: queryKeys.projectRewards.meta, queryFn: () => api.get<Meta>('/projects/meta') });
  const canManage = !!list.data?.can_manage;

  const importer = useMutation({
    mutationFn: () => api.post<ImportResult>('/projects/import'),
    onSuccess: (r) => {
      toast.success(t('projectRewards.imported', { matched: r.matched, created: r.created, updated: r.updated, removed: r.removed }), {
        description: r.removed_projects.length ? t('projectRewards.removedList', { names: r.removed_projects.join(', ') }) : undefined,
      });
      r.errors.forEach((e) => toast.warning(t('projectRewards.importPartial', { source: t(`projectRewards.sources.${e.source}`), message: e.message })));
      void qc.invalidateQueries({ queryKey: queryKeys.projectRewards.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const all = list.data?.items ?? [];
  const items = team === 'all' ? all : all.filter((p) => p.team === team);
  const term = q.trim().toLowerCase();
  const shown = items.filter((p) => {
    const searchable = [
      p.name, p.code, p.company, ...p.members.map((m) => m.full_name), ...p.people.responsible, ...p.people.accountable,
      ...p.tasks.map((x) => x.title),
      ...p.processes.flatMap((g) => [g.process_group, g.wing, ...g.subprocesses, ...g.raci.map((r) => r.name)]),
    ];
    if (term && !searchable.some((s) => s?.toLowerCase().includes(term))) return false;
    if (view === 'almost') return p.completion_percentage >= ALMOST;
    if (view === 'challenge') return p.challenge?.status === 'Active';
    if (view === 'none') return !p.challenge || p.challenge.status !== 'Active';
    return true;
  });
  const active = items.filter((p) => p.challenge?.status === 'Active');
  const pool = active.reduce((s, p) => s + (p.challenge?.reward_amount ?? 0), 0);
  const almost = items.filter((p) => p.completion_percentage >= ALMOST).length;

  return (
    <>
      <PageHeader
        title={t('projectRewards.title')}
        subtitle={t('projectRewards.subtitle', {
          department: meta.data?.filter.department ?? 'Digital Transformation',
        })}
        meta={
          meta.data ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
              {meta.data.last_import && <span>{t('projectRewards.lastImport', { when: relativeFromNow(meta.data.last_import) })}</span>}
              <Badge tone={meta.data.auto_sync.enabled ? 'success' : 'neutral'} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}>
                {meta.data.auto_sync.enabled
                  ? t('projectRewards.autoSyncOn', { time: meta.data.auto_sync.time, tz: meta.data.timezone })
                  : t('projectRewards.autoSyncOff')}
              </Badge>
              {meta.data.auto_sync.last && <span>{t('projectRewards.autoSyncLast', { result: meta.data.auto_sync.last })}</span>}
            </span>
          ) : undefined
        }
        actions={
          canManage && (
            <Button icon={<DownloadCloud className="h-4 w-4" aria-hidden />} loading={importer.isPending} onClick={() => importer.mutate()}>
              {t('projectRewards.import')}
            </Button>
          )
        }
      />

      <Tabs
        className="mb-4"
        ariaLabel={t('projectRewards.team.label')}
        value={team}
        onChange={(v) => setTeam(v as typeof team)}
        tabs={(['all', 'AES', 'AI'] as const).map((v) => ({
          value: v,
          label: t(`projectRewards.team.${v}`),
          count: list.data ? (v === 'all' ? all.length : all.filter((p) => p.team === v).length) : undefined,
        }))}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('projectRewards.stats.tracked')} value={list.data ? items.length : '—'} tone="primary" icon={<Database className="h-4 w-4" aria-hidden />} />
        <Stat label={t('projectRewards.stats.active')} value={list.data ? active.length : '—'} tone="spark" icon={<Gift className="h-4 w-4" aria-hidden />} />
        <Stat label={t('projectRewards.stats.pool')} value={list.data ? bdt(pool) : '—'} tone="success" icon={<Trophy className="h-4 w-4" aria-hidden />} />
        <Stat label={t('projectRewards.stats.almost')} value={list.data ? almost : '—'} tone="warning" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_240px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input aria-label={t('projectRewards.search')} placeholder={t('projectRewards.search')} className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select
          aria-label={t('projectRewards.show')}
          value={view}
          onChange={(e) => setView(e.target.value as typeof view)}
          options={(['all', 'almost', 'challenge', 'none'] as const).map((v) => ({ value: v, label: t(`projectRewards.views.${v}`) }))}
        />
      </div>

      {list.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-96 w-full" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Database className="h-8 w-8" aria-hidden />}
          title={all.length ? t('projectRewards.noMatch') : t('projectRewards.emptyTitle')}
          description={all.length ? undefined : t('projectRewards.emptyBody')}
          action={
            !all.length && canManage ? (
              <Button icon={<DownloadCloud className="h-4 w-4" aria-hidden />} loading={importer.isPending} onClick={() => importer.mutate()}>
                {t('projectRewards.import')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {shown.map((p) => (
            <li key={p.id}>
              <ProjectCard p={p} canManage={canManage} onChallenge={() => setChallengeFor(p)} />
            </li>
          ))}
        </ul>
      )}

      {challengeFor && <ChallengeDialog key={challengeFor.id} p={challengeFor} aesLeadSet={!!list.data?.aes_lead} onClose={() => setChallengeFor(null)} />}
    </>
  );
}
