import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  PageSkeleton,
  Select,
  Stat,
  Tabs,
  Textarea,
  type Column,
  type Tone,
} from '@/components/ui';
import { formatDateTime } from '@/utils/dates';
import { tr } from '@/utils/i18n';
import type { QueueItem, QueueResponse } from './types';

const REASONS = ['SAME_TEAM', 'MANAGER', 'DIRECT_REPORT', 'FAMILY', 'OTHER'];
const STATUS: Record<string, { key: string; tone: Tone }> = {
  ASSIGNED: { key: 'review.notStarted', tone: 'neutral' },
  IN_PROGRESS: { key: 'review.inProgress', tone: 'warning' },
  SUBMITTED: { key: 'review.submitted', tone: 'success' },
};

export default function ReviewQueuePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<QueueItem | null>(null);
  const [reason, setReason] = useState('OTHER');
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'challenge' | 'idea'>('challenge');
  const [challenge, setChallenge] = useState('');
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('');

  const query = useQuery({ queryKey: queryKeys.review.queue, queryFn: () => api.get<QueueResponse>('/me/review-queue') });

  const declare = useMutation({
    mutationFn: (item: QueueItem) => api.post(`/review-assignments/${item.id}/actions/declare-conflict`, { reason, note }),
    onSuccess: () => {
      toast.success(t('review.conflictDone'));
      setConflict(null);
      setNote('');
      setReason('OTHER');
      void qc.invalidateQueries({ queryKey: queryKeys.review.queue });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const all = useMemo(() => query.data?.items ?? [], [query.data]);
  const ofTab = useMemo(() => all.filter((i) => (tab === 'idea' ? i.entity.type === 'initiative' : i.entity.type !== 'initiative')), [all, tab]);
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  const challengeOptions = unique(ofTab.map((i) => tr(i.entity.context_i18n, i.entity.context)));
  const stageOptions = unique(ofTab.map((i) => i.round_name));
  const state = (i: QueueItem) => (i.status !== 'SUBMITTED' && i.overdue_days > 0 ? 'OVERDUE' : i.status);
  const shown = ofTab.filter(
    (i) =>
      (!challenge || tr(i.entity.context_i18n, i.entity.context) === challenge) &&
      (!stage || i.round_name === stage) &&
      (!status || state(i) === status || (status === 'ASSIGNED' && i.status === 'ASSIGNED')),
  );
  const count = (kind: 'challenge' | 'idea') =>
    all.filter((i) => (kind === 'idea' ? i.entity.type === 'initiative' : i.entity.type !== 'initiative') && i.status !== 'SUBMITTED').length;

  if (query.isLoading) return <PageSkeleton rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { summary } = query.data!;

  const open = (r: QueueItem) => (r.kpi ? `/review/kpi/${r.id}` : r.gate ? `/review/decision/${r.id}` : `/review/${r.id}`);
  const columns: Column<QueueItem>[] = [
    {
      key: 'code',
      header: t('review.colCode'),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          {r.blind && <EyeOff className="h-3.5 w-3.5 text-ink-muted" aria-label={t('review.blind')} />}
          {r.entity.code ?? '—'}
        </span>
      ),
    },
    {
      key: 'title',
      header: t('review.colTitle'),
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {r.entity.title}
          {r.entity.confidential && (
            <Badge tone="danger" icon={<Lock className="h-3 w-3" />}>
              {t('review.confidential')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'challenge',
      header: t('review.colChallenge'),
      render: (r) => (r.entity.type === 'initiative' ? t('review.openIdea') : tr(r.entity.context_i18n, r.entity.context)),
      hideOnMobile: true,
    },
    { key: 'round', header: t('review.colRound'), render: (r) => (r.gate || r.kpi ? <Badge tone="spark">{r.round_name}</Badge> : r.round_name) },
    {
      key: 'due',
      header: t('review.colDue'),
      sortValue: (r) => r.due_at,
      render: (r) => (
        <span>
          <span className="tabular">{r.due_at ? formatDateTime(r.due_at) : '—'}</span>
          {r.overdue_days > 0 && (
            <span className="block text-sm font-medium text-danger">{t('review.daysOverdue', { count: r.overdue_days })}</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('review.colStatus'),
      render: (r) => {
        const s = STATUS[r.status] ?? STATUS.ASSIGNED;
        return <Badge tone={s.tone}>{t(s.key)}</Badge>;
      },
    },
    {
      key: 'action',
      header: t('review.colAction'),
      align: 'right',
      render: (r) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {r.status !== 'SUBMITTED' && !r.gate && !r.kpi && (
            <Button
              variant="ghost"
              size="sm"
              icon={<ShieldAlert className="h-4 w-4" />}
              aria-label={t('review.conflictAction')}
              title={t('review.conflictAction')}
              onClick={() => setConflict(r)}
            />
          )}
          <ButtonLink to={open(r)} size="sm" variant={r.status === 'SUBMITTED' ? 'secondary' : 'primary'}>
            {r.status === 'SUBMITTED' ? t('review.view') : r.gate || r.kpi ? t('gates.decide') : r.status === 'IN_PROGRESS' ? t('review.continue') : t('review.start')}
          </ButtonLink>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('review.queueTitle')} subtitle={t('review.queueSubtitle')} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('review.dueToday')} value={summary.due_today} tone={summary.due_today ? 'warning' : undefined} />
        <Stat label={t('review.dueThisWeek')} value={summary.due_this_week} />
        <Stat label={t('review.overdue')} value={summary.overdue} tone={summary.overdue ? 'danger' : undefined} />
        <Stat label={t('review.done')} value={summary.done} tone="success" />
      </div>

      <Tabs
        ariaLabel={t('review.queueTitle')}
        value={tab}
        onChange={(v) => {
          setTab(v === 'idea' ? 'idea' : 'challenge');
          setChallenge('');
          setStage('');
        }}
        tabs={[
          { value: 'challenge', label: t('review.tabChallenge'), count: count('challenge') },
          { value: 'idea', label: t('review.tabIdea'), count: count('idea') },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tab === 'challenge' && (
          <Field label={t('review.colChallenge')}>
            <Select value={challenge} onChange={(e) => setChallenge(e.target.value)} placeholder={t('review.filterAllChallenges')} options={challengeOptions.map((c) => ({ value: c, label: c }))} />
          </Field>
        )}
        {tab === 'challenge' && (
          <Field label={t('review.colRound')}>
            <Select value={stage} onChange={(e) => setStage(e.target.value)} placeholder={t('review.filterAllStages')} options={stageOptions.map((s) => ({ value: s, label: s }))} />
          </Field>
        )}
        <Field label={t('review.colStatus')}>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder={t('review.filterAllStatuses')}
            options={[
              { value: 'ASSIGNED', label: t('review.notStarted') },
              { value: 'IN_PROGRESS', label: t('review.inProgress') },
              { value: 'OVERDUE', label: t('review.overdue') },
              { value: 'SUBMITTED', label: t('review.submitted') },
            ]}
          />
        </Field>
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck className="h-8 w-8" />}
            title={ofTab.length === 0 ? (tab === 'idea' ? t('review.emptyIdea') : t('review.emptyChallenge')) : t('review.emptyFiltered')}
            description={ofTab.length === 0 ? t('review.emptyHint') : undefined}
          />
        </Card>
      ) : (
        <DataTable
          columns={tab === 'idea' ? columns.filter((c) => c.key !== 'challenge') : columns}
          rows={shown}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(open(r))}
          rowClassName={(r) => (r.overdue_days > 0 ? 'bg-danger-soft/40' : undefined)}
          caption={t('review.queueTitle')}
        />
      )}

      <ConfirmDialog
        open={!!conflict}
        onOpenChange={(o) => !o && setConflict(null)}
        title={t('review.conflictTitle')}
        description={t('review.conflictBody')}
        confirmLabel={t('review.conflictConfirm')}
        variant="danger"
        loading={declare.isPending}
        onConfirm={() => conflict && declare.mutate(conflict)}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">
            {conflict?.entity.code} · {conflict?.entity.title}
          </p>
          <Field label={t('review.conflictReason')} required>
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              options={REASONS.map((r) => ({ value: r, label: t(`review.reason.${r}`) }))}
            />
          </Field>
          <Field label={t('review.conflictNote')}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
