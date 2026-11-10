import { CheckCircle2, ChevronDown, Download, Gauge } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate, relativeFromNow } from '@/utils/dates';

/** Weekly team score and the deadline bonus multiplier. Fully automatic: every sync (the daily run, Import or Sync)
 * scores the week on the server from the project's progress, task deadlines, blockers and update activity
 * (backend/app/modules/projects/scoring.py). This panel only shows the result and why. */

export interface ScoringRules {
  target_max: number;
  quality_max: number;
  deadline_max: number;
  communication_max: number;
  missed_deadline_penalty: number;
  rework_penalty: number;
  missing_update_penalty: number;
  tiers: { min: number; multiplier: number }[];
  week_start_day: string;
  this_week: string;
}

interface Signals {
  as_of?: string;
  gained?: number;
  open_tasks?: number;
  blocked?: number;
  update_days?: number;
  partial?: boolean;
  overdue?: boolean;
  communication?: { updates: number; updates_max: number; progress: number; progress_max: number; deadline: number; deadline_max: number };
  finished?: boolean;
  expected?: number | null;
  deadline?: { basis: 'tasks'; due: number; late: number } | { basis: 'timeline'; expected: number | null; actual: number };
}

export interface Scorecard {
  id: string;
  week_start: string;
  progress_start: number;
  progress_end: number;
  weeks_left: number | null;
  required_pct: number;
  quality: number;
  deadline: number;
  communication: number;
  missed_deadlines: number;
  rework: number;
  missing_updates: number;
  target_points: number;
  deductions: number;
  total: number;
  signals: Signals;
  is_final: boolean;
  updated_at: string;
}

export interface Scoring {
  week_start: string;
  progress_start: number;
  progress_end: number;
  weeks_left: number | null;
  required_pct: number | null;
  deadline: string | null;
  this_week: Scorecard | null;
  average: number | null;
  bonus: {
    challenge_id: string;
    status: 'Active' | 'Achieved' | 'Expired';
    base: number;
    average: number | null;
    weeks: number;
    multiplier: number | null;
    amount: number | null;
    final: boolean;
  } | null;
  scorecards: Scorecard[];
}

interface ProjectRef {
  id: string;
  code: string;
  name: string;
  scoring: Scoring | null;
}

