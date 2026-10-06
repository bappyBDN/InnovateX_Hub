import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, MessageCircleQuestion, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { AttachmentList, Callout, DeadlineCountdown, JourneyRail, StatusBadge } from '@/components/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Field,
  isNotFound,
  PageHeader,
  PageSkeleton,
  Textarea,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime } from '@/utils/dates';
import { tr } from '@/utils/i18n';
import type { Clarification, EntryDetail, SubmissionInfo } from './types';

const SUB_LABEL: Record<string, string> = {
  METHODOLOGY: 'entries.methodology',
  PROTOTYPE: 'entries.prototype',
  FINAL_PROJECT: 'entries.finalProject',
};

function SubmissionRow({ s, isMember }: { s: SubmissionInfo; isMember: boolean }) {
  const { t } = useTranslation();
  const submitted = s.status === 'SUBMITTED' || s.status === 'LOCKED';
  let state: string;
  if (!s.required) state = t('entries.notRequired');
  else if (submitted) state = t('entries.submittedOn', { date: formatDateTime(s.submitted_at), version: s.version_no });
  else if (s.status === 'DRAFT') state = t('entries.draftPct', { pct: s.completeness_pct });
  else state = t('entries.notStarted');
  const canOpen = s.required && (submitted || isMember);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="font-medium text-ink">{t(SUB_LABEL[s.type] ?? s.type)}</p>
        <p className="text-sm text-ink-muted">{state}</p>
        {s.required && s.window_open && isMember && s.closes_at && <DeadlineCountdown closesAt={s.closes_at} compact className="mt-0.5" />}
        {s.required && !s.window_open && !submitted && s.opens_at && new Date(s.opens_at) > new Date() && (
          <p className="text-sm text-ink-muted">{t('entries.opensOn', { date: formatDateTime(s.opens_at) })}</p>
        )}
      </div>
      {canOpen && (
        <ButtonLink to={s.path} size="sm" variant="secondary">
          {isMember && s.window_open ? (submitted || s.status === 'DRAFT' ? t('common.edit') : t('entries.start')) : t('common.view')}
        </ButtonLink>
      )}
    </li>
  );
}

