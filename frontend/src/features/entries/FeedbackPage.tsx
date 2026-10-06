import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, FeedbackCard, ScoreSummary, StatusBadge } from '@/components/domain';
import { Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, Field, isNotFound, PageHeader, PageSkeleton, Textarea } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime } from '@/utils/dates';
import { statusLabel } from '@/utils/format';
import type { FeedbackData, FeedbackItem } from './types';

const MIN_REASON = 20;

export default function FeedbackPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.entries.feedback(id), queryFn: () => api.get<FeedbackData>(`/entries/${id}/feedback`), enabled: !!id });
  const [appealFor, setAppealFor] = useState<FeedbackItem | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const appeal = useMutation({
    mutationFn: () => api.post('/appeals', { feedback_id: appealFor?.id, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(t('entries.appealRaised'));
      setAppealFor(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: queryKeys.entries.feedback(id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const { entry, items } = q.data;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('entries.myEntries'), to: '/entries' },
          { label: entry.code, to: `/entries/${entry.id}` },
          { label: t('entries.feedback') },
        ]}
        title={t('entries.feedbackTitle')}
        subtitle={entry.title}
        meta={<StatusBadge status={entry.status_code} />}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<MessageSquareText className="h-8 w-8" aria-hidden />}
          title={t('entries.feedbackEmpty')}
          description={t('entries.feedbackEmptyBody')}
          action={<ButtonLink to={`/entries/${entry.id}`} variant="secondary">{t('entries.backToEntry')}</ButtonLink>}
        />
      ) : (
        <div className="max-w-reading space-y-6">
          {items.map((f) => {
            const criteria = Object.entries(f.criterion_scores ?? {}).map(([name, value]) => ({ name, value, max: 5 }));
            return (
              <section key={f.id} aria-label={f.round} className="space-y-3">
                {f.score_shared != null && (
                  <Card>
                    <ScoreSummary
                      total={f.score_shared}
                      criteria={criteria.length ? criteria : undefined}
                      caption={t('entries.scoreCaption', { score: Math.round(f.score_shared * 10) / 10 })}
                    />
                  </Card>
                )}
                <FeedbackCard
                  feedback={f}
                  title={f.round}
                  footer={
                    f.appeal ? (
                      <Callout tone={f.appeal.status === 'OPEN' ? 'info' : f.appeal.status === 'UPHELD' ? 'success' : 'warning'} title={t('entries.appealStatus', { status: statusLabel(f.appeal.status) })}>
                        <p className="whitespace-pre-wrap">{f.appeal.reason}</p>
                        {f.appeal.decision_note && (
                          <p className="mt-1 whitespace-pre-wrap">
                            <span className="font-medium">{t('entries.appealDecision')}:</span> {f.appeal.decision_note}
                          </p>
                        )}
                      </Callout>
                    ) : f.can_appeal ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-ink-muted">{t('entries.appealUntil', { date: formatDateTime(f.appeal_deadline) })}</p>
                        <Button variant="ghost" size="sm" onClick={() => { setAppealFor(f); setReason(''); setReasonError(null); }}>
                          {t('entries.raiseAppeal')}
                        </Button>
                      </div>
                    ) : undefined
                  }
                />
              </section>
            );
          })}
          <p className="text-sm text-ink-muted">{t('entries.feedbackPrivacy')}</p>
        </div>
      )}

      <Dialog
        open={!!appealFor}
        onOpenChange={(o) => !o && setAppealFor(null)}
        title={t('entries.appealTitle')}
        description={t('entries.appealBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAppealFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={appeal.isPending}
              onClick={() => {
                if (reason.trim().length < MIN_REASON) {
                  setReasonError(t('entries.appealReasonError'));
                  return;
                }
                setReasonError(null);
                appeal.mutate();
              }}
            >
              {t('entries.raiseAppeal')}
            </Button>
          </>
        }
      >
        <Field label={t('entries.appealReason')} required error={reasonError} help={t('entries.appealReasonHelp')} hint={`${reason.length} / 1000`}>
          <Textarea rows={5} maxLength={1000} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
