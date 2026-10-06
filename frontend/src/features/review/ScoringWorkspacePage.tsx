import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, MessageCircleQuestion } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError, api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { AttachmentList, Callout, ConfidentialBanner, DynamicFormView, SaveIndicator } from '@/components/domain';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  PageSkeleton,
  Tabs,
  Textarea,
  isNotFound,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { useAutosave } from '@/hooks';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/dates';
import { tr } from '@/utils/i18n';
import { ScorecardForm } from './components/ScorecardForm';
import { draftFrom, liveTotal, type ReviewDraft, type Workspace } from './types';

interface SaveResult {
  weighted_score: number;
  status: string;
}

export default function ScoringWorkspacePage() {
  const { assignmentId = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [server, setServer] = useState<{ total: number; snapshot: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pane, setPane] = useState<'submission' | 'scorecard'>('submission');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState('');

  const query = useQuery({
    queryKey: queryKeys.review.assignment(assignmentId),
    queryFn: () => api.get<Workspace>(`/review-assignments/${assignmentId}`),
    refetchOnWindowFocus: false,
  });
  const ws = query.data;

  // Load the saved draft once per assignment; later refetches must not overwrite what the judge is typing.
  useEffect(() => {
    if (ws && (!draft || ws.read_only)) setDraft(draftFrom(ws));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const readOnly = !ws || ws.read_only;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.review.queue });
    void qc.invalidateQueries({ queryKey: queryKeys.home });
  };

  const save = async (d: ReviewDraft) => {
    const res = await api.put<SaveResult>(`/review-assignments/${assignmentId}/scores`, d);
    setServer({ total: res.weighted_score, snapshot: JSON.stringify(d.scores) });
    invalidate();
    return res;
  };
  const saveStatus = useAutosave(draft ?? undefined, save, 2500, !readOnly);

  const saveNow = useMutation({
    mutationFn: () => save(draft!),
    onSuccess: () => toast.success(t('review.draftSaved')),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = useMutation({
    mutationFn: () => api.post<SaveResult>(`/review-assignments/${assignmentId}/actions/submit`, draft),
    onSuccess: () => {
      toast.success(t('review.reviewSubmitted'));
      setConfirmOpen(false);
      setErrors({});
      invalidate();
      void qc.invalidateQueries({ queryKey: queryKeys.review.assignment(assignmentId) });
    },
    onError: (e) => {
      setConfirmOpen(false);
      const fields = e instanceof ApiError ? (e.details?.fields as Record<string, string> | undefined) : undefined;
      if (fields) {
        setErrors(fields);
        setPane('scorecard');
        toast.error(t('review.incomplete'));
      } else toast.error(errorMessage(e));
    },
  });

  const ask = useMutation({
    mutationFn: () => api.post(`/review-assignments/${assignmentId}/clarification`, { question }),
    onSuccess: () => {
      toast.success(t('review.questionSent'));
      setAskOpen(false);
      setQuestion('');
      invalidate();
      void qc.invalidateQueries({ queryKey: queryKeys.review.assignment(assignmentId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ratedCount = useMemo(() => draft?.scores.filter((s) => s.rating != null).length ?? 0, [draft]);

  if (query.isLoading) return <PageSkeleton rows={8} />;
  if (isNotFound(query.error)) return <NotFoundPage />;
  if (query.isError || !ws) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!draft) return <PageSkeleton rows={8} />;

  const card = ws.scorecard;
  const live = card ? liveTotal(card, draft.scores) : 0;
  // Show the server's number once it has seen the current ratings; otherwise the live one.
  const serverTotal = ws.status === 'SUBMITTED' ? ws.weighted_score : server && server.snapshot === JSON.stringify(draft.scores) ? server.total : null;
  const change = (next: ReviewDraft) => {
    setDraft(next);
    if (Object.keys(errors).length) setErrors({});
  };
  const sections = ws.submission.form?.sections ?? [];

  const submissionPane = (
    <Card className={cn('min-w-0', pane !== 'submission' && 'hidden lg:block')}>
      <CardHeader
        title={ws.entity.title}
        subtitle={[
          ws.submission.version_no ? t('review.version', { no: ws.submission.version_no }) : null,
          ws.submission.submitted_at ? t('review.submittedOn', { date: formatDateTime(ws.submission.submitted_at) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      {sections.length > 1 && (
        <nav aria-label={t('review.jumpTo')} className="mb-4 flex flex-wrap gap-x-3 gap-y-1 border-b border-line pb-3 text-sm">
          <span className="text-ink-muted">{t('review.jumpTo')}:</span>
          {sections.map((s) => (
            <a key={s.id} href={`#section-${s.code}`} className="text-primary hover:underline">
              {tr(s.title_i18n)}
            </a>
          ))}
        </nav>
      )}
      {ws.submission.form ? (
        <DynamicFormView form={ws.submission.form} value={ws.submission.content ?? {}} className="reading" />
      ) : (
        <EmptyState title={t('review.noSubmission')} />
      )}
      <div className="mt-6 border-t border-line pt-4">
        {ws.blind_note && <p className="mb-2 text-sm text-ink-muted">{ws.blind_note}</p>}
        <AttachmentList
          entityType={ws.attachment_entity.entity_type}
          entityId={ws.attachment_entity.entity_id}
          canEdit={false}
          title={t('review.attachments')}
        />
      </div>
      {ws.clarifications.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="mb-2 font-semibold text-ink">{t('review.clarifications')}</h3>
          <ul className="space-y-3">
            {ws.clarifications.map((c) => (
              <li key={c.id} className="rounded-control border border-line p-3 text-sm">
                <p className="font-medium text-ink">{c.question}</p>
                <p className="text-xs text-ink-muted">{c.asked_at && formatDateTime(c.asked_at)}</p>
                {c.answer ? (
                  <p className="mt-2 whitespace-pre-wrap text-ink">{c.answer}</p>
                ) : (
                  <Badge tone="warning" className="mt-2">
                    {t('review.awaitingReply')}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );

  const scorecardPane = (
    <Card className={cn('min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto', pane !== 'scorecard' && 'hidden lg:block')}>
      <CardHeader
        title={card?.name ?? t('review.scorecard')}
        subtitle={ws.due_at ? t('review.dueOn', { date: formatDateTime(ws.due_at) }) : undefined}
        actions={!readOnly ? <SaveIndicator status={saveStatus} /> : undefined}
      />
      {ws.read_only && (
        <Callout tone="info" className="mb-4">
          {ws.status === 'SUBMITTED' ? t('review.readOnly') : t('review.readOnlyOther')}
        </Callout>
      )}
      {card && (
        <ScorecardForm scorecard={card} value={draft} onChange={change} readOnly={readOnly} errors={errors} serverTotal={serverTotal} />
      )}
      {!readOnly && (
        <div className="mt-5 hidden flex-wrap justify-end gap-2 lg:flex">
          <Button variant="secondary" loading={saveNow.isPending} onClick={() => saveNow.mutate()}>
            {t('review.saveDraft')}
          </Button>
          <Button onClick={() => setConfirmOpen(true)}>{t('review.submitReview')}</Button>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-4 pb-20 lg:pb-0">
      <PageHeader
        title={`${ws.entity.code ?? ''} · ${ws.entity.title}`}
        subtitle={`${ws.entity.type === 'initiative' ? t('review.openIdea') : tr(ws.entity.context_i18n, ws.entity.context)} · ${ws.round.name}`}
        breadcrumbs={[{ label: t('review.queueTitle'), to: '/review' }, { label: ws.entity.code ?? t('review.workspace') }]}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            {ws.round.blind && (
              <Badge tone="info" icon={<EyeOff className="h-3 w-3" />}>
                {t('review.blind')}
              </Badge>
            )}
            {!ws.round.blind && ws.entity.entrant && <span className="text-sm text-ink-muted">{ws.entity.entrant}</span>}
          </span>
        }
        actions={
          !readOnly ? (
            <Button variant="secondary" icon={<MessageCircleQuestion className="h-4 w-4" />} onClick={() => setAskOpen(true)}>
              {t('review.askClarification')}
            </Button>
          ) : undefined
        }
      />
      {ws.entity.confidential && <ConfidentialBanner />}

      <Tabs
        className="lg:hidden"
        ariaLabel={t('review.workspace')}
        value={pane}
        onChange={(v) => setPane(v as 'submission' | 'scorecard')}
        tabs={[
          { value: 'submission', label: t('review.tabSubmission') },
          { value: 'scorecard', label: t('review.tabScorecard') },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {submissionPane}
        {scorecardPane}
      </div>

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-14 z-20 md:bottom-0 flex items-center gap-3 border-t border-line bg-surface px-4 py-2 shadow-float lg:hidden">
          <span className="tabular flex-1 text-sm font-semibold text-ink">
            {t('review.total')}: {(serverTotal ?? live).toFixed(1)}
          </span>
          <Button onClick={() => setConfirmOpen(true)}>{t('review.submitReview')}</Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('review.submitTitle')}
        description={t('review.submitBody')}
        confirmLabel={t('review.submitReview')}
        loading={submit.isPending}
        onConfirm={() => submit.mutate()}
      >
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink-muted">{t('review.total')}</dt>
          <dd className="tabular text-right font-semibold text-ink">{t('review.outOf100', { score: (serverTotal ?? live).toFixed(1) })}</dd>
          <dt className="text-ink-muted">{t('review.scorecard')}</dt>
          <dd className="text-right text-ink">{t('review.rated', { done: ratedCount, total: draft.scores.length })}</dd>
          <dt className="text-ink-muted">{t('review.recommendation')}</dt>
          <dd className="text-right text-ink">{draft.recommendation ? t(`review.rec.${draft.recommendation}`) : '—'}</dd>
        </dl>
      </ConfirmDialog>

      <Dialog
        open={askOpen}
        onOpenChange={setAskOpen}
        title={t('review.clarificationTitle')}
        description={t('review.clarificationBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAskOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={ask.isPending} disabled={!question.trim()} onClick={() => ask.mutate()}>
              {t('review.sendQuestion')}
            </Button>
          </>
        }
      >
        <Field label={t('review.question')} required>
          <Textarea rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
