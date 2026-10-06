import { useQuery } from '@tanstack/react-query';
import { EyeOff, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { StatusBadge } from '@/components/domain';
import { Badge, EmptyState, ErrorState, RichText, Skeleton, type Tone } from '@/components/ui';
import { GATE_TONE, DECISION_TONE, type GateDecision, type GateStatus } from '@/features/gates/types';
import { formatDateTime } from '@/utils/dates';
import { num } from '@/utils/format';
import type { JudgeFeedbackData, JudgeFeedbackGate, JudgeFeedbackReview, JudgeFeedbackRound, JudgeFeedbackSummary } from './types';

const REC_TONE: Record<string, Tone> = { STRONG_YES: 'success', YES: 'success', MAYBE: 'warning', NO: 'danger' };

export const judgeFeedbackKey = (entityType: string, entityId: string) => ['judge-feedback', entityType, entityId] as const;

function Recommendation({ code }: { code: string }) {
  const { t } = useTranslation();
  return <Badge tone={REC_TONE[code] ?? 'neutral'}>{t(`review.rec.${code}`, code)}</Badge>;
}

/** Average score and how the judges recommended, in one line. */
export function FeedbackSummaryLine({ summary }: { summary: JudgeFeedbackSummary }) {
  const { t } = useTranslation();
  const recs = Object.entries(summary.recommendations);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-line bg-primary-soft px-4 py-3 text-sm text-ink">
      <span>
        <span className="font-medium">{t('judgeFeedback.average')}: </span>
        <span className="tabular text-lg font-semibold">{summary.average_score != null ? `${num(summary.average_score, 1)} / 100` : '—'}</span>
      </span>
      <span className="text-ink-muted">{t('judgeFeedback.reviewsDone', { done: summary.reviews_done, total: summary.reviews_total })}</span>
      {recs.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          {recs.map(([code, n]) => (
            <Badge key={code} tone={REC_TONE[code] ?? 'neutral'}>
              {t(`review.rec.${code}`, code)} × {n}
            </Badge>
          ))}
        </span>
      )}
    </div>
  );
}

