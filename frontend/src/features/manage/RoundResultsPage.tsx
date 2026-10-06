import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ListChecks, MessageSquareText, Scale } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  PageSkeleton,
  Select,
  Tabs,
  Textarea,
  isNotFound,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime } from '@/utils/dates';
import { num, statusLabel } from '@/utils/format';
import { tr } from '@/utils/i18n';
import type { RoundCriterion, RoundResultRow, RoundResults } from './evaluation/types';

/** One-hue heat-map cell: darker = higher average. The number is always printed. */
function HeatCell({ value, max = 5, flag }: { value: number | undefined; max?: number; flag?: boolean }) {
  if (value == null) return <span className="text-ink-muted">—</span>;
  return (
    <span className="relative inline-flex min-w-[3rem] justify-center overflow-hidden rounded-control border border-line px-2 py-1">
      <span className="absolute inset-0 bg-primary" style={{ opacity: Math.min(0.45, (value / max) * 0.45) }} aria-hidden />
      <span className="tabular relative font-medium text-ink">
        {num(value, 1)}
        {flag && <span className="ml-0.5 text-danger" aria-hidden>▾</span>}
      </span>
    </span>
  );
}

function DisagreementDialog({
  row,
  criteria,
  threshold,
  canManage,
  onClose,
  roundId,
}: {
  row: RoundResultRow;
  criteria: RoundCriterion[];
  threshold: number | null;
  canManage: boolean;
  onClose: () => void;
  roundId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [resolution, setResolution] = useState('SCORES_KEPT');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const marked = new Set(row.disagreement_criteria);
  const resolve = useMutation({
    mutationFn: () => api.post(`/round-results/${row.id}/resolve-discussion`, { resolution, note: note.trim() }),
    onSuccess: () => {
      toast.success(t('rounds.resolutionSaved'));
      void qc.invalidateQueries({ queryKey: queryKeys.review.results(roundId) });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const resolutionLabels: Record<string, string> = {
    SCORES_KEPT: t('rounds.resolutionKept'),
    SCORES_UPDATED: t('rounds.resolutionUpdated'),
    CHAIR_DECISION: t('rounds.resolutionChair'),
  };
  const canResolve = canManage && row.needs_discussion && !row.is_frozen;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={
        marked.size > 0
          ? t('rounds.disagreeTitle', { entry: row.entry ? `${row.entry.code} · ${row.entry.title}` : '' })
          : `${t('rounds.viewRatings')} — ${row.entry ? `${row.entry.code} · ${row.entry.title}` : ''}`
      }
      description={marked.size > 0 ? t('rounds.disagreeIntro', { threshold: num(threshold ?? 2) }) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          {canResolve && (
            <Button
              loading={resolve.isPending}
              onClick={() => {
                if (!note.trim()) return setError(t('rounds.noteRequired'));
                setError(null);
                resolve.mutate();
              }}
            >
              {t('rounds.recordResolution')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="py-2 pr-3 font-medium">{t('rounds.judge')}</th>
                {criteria.map((c) => (
                  <th key={c.code} className="px-2 py-2 text-center font-medium">
                    <span className={marked.has(c.code) ? 'font-semibold text-warning' : undefined}>
                      {marked.has(c.code) && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />}
                      {c.name}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">{t('rounds.total')}</th>
              </tr>
            </thead>
            <tbody>
              {row.reviews.map((r, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-ink">{r.reviewer ?? '—'}</p>
                    {r.status !== 'SUBMITTED' ? (
                      <p className="text-xs text-ink-muted">{t('rounds.pending')}</p>
                    ) : (
                      r.recommendation && <p className="text-xs text-ink-muted">{statusLabel(r.recommendation)}</p>
                    )}
                    {r.private_note && (
                      <p className="mt-1 text-xs text-ink-muted">
                        {t('rounds.privateNote')}: {r.private_note}
                      </p>
                    )}
                  </td>
                  {criteria.map((c) => (
                    <td
                      key={c.code}
                      className={`tabular px-2 py-2 text-center ${marked.has(c.code) ? 'bg-warning-soft font-semibold text-ink' : 'text-ink'}`}
                    >
                      {r.ratings[c.code] ?? '—'}
                    </td>
                  ))}
                  <td className="tabular px-2 py-2 text-right font-medium text-ink">
                    {r.weighted_score == null ? '—' : num(r.weighted_score, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {row.reviews.some((r) => r.comments && Object.keys(r.comments).length > 0) && (
          <div className="border-t border-line pt-4">
            <h4 className="text-sm font-medium text-ink">{t('rounds.judgeComments')}</h4>
            <div className="mt-2 space-y-3">
              {row.reviews.map((r, i) =>
                !r.comments || Object.keys(r.comments).length === 0 ? null : (
                  <div key={i} className="rounded-control border border-line p-3">
                    <p className="text-sm font-medium text-ink">{r.reviewer ?? '—'}</p>
                    <ul className="mt-1 space-y-1">
                      {Object.entries(r.comments).map(([code, comment]) => (
                        <li key={code} className="text-sm">
                          <span className="font-medium text-ink-muted">
                            {criteria.find((c) => c.code === code)?.name ?? code}:
                          </span>{' '}
                          <span className="text-ink">{comment}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          </div>
        )}

        {row.discussion_resolved && (
          <Callout tone="success" title={t('rounds.resolvedAs', { resolution: resolutionLabels[row.discussion_resolution ?? ''] ?? '' })}>
            {row.discussion_note}
          </Callout>
        )}

        {canResolve && (
          <div className="space-y-3 border-t border-line pt-4">
            <Field label={t('rounds.resolution')}>
              <Select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                options={Object.entries(resolutionLabels).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label={t('rounds.resolutionNote')} required help={t('rounds.resolutionNoteHelp')} error={error}>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default function RoundResultsPage() {
  const { t } = useTranslation();
  const { id = '', roundId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'raw' | 'normalized'>('raw');
  const [openRow, setOpenRow] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.review.results(roundId),
    queryFn: () => api.get<RoundResults>(`/review-rounds/${roundId}/results`),
  });
  const propose = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/review-rounds/${roundId}/shortlist/actions/propose`),
    onSuccess: (s) => {
      toast.success(t('rounds.proposed'));
      void qc.invalidateQueries({ queryKey: queryKeys.review.results(roundId) });
      void qc.invalidateQueries({ queryKey: queryKeys.manage.challenge(id) });
      navigate(`/manage/challenges/${id}/shortlist/${s.id}`);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      void qc.invalidateQueries({ queryKey: queryKeys.review.results(roundId) });
    },
  });

  if (query.isLoading) return <PageSkeleton rows={6} />;
  if (isNotFound(query.error)) return <NotFoundPage />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data;
  const { round, criteria, results } = data;
  const challengeTitle = data.challenge ? tr(data.challenge.title_i18n) : '';
  const dialogRow = results.find((r) => r.id === openRow) ?? null;
  const frozen = results.some((r) => r.is_frozen);
  const isFinal = round.round_type === 'FINAL_JURY';
  const criterionName = (code: string) => criteria.find((c) => c.code === code)?.name ?? statusLabel(code);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${t('rounds.title')} — ${round.name}`}
        subtitle={challengeTitle}
        breadcrumbs={[
          { label: t('rounds.crumbManage'), to: '/manage/challenges' },
          { label: challengeTitle, to: `/manage/challenges/${id}` },
          { label: round.name },
        ]}
        meta={<StatusBadge status={round.status} />}
        actions={
          <>
            {data.shortlist && (
              <ButtonLink
                to={`/manage/challenges/${id}/shortlist/${data.shortlist.id}`}
                variant="secondary"
                icon={<ListChecks className="h-4 w-4" aria-hidden />}
              >
                {t('rounds.openShortlist')}
              </ButtonLink>
            )}
            {isFinal && (
              <ButtonLink to={`/manage/challenges/${id}/results`} variant="secondary">
                {t('resultsDecision.title')}
              </ButtonLink>
            )}
            {data.can_manage && !isFinal && !data.shortlist && (
              <Button
                onClick={() => propose.mutate()}
                loading={propose.isPending}
                disabled={!data.can_propose}
                disabledReason={data.propose_blockers.join(' ')}
              >
                {t('rounds.propose')}
              </Button>
            )}
          </>
        }
      />

      {!data.can_manage && <Callout tone="info">{t('rounds.readOnly')}</Callout>}
      {data.can_manage && !isFinal && !data.shortlist && data.propose_blockers.length > 0 && (
        <Callout tone="warning" title={t('rounds.blockedBecause')}>
          <ul className="list-disc pl-5">
            {data.propose_blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Callout>
      )}
      {frozen && <Callout tone="info">{t('rounds.frozen')}</Callout>}

      <Card>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-ink-muted">{t('rounds.rule')}</dt>
            <dd className="font-medium text-ink">{data.rule.text}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">{t('rounds.aggregation')}</dt>
            <dd className="font-medium text-ink">{statusLabel(round.aggregation_method)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">{t('rounds.due')}</dt>
            <dd className="font-medium text-ink">{formatDateTime(round.due_at)}</dd>
          </div>
          {data.shortlist && (
            <div>
              <dt className="text-ink-muted">{t('shortlist.title')}</dt>
              <dd>
                <StatusBadge status={data.shortlist.status} />
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <CardHeader title={t('rounds.title')} subtitle={t('rounds.heatHelp')} />
          <Tabs
            ariaLabel={t('rounds.scoreMode')}
            value={mode}
            onChange={(v) => setMode(v as 'raw' | 'normalized')}
            tabs={[
              { value: 'raw', label: t('rounds.raw') },
              { value: 'normalized', label: t('rounds.normalized') },
            ]}
          />
        </div>
        {results.length === 0 ? (
          <EmptyState
            icon={<Scale className="h-8 w-8" aria-hidden />}
            title={t('rounds.empty')}
            description={t('rounds.emptyHelp')}
            action={<ButtonLink to={`/manage/challenges/${id}`}>{t('rounds.backToChallenge')}</ButtonLink>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="px-4 py-3 font-medium">{t('rounds.rank')}</th>
                  <th className="px-2 py-3 font-medium">{t('rounds.entry')}</th>
                  <th className="px-2 py-3 text-right font-medium">
                    {mode === 'raw' ? t('rounds.finalScore') : t('rounds.normScore')}
                  </th>
                  {criteria.map((c) => (
                    <th key={c.code} className="px-2 py-3 text-center font-medium">
                      <span className="block max-w-[7rem] truncate" title={c.name}>
                        {c.name}
                      </span>
                      <span className="tabular block text-xs font-normal">
                        {num(c.weight_pct)}%{c.min_rating != null && ` · min ${num(c.min_rating)}`}
                      </span>
                    </th>
                  ))}
                  <th className="px-2 py-3 text-center font-medium">{t('rounds.reviews')}</th>
                  <th className="px-4 py-3 font-medium">{t('rounds.flags')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const incomplete = r.reviews_completed < r.reviews_expected;
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="tabular px-4 py-3 font-semibold text-ink">{r.rank ?? '—'}</td>
                      <td className="px-2 py-3">
                        <p className="font-medium text-ink">{r.entry?.title ?? '—'}</p>
                        <p className="text-xs text-ink-muted">
                          {r.entry?.code}
                          {r.entry?.entrant && ` · ${r.entry.entrant}`}
                        </p>
                      </td>
                      <td className="tabular px-2 py-3 text-right">
                        {r.final_score == null ? (
                          <span className="text-ink-muted">{t('rounds.notScored')}</span>
                        ) : mode === 'raw' ? (
                          <>
                            <span className="text-base font-semibold text-ink">{num(r.final_score, 1)}</span>
                            {r.raw_score != null && r.raw_score !== r.final_score && (
                              <span className="block text-xs text-ink-muted">
                                {t('rounds.rawScore')} {num(r.raw_score, 1)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-base font-semibold text-ink">
                            {r.normalized_score == null ? '—' : `${r.normalized_score > 0 ? '+' : ''}${num(r.normalized_score, 2)}`}
                          </span>
                        )}
                      </td>
                      {criteria.map((c) => (
                        <td key={c.code} className="px-2 py-3 text-center">
                          <HeatCell value={r.criterion_averages[c.code]} flag={r.failed_gates.includes(c.code)} />
                        </td>
                      ))}
                      <td className="tabular px-2 py-3 text-center">
                        <span className={incomplete ? 'font-medium text-warning' : 'text-ink'}>
                          {r.reviews_completed}/{r.reviews_expected}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          {r.failed_gates.length > 0 && (
                            <Badge tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}>
                              {t('rounds.failedMinimumFor', { criteria: r.failed_gates.map(criterionName).join(', ') })}
                            </Badge>
                          )}
                          {r.needs_discussion && (
                            <Badge tone="warning" icon={<MessageSquareText className="h-3.5 w-3.5" aria-hidden />}>
                              {t('rounds.judgesDisagree')}
                            </Badge>
                          )}
                          {r.discussion_resolved && (
                            <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}>
                              {t('rounds.resolved')}
                            </Badge>
                          )}
                          {r.reviews.length > 0 && (
                            <Button size="sm" variant={r.needs_discussion ? 'secondary' : 'ghost'} onClick={() => setOpenRow(r.id)}>
                              {t('rounds.viewRatings')}
                            </Button>
                          )}
                          {r.failed_gates.length === 0 && !r.needs_discussion && !r.discussion_resolved && r.reviews.length === 0 && (
                            <span className="text-ink-muted">{t('rounds.noFlags')}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialogRow && (
        <DisagreementDialog
          row={dialogRow}
          criteria={criteria}
          threshold={round.disagreement_threshold}
          canManage={data.can_manage}
          roundId={roundId}
          onClose={() => setOpenRow(null)}
        />
      )}
    </div>
  );
}
