import { AlertTriangle, CheckCircle2, Circle, Lock, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Callout } from '@/components/domain';
import { Button, Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDateTime, fromLocalInputValue, serverNow, toLocalInputValue } from '@/utils/dates';
import { money } from '@/utils/format';
import { tr } from '@/utils/i18n';
import {
  BANNER_COLORS,
  PHASE_TYPES,
  REQUIRED_PHASES,
  timelineIssues,
  type BuilderLookups,
  type ChallengeConfig,
  type ChecklistItem,
  type PhaseRow,
  type PrizeRow,
  type UserBrief,
} from './types';

export interface StepProps {
  cfg: ChallengeConfig;
  set: (patch: Partial<ChallengeConfig>) => void;
  lookups: BuilderLookups;
  /** True once the challenge is published: structural fields can no longer change. */
  locked: boolean;
}

const intOr = (v: string, fallback: number) => (v === '' || Number.isNaN(Number(v)) ? fallback : Math.round(Number(v)));
const numOrNull = (v: string) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function LockedNote() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-1.5 text-sm text-ink-muted">
      <Lock className="h-3.5 w-3.5" aria-hidden />
      {t('manage.builder.lockedNote')}
    </p>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/** Searchable list of people with checkboxes (multi) or a select-like single choice. */
function UserPicker({
  users,
  value,
  onChange,
  multi,
  label,
}: {
  users: UserBrief[];
  value: string[];
  onChange: (ids: string[]) => void;
  multi?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => !needle || `${u.full_name} ${u.job_title ?? ''} ${u.org_unit ?? ''}`.toLowerCase().includes(needle));
  }, [users, q]);
  const toggle = (id: string) => {
    if (!multi) return onChange(value[0] === id ? [] : [id]);
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('manage.builder.searchPeople')} aria-label={t('manage.builder.searchPeople')} />
      <div className="max-h-56 overflow-y-auto rounded-control border border-line">
        {shown.length === 0 && <p className="p-3 text-sm text-ink-muted">{t('common.noResults')}</p>}
        {shown.map((u) => {
          const on = value.includes(u.id);
          return (
            <label key={u.id} className={cn('flex min-h-[44px] cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0', on && 'bg-primary-soft')}>
              <input
                type={multi ? 'checkbox' : 'radio'}
                checked={on}
                onChange={() => toggle(u.id)}
                onClick={() => !multi && on && toggle(u.id)}
                className="h-4 w-4 accent-[rgb(var(--primary))]"
              />
              <span className="text-sm">
                <span className="font-medium text-ink">{u.full_name}</span>
                <span className="block text-ink-muted">{[u.job_title, u.org_unit].filter(Boolean).join(' · ')}</span>
              </span>
            </label>
          );
        })}
      </div>
      {multi && <p className="text-sm text-ink-muted">{t('manage.builder.selectedCount', { count: value.length })}</p>}
    </fieldset>
  );
}

// 1 ───────────────────────────────────────────────────────────────────────────
export function BasicsStep({ cfg, set, lookups }: StepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <Grid>
        <Field label={t('manage.builder.titleEn')} required>
          <Input value={cfg.title} onChange={(e) => set({ title: e.target.value })} maxLength={150} />
        </Field>
        <Field label={t('manage.builder.titleBn')} help={t('manage.builder.titleBnHelp')}>
          <Input value={cfg.title_bn ?? ''} onChange={(e) => set({ title_bn: e.target.value || null })} maxLength={150} lang="bn" />
        </Field>
        <Field label={t('manage.builder.domain')} help={t('manage.builder.domainHelp')}>
          <Select
            value={cfg.domain_id ?? ''}
            onChange={(e) => set({ domain_id: e.target.value || null })}
            placeholder={t('manage.builder.choose')}
            options={lookups.domains.map((d) => ({ value: d.id, label: tr(d.name_i18n, d.name) }))}
          />
        </Field>
        <Field label={t('manage.builder.category')}>
          <Select
            value={cfg.category_id ?? ''}
            onChange={(e) => set({ category_id: e.target.value || null })}
            placeholder={t('manage.builder.choose')}
            options={lookups.categories.map((d) => ({ value: d.id, label: tr(d.name_i18n, d.name) }))}
          />
        </Field>
      </Grid>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">{t('manage.builder.bannerColor')}</legend>
        <div className="flex flex-wrap gap-2">
          {BANNER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set({ banner_color: c })}
              aria-label={c}
              aria-pressed={cfg.banner_color === c}
              className={cn('h-11 w-11 rounded-control border-2', cfg.banner_color === c ? 'border-ink' : 'border-transparent')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </fieldset>
      <UserPicker
        users={lookups.users}
        value={cfg.sponsor_user_id ? [cfg.sponsor_user_id] : []}
        onChange={(ids) => set({ sponsor_user_id: ids[0] ?? null })}
        label={t('manage.builder.sponsor')}
      />
    </div>
  );
}

