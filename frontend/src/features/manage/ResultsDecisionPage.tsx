import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, Send, ShieldCheck, Trophy, UserCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError, api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
  isNotFound,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/dates';
import { money, num } from '@/utils/format';
import { tr } from '@/utils/i18n';
import type { I18nText } from './evaluation/types';

type Result = '' | 'WINNER' | 'RUNNER_UP';
interface DecisionState {
  result: Result;
  rank: number;
  award_category_id: string;
  decision_note: string;
}
interface ResultEntry {
  entry_id: string;
  code: string;
  title: string;
  status_code: string;
  entrant: string | null;
  jury_score: number | null;
  jury_rank: number | null;
  reviews_completed: number;
  reviews_expected: number;
  has_working_evidence: boolean;
  converted_initiative_code?: string | null;
  decision: { rank: number; result: 'WINNER' | 'RUNNER_UP'; award_category_id: string | null; decision_note: string | null } | null;
}
interface Prize {
  rank_from: number;
  rank_to: number;
  prize_type: string;
  amount: number | null;
  description: string;
  currency_code: string;
}
interface ResultsWorkspace {
  challenge: { id: string; code: string; title_i18n: I18nText; status_code: string; slug: string };
  round: { id: string; name: string; status: string } | null;
  entries: ResultEntry[];
  pending_reviews: number;
  status: 'NONE' | 'DRAFT' | 'APPROVED' | 'PUBLISHED';
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  prizes: Prize[];
  award_categories: { id: string; code: string; name: string }[];
  can_manage: boolean;
}

const blank = (e: ResultEntry, i: number): DecisionState => ({
  result: e.decision?.result ?? '',
  rank: e.decision?.rank ?? e.jury_rank ?? i + 1,
  award_category_id: e.decision?.award_category_id ?? '',
  decision_note: e.decision?.decision_note ?? '',
});