const bdt = (n: number) => `৳${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

function scoreTone(total: number | null | undefined): 'success' | 'primary' | 'warning' | 'danger' | 'neutral' {
  if (total == null) return 'neutral';
  return total >= 90 ? 'success' : total >= 80 ? 'primary' : total >= 70 ? 'warning' : 'danger';
}

function multiplierFor(avg: number | null, rules: ScoringRules): number | null {
  if (avg == null) return null;
  return rules.tiers.find((x) => avg >= x.min)?.multiplier ?? 0;
}

/** The scorecards as a CSV that opens in Google Sheets / Excel (same columns as the sheet layout). */
function exportCsv(p: ProjectRef, rules: ScoringRules, headers: string[]) {
  const rows = (p.scoring?.scorecards ?? []).slice().reverse().map((s) => [
    s.week_start, s.progress_start, s.progress_end, r2(s.progress_end - s.progress_start), s.weeks_left ?? '', s.required_pct,
    s.target_points, s.quality, s.deadline, s.communication, s.missed_deadlines, s.rework, s.missing_updates,
    s.deductions, s.total, s.is_final ? 'final' : 'so far',
  ]);
  const avg = p.scoring?.bonus?.average ?? p.scoring?.average ?? null;
  const tail = [
    [],
    ['Average score', avg ?? ''],
    ['Multiplier', multiplierFor(avg, rules) ?? ''],
    ['Base bonus (BDT)', p.scoring?.bonus?.base ?? ''],
    ['Bonus (BDT)', p.scoring?.bonus?.amount ?? ''],
  ];
  const esc = (x: unknown) => {
    const s = String(x ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows, ...tail].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.code}-weekly-scores.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** One part of the week's score: points out of the maximum and the reason, in plain words. */
function SubPart({ label, v, max }: { label: string; v: number; max: number }) {
  return (
    <li className="flex justify-between gap-2">
      <span>{label}</span>
      <span className={cn('tabular', v < max ? 'text-danger' : 'text-success')}>
        {r2(v)} / {r2(max)}
      </span>
    </li>
  );
}

function Part({ label, value, max, why, children }: { label: string; value: number; max: number; why: string; children?: ReactNode }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink">{label}</span>
        <span className="tabular font-semibold text-ink">
          {r2(value)} <span className="text-xs font-normal text-ink-muted">/ {max}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-soft" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      {why && <p className="mt-0.5 text-xs text-ink-muted">{why}</p>}
      {children}
    </li>
  );
}

function Breakdown({ c, rules }: { c: Scorecard; rules: ScoringRules }) {
  const { t } = useTranslation();
  const sg = c.signals ?? {};
  const dl = sg.deadline;
  const minus: string[] = [];
  if (c.missed_deadlines) minus.push(t('projectRewards.score.auto.missed', { count: c.missed_deadlines, pts: c.missed_deadlines * rules.missed_deadline_penalty }));
  if (c.rework) minus.push(t('projectRewards.score.auto.rework', { count: c.rework, pts: c.rework * rules.rework_penalty }));
  if (c.missing_updates) minus.push(t('projectRewards.score.auto.missing', { pts: c.missing_updates * rules.missing_update_penalty }));
  if (sg.finished) return <p className="mt-2 text-sm text-success">{t('projectRewards.score.auto.finished')}</p>;
  return (
    <div className="mt-3 space-y-3">
      {sg.partial && <p className="rounded-control bg-info-soft p-2 text-xs text-ink">{t('projectRewards.score.auto.partialNote')}</p>}
      <ul className="space-y-2">
        <Part
          label={t('projectRewards.score.auto.target')}
          value={c.target_points}
          max={rules.target_max}
          why={
            sg.partial
              ? sg.expected != null
                ? t('projectRewards.score.auto.targetTimeline', { actual: r2(c.progress_end), expected: sg.expected })
                : t('projectRewards.score.auto.deadlineNone')
              : t('projectRewards.score.auto.targetWhy', { gained: r2(c.progress_end - c.progress_start), required: c.required_pct })
          }
        />
        <Part
          label={t('projectRewards.score.auto.quality')}
          value={c.quality}
          max={rules.quality_max}
          why={sg.open_tasks ? t('projectRewards.score.auto.qualityWhy', { blocked: sg.blocked ?? 0, open: sg.open_tasks }) : t('projectRewards.score.auto.qualityNone')}
        />
        <Part
          label={t('projectRewards.score.auto.deadline')}
          value={c.deadline}
          max={rules.deadline_max}
          why={
            sg.overdue
              ? t('projectRewards.score.auto.deadlineOverdue')
              : dl?.basis === 'tasks'
              ? t('projectRewards.score.auto.deadlineTasks', { late: dl.late, due: dl.due })
              : dl?.basis === 'timeline' && dl.expected != null
                ? t('projectRewards.score.auto.deadlineTimeline', { actual: r2(dl.actual), expected: dl.expected })
                : t('projectRewards.score.auto.deadlineNone')
          }
        />
        <Part
          label={t('projectRewards.score.auto.communication')}
          value={c.communication}
          max={rules.communication_max}
          why={sg.communication ? '' : t('projectRewards.score.auto.communicationWhy', { count: sg.update_days ?? 0 })}
        >
          {sg.communication && (
            <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
              {sg.communication.updates_max > 0 ? (
                <SubPart label={t('projectRewards.score.auto.commUpdates', { count: sg.update_days ?? 0 })} v={sg.communication.updates} max={sg.communication.updates_max} />
              ) : (
                <li>{t('projectRewards.score.auto.commUpdatesPartial')}</li>
              )}
              <SubPart label={t('projectRewards.score.auto.commProgress')} v={sg.communication.progress} max={sg.communication.progress_max} />
              <SubPart label={t(sg.overdue ? 'projectRewards.score.auto.commDeadlineOverdue' : 'projectRewards.score.auto.commDeadline')} v={sg.communication.deadline} max={sg.communication.deadline_max} />
            </ul>
          )}
        </Part>
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-control bg-neutral-soft p-2 text-sm">
        <span className={minus.length ? 'text-danger' : 'text-ink-muted'}>
          {minus.length ? `${t('projectRewards.score.auto.deductions')}: ${minus.join(' · ')}` : t('projectRewards.score.auto.noDeductions')}
        </span>
        <span className="tabular font-bold text-ink">{t('projectRewards.score.total', { total: c.total })}</span>
      </div>
    </div>
  );
}

export function WeeklyScorePanel({ p, rules }: { p: ProjectRef; rules: ScoringRules | undefined }) {
  const { t } = useTranslation();
  const s = p.scoring;
  if (!s || !rules) return null;
  const week = s.this_week;
  const bonus = s.bonus;
  const mult = bonus?.multiplier ?? null;
  const csvHeaders = t('projectRewards.score.csvHeaders', { returnObjects: true }) as string[];
  const past = s.scorecards.filter((c) => c.week_start !== s.week_start);

  return (
    <section aria-label={t('projectRewards.score.title')} className="rounded-control border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
            <Gauge className="h-3.5 w-3.5" aria-hidden /> {t('projectRewards.score.title')}
            <Badge tone="info">{t('projectRewards.score.auto.badge')}</Badge>
          </div>
          <div className="mt-1 text-sm text-ink">
            {s.required_pct == null
              ? t('projectRewards.score.noDeadline')
              : s.required_pct <= 0
                ? t('projectRewards.score.nothingLeft')
                : t('projectRewards.score.required', { pct: s.required_pct, weeks: s.weeks_left ?? 0, count: s.weeks_left ?? 0 })}
          </div>
          <div className="text-xs text-ink-muted">
            {t('projectRewards.score.weekOf', { date: formatDate(s.week_start), day: t(`projectRewards.score.days.${rules.week_start_day}`, rules.week_start_day) })}
            {week && ` · ${t('projectRewards.score.auto.updated', { when: relativeFromNow(week.updated_at) })}`}
          </div>
        </div>
        <Badge tone={scoreTone(week?.total)}>
          {week ? t('projectRewards.score.thisWeek', { total: week.total }) : t('projectRewards.score.auto.pending')}
        </Badge>
      </div>

      {week && <Breakdown c={week} rules={rules} />}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-control bg-neutral-soft p-2">
          <dt className="text-xs text-ink-muted">{t('projectRewards.score.average')}</dt>
          <dd className="tabular text-lg font-bold text-ink">{(bonus?.average ?? s.average) ?? '—'}</dd>
        </div>
        <div className="rounded-control bg-neutral-soft p-2">
          <dt className="text-xs text-ink-muted">{t('projectRewards.score.multiplier')}</dt>
          <dd className="tabular text-lg font-bold text-ink">{mult == null ? '—' : `${mult}×`}</dd>
        </div>
        <div className="rounded-control bg-neutral-soft p-2">
          <dt className="text-xs text-ink-muted">
            {bonus?.status === 'Active' ? t('projectRewards.score.projected') : t('projectRewards.score.payout')}
          </dt>
          <dd className="tabular text-lg font-bold text-ink">{bonus?.amount == null ? '—' : bdt(bonus.amount)}</dd>
        </div>
      </dl>
      {bonus && (
        <p className="mt-1 text-xs text-ink-muted">
          {bonus.status === 'Expired'
            ? t('projectRewards.score.expiredNote')
            : t('projectRewards.score.bonusNote', { base: bdt(bonus.base), weeks: bonus.weeks, count: bonus.weeks, id: bonus.challenge_id })}
        </p>
      )}

      {s.scorecards.length > 0 && (
        <details className="group mt-3 border-t border-line pt-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-control text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('projectRewards.score.history', { count: s.scorecards.length })}
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-1 pr-2 font-medium">{t('projectRewards.score.col.week')}</th>
                  <th className="py-1 pr-2 font-medium">{t('projectRewards.score.col.progress')}</th>
                  <th className="py-1 pr-2 font-medium">{t('projectRewards.score.col.target')}</th>
                  <th className="py-1 pr-2 font-medium">{t('projectRewards.score.col.qdc')}</th>
                  <th className="py-1 pr-2 font-medium">{t('projectRewards.score.col.minus')}</th>
                  <th className="py-1 font-medium">{t('projectRewards.score.col.total')}</th>
                </tr>
              </thead>
              <tbody className="tabular text-ink">
                {s.scorecards.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="py-1 pr-2">
                      {formatDate(c.week_start)}
                      {c.is_final ? (
                        <CheckCircle2 className="ml-1 inline h-3 w-3 text-success" aria-label={t('projectRewards.score.auto.final')} />
                      ) : (
                        <span className="ml-1 text-ink-muted">({t('projectRewards.score.auto.soFar')})</span>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      {r2(c.progress_end - c.progress_start)} / {c.required_pct}%
                    </td>
                    <td className="py-1 pr-2">{c.target_points}</td>
                    <td className="py-1 pr-2">{c.quality} · {c.deadline} · {c.communication}</td>
                    <td className="py-1 pr-2 text-danger">{c.deductions ? `−${c.deductions}` : '0'}</td>
                    <td className="py-1"><Badge tone={scoreTone(c.total)}>{c.total}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {past.length === 0 && <p className="mt-1 text-xs text-ink-muted">{t('projectRewards.score.auto.firstWeek')}</p>}
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" aria-hidden />} onClick={() => exportCsv(p, rules, csvHeaders)}>
              {t('projectRewards.score.export')}
            </Button>
          </div>
        </details>
      )}
    </section>
  );
}