// 2 ───────────────────────────────────────────────────────────────────────────
export function ProblemStep({ cfg, set }: StepProps) {
  const { t } = useTranslation();
  const area = (key: 'problem_statement' | 'background' | 'expected_outcome' | 'rules', required = false, rows = 4) => (
    <Field label={t(`manage.builder.${key}`)} help={t(`manage.builder.${key}Help`)} required={required} hint={`${cfg[key].length}/3000`}>
      <Textarea value={cfg[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<ChallengeConfig>)} rows={rows} maxLength={3000} />
    </Field>
  );
  return (
    <div className="space-y-5">
      {area('problem_statement', true, 5)}
      {area('background')}
      {area('expected_outcome')}
      {area('rules', false, 5)}
    </div>
  );
}

// 3 ───────────────────────────────────────────────────────────────────────────
export function EligibilityStep({ cfg, set, lookups, locked }: StepProps) {
  const { t } = useTranslation();
  const toggleUnit = (id: string) =>
    set({
      eligibility_org_unit_ids: cfg.eligibility_org_unit_ids.includes(id)
        ? cfg.eligibility_org_unit_ids.filter((x) => x !== id)
        : [...cfg.eligibility_org_unit_ids, id],
    });
  // Only SBUs are offered. A smaller unit ticked on an older challenge stays listed so it can be unticked.
  const units = lookups.orgUnits.filter((u) => (u.is_sbu && u.is_active !== false) || cfg.eligibility_org_unit_ids.includes(u.id));
  const sizeError = cfg.team_max_size < cfg.team_min_size ? t('manage.builder.teamSizeError') : null;
  return (
    <div className="space-y-5">
      {locked && <LockedNote />}
      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-sm font-medium text-ink">{t('manage.builder.eligibility')}</legend>
        <p className="text-sm text-ink-muted">{t('manage.builder.eligibilityHelp')}</p>
        <div className="max-h-64 overflow-y-auto rounded-control border border-line p-2">
          {units.map((u) => (
            <div key={u.id} className="py-1">
              <Checkbox
                label={u.name}
                description={u.is_sbu ? undefined : t(`manage.unitType.${u.unit_type}`, u.unit_type)}
                checked={cfg.eligibility_org_unit_ids.includes(u.id)}
                onChange={() => toggleUnit(u.id)}
                disabled={locked}
              />
            </div>
          ))}
        </div>
        <p className="text-sm text-ink-muted">
          {cfg.eligibility_org_unit_ids.length ? t('manage.builder.eligibilitySome', { count: cfg.eligibility_org_unit_ids.length }) : t('manage.builder.eligibilityAll')}
        </p>
      </fieldset>
      <Grid>
        <Field label={t('manage.builder.participationMode')}>
          <Select
            value={cfg.participation_mode}
            disabled={locked}
            onChange={(e) => set({ participation_mode: e.target.value })}
            options={['BOTH', 'INDIVIDUAL', 'TEAM'].map((m) => ({ value: m, label: t(`manage.mode.${m}`) }))}
          />
        </Field>
        <div />
        <Field label={t('manage.builder.teamMin')}>
          <Input type="number" min={1} max={20} disabled={locked || cfg.participation_mode === 'INDIVIDUAL'} value={cfg.team_min_size} onChange={(e) => set({ team_min_size: intOr(e.target.value, 1) })} />
        </Field>
        <Field label={t('manage.builder.teamMax')} error={sizeError}>
          <Input type="number" min={1} max={20} disabled={locked || cfg.participation_mode === 'INDIVIDUAL'} value={cfg.team_max_size} onChange={(e) => set({ team_max_size: intOr(e.target.value, 5) })} />
        </Field>
      </Grid>
      <Switch
        checked={cfg.allow_cross_org_teams}
        onChange={(v) => set({ allow_cross_org_teams: v })}
        label={t('manage.builder.crossOrg')}
        description={t('manage.builder.crossOrgHelp')}
      />
    </div>
  );
}