function ClarificationItem({ c, canReply, entryId }: { c: Clarification; canReply: boolean; entryId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [answer, setAnswer] = useState('');
  const reply = useMutation({
    mutationFn: () => api.post(`/clarifications/${c.id}/answer`, { answer }),
    onSuccess: () => {
      toast.success(t('entries.replySent'));
      setAnswer('');
      void qc.invalidateQueries({ queryKey: queryKeys.entries.detail(entryId) });
      void qc.invalidateQueries({ queryKey: queryKeys.entries.mine });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const open = c.status === 'OPEN';
  return (
    <li className={open ? 'rounded-panel border border-warning/40 bg-warning-soft p-3' : 'rounded-panel border border-line p-3'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{t('entries.askedOn', { date: formatDateTime(c.asked_at) })}</p>
        <Badge tone={open ? 'warning' : 'success'}>{open ? t('entries.waitingReply') : t('entries.answered')}</Badge>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-ink">{c.question}</p>
      {c.answer && (
        <div className="mt-2 border-l-2 border-line pl-3">
          <p className="text-sm text-ink-muted">{t('entries.repliedOn', { date: formatDateTime(c.answered_at) })}</p>
          <p className="whitespace-pre-wrap text-ink">{c.answer}</p>
        </div>
      )}
      {open && canReply && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) reply.mutate();
          }}
        >
          <Field label={t('entries.yourReply')} required help={c.due_at ? t('entries.replyBy', { date: formatDateTime(c.due_at) }) : undefined}>
            <Textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" loading={reply.isPending} disabled={!answer.trim()} disabledReason={t('entries.writeReplyFirst')}>
            {t('entries.sendReply')}
          </Button>
        </form>
      )}
    </li>
  );
}

export default function EntryOverviewPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.entries.detail(id), queryFn: () => api.get<EntryDetail>(`/entries/${id}`), enabled: !!id });
  const [moment, setMoment] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState('');

  // The server shows the moment once; keep it on screen for this visit even after a refetch.
  useEffect(() => {
    if (q.data?.show_shortlist_moment) setMoment(true);
  }, [q.data?.show_shortlist_moment]);

  const withdraw = useMutation({
    mutationFn: () => api.post(`/entries/${id}/actions/withdraw`, { reason }),
    onSuccess: () => {
      toast.success(t('entries.withdrawn'));
      setWithdrawOpen(false);
      void qc.invalidateQueries({ queryKey: queryKeys.entries.all });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <PageSkeleton rows={5} />;
  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const e = q.data;
  const step = e.next_step;
  const needsReason = !e.is_lead; // privileged withdrawal on behalf needs a reason
  const stepTone = step.tone === 'danger' ? 'danger' : step.tone === 'warning' ? 'warning' : step.tone === 'success' ? 'success' : 'info';

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('entries.myEntries'), to: '/entries' }, { label: e.code }]}
        title={e.title}
        subtitle={
          <>
            <span className="tabular">{e.code}</span> ·{' '}
            <Link to={`/challenges/${e.challenge.slug}`} className="text-primary hover:underline">
              {tr(e.challenge.title_i18n)}
            </Link>
          </>
        }
        meta={<StatusBadge status={e.status_code} />}
      />

      <div className="space-y-4">
        {!e.is_member && (
          <Callout tone="info" title={<span className="inline-flex items-center gap-1.5"><Eye className="h-4 w-4" aria-hidden />{t('entries.readOnlyTitle')}</span>}>
            {e.lead || e.team ? t('entries.readOnlyBody') : t('entries.blindBody')}
          </Callout>
        )}

        {moment && (
          <Callout tone="spark" title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4" aria-hidden />{e.team ? t('entries.shortlistedTeam') : t('entries.shortlistedYou')}</span>}>
            {e.prototype_required ? t('entries.shortlistedProto') : t('entries.shortlistedNext')}
          </Callout>
        )}

        <Card>
          <JourneyRail stages={e.journey} size="full" />
        </Card>

        {step.text && (
          <Callout
            tone={stepTone}
            title={t('entries.nextStep')}
            action={
              e.is_member && step.action_path && step.action_label ? (
                <ButtonLink to={step.action_path} icon={<ArrowRight className="h-4 w-4" aria-hidden />}>
                  {step.action_label}
                </ButtonLink>
              ) : undefined
            }
          >
            <p>{step.text}</p>
            {step.due_at && !e.is_finished && <DeadlineCountdown closesAt={step.due_at} className="mt-1" />}
          </Callout>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('entries.submissions')} />
            {e.submissions.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('entries.noSubmissionPhases')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {e.submissions.map((s) => (
                  <SubmissionRow key={s.type} s={s} isMember={e.is_member} />
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-4">
            <div>
              <CardHeader title={t('entries.feedback')} />
              {e.feedback_available ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink">{t('entries.feedbackReady')}</p>
                  <ButtonLink to={`/entries/${e.id}/feedback`} size="sm" variant="secondary">
                    {t('entries.readFeedback')}
                  </ButtonLink>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">{t('entries.feedbackNotYet')}</p>
              )}
            </div>
            <div className="border-t border-line pt-4">
              <CardHeader title={t('entries.participation')} />
              {e.team ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm text-ink">
                    <Users className="h-4 w-4 text-ink-muted" aria-hidden />
                    {t('entries.teamWithCount', { name: e.team.name, count: e.team.member_count })}
                  </p>
                  <ButtonLink to={`/teams/${e.team.id}`} size="sm" variant="secondary">
                    {t('entries.openTeam')}
                  </ButtonLink>
                </div>
              ) : e.lead ? (
                <p className="text-sm text-ink">{t('entries.individualBy', { name: e.lead.full_name })}</p>
              ) : (
                <p className="text-sm text-ink-muted">{t('entries.identityHidden')}</p>
              )}
              {e.current_score != null && (
                <p className="tabular mt-2 text-sm text-ink-muted">
                  {t('entries.staffScore', { score: e.current_score, rank: e.current_rank ?? '—' })}
                </p>
              )}
            </div>
            {['SHORTLISTED', 'BUILDING', 'PROTOTYPE_SUBMITTED', 'FINALIST', 'FINAL_SUBMITTED'].includes(e.status_code) && (
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                <ButtonLink to={`/entries/${e.id}/milestones`} size="sm" variant="secondary">
                  {t('entries.buildPlan')}
                </ButtonLink>
                {['FINALIST', 'FINAL_SUBMITTED'].includes(e.status_code) && (
                  <ButtonLink to={`/entries/${e.id}/demo`} size="sm" variant="secondary">
                    {t('entries.demoSlot')}
                  </ButtonLink>
                )}
                {['FINALIST', 'FINAL_SUBMITTED'].includes(e.status_code) && (
                  <ButtonLink to={`/entries/${e.id}/prototype`} size="sm" variant="secondary">
                    {t('entries.pilotForm')}
                  </ButtonLink>
                )}
              </div>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader
            title={<span className="inline-flex items-center gap-1.5"><MessageCircleQuestion className="h-4 w-4" aria-hidden />{t('entries.messages')}</span>}
            subtitle={t('entries.messagesSubtitle')}
          />
          {e.clarifications.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('entries.noMessages')}</p>
          ) : (
            <ul className="space-y-3">
              {e.clarifications.map((c) => (
                <ClarificationItem key={c.id} c={c} canReply={e.is_member} entryId={e.id} />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <AttachmentList entityType="challenge_entry" entityId={e.id} canEdit={e.is_member && e.status_code !== 'WITHDRAWN'} title={t('entries.files')} />
        </Card>

        {e.can_withdraw && (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setWithdrawOpen(true)}>
              {t('entries.withdrawEntry')}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        title={t('entries.withdrawTitle')}
        description={t('entries.withdrawBody')}
        confirmLabel={t('entries.withdrawEntry')}
        variant="danger"
        loading={withdraw.isPending}
        onConfirm={() => {
          if (needsReason && !reason.trim()) {
            toast.error(t('entries.withdrawReasonRequired'));
            return;
          }
          withdraw.mutate();
        }}
      >
        <Field label={t('entries.withdrawReason')} required={needsReason}>
          <Textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
