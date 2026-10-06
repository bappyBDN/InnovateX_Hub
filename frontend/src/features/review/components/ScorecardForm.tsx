import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Textarea } from '@/components/ui';
import { cn } from '@/utils/cn';
import { liveTotal, type Criterion, type ReviewDraft, type Scorecard } from '../types';

const RECOMMENDATIONS = ['STRONG_YES', 'YES', 'MAYBE', 'NO'] as const;

export interface ScorecardFormProps {
  scorecard: Scorecard;
  value: ReviewDraft;
  onChange: (next: ReviewDraft) => void;
  readOnly?: boolean;
  /** Keyed by criterion id, or `strengths` / `improvements` / `recommendation`. */
  errors?: Record<string, string>;
  /** Score calculated by the server at the last save; shown instead of the live value when in step. */
  serverTotal?: number | null;
}

/** Criteria with weights, rating buttons with level descriptions, comments and a live weighted total (spec §9.2). */
export function ScorecardForm({ scorecard, value, onChange, readOnly, errors = {}, serverTotal }: ScorecardFormProps) {
  const { t } = useTranslation();
  const { min, max, levels } = scorecard.scale;
  const ratings = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const [hover, setHover] = useState<{ id: string; value: number } | null>(null);
  const level = (v: number) => levels.find((l) => l.value === v);
  const total = serverTotal ?? liveTotal(scorecard, value.scores);

  const setScore = (id: string, patch: { rating?: number | null; comment?: string | null }) =>
    onChange({ ...value, scores: value.scores.map((s) => (s.criterion_id === id ? { ...s, ...patch } : s)) });

  const onKey = (c: Criterion) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || e.target instanceof HTMLTextAreaElement) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= min && n <= max) {
      e.preventDefault();
      setScore(c.id, { rating: n });
    }
  };

  return (
    <div className="space-y-5">
      {!readOnly && <p className="text-xs text-ink-muted">{t('review.keyboardHint', { max })}</p>}

      {scorecard.criteria.map((c) => {
        const row = value.scores.find((s) => s.criterion_id === c.id);
        const rating = row?.rating ?? null;
        const shown = hover?.id === c.id ? level(hover.value) : rating != null ? level(rating) : undefined;
        const needsComment = rating != null && c.comment_required_at.includes(rating);
        const below = rating != null && c.min_rating != null && rating < c.min_rating;
        const err = errors[c.id];
        return (
          <div
            key={c.id}
            role="group"
            tabIndex={readOnly ? undefined : 0}
            aria-label={c.name}
            onKeyDown={onKey(c)}
            className={cn(
              'rounded-panel border border-line p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              err && 'border-danger',
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="font-semibold text-ink">{c.name}</h3>
              <span className="tabular text-sm text-ink-muted">
                {t('review.weight', { pct: c.weight_pct })}
                {c.min_rating != null && ` · ${t('review.minimum', { min: c.min_rating })}`}
              </span>
            </div>
            {c.guidance && <p className="mt-1 text-sm text-ink-muted">{c.guidance}</p>}

            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={c.name}>
              {ratings.map((v) => {
                const active = rating === v;
                const lv = level(v);
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={t('review.rate', { name: c.name, value: lv ? `${v} – ${lv.label}` : v })}
                    title={lv ? `${lv.label}${lv.description ? ` — ${lv.description}` : ''}` : undefined}
                    disabled={readOnly}
                    onClick={() => setScore(c.id, { rating: v })}
                    onMouseEnter={() => setHover({ id: c.id, value: v })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ id: c.id, value: v })}
                    onBlur={() => setHover(null)}
                    className={cn(
                      'tabular h-11 w-11 rounded-full border text-sm font-medium transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                      active ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-ink',
                      !readOnly && !active && 'hover:border-primary hover:bg-primary-soft',
                      readOnly && !active && 'opacity-60',
                    )}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 min-h-[1.25rem] text-sm text-ink-muted" aria-live="polite">
              {shown && (
                <>
                  <span className="font-medium text-ink">{shown.label}</span>
                  {shown.description && ` — ${shown.description}`}
                </>
              )}
            </p>
            {below && (
              <p className="mt-1 rounded-control bg-warning-soft px-2 py-1 text-sm text-warning">
                {t('review.belowMinimum', { min: c.min_rating })}
              </p>
            )}

            {(!readOnly || row?.comment) && (
              <Field
                className="mt-3"
                label={t('review.comment')}
                required={needsComment}
                error={err ?? (needsComment && !(row?.comment ?? '').trim() ? t('review.commentRequired', { rating }) : null)}
              >
                <Textarea
                  rows={2}
                  value={row?.comment ?? ''}
                  readOnly={readOnly}
                  onChange={(e) => setScore(c.id, { comment: e.target.value })}
                />
              </Field>
            )}
            {err && readOnly && <p className="mt-1 text-sm text-danger">{err}</p>}
          </div>
        );
      })}

      <div className="flex items-baseline justify-between rounded-panel bg-primary-soft px-4 py-3" aria-live="polite">
        <span className="font-semibold text-ink">{t('review.total')}</span>
        <span className="tabular text-xl font-semibold text-ink">{t('review.outOf100', { score: total.toFixed(1) })}</span>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">
          {t('review.recommendation')} <span className="text-danger">*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {RECOMMENDATIONS.map((r) => (
            <label
              key={r}
              className={cn(
                'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-control border px-3 text-sm',
                value.recommendation === r ? 'border-primary bg-primary-soft text-ink' : 'border-line text-ink',
                readOnly && 'cursor-default opacity-80',
              )}
            >
              <input
                type="radio"
                name="recommendation"
                className="accent-primary"
                checked={value.recommendation === r}
                disabled={readOnly}
                onChange={() => onChange({ ...value, recommendation: r })}
              />
              {t(`review.rec.${r}`)}
            </label>
          ))}
        </div>
        {errors.recommendation && <p className="mt-1 text-sm text-danger">{errors.recommendation}</p>}
      </fieldset>

      <Field label={t('review.strengths')} required help={t('review.sharedHelp')} error={errors.strengths}>
        <Textarea
          rows={3}
          value={value.strengths}
          readOnly={readOnly}
          onChange={(e) => onChange({ ...value, strengths: e.target.value })}
        />
      </Field>
      <Field label={t('review.improvements')} required error={errors.improvements}>
        <Textarea
          rows={3}
          value={value.improvements}
          readOnly={readOnly}
          onChange={(e) => onChange({ ...value, improvements: e.target.value })}
        />
      </Field>
      <Field label={t('review.privateNote')}>
        <Textarea
          rows={2}
          value={value.private_note}
          readOnly={readOnly}
          onChange={(e) => onChange({ ...value, private_note: e.target.value })}
        />
      </Field>
    </div>
  );
}