function Section({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'private' }) {
  return (
    <div className={tone === 'private' ? 'rounded-control border border-dashed border-warning bg-warning-soft px-3 py-2' : undefined}>
      <h5 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {tone === 'private' && <EyeOff className="h-3.5 w-3.5" aria-hidden />}
        {title}
      </h5>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

function ReviewCard({ review, max }: { review: JudgeFeedbackReview; max: number }) {
  const { t } = useTranslation();
  const done = review.status === 'SUBMITTED';
  const commented = review.criteria.filter((c) => c.rating != null || (c.comment ?? '').trim());
  return (
    <details className="group rounded-panel border border-line bg-surface" open={done}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span>
          <span className="font-medium text-ink">{review.judge?.full_name ?? t('judgeFeedback.aJudge')}</span>
          {review.judge?.job_title && <span className="ml-2 text-sm text-ink-muted">{review.judge.job_title}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {done ? (
            <>
              {review.recommendation && <Recommendation code={review.recommendation} />}
              <span className="tabular rounded-control bg-primary-soft px-2 py-0.5 text-sm font-semibold text-ink">
                {review.weighted_score != null ? `${num(review.weighted_score, 1)} / 100` : '—'}
              </span>
            </>
          ) : (
            <StatusBadge status={review.status} />
          )}
        </span>
      </summary>
      {done ? (
        <div className="space-y-4 border-t border-line px-4 py-3">
          {review.submitted_at && <p className="text-xs text-ink-muted">{t('judgeFeedback.submittedOn', { date: formatDateTime(review.submitted_at) })}</p>}
          {commented.length > 0 && (
            <Section title={t('judgeFeedback.byCriterion')}>
              <ul className="divide-y divide-line rounded-control border border-line">
                {commented.map((c) => (
                  <li key={c.code} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,12rem)_4.5rem_minmax(0,1fr)]">
                    <span className="font-medium">{c.name}</span>
                    <span className="tabular text-ink-muted">{c.rating != null ? `${num(c.rating, 0)} / ${num(max, 0)}` : '—'}</span>
                    <span>{(c.comment ?? '').trim() ? <RichText value={c.comment} /> : <span className="text-ink-muted">—</span>}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {review.strengths && (
            <Section title={t('judgeFeedback.strengths')}>
              <RichText value={review.strengths} />
            </Section>
          )}
          {review.improvements && (
            <Section title={t('judgeFeedback.suggestions')}>
              <RichText value={review.improvements} />
            </Section>
          )}
          {review.private_note && (
            <Section title={t('judgeFeedback.privateNote')} tone="private">
              <RichText value={review.private_note} />
            </Section>
          )}
        </div>
      ) : (
        <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">{t('judgeFeedback.notSubmitted')}</p>
      )}
    </details>
  );
}

function RoundBlock({ round }: { round: JudgeFeedbackRound }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2" aria-label={round.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-base font-semibold text-ink">{round.name}</h4>
        <span className="text-sm text-ink-muted">
          {t('judgeFeedback.roundAverage', { score: round.average_score != null ? num(round.average_score, 1) : '—' })} ·{' '}
          {t('judgeFeedback.reviewsDone', { done: round.reviews_done, total: round.reviews_total })}
        </span>
      </div>
      <div className="space-y-2">
        {round.reviews.map((r) => (
          <ReviewCard key={r.id} review={r} max={round.scale_max} />
        ))}
      </div>
    </section>
  );
}

function GateBlock({ gate }: { gate: JudgeFeedbackGate }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2" aria-label={gate.title}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold text-ink">{t(`gates.stage.${gate.stage}`, gate.title)}</h4>
        {gate.round_no > 1 && <Badge>{t('gates.round', { n: gate.round_no })}</Badge>}
        <Badge tone={GATE_TONE[gate.status as GateStatus] ?? 'neutral'}>{t(`gates.status.${gate.status}`, gate.status)}</Badge>
        {gate.decided_at && <span className="text-xs text-ink-muted">{formatDateTime(gate.decided_at)}</span>}
      </div>
      {gate.decision_note && (
        <div className="rounded-control border border-line bg-canvas px-3 py-2 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('gates.adminDecision')}</p>
          <RichText value={gate.decision_note} />
        </div>
      )}
      {gate.judges.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('gates.noJudges')}</p>
      ) : (
        <ul className="space-y-2">
          {gate.judges.map((j, i) => (
            <li key={i} className="rounded-panel border border-line bg-surface px-4 py-3 text-sm">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{j.judge?.full_name ?? t('judgeFeedback.aJudge')}</span>
                {j.decision ? <Badge tone={DECISION_TONE[j.decision as GateDecision]}>{t(`gates.decision.${j.decision}`)}</Badge> : <Badge>{t('gates.waiting')}</Badge>}
              </span>
              {j.feedback && <RichText className="mt-2" value={j.feedback} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Everything the judges said about one idea or challenge entry: per judge the score, recommendation, comment on every
 * criterion, strengths, suggestions and the private note; plus the demo and pilot review decisions.
 * Staff only — the server answers 404 for anyone else.
 */
export function JudgeFeedbackPanel({ entityType, entityId, enabled = true }: { entityType: 'initiative' | 'challenge_entry'; entityId: string; enabled?: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: judgeFeedbackKey(entityType, entityId),
    queryFn: () => api.get<JudgeFeedbackData>(`/judge-feedback/${entityType}/${entityId}`),
    enabled,
  });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d || (d.rounds.length === 0 && d.gates.length === 0)) {
    return <EmptyState icon={<MessageSquareText className="h-8 w-8" aria-hidden />} title={t('judgeFeedback.emptyTitle')} description={t('judgeFeedback.emptyBody')} />;
  }
  return (
    <div className="space-y-5">
      {d.rounds.length > 0 && <FeedbackSummaryLine summary={d.summary} />}
      {d.rounds.map((r) => (
        <RoundBlock key={r.round_id} round={r} />
      ))}
      {d.gates.length > 0 && (
        <div className="space-y-4 border-t border-line pt-4">
          {d.gates.map((g) => (
            <GateBlock key={g.id} gate={g} />
          ))}
        </div>
      )}
    </div>
  );
}
