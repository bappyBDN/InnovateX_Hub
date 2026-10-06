import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ProgressBar } from '@/components/ui/Feedback';
import { Card } from '@/components/ui/Layout';
import { RichText } from '@/components/ui/RichText';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/dates';
import { num, statusLabel } from '@/utils/format';
import { StatusBadge } from './StatusBadge';

export interface CriterionScore {
  code?: string;
  name: string;
  /** Average rating on the scale (e.g. 3.7 of 5), or a 0–100 value when max is 100. */
  value: number | null | undefined;
  max?: number;
  weight?: number | null;
}

export interface ScoreSummaryProps {
  /** 0–100. null/undefined = not shared. */
  total: number | null | undefined;
  criteria?: CriterionScore[];
  /** Small text under the total. */
  caption?: ReactNode;
  className?: string;
}

/** Total score and per-criterion bars (only when the challenge shares them). No comparison with others. */
export function ScoreSummary({ total, criteria, caption, className }: ScoreSummaryProps) {
  const { t } = useTranslation();
  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <p className="text-sm text-ink-muted">{t('feedback.totalScore')}</p>
        <p className="tabular text-[2rem] font-semibold leading-tight text-ink">
          {total == null ? <span className="text-base font-normal text-ink-muted">{t('feedback.notShared')}</span> : (
            <>
              {num(total, 1)} <span className="text-base font-normal text-ink-muted">/ 100</span>
            </>
          )}
        </p>
        {caption && <p className="text-sm text-ink-muted">{caption}</p>}
      </div>
      {criteria && criteria.length > 0 && (
        <ul className="space-y-3">
          {criteria.map((c) => {
            const max = c.max ?? 5;
            return (
              <li key={c.code ?? c.name}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink">
                    {c.name}
                    {c.weight != null && <span className="text-ink-muted"> · {num(c.weight)}%</span>}
                  </span>
                  <span className="tabular text-ink-muted">
                    {c.value == null ? '—' : `${num(c.value, 1)} / ${max}`}
                  </span>
                </div>
                <ProgressBar value={c.value ?? 0} max={max} label={c.name} className="[&>div:first-child]:hidden" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface FeedbackData {
  strengths?: string | null;
  improvements?: string | null;
  decision_code?: string | null;
  decision_reason?: string | null;
  next_steps?: string | null;
  score_shared?: number | null;
  published_at?: string | null;
  judge_comments?: Record<string, string[]>;
  recommendations?: string[];
}

export interface FeedbackCardProps {
  feedback: FeedbackData;
  title?: ReactNode;
  /** Extra content at the bottom (e.g. "Raise an appeal"). */
  footer?: ReactNode;
  className?: string;
}

function Block({ title, children, rich }: { title: string; children?: ReactNode; rich?: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-ink-muted">{title}</h3>
      <div className={cn('reading mt-1 text-ink', rich === undefined && 'whitespace-pre-wrap')}>{rich !== undefined ? <RichText value={rich} /> : children}</div>
    </div>
  );
}

/** Formal feedback in the fixed format: strengths, improvements, decision, next steps. Judges are never named. */
export function FeedbackCard({ feedback: f, title, footer, className }: FeedbackCardProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {title && <h2 className="text-xl font-semibold text-ink">{title}</h2>}
          {f.decision_code && <StatusBadge status={f.decision_code} />}
        </div>
        {f.published_at && <span className="tabular text-xs text-ink-muted">{formatDateTime(f.published_at)}</span>}
      </div>
      {f.score_shared != null && (
        <p className="tabular text-lg font-semibold text-ink">{t('feedback.score', { score: num(f.score_shared, 1) })}</p>
      )}
      {f.strengths && <Block title={t('feedback.strengths')} rich={f.strengths} />}
      {f.improvements && <Block title={t('feedback.improvements')} rich={f.improvements} />}
      {f.judge_comments && Object.keys(f.judge_comments).length > 0 && (
        <Block title={t('feedback.judgeComments')}>
          <ul className="space-y-2">
            {Object.entries(f.judge_comments).map(([name, comments]) => (
              <li key={name}>
                <p className="font-medium text-ink-muted">{name}</p>
                <ul className="list-disc pl-5">
                  {comments.map((c, i) => (
                    <li key={i} className="text-ink">
                      <RichText value={c} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Block>
      )}
      {f.recommendations && f.recommendations.length > 0 && (
        <Block title={t('feedback.recommendation')}>
          {f.recommendations.map((code) => t(`review.rec.${code}`, code)).join(' · ')}
        </Block>
      )}
      {(f.decision_code || f.decision_reason) && (
        <Block title={t('feedback.decision')} rich={f.decision_reason || statusLabel(f.decision_code)} />
      )}
      {f.next_steps && <Block title={t('feedback.nextSteps')} rich={f.next_steps} />}
      {footer}
    </Card>
  );
}
