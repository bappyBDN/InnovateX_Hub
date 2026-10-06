import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { StatusBadge } from '@/components/domain';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { GATE_TONE, type GateStatus } from '@/features/gates/types';
import { num } from '@/utils/format';
import { JudgeFeedbackPanel } from './JudgeFeedbackPanel';
import type { ChallengeJudgeFeedbackRow } from './types';

/** Challenge-wise feedback: every entry the judges have scored or reviewed, expandable to each judge's score and comments. */
export function ChallengeFeedbackTab({ challengeId }: { challengeId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['challenges', challengeId, 'judge-feedback'],
    queryFn: () => api.get<{ items: ChallengeJudgeFeedbackRow[] }>(`/challenges/${challengeId}/judge-feedback`),
  });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data?.items ?? [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">{t('judgeFeedback.challengeHelp')}</p>
      {rows.length === 0 && <EmptyState title={t('judgeFeedback.noEntries')} description={t('judgeFeedback.emptyBody')} />}
      {rows.map((r) => {
        const expanded = open === r.entry.id;
        return (
          <Card key={r.entry.id} id={`judge-feedback-${r.entry.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">{r.entry.title}</p>
                <p className="text-sm text-ink-muted">
                  {r.entry.code}
                  {r.entry.entrant ? ` · ${r.entry.entrant}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={r.entry.status_code} />
                <span className="tabular rounded-control bg-primary-soft px-2 py-0.5 text-sm font-semibold text-ink" title={t('judgeFeedback.average')}>
                  {r.summary.average_score != null ? `${num(r.summary.average_score, 1)} / 100` : '—'}
                </span>
                <span className="text-sm text-ink-muted">{t('judgeFeedback.reviewsDone', { done: r.summary.reviews_done, total: r.summary.reviews_total })}</span>
                {r.gates.map((g, i) => (
                  <Badge key={i} tone={GATE_TONE[g.status as GateStatus] ?? 'neutral'}>
                    {t(`gates.stage.${g.stage}`)}: {t(`gates.status.${g.status}`, g.status)}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="mt-3">
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={expanded}
                icon={expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                onClick={() => setOpen(expanded ? null : r.entry.id)}
              >
                {expanded ? t('judgeFeedback.hideFeedback') : t('judgeFeedback.viewFeedback')}
              </Button>
            </div>
            {expanded && (
              <div className="mt-4 border-t border-line pt-4">
                <JudgeFeedbackPanel entityType="challenge_entry" entityId={r.entry.id} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
