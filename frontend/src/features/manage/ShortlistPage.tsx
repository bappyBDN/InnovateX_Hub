import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleAlert, Pencil, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, FeedbackCard, StatusBadge } from '@/components/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
  Tabs,
  Textarea,
  isNotFound,
  type Tone,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime } from '@/utils/dates';
import { num } from '@/utils/format';
import { tr } from '@/utils/i18n';
import { FeedbackComposer } from './evaluation/FeedbackComposer';
import type { Decision, FeedbackComposerData, ShortlistDetail, ShortlistRow } from './evaluation/types';

const TONE: Record<Decision, Tone> = { IN: 'success', WAITLIST: 'warning', OUT: 'neutral' };

function DecisionBadge({ value }: { value: Decision }) {
  const { t } = useTranslation();
  const label = { IN: t('shortlist.in'), WAITLIST: t('shortlist.waitlist'), OUT: t('shortlist.out') }[value];
  return <Badge tone={TONE[value]}>{label}</Badge>;
}

function DecisionDialog({ row, shortlistId, onClose }: { row: ShortlistRow; shortlistId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [decision, setDecision] = useState<Decision>(row.final_decision);
  const [reason, setReason] = useState(row.override_reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const differs = decision !== row.system_decision;
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/shortlists/${shortlistId}/entries/${row.id}`, { final_decision: decision, override_reason: differs ? reason.trim() : null }),
    onSuccess: () => {
      toast.success(t('shortlist.decisionSaved'));
      void qc.invalidateQueries({ queryKey: queryKeys.shortlists.detail(shortlistId) });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const labels: Record<Decision, string> = { IN: t('shortlist.in'), WAITLIST: t('shortlist.waitlist'), OUT: t('shortlist.out') };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('shortlist.changeFor', { entry: row.entry.title })}
      description={t('shortlist.systemDecided', { decision: labels[row.system_decision] })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              if (differs && !reason.trim()) return setError(t('shortlist.reasonRequired'));
              setError(null);
              save.mutate();
            }}
          >
            {t('shortlist.saveDecision')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('shortlist.decision')}>
          <Select
            value={decision}
            onChange={(e) => setDecision(e.target.value as Decision)}
            options={(['IN', 'WAITLIST', 'OUT'] as Decision[]).map((d) => ({ value: d, label: labels[d] }))}
          />
        </Field>
        {differs ? (
          <Field label={t('shortlist.reason')} required help={t('shortlist.reasonHelp')} error={error}>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : (
          error && <p className="text-sm text-danger">{error}</p>
        )}
      </div>
    </Dialog>
  );
}

function PrototypeDialog({ row, shortlistId, onClose }: { row: ShortlistRow; shortlistId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [required, setRequired] = useState(row.prototype_required);
  const [reason, setReason] = useState(row.prototype_reason ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/shortlists/${shortlistId}/entries/${row.id}`, { prototype_required: required, prototype_reason: required ? reason.trim() || null : null }),
    onSuccess: () => {
      toast.success(t('shortlist.prototypeSaved'));
      void qc.invalidateQueries({ queryKey: queryKeys.shortlists.detail(shortlistId) });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={t('shortlist.prototypeFor', { entry: row.entry.title })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Checkbox label={t('shortlist.prototypeAsk')} checked={required} onChange={(e) => setRequired(e.target.checked)} />
        {required && (
          <Field label={t('shortlist.prototypeReasonLabel')} help={t('shortlist.prototypeReasonHelp')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function PublishDialog({
  data,
  onClose,
  onWriteFeedback,
}: {
  data: ShortlistDetail;
  onClose: () => void;
  onWriteFeedback: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const feedback = useQuery({
    queryKey: queryKeys.review.feedback(data.round.id),
    queryFn: () => api.get<FeedbackComposerData>(`/review-rounds/${data.round.id}/feedback`),
  });
  const publish = useMutation({
    mutationFn: () => api.post(`/shortlists/${data.id}/actions/publish`),
    onSuccess: () => {
      toast.success(t('shortlist.publishedToast'));
      void qc.invalidateQueries({ queryKey: queryKeys.shortlists.detail(data.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.review.feedback(data.round.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.review.results(data.round.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.manage.challenge(data.challenge.id) });
      onClose();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      void qc.invalidateQueries({ queryKey: queryKeys.shortlists.detail(data.id) });
    },
  });
  const isFinalists = data.round.round_type === 'PROTOTYPE';
  const example = (wanted: boolean) => {
    const row = data.entries.find((e) => (e.final_decision === 'IN') === wanted);
    const fb = row && feedback.data?.items.find((f) => f.entry.id === row.entry.id);
    if (!row) return <p className="text-sm text-ink-muted">{t('shortlist.previewNoExample')}</p>;
    const code = wanted ? (isFinalists ? 'FINALIST' : 'SHORTLISTED') : isFinalists ? 'NOT_SELECTED' : 'NOT_SHORTLISTED';
    const title = wanted ? t('shortlist.previewInTitle') : t('shortlist.previewOutTitle');
    return (
      <div className="space-y-2">
        <p className="text-xs text-ink-muted">
          {t('shortlist.previewEmail')}: <span className="text-ink">[InnovateX] {title} - {row.entry.code}</span>
        </p>
        <FeedbackCard
          title={`${title}: ${row.entry.title}`}
          feedback={{
            strengths: fb?.strengths,
            improvements: fb?.improvements,
            decision_code: code,
            decision_reason: fb?.decision_reason,
            next_steps:
              (fb?.next_steps ?? '') +
              (wanted && row.prototype_required ? ` ${t('shortlist.prototypeNeeded')}${row.prototype_reason ? `: ${row.prototype_reason}` : ''}` : ''),
            score_shared: fb?.score_shared,
          }}
        />
      </div>
    );
  };
  const missing = data.missing_feedback;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={t('shortlist.publishTitle')}
      description={t('shortlist.publishBody')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Send className="h-4 w-4" aria-hidden />}
            loading={publish.isPending}
            disabled={missing > 0}
            disabledReason={t('shortlist.checkFeedbackMissing', { count: missing })}
            onClick={() => publish.mutate()}
          >
            {t('shortlist.publish')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {missing > 0 ? (
          <Callout
            tone="warning"
            title={t('shortlist.checkFeedbackMissing', { count: missing })}
            action={
              <Button size="sm" variant="secondary" onClick={onWriteFeedback}>
                {t('shortlist.writeMissing')}
              </Button>
            }
          />
        ) : (
          <Callout tone="success" title={t('shortlist.checkFeedbackOk')} />
        )}
        <p className="text-sm text-ink">
          {t('shortlist.counts', { in: data.counts.IN, wait: data.counts.WAITLIST, out: data.counts.OUT })}
        </p>
        <section className="space-y-2">
          <h3 className="font-semibold text-ink">{t('shortlist.previewIn')}</h3>
          {example(true)}
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold text-ink">{t('shortlist.previewOut')}</h3>
          {example(false)}
        </section>
      </div>
    </Dialog>
  );
}

export default function ShortlistPage() {
  const { t } = useTranslation();
  const { id = '', shortlistId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'feedback' ? 'feedback' : 'shortlist';
  const [editing, setEditing] = useState<{ row: ShortlistRow; kind: 'decision' | 'prototype' } | null>(null);
  const [dialog, setDialog] = useState<'rerun' | 'confirm' | 'publish' | null>(null);

  const query = useQuery({
    queryKey: queryKeys.shortlists.detail(shortlistId),
    queryFn: () => api.get<ShortlistDetail>(`/shortlists/${shortlistId}`),
  });
  const action = useMutation({
    mutationFn: (name: 'rerun' | 'confirm') => api.post<{ id: string; status: string }>(`/shortlists/${shortlistId}/actions/${name}`),
    onSuccess: (res, name) => {
      setDialog(null);
      toast.success(name === 'rerun' ? t('shortlist.rerunDone') : t('shortlist.confirmed'));
      void qc.invalidateQueries({ queryKey: queryKeys.manage.challenge(id) });
      if (query.data) void qc.invalidateQueries({ queryKey: queryKeys.review.results(query.data.round.id) });
      if (res.id !== shortlistId) navigate(`/manage/challenges/${id}/shortlist/${res.id}`, { replace: true });
      else void qc.invalidateQueries({ queryKey: queryKeys.shortlists.detail(shortlistId) });
    },
    onError: (e) => {
      setDialog(null);
      toast.error(errorMessage(e));
    },
  });

  if (query.isLoading) return <PageSkeleton rows={6} />;
  if (isNotFound(query.error)) return <NotFoundPage />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data;
  const editable = data.can_manage && data.status === 'PROPOSED';
  const challengeTitle = tr(data.challenge.title_i18n);
  const setTab = (v: string) => setParams(v === 'feedback' ? { tab: 'feedback' } : {}, { replace: true });

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${t('shortlist.title')} — ${data.round.name}`}
        subtitle={`${t('shortlist.rule', { rule: data.rule?.text ?? '—' })} · ${t('shortlist.counts', {
          in: data.counts.IN,
          wait: data.counts.WAITLIST,
          out: data.counts.OUT,
        })}`}
        breadcrumbs={[
          { label: t('rounds.crumbManage'), to: '/manage/challenges' },
          { label: challengeTitle, to: `/manage/challenges/${id}` },
          { label: data.round.name, to: `/manage/challenges/${id}/rounds/${data.round.id}` },
          { label: t('shortlist.title') },
        ]}
        meta={<StatusBadge status={data.status} />}
        actions={
          data.can_manage && (
            <>
              {data.status === 'PROPOSED' && (
                <>
                  <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" aria-hidden />} onClick={() => setDialog('rerun')}>
                    {t('shortlist.rerun')}
                  </Button>
                  <Button icon={<ShieldCheck className="h-4 w-4" aria-hidden />} onClick={() => setDialog('confirm')}>
                    {t('shortlist.confirm')}
                  </Button>
                </>
              )}
              {data.status === 'CONFIRMED' && (
                <Button icon={<Send className="h-4 w-4" aria-hidden />} onClick={() => setDialog('publish')}>
                  {t('shortlist.publish')}
                </Button>
              )}
            </>
          )
        }
      />

      {!data.can_manage && <Callout tone="info">{t('shortlist.readOnly')}</Callout>}
      {data.status === 'CONFIRMED' && (
        <Callout tone="info">
          {t('shortlist.lockedConfirmed')}{' '}
          {data.confirmed_by && t('shortlist.confirmedBy', { name: data.confirmed_by, date: formatDateTime(data.confirmed_at) })}
        </Callout>
      )}
      {data.status === 'PUBLISHED' && (
        <Callout tone="success">
          {t('shortlist.lockedPublished')} {t('shortlist.published', { date: formatDateTime(data.published_at) })}
        </Callout>
      )}
      {data.can_manage && data.status !== 'PUBLISHED' && data.missing_feedback > 0 && (
        <Callout
          tone="warning"
          title={t('shortlist.checkFeedbackMissing', { count: data.missing_feedback })}
          action={
            <Button size="sm" variant="secondary" onClick={() => setTab('feedback')}>
              {t('shortlist.writeMissing')}
            </Button>
          }
        />
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'shortlist', label: t('shortlist.tabShortlist'), count: data.entries.length },
          ...(data.can_manage ? [{ value: 'feedback', label: t('shortlist.tabFeedback'), count: data.missing_feedback || undefined }] : []),
        ]}
      />

      {tab === 'feedback' ? (
        <FeedbackComposer roundId={data.round.id} shortlistId={data.id} canManage={data.can_manage} />
      ) : data.entries.length === 0 ? (
        <EmptyState
          title={t('shortlist.empty')}
          action={<ButtonLink to={`/manage/challenges/${id}/rounds/${data.round.id}`}>{t('rounds.title')}</ButtonLink>}
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="px-4 py-3 font-medium">{t('shortlist.rank')}</th>
                  <th className="px-2 py-3 font-medium">{t('shortlist.entry')}</th>
                  <th className="px-2 py-3 text-right font-medium">{t('shortlist.score')}</th>
                  <th className="px-2 py-3 font-medium">{t('shortlist.system')}</th>
                  <th className="px-2 py-3 font-medium">{t('shortlist.final')}</th>
                  <th className="px-2 py-3 font-medium">{t('shortlist.prototype')}</th>
                  <th className="px-4 py-3 font-medium">{t('shortlist.feedback')}</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((row) => (
                  <tr key={row.id} className="border-b border-line align-top last:border-0">
                    <td className="tabular px-4 py-3 font-semibold text-ink">{row.rank ?? '—'}</td>
                    <td className="px-2 py-3">
                      <p className="font-medium text-ink">{row.entry.title}</p>
                      <p className="text-xs text-ink-muted">
                        {row.entry.code}
                        {row.entry.entrant && ` · ${row.entry.entrant}`}
                      </p>
                      {row.is_override && (
                        <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span>{t('shortlist.overrideReason', { reason: row.override_reason ?? '' })}</span>
                        </p>
                      )}
                    </td>
                    <td className="tabular px-2 py-3 text-right font-medium text-ink">{row.final_score == null ? '—' : num(row.final_score, 1)}</td>
                    <td className="px-2 py-3">
                      <DecisionBadge value={row.system_decision} />
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <DecisionBadge value={row.final_decision} />
                        {row.is_override && (
                          <span title={t('shortlist.override')} className="text-warning">
                            <AlertTriangle className="h-4 w-4" aria-label={t('shortlist.override')} />
                          </span>
                        )}
                        {editable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t('shortlist.changeDecision')}: ${row.entry.title}`}
                            icon={<Pencil className="h-3.5 w-3.5" aria-hidden />}
                            onClick={() => setEditing({ row, kind: 'decision' })}
                          >
                            {t('common.edit')}
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {row.final_decision !== 'IN' ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <div className="space-y-1">
                          {editable && data.prototype_editable ? (
                            <Checkbox
                              label={t('shortlist.prototypeNeeded')}
                              checked={row.prototype_required}
                              onChange={() => setEditing({ row, kind: 'prototype' })}
                            />
                          ) : (
                            <span className={row.prototype_required ? 'font-medium text-ink' : 'text-ink-muted'}>
                              {row.prototype_required ? t('shortlist.prototypeNeeded') : t('shortlist.prototypeNotNeeded')}
                            </span>
                          )}
                          {row.prototype_required && row.prototype_reason && (
                            <p className="text-xs text-ink-muted">{t('shortlist.prototypeReason', { reason: row.prototype_reason })}</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.has_feedback ? (
                        <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}>
                          {t('shortlist.feedbackWritten')}
                        </Badge>
                      ) : (
                        <Badge tone="warning" icon={<CircleAlert className="h-3.5 w-3.5" aria-hidden />}>
                          {t('shortlist.feedbackMissing')}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.generated_at && (
            <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">{t('shortlist.generated', { date: formatDateTime(data.generated_at) })}</p>
          )}
        </Card>
      )}

      {editing?.kind === 'decision' && <DecisionDialog row={editing.row} shortlistId={data.id} onClose={() => setEditing(null)} />}
      {editing?.kind === 'prototype' && <PrototypeDialog row={editing.row} shortlistId={data.id} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={dialog === 'rerun'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('shortlist.rerunTitle')}
        description={t('shortlist.rerunBody')}
        confirmLabel={t('shortlist.rerun')}
        loading={action.isPending}
        onConfirm={() => action.mutate('rerun')}
      />
      <ConfirmDialog
        open={dialog === 'confirm'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('shortlist.confirmTitle')}
        description={t('shortlist.confirmBody')}
        confirmLabel={t('shortlist.confirm')}
        loading={action.isPending}
        onConfirm={() => action.mutate('confirm')}
      />
      {dialog === 'publish' && (
        <PublishDialog
          data={data}
          onClose={() => setDialog(null)}
          onWriteFeedback={() => {
            setDialog(null);
            setTab('feedback');
          }}
        />
      )}
    </div>
  );
}