export default function ResultsDecisionPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, DecisionState>>({});
  const [dialog, setDialog] = useState<'approve' | 'publish' | null>(null);
  const [converted, setConverted] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: queryKeys.manage.results(id),
    queryFn: () => api.get<ResultsWorkspace>(`/manage/challenges/${id}/results`),
  });
  const data = query.data;
  const initial = useMemo(
    () => Object.fromEntries((data?.entries ?? []).map((e, i) => [e.entry_id, blank(e, i)])) as Record<string, DecisionState>,
    [data],
  );
  useEffect(() => setForm(initial), [initial]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.manage.results(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.manage.challenge(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.results });
  };
  const save = useMutation({
    mutationFn: () =>
      api.put(`/manage/challenges/${id}/results/decisions`, {
        decisions: Object.entries(form)
          .filter(([, d]) => d.result)
          .map(([entry_id, d]) => ({
            entry_id,
            rank: d.rank,
            result: d.result,
            award_category_id: d.award_category_id || null,
            decision_note: d.decision_note.trim() || null,
          })),
      }),
    onSuccess: () => {
      toast.success(t('resultsDecision.saved'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const act = useMutation({
    mutationFn: (name: 'approve' | 'publish') => api.post(`/manage/challenges/${id}/results/actions/${name}`),
    onSuccess: (_r, name) => {
      setDialog(null);
      toast.success(name === 'approve' ? t('resultsDecision.approved') : t('resultsDecision.publishedToast'));
      refresh();
    },
    onError: (e) => {
      setDialog(null);
      toast.error(errorMessage(e));
    },
  });
  const convert = useMutation({
    mutationFn: (entryId: string) => api.post<{ code: string }>(`/entries/${entryId}/actions/convert-to-initiative`),
    onSuccess: (res, entryId) => {
      setConverted((c) => ({ ...c, [entryId]: res.code }));
      toast.success(t('resultsDecision.continued', { code: res.code }));
      void qc.invalidateQueries({ queryKey: queryKeys.ideas.all });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError && e.code === 'ALREADY_CONVERTED' ? t('resultsDecision.alreadyContinued') : errorMessage(e)),
  });

  if (query.isLoading) return <PageSkeleton rows={6} />;
  if (isNotFound(query.error)) return <NotFoundPage />;
  if (query.isError || !data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const published = data.status === 'PUBLISHED';
  const editable = data.can_manage && !published;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const chosen = data.entries
    .map((e) => ({ e, d: form[e.entry_id] }))
    .filter((x) => x.d?.result)
    .sort((a, b) => a.d.rank - b.d.rank);
  const hasWinner = chosen.some((x) => x.d.result === 'WINNER');
  const evidenceProblem = chosen.some((x) => x.d.result === 'WINNER' && !x.e.has_working_evidence);
  const challengeTitle = tr(data.challenge.title_i18n);
  const categoryName = (cid: string) => data.award_categories.find((c) => c.id === cid)?.name;
  const prizeFor = (rank: number) => data.prizes.find((p) => p.rank_from <= rank && rank <= p.rank_to);
  const update = (entryId: string, patch: Partial<DecisionState>) => setForm((f) => ({ ...f, [entryId]: { ...f[entryId], ...patch } }));
  const steps: [string, boolean, boolean][] = [
    [t('resultsDecision.stepRecord'), data.status !== 'NONE', data.status === 'NONE'],
    [t('resultsDecision.stepApprove'), data.status === 'APPROVED' || published, data.status === 'DRAFT'],
    [t('resultsDecision.stepPublish'), published, data.status === 'APPROVED'],
  ];

  const winnersPreview = (
    <ul className="space-y-3">
      {chosen.map(({ e, d }) => {
        const prize = prizeFor(d.rank);
        return (
          <li key={e.entry_id} className="rounded-panel border border-spark bg-spark-soft p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="spark" icon={<Trophy className="h-3.5 w-3.5" aria-hidden />}>
                {d.result === 'WINNER' ? t('resultsDecision.winner') : t('resultsDecision.runnerUp')} · #{d.rank}
              </Badge>
              {d.award_category_id && <span className="text-sm text-ink-muted">{categoryName(d.award_category_id)}</span>}
            </div>
            <p className="mt-2 font-semibold text-ink">{e.title}</p>
            <p className="text-sm text-ink-muted">{e.entrant}</p>
            {prize && (
              <p className="mt-1 text-sm text-ink">
                {prize.description}
                {prize.amount != null && ` · ${money(prize.amount, prize.currency_code)}`}
              </p>
            )}
            {published && data.can_manage && d.result === 'WINNER' && (
              <div className="mt-3">
                {(converted[e.entry_id] ?? e.converted_initiative_code) ? (
                  <Link className="inline-flex items-center gap-1 font-medium text-primary underline" to={`/ideas/${converted[e.entry_id] ?? e.converted_initiative_code}`}>
                    {t('resultsDecision.openIdea', { code: converted[e.entry_id] ?? e.converted_initiative_code })}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={convert.isPending && convert.variables === e.entry_id}
                    onClick={() => convert.mutate(e.entry_id)}
                  >
                    {t('resultsDecision.continue')}
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('resultsDecision.title')}
        subtitle={challengeTitle}
        breadcrumbs={[
          { label: t('rounds.crumbManage'), to: '/manage/challenges' },
          { label: challengeTitle, to: `/manage/challenges/${id}` },
          { label: t('resultsDecision.title') },
        ]}
        meta={<StatusBadge status={data.challenge.status_code} />}
        actions={
          data.can_manage &&
          !published && (
            <>
              <Button
                variant={data.status === 'NONE' || dirty ? 'primary' : 'secondary'}
                loading={save.isPending}
                disabled={!hasWinner || evidenceProblem || (!dirty && data.status !== 'NONE')}
                disabledReason={!hasWinner ? t('resultsDecision.needWinner') : evidenceProblem ? t('resultsDecision.evidenceRule') : undefined}
                onClick={() => save.mutate()}
              >
                {t('resultsDecision.save')}
              </Button>
              {data.status === 'DRAFT' && (
                <Button
                  icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
                  disabled={dirty}
                  disabledReason={t('resultsDecision.unsaved')}
                  onClick={() => setDialog('approve')}
                >
                  {t('resultsDecision.approve')}
                </Button>
              )}
              {data.status === 'APPROVED' && (
                <Button
                  icon={<Send className="h-4 w-4" aria-hidden />}
                  disabled={dirty}
                  disabledReason={t('resultsDecision.unsaved')}
                  onClick={() => setDialog('publish')}
                >
                  {t('resultsDecision.publish')}
                </Button>
              )}
            </>
          )
        }
      />

      <Callout tone="info" title={t(`resultsDecision.status${data.status}`)}>
        <span className="inline-flex items-start gap-2">
          <UserCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t('resultsDecision.humanNote')}
        </span>
      </Callout>

      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map(([label, done, current]) => (
          <li
            key={label}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-panel border px-3 py-2 text-sm',
              current ? 'border-primary bg-primary-soft font-medium text-ink' : 'border-line bg-surface text-ink-muted',
            )}
          >
            {done && <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />}
            {label}
          </li>
        ))}
      </ol>

      {!data.can_manage && <Callout tone="info">{t('resultsDecision.readOnly')}</Callout>}
      {published && (
        <Callout tone="success">
          {t('resultsDecision.publishedOn', { date: formatDateTime(data.published_at) })} · {t('resultsDecision.locked')}
        </Callout>
      )}
      {!published && data.approved_at && data.approved_by && (
        <Callout tone="success">{t('resultsDecision.approvedBy', { name: data.approved_by, date: formatDateTime(data.approved_at) })}</Callout>
      )}
      {!published && data.pending_reviews > 0 && (
        <Callout
          tone="warning"
          action={
            data.round && (
              <ButtonLink size="sm" variant="secondary" to={`/manage/challenges/${id}/rounds/${data.round.id}`}>
                {t('rounds.title')}
              </ButtonLink>
            )
          }
        >
          {t('resultsDecision.pendingReviews', { count: data.pending_reviews })}
        </Callout>
      )}

      {data.entries.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-8 w-8" aria-hidden />}
          title={t('resultsDecision.empty')}
          description={t('resultsDecision.emptyHelp')}
          action={<ButtonLink to={`/manage/challenges/${id}`}>{t('rounds.backToChallenge')}</ButtonLink>}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            {data.entries.map((e) => {
              const d = form[e.entry_id];
              if (!d) return null;
              const noEvidenceWinner = d.result === 'WINNER' && !e.has_working_evidence;
              return (
                <Card key={e.entry_id} className={d.result ? 'border-spark' : undefined}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-ink-muted">
                        {t('resultsDecision.juryRank')} <span className="tabular font-semibold text-ink">{e.jury_rank ?? '—'}</span> · {e.code}
                      </p>
                      <p className="font-semibold text-ink">{e.title}</p>
                      <p className="text-sm text-ink-muted">{e.entrant}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-2xl font-semibold text-ink">{e.jury_score == null ? '—' : num(e.jury_score, 1)}</p>
                      <p className="text-xs text-ink-muted">
                        {t('resultsDecision.juryScore')} · {t('resultsDecision.reviews')}{' '}
                        <span className={cn('tabular', e.reviews_completed < e.reviews_expected && 'font-medium text-warning')}>
                          {e.reviews_completed}/{e.reviews_expected}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-2">
                    {e.has_working_evidence ? (
                      <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}>
                        {t('resultsDecision.evidence')}: {t('resultsDecision.evidenceYes')}
                      </Badge>
                    ) : (
                      <Badge tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}>
                        {t('resultsDecision.evidenceNo')}
                      </Badge>
                    )}
                  </div>
                  {editable ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Field label={t('resultsDecision.result')} error={noEvidenceWinner ? t('resultsDecision.evidenceRule') : null}>
                        <Select
                          value={d.result}
                          onChange={(ev) => update(e.entry_id, { result: ev.target.value as Result })}
                          options={[
                            { value: '', label: t('resultsDecision.none') },
                            { value: 'WINNER', label: t('resultsDecision.winner') },
                            { value: 'RUNNER_UP', label: t('resultsDecision.runnerUp') },
                          ]}
                        />
                      </Field>
                      {d.result && (
                        <>
                          <Field label={t('resultsDecision.rank')}>
                            <Input
                              type="number"
                              min={1}
                              value={d.rank}
                              onChange={(ev) => update(e.entry_id, { rank: Math.max(1, Number(ev.target.value) || 1) })}
                            />
                          </Field>
                          <Field label={t('resultsDecision.category')}>
                            <Select
                              value={d.award_category_id}
                              onChange={(ev) => update(e.entry_id, { award_category_id: ev.target.value })}
                              options={[
                                { value: '', label: t('resultsDecision.noCategory') },
                                ...data.award_categories.map((c) => ({ value: c.id, label: c.name })),
                              ]}
                            />
                          </Field>
                          <Field label={t('resultsDecision.note')}>
                            <Input
                              value={d.decision_note}
                              placeholder={t('resultsDecision.notePlaceholder')}
                              onChange={(ev) => update(e.entry_id, { decision_note: ev.target.value })}
                            />
                          </Field>
                        </>
                      )}
                    </div>
                  ) : (
                    e.decision && (
                      <p className="mt-3 text-sm text-ink">
                        <Badge tone="spark" icon={<Trophy className="h-3.5 w-3.5" aria-hidden />}>
                          {e.decision.result === 'WINNER' ? t('resultsDecision.winner') : t('resultsDecision.runnerUp')} · #{e.decision.rank}
                        </Badge>{' '}
                        {e.decision.award_category_id && categoryName(e.decision.award_category_id)}
                        {e.decision.decision_note && <span className="mt-1 block text-ink-muted">{e.decision.decision_note}</span>}
                      </p>
                    )
                  )}
                </Card>
              );
            })}
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title={published ? t('resultsDecision.winners') : t('resultsDecision.preview')} subtitle={t('resultsDecision.previewNote')} />
              {chosen.length === 0 ? <p className="text-sm text-ink-muted">{t('resultsDecision.needWinner')}</p> : winnersPreview}
            </Card>
            <Card>
              <CardHeader title={t('resultsDecision.prizes')} />
              {data.prizes.length === 0 ? (
                <p className="text-sm text-ink-muted">—</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.prizes.map((p) => (
                    <li key={`${p.rank_from}-${p.rank_to}`} className="flex justify-between gap-3">
                      <span className="text-ink">
                        <span className="text-ink-muted">
                          {p.rank_from === p.rank_to
                            ? t('resultsDecision.prizeRank', { from: p.rank_from })
                            : t('resultsDecision.prizeRankRange', { from: p.rank_from, to: p.rank_to })}
                          :{' '}
                        </span>
                        {p.description}
                      </span>
                      <span className="tabular shrink-0 font-medium text-ink">{p.amount != null ? money(p.amount, p.currency_code) : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('resultsDecision.approveTitle')}
        description={t('resultsDecision.approveBody')}
        confirmLabel={t('resultsDecision.approve')}
        loading={act.isPending}
        onConfirm={() => act.mutate('approve')}
      />
      <Dialog
        open={dialog === 'publish'}
        onOpenChange={(o) => !o && setDialog(null)}
        size="lg"
        title={t('resultsDecision.publishTitle')}
        description={t('resultsDecision.publishBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button icon={<Send className="h-4 w-4" aria-hidden />} loading={act.isPending} onClick={() => act.mutate('publish')}>
              {t('resultsDecision.publish')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="font-semibold text-ink">{t('resultsDecision.preview')}</p>
          <p className="text-sm text-ink-muted">{t('resultsDecision.previewNote')}</p>
          {winnersPreview}
        </div>
      </Dialog>
    </div>
  );
}
