import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, RichTextEditor, Skeleton } from '@/components/ui';
import { JudgeFeedbackPanel } from '@/features/judging/JudgeFeedbackPanel';
import { formatDateTime } from '@/utils/dates';
import { num } from '@/utils/format';
import type { FeedbackComposerData, FeedbackDraft } from './types';

function DraftCard({
  draft,
  canManage,
  roundId,
  shortlistId,
}: {
  draft: FeedbackDraft;
  canManage: boolean;
  roundId: string;
  shortlistId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const initial = {
    strengths: draft.strengths ?? '',
    improvements: draft.improvements ?? '',
    decision_reason: draft.decision_reason ?? '',
    next_steps: draft.next_steps ?? '',
  };
  const [form, setForm] = useState(initial);
  const [showJudges, setShowJudges] = useState(false);
  useEffect(() => {
    setForm(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, draft.strengths, draft.improvements, draft.decision_reason, draft.next_steps]);
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/feedback/${draft.id}`, {
        strengths: form.strengths,
        improvements: form.improvements,
        decision_reason: form.decision_reason || null,
        next_steps: form.next_steps || null,
      }),
    onSuccess: () => {
      toast.success(t('shortlist.feedbackSaved'));
      void qc.invalidateQueries({ queryKey: queryKeys.review.feedback(roundId) });
      void qc.invalidateQueries({ queryKey: queryKeys.shortlists.detail(shortlistId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k: keyof typeof initial) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const fields: [keyof typeof initial, string, boolean][] = [
    ['strengths', t('shortlist.strengths'), true],
    ['improvements', t('shortlist.improvements'), true],
    ['decision_reason', t('shortlist.decisionReason'), false],
    ['next_steps', t('shortlist.nextSteps'), false],
  ];

  return (
    <Card id={`feedback-${draft.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{draft.entry.title}</p>
          <p className="text-sm text-ink-muted">
            {draft.entry.code} ·{' '}
            {draft.score_shared == null ? t('shortlist.scoreNotShared') : t('shortlist.scoreShared', { score: num(draft.score_shared, 1) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={draft.entry.status_code} />
          {draft.complete ? (
            <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}>
              {t('shortlist.complete')}
            </Badge>
          ) : (
            <Badge tone="warning" icon={<CircleAlert className="h-3.5 w-3.5" aria-hidden />}>
              {t('shortlist.incomplete')}
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {fields.map(([key, label, required]) => (
          <Field key={key} label={label} required={required}>
            <RichTextEditor rows={4} value={form[key]} onChange={set(key)} readOnly={!canManage} />
          </Field>
        ))}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={showJudges}
          icon={showJudges ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          onClick={() => setShowJudges((v) => !v)}
        >
          {showJudges ? t('judgeFeedback.hideFeedback') : t('judgeFeedback.viewFeedback')}
        </Button>
        {showJudges && (
          <div className="mt-4">
            <JudgeFeedbackPanel entityType="challenge_entry" entityId={draft.entry.id} />
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          {draft.published_at
            ? `${t('shortlist.publishedOn', { date: formatDateTime(draft.published_at) })} · ${
                draft.read_at ? t('shortlist.readOn', { date: formatDateTime(draft.read_at) }) : t('shortlist.notRead')
              }`
            : ''}
        </p>
        {canManage && (
          <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
            {t('shortlist.saveFeedback')}
          </Button>
        )}
      </div>
    </Card>
  );
}

/** §10.5 — one clear message per entry, built from the judges' shared comments. */
export function FeedbackComposer({ roundId, shortlistId, canManage }: { roundId: string; shortlistId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const [onlyMissing, setOnlyMissing] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.review.feedback(roundId),
    queryFn: () => api.get<FeedbackComposerData>(`/review-rounds/${roundId}/feedback`),
    enabled: canManage,
  });

  if (!canManage) return <Callout tone="info">{t('shortlist.readOnly')}</Callout>;
  if (query.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const items = query.data.items.filter((i) => !onlyMissing || !i.complete);
  const missing = query.data.items.filter((i) => !i.complete).length;

  return (
    <div className="space-y-4">
      <Callout tone="info">{t('shortlist.composerIntro')}</Callout>
      {query.data.items.length === 0 ? (
        <EmptyState title={t('shortlist.composerEmpty')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge tone={missing ? 'warning' : 'success'}>
              {missing ? t('shortlist.checkFeedbackMissing', { count: missing }) : t('shortlist.checkFeedbackOk')}
            </Badge>
            <Checkbox label={t('shortlist.showOnlyMissing')} checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          </div>
          {items.length === 0 ? (
            <EmptyState title={t('shortlist.checkFeedbackOk')} />
          ) : (
            items.map((d) => <DraftCard key={d.id} draft={d} canManage={canManage} roundId={roundId} shortlistId={shortlistId} />)
          )}
        </>
      )}
    </div>
  );
}