// 4 ───────────────────────────────────────────────────────────────────────────
export function TimelineBar({ phases }: { phases: PhaseRow[] }) {
  const { t } = useTranslation();
  const dated = phases.filter((p) => p.opens_at && p.closes_at && new Date(p.closes_at) > new Date(p.opens_at));
  if (!dated.length) return null;
  const min = Math.min(...dated.map((p) => new Date(p.opens_at).getTime()));
  const max = Math.max(...dated.map((p) => new Date(p.closes_at).getTime()));
  const span = Math.max(max - min, 1);
  const now = serverNow().getTime();
  const nowPct = ((now - min) / span) * 100;
  return (
    <div className="rounded-panel border border-line bg-surface p-4" role="img" aria-label={t('manage.builder.timelinePreview')}>
      <div className="mb-2 flex justify-between text-xs text-ink-muted">
        <span>{formatDateTime(new Date(min))}</span>
        <span>{formatDateTime(new Date(max))}</span>
      </div>
      <div className="relative space-y-1.5">
        {nowPct >= 0 && nowPct <= 100 && (
          <div className="absolute inset-y-0 z-10 w-px bg-danger" style={{ left: `${nowPct}%` }}>
            <span className="absolute -top-4 -translate-x-1/2 text-[11px] font-medium text-danger">{t('manage.now')}</span>
          </div>
        )}
        {dated.map((p) => {
          const left = ((new Date(p.opens_at).getTime() - min) / span) * 100;
          const width = Math.max(((new Date(p.closes_at).getTime() - new Date(p.opens_at).getTime()) / span) * 100, 1.5);
          return (
            <div key={p.phase_type} className="relative h-6 rounded bg-neutral-soft">
              <div className="absolute inset-y-0 rounded bg-primary/80" style={{ left: `${left}%`, width: `${width}%` }} />
              <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium text-ink">{t(`manage.phase.${p.phase_type}`)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimelineStep({ cfg, set }: StepProps) {
  const { t } = useTranslation();
  const issues = timelineIssues(cfg.phases);
  const unused = PHASE_TYPES.filter((p) => !cfg.phases.some((x) => x.phase_type === p));
  const [adding, setAdding] = useState('');
  const update = (i: number, patch: Partial<PhaseRow>) => set({ phases: cfg.phases.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const add = (type: string) => {
    if (!type) return;
    const next = [...cfg.phases, { phase_type: type, opens_at: '', closes_at: '' }];
    next.sort((a, b) => PHASE_TYPES.indexOf(a.phase_type) - PHASE_TYPES.indexOf(b.phase_type));
    set({ phases: next });
    setAdding('');
  };
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">{t('manage.builder.timelineHelp')}</p>
      <ul className="space-y-3">
        {cfg.phases.map((p, i) => {
          const bad = p.opens_at && p.closes_at && new Date(p.closes_at) <= new Date(p.opens_at);
          const required = REQUIRED_PHASES.includes(p.phase_type);
          return (
            <li key={p.phase_type} className="rounded-panel border border-line p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {t(`manage.phase.${p.phase_type}`)}
                  {required && <span className="ml-2 text-xs font-normal text-ink-muted">{t('common.required')}</span>}
                </span>
                {!required && (
                  <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => set({ phases: cfg.phases.filter((_, idx) => idx !== i) })}>
                    {t('common.remove')}
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('manage.builder.opensAt')}>
                  <Input type="datetime-local" value={toLocalInputValue(p.opens_at)} onChange={(e) => update(i, { opens_at: fromLocalInputValue(e.target.value) ?? '' })} />
                </Field>
                <Field label={t('manage.builder.closesAt')} error={bad ? t('manage.builder.issue.window', { phase: t(`manage.phase.${p.phase_type}`) }) : null}>
                  <Input type="datetime-local" value={toLocalInputValue(p.closes_at)} onChange={(e) => update(i, { closes_at: fromLocalInputValue(e.target.value) ?? '' })} />
                </Field>
              </div>
            </li>
          );
        })}
      </ul>
      {unused.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('manage.builder.addPhase')} className="min-w-[220px] flex-1 sm:flex-none">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t('manage.builder.choose')} options={unused.map((p) => ({ value: p, label: t(`manage.phase.${p}`) }))} />
          </Field>
          <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => add(adding)} disabled={!adding}>
            {t('common.add')}
          </Button>
        </div>
      )}
      <TimelineBar phases={cfg.phases} />
      {issues.length > 0 && (
        <Callout tone={issues.some((i) => i.tone === 'danger') ? 'danger' : 'warning'} title={t('manage.builder.timelineIssues')}>
          <ul className="list-disc space-y-1 pl-5">
            {issues.map((i, idx) => (
              <li key={idx}>
                {t(`manage.builder.issue.${i.code}`, { phase: t(`manage.phase.${i.phase}`), other: i.other ? t(`manage.phase.${i.other}`) : '' })}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}

// 5 ───────────────────────────────────────────────────────────────────────────
export function FormsStep({ cfg, set, lookups }: StepProps) {
  const { t } = useTranslation();
  const has = (type: string) => cfg.phases.some((p) => p.phase_type === type);
  const pick = (key: 'methodology_form_id' | 'prototype_form_id' | 'final_form_id', purpose: string, note?: string | null) => (
    <Field label={t(`manage.builder.${key}`)} help={note ?? undefined}>
      <Select
        value={cfg[key] ?? ''}
        onChange={(e) => set({ [key]: e.target.value || null } as Partial<ChallengeConfig>)}
        placeholder={t('manage.builder.choose')}
        options={lookups.forms.filter((f) => f.purpose === purpose && f.status === 'PUBLISHED').map((f) => ({ value: f.id, label: `${f.name} (v${f.version})` }))}
      />
    </Field>
  );
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">{t('manage.builder.formsHelp')}</p>
      {pick('methodology_form_id', 'METHODOLOGY')}
      {pick('prototype_form_id', 'PROTOTYPE', has('PROTOTYPE') ? null : t('manage.builder.noPhaseNote', { phase: t('manage.phase.PROTOTYPE') }))}
      {pick('final_form_id', 'FINAL', has('FINAL_SUBMISSION') ? null : t('manage.builder.noPhaseNote', { phase: t('manage.phase.FINAL_SUBMISSION') }))}
      <Link to="/admin/forms" className="text-sm font-medium text-primary underline">
        {t('manage.builder.openFormBuilder')}
      </Link>
    </div>
  );
}

// 6 ───────────────────────────────────────────────────────────────────────────
export function JudgingStep({ cfg, set, lookups }: StepProps) {
  const { t } = useTranslation();
  const card = (key: 'methodology_scorecard_id' | 'final_scorecard_id') => {
    const chosen = lookups.scorecards.find((s) => s.id === cfg[key]);
    return (
      <Field
        label={t(`manage.builder.${key}`)}
        help={chosen ? chosen.criteria.map((c) => `${c.name} ${c.weight_pct}%`).join(' · ') : undefined}
        error={chosen && Math.round(chosen.total_weight) !== 100 ? t('manage.builder.weightsNot100', { total: chosen.total_weight }) : null}
      >
        <Select
          value={cfg[key] ?? ''}
          onChange={(e) => set({ [key]: e.target.value || null } as Partial<ChallengeConfig>)}
          placeholder={t('manage.builder.choose')}
          options={lookups.scorecards.map((s) => ({ value: s.id, label: s.name }))}
        />
      </Field>
    );
  };
  return (
    <div className="space-y-5">
      {card('methodology_scorecard_id')}
      {card('final_scorecard_id')}
      <Callout tone="info" title={t('manage.builder.judges')}>
        {t('judging.builderNote')}
      </Callout>
      <Grid>
        <Field label={t('manage.builder.reviewersPerEntry')}>
          <Input type="number" min={1} max={10} value={cfg.reviewers_per_entry} onChange={(e) => set({ reviewers_per_entry: intOr(e.target.value, 3) })} />
        </Field>
        <Field label={t('manage.builder.aggregation')} help={t(`manage.aggregationHelp.${cfg.aggregation_method}`)}>
          <Select
            value={cfg.aggregation_method}
            onChange={(e) => set({ aggregation_method: e.target.value })}
            options={['MEAN', 'MEDIAN', 'TRIMMED_MEAN', 'WEIGHTED_BY_REVIEWER'].map((m) => ({ value: m, label: t(`manage.aggregation.${m}`) }))}
          />
        </Field>
        <Field label={t('manage.builder.showScores')}>
          <Select
            value={cfg.show_scores_to_entrants}
            onChange={(e) => set({ show_scores_to_entrants: e.target.value })}
            options={['TOTAL_ONLY', 'PER_CRITERION', 'NONE'].map((m) => ({ value: m, label: t(`manage.showScores.${m}`) }))}
          />
        </Field>
      </Grid>
      <Switch checked={cfg.blind_review} onChange={(v) => set({ blind_review: v })} label={t('manage.builder.blind')} description={t('manage.builder.blindHelp')} />
    </div>
  );
}

// 7 ───────────────────────────────────────────────────────────────────────────
export function ShortlistStep({ cfg, set, locked }: StepProps) {
  const { t } = useTranslation();
  const m = cfg.shortlist_method;
  return (
    <div className="space-y-5">
      <Grid>
        <Field label={t('manage.builder.shortlistMethod')} help={t(`manage.shortlistHelp.${m}`)}>
          <Select
            value={m}
            onChange={(e) => set({ shortlist_method: e.target.value })}
            options={['TOP_N', 'THRESHOLD', 'TOP_N_WITH_THRESHOLD', 'TOP_PERCENT', 'MANUAL'].map((x) => ({ value: x, label: t(`manage.shortlistMethod.${x}`) }))}
          />
        </Field>
        <div />
        {(m === 'TOP_N' || m === 'TOP_N_WITH_THRESHOLD') && (
          <Field label={t('manage.builder.topN')} required>
            <Input type="number" min={1} value={cfg.top_n ?? ''} onChange={(e) => set({ top_n: numOrNull(e.target.value) })} />
          </Field>
        )}
        {(m === 'THRESHOLD' || m === 'TOP_N_WITH_THRESHOLD') && (
          <Field label={t('manage.builder.minScore')} required>
            <Input type="number" min={0} max={100} value={cfg.min_score ?? ''} onChange={(e) => set({ min_score: numOrNull(e.target.value) })} />
          </Field>
        )}
        {m === 'TOP_PERCENT' && (
          <Field label={t('manage.builder.topPercent')} required>
            <Input type="number" min={1} max={100} value={cfg.top_percent ?? ''} onChange={(e) => set({ top_percent: numOrNull(e.target.value) })} />
          </Field>
        )}
        <Field label={t('manage.builder.waitlist')} help={t('manage.builder.waitlistHelp')}>
          <Input type="number" min={0} value={cfg.waitlist_size} onChange={(e) => set({ waitlist_size: intOr(e.target.value, 0) })} />
        </Field>
      </Grid>
      <p className="text-sm text-ink-muted">{t('manage.builder.tieBreak')}</p>
      <Field label={t('manage.builder.prototypePolicy')} help={t(`manage.prototypeHelp.${cfg.prototype_policy}`)}>
        <Select
          value={cfg.prototype_policy}
          disabled={locked}
          onChange={(e) => set({ prototype_policy: e.target.value })}
          options={['NONE', 'OPTIONAL', 'REQUIRED_ALL', 'PANEL_DECIDES'].map((x) => ({ value: x, label: t(`manage.prototypePolicy.${x}`) }))}
        />
      </Field>
      {locked && <LockedNote />}
      <Callout tone="info">{t('manage.builder.humanConfirms')}</Callout>
    </div>
  );
}

// 8 ───────────────────────────────────────────────────────────────────────────
export function prizeTotal(prizes: PrizeRow[]): number {
  return prizes.reduce((sum, p) => sum + (p.amount ?? 0) * Math.max(p.rank_to - p.rank_from + 1, 1), 0);
}

export function PrizesStep({ cfg, set }: StepProps) {
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<PrizeRow>) => set({ prizes: cfg.prizes.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const add = () => {
    const next = cfg.prizes.length ? Math.max(...cfg.prizes.map((p) => p.rank_to)) + 1 : 1;
    set({ prizes: [...cfg.prizes, { rank_from: next, rank_to: next, prize_type: 'CASH', description: '', amount: null }] });
  };
  return (
    <div className="space-y-5">
      <ul className="space-y-3">
        {cfg.prizes.map((p, i) => (
          <li key={i} className="rounded-panel border border-line p-3">
            <div className="grid gap-3 sm:grid-cols-6">
              <Field label={t('manage.builder.rankFrom')}>
                <Input type="number" min={1} value={p.rank_from} onChange={(e) => update(i, { rank_from: intOr(e.target.value, 1), rank_to: Math.max(p.rank_to, intOr(e.target.value, 1)) })} />
              </Field>
              <Field label={t('manage.builder.rankTo')}>
                <Input type="number" min={p.rank_from} value={p.rank_to} onChange={(e) => update(i, { rank_to: Math.max(intOr(e.target.value, p.rank_from), p.rank_from) })} />
              </Field>
              <Field label={t('manage.builder.prizeType')} className="sm:col-span-2">
                <Select value={p.prize_type} onChange={(e) => update(i, { prize_type: e.target.value })} options={['CASH', 'TROPHY', 'CERTIFICATE', 'TRAINING', 'INCENTIVE', 'OTHER'].map((x) => ({ value: x, label: t(`manage.prizeType.${x}`) }))} />
              </Field>
              <Field label={t('manage.builder.amount')} className="sm:col-span-2">
                <Input type="number" min={0} value={p.amount ?? ''} onChange={(e) => update(i, { amount: numOrNull(e.target.value) })} />
              </Field>
              <Field label={t('manage.builder.prizeDescription')} className="sm:col-span-5">
                <Input value={p.description} onChange={(e) => update(i, { description: e.target.value })} maxLength={200} />
              </Field>
              <div className="flex items-end">
                <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => set({ prizes: cfg.prizes.filter((_, idx) => idx !== i) })}>
                  {t('common.remove')}
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {cfg.prizes.length === 0 && <p className="text-sm text-ink-muted">{t('manage.builder.noPrizes')}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={add}>
          {t('manage.builder.addPrize')}
        </Button>
        <span className="tabular text-sm text-ink-muted">{t('manage.builder.prizeTotal', { total: money(prizeTotal(cfg.prizes)) })}</span>
      </div>
      <div className="space-y-4 border-t border-line pt-4">
        <Switch checked={cfg.publish_winner_summaries} onChange={(v) => set({ publish_winner_summaries: v })} label={t('manage.builder.publishWinners')} description={t('manage.builder.publishWinnersHelp')} />
        <Switch checked={cfg.show_registration_count} onChange={(v) => set({ show_registration_count: v })} label={t('manage.builder.showCount')} description={t('manage.builder.showCountHelp')} />
        <Switch checked={cfg.peoples_choice_enabled} onChange={(v) => set({ peoples_choice_enabled: v })} label={t('manage.builder.peoplesChoice')} description={t('manage.builder.peoplesChoiceHelp')} />
        <Switch checked={cfg.leaderboard_enabled} onChange={(v) => set({ leaderboard_enabled: v })} label={t('manage.builder.leaderboard')} description={t('manage.builder.leaderboardHelp')} />
        {(cfg.peoples_choice_enabled || cfg.leaderboard_enabled) && (
          <Callout tone="warning" title={t('manage.builder.privacyTitle')}>
            {t('manage.builder.privacyNote')}
          </Callout>
        )}
      </div>
    </div>
  );
}

// 9 ───────────────────────────────────────────────────────────────────────────
export function ReviewStep({
  cfg,
  lookups,
  checklist,
  dirty,
  missing,
}: StepProps & { checklist: ChecklistItem[] | null; dirty: boolean; missing: string[] }) {
  const { t } = useTranslation();
  const issues = timelineIssues(cfg.phases).filter((i) => i.tone === 'danger');
  const name = (id: string | null, list: { id: string; name?: string; name_i18n?: unknown }[]) => {
    const item = list.find((x) => x.id === id);
    return item ? tr(item.name_i18n as never, item.name ?? '') : '—';
  };
  const rows: [string, ReactNode][] = [
    [t('manage.builder.titleEn'), cfg.title || '—'],
    [t('manage.builder.domain'), name(cfg.domain_id, lookups.domains)],
    [t('manage.builder.sponsor'), lookups.users.find((u) => u.id === cfg.sponsor_user_id)?.full_name ?? '—'],
    [t('manage.builder.participationMode'), `${t(`manage.mode.${cfg.participation_mode}`)} · ${cfg.team_min_size}–${cfg.team_max_size}`],
    [t('manage.builder.step.timeline'), t('manage.builder.phaseCount', { count: cfg.phases.filter((p) => p.opens_at && p.closes_at).length })],
    [t('manage.builder.shortlistMethod'), t(`manage.shortlistMethod.${cfg.shortlist_method}`)],
    [t('manage.builder.prototypePolicy'), t(`manage.prototypePolicy.${cfg.prototype_policy}`)],
    [t('manage.builder.step.prizes'), money(prizeTotal(cfg.prizes))],
  ];
  return (
    <div className="space-y-5">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line py-1.5 text-sm">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="text-right font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="publish-checklist" className="space-y-2">
        <h3 id="publish-checklist" className="font-semibold text-ink">
          {t('manage.builder.checklist')}
        </h3>
        {!checklist ? (
          <p className="text-sm text-ink-muted">{t('manage.builder.checklistUnsaved')}</p>
        ) : (
          <ul className="space-y-1.5">
            {checklist.map((c) => (
              <li key={c.code} className="flex items-center gap-2 text-sm">
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : <Circle className="h-4 w-4 text-ink-muted" aria-hidden />}
                <span className={c.ok ? 'text-ink' : 'text-ink-muted'}>{t(`manage.checklist.${c.code}`, c.label)}</span>
                <span className="sr-only">{c.ok ? t('manage.builder.done') : t('manage.builder.notDone')}</span>
              </li>
            ))}
          </ul>
        )}
        {checklist && dirty && <p className="text-sm text-ink-muted">{t('manage.builder.checklistStale')}</p>}
      </section>
      {issues.length > 0 && (
        <Callout tone="danger" title={t('manage.builder.timelineIssues')}>
          <ul className="list-disc pl-5">
            {issues.map((i, idx) => (
              <li key={idx}>{t(`manage.builder.issue.${i.code}`, { phase: t(`manage.phase.${i.phase}`), other: '' })}</li>
            ))}
          </ul>
        </Callout>
      )}
      {missing.length > 0 && (
        <Callout tone="danger" title={t('manage.builder.publishBlocked')}>
          <ul className="list-disc pl-5">
            {missing.map((m) => (
              <li key={m} className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {m}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}
