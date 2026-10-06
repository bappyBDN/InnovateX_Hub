import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout } from '@/components/domain';
import { Badge, Button, ButtonLink, Card, CardHeader, ErrorState, Field, PageHeader, PageSkeleton, Select, Textarea, isNotFound } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime } from '@/utils/dates';
import { GateAnswers } from './GatePanel';
import { DECISIONS, DECISION_TONE, GATE_TONE, type GateBallot, type GateDecision } from './types';

/** A judge reads a prototype (link and how to use it) or a pilot report and gives a decision with feedback. No score. */
export default function GateDecisionPage() {
  const { t } = useTranslation();
  const { voteId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['gate-vote', voteId], queryFn: () => api.get<GateBallot>(`/gate-votes/${voteId}`) });
  const [decision, setDecision] = useState<GateDecision | ''>('');
  const [feedback, setFeedback] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) {
      setDecision(q.data.my_decision ?? '');
      setFeedback(q.data.my_feedback ?? '');
    }
  }, [q.data]);

  const send = useMutation({
    mutationFn: () => api.post<{ status: string }>(`/gate-votes/${voteId}`, { decision, feedback }),
    onSuccess: async () => {
      toast.success(t('gates.decisionSaved'));
      await Promise.all([qc.invalidateQueries({ queryKey: ['gate-vote', voteId] }), qc.invalidateQueries({ queryKey: queryKeys.review.queue }), qc.invalidateQueries({ queryKey: queryKeys.home })]);
      navigate('/review');
    },
    onError: (e) => {
      setErrors(e instanceof ApiError ? ((e.details as { fields?: Record<string, string> }).fields ?? {}) : {});
      toast.error(errorMessage(e));
    },
  });

  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <PageSkeleton rows={5} />;
  const d = q.data;
  const title = t(`gates.stage.${d.stage}`, d.title);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${d.entity.code} · ${d.entity.title}`}
        subtitle={`${d.entity.context} · ${title}`}
        breadcrumbs={[{ label: t('review.queueTitle'), to: '/review' }, { label: d.entity.code }]}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            {d.round_no > 1 && <Badge>{t('gates.round', { n: d.round_no })}</Badge>}
            <Badge tone={GATE_TONE[d.status]}>{t(`gates.status.${d.status}`)}</Badge>
          </span>
        }
        actions={
          <ButtonLink to="/review" variant="secondary">
            {t('review.backToQueue')}
          </ButtonLink>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={title} subtitle={t('gates.sentOn', { date: formatDateTime(d.submitted_at) })} />
            {d.entity.summary && <p className="mt-3 text-sm text-ink-muted">{d.entity.summary}</p>}
            <div className="mt-4">
              <GateAnswers fields={d.fields} content={d.content} />
            </div>
          </Card>
          {d.earlier_feedback.some((r) => r.items.length > 0) && (
            <Card>
              <CardHeader title={t('gates.earlierFeedback')} subtitle={t('gates.earlierFeedbackHelp')} />
              <div className="mt-3 space-y-3 text-sm">
                {d.earlier_feedback
                  .filter((r) => r.items.length > 0)
                  .map((r) => (
                    <div key={r.round_no}>
                      <Badge>{t('gates.round', { n: r.round_no })}</Badge>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-ink">
                        {r.items.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader title={t('gates.yourDecision')} subtitle={t('gates.yourDecisionHelp')} />
          <div className="mt-4 space-y-4">
            {!d.can_decide && (
              <Callout tone="info">
                {d.my_decision ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {t('gates.youDecided')} <Badge tone={DECISION_TONE[d.my_decision]}>{t(`gates.decision.${d.my_decision}`)}</Badge>
                  </span>
                ) : (
                  t('gates.closedNoDecision')
                )}
              </Callout>
            )}
            <Field label={t('gates.decisionField')} required error={errors.decision}>
              <Select
                value={decision}
                disabled={!d.can_decide}
                onChange={(e) => setDecision(e.target.value as GateDecision | '')}
                placeholder={t('gates.chooseDecision')}
                options={DECISIONS.map((x) => ({ value: x, label: `${t(`gates.decision.${x}`)} — ${t(`gates.decisionHelp.${x}`)}` }))}
              />
            </Field>
            <Field label={t('gates.feedbackField')} required={decision === 'REVISE' || decision === 'REJECT'} help={t('gates.feedbackFieldHelp')} error={errors.feedback}>
              <Textarea rows={6} maxLength={3000} disabled={!d.can_decide} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </Field>
            {d.can_decide && (
              <Button disabled={!decision} disabledReason={t('gates.chooseDecision')} loading={send.isPending} onClick={() => send.mutate()}>
                {d.my_decision ? t('gates.changeDecision') : t('gates.giveDecision')}
              </Button>
            )}
            <p className="text-sm text-ink-muted">{t('gates.majorityNote', { total: d.tally.total })}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
