import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { Callout } from '@/components/domain';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Select, Skeleton, type Column } from '@/components/ui';
import { formatDateTime } from '@/utils/dates';
import { AddJudgesDialog } from './AddJudgesDialog';
import { QuickAddJudge, useStageLabel } from './QuickAdd';
import type { AddJudgesResult, ChallengeJudgeRow, ChallengeJudges, JudgeInviteRow } from './types';

export const judgesKey = (challengeId: string) => ['challenges', challengeId, 'judges'] as const;

export function StageBadges({ stages, all }: { stages: string[]; all: boolean }) {
  const { t } = useTranslation();
  if (all) return <Badge tone="success">{t('judging.allStages')}</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {stages.map((s) => (
        <Badge key={s} tone="info">
          {t(`judging.stage.${s}`, s)}
        </Badge>
      ))}
    </span>
  );
}

/** Judges of one challenge. Everyone who manages the challenge can look; only the admin can change. */
export function ChallengeJudgesTab({ challengeId, refresh }: { challengeId: string; refresh: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const stageLabel = useStageLabel();
  const [removing, setRemoving] = useState<ChallengeJudgeRow | null>(null);
  const list = useQuery({ queryKey: judgesKey(challengeId), queryFn: () => api.get<ChallengeJudges>(`/challenges/${challengeId}/judges`) });
  const reload = () => Promise.all([qc.invalidateQueries({ queryKey: judgesKey(challengeId) }), refresh()]);

  const remove = useMutation({
    mutationFn: () => api.del<{ kept_submitted_scores: boolean }>(`/challenges/${challengeId}/judges/${removing!.user.id}`),
    onSuccess: async (res) => {
      toast.success(res.kept_submitted_scores ? t('judging.removedKept') : t('judging.removed'));
      setRemoving(null);
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setStage = useMutation({
    mutationFn: (v: { userId: string; stages: string[] }) => api.patch(`/challenges/${challengeId}/judges/${v.userId}`, { stages: v.stages }),
    onSuccess: async () => {
      toast.success(t('judging.stagesSaved'));
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const share = useMutation({
    mutationFn: () => api.post<{ created: number }>(`/challenges/${challengeId}/judges/actions/share-out`),
    onSuccess: async (res) => {
      toast.success(res.created ? t('judging.shared', { count: res.created }) : t('judging.sharedNothing'));
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancelInvite = useMutation({
    mutationFn: (id: string) => api.del(`/judge-invites/${id}`),
    onSuccess: async () => {
      toast.success(t('judging.inviteCancelled'));
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (list.isLoading || !list.data) return <Skeleton className="h-40 w-full" />;
  const d = list.data;

  const columns: Column<ChallengeJudgeRow>[] = [
    {
      key: 'name',
      header: t('judging.col.judge'),
      sortValue: (r) => r.user.full_name,
      render: (r) => (
        <span>
          <span className="font-medium text-ink">{r.user.full_name}</span>
          <span className="block text-xs text-ink-muted">{[r.user.job_title, r.user.org_unit].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    {
      key: 'stages',
      header: t('judging.col.stages'),
      render: (r) => {
        if (!d.can_edit) return <StageBadges stages={r.stages} all={r.all_stages} />;
        // One dropdown list per judge. A judge with a mix of stages keeps that mix as an extra choice.
        const current = r.stages.join('+');
        const options = [{ value: '', label: t('judging.allStages') }, ...d.stages.filter((x) => x.in_challenge).map((x) => ({ value: x.code, label: stageLabel([x.code]) }))];
        if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: stageLabel(r.stages) });
        return (
          <Select
            aria-label={t('judging.changeStagesTitle', { name: r.user.full_name })}
            className="min-w-40"
            value={current}
            disabled={setStage.isPending}
            onChange={(e) => setStage.mutate({ userId: r.user.id, stages: e.target.value ? e.target.value.split('+') : [] })}
            options={options}
          />
        );
      },
    },
    {
      key: 'progress',
      header: t('judging.col.progress'),
      align: 'right',
      sortValue: (r) => r.assigned,
      render: (r) => <span className="tabular">{r.assigned ? t('judging.progress', { done: r.done, total: r.assigned }) : t('judging.nothingYet')}</span>,
    },
    ...(d.can_edit
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r: ChallengeJudgeRow) => (
              <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}>
                {t('common.remove')}
              </Button>
            ),
          } satisfies Column<ChallengeJudgeRow>,
        ]
      : []),
  ];

  const inviteColumns: Column<JudgeInviteRow>[] = [
    { key: 'email', header: t('judging.col.email'), render: (r) => <span className="font-medium text-ink">{r.email}</span> },
    { key: 'stages', header: t('judging.col.stages'), render: (r) => <StageBadges stages={r.stages} all={r.all_stages} /> },
    {
      key: 'expires',
      header: t('judging.col.expires'),
      render: (r) => (r.expired ? <Badge tone="warning">{t('judging.expired')}</Badge> : <span>{r.expires_at ? formatDateTime(r.expires_at) : '—'}</span>),
    },
    ...(d.can_edit
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r: JudgeInviteRow) => (
              <Button variant="ghost" size="sm" loading={cancelInvite.isPending && cancelInvite.variables === r.id} onClick={() => cancelInvite.mutate(r.id)}>
                {t('judging.cancelInvite')}
              </Button>
            ),
          } satisfies Column<JudgeInviteRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {!d.can_edit && <Callout tone="info">{t('judging.adminOnly')}</Callout>}
      <Card>
        <CardHeader
          title={t('judging.title')}
          subtitle={t('judging.subtitle')}
          actions={
            d.can_edit ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" icon={<Mail className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
                  {t('judging.inviteButton')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Share2 className="h-4 w-4" aria-hidden />}
                  loading={share.isPending}
                  disabled={d.judges.length === 0}
                  disabledReason={t('judging.addFirst')}
                  onClick={() => share.mutate()}
                >
                  {t('judging.shareNow')}
                </Button>
              </div>
            ) : undefined
          }
        />
        {d.can_edit && (
          <div className="mt-4 rounded-panel border border-line bg-canvas p-4">
            <QuickAddJudge
              stages={d.stages}
              excludeIds={d.judges.map((j) => j.user.id)}
              submit={(payload) => api.post<AddJudgesResult>(`/challenges/${challengeId}/judges`, payload)}
              onDone={() => void reload()}
            />
          </div>
        )}
        <div className="mt-4">
          {d.judges.length === 0 ? (
            <EmptyState title={t('judging.empty')} description={d.can_edit ? t('judging.emptyHelp') : undefined} />
          ) : (
            <DataTable columns={columns} rows={d.judges} rowKey={(r) => r.user.id} caption={t('judging.title')} />
          )}
        </div>
        <p className="mt-3 text-sm text-ink-muted">{t('judging.howItWorks')}</p>
      </Card>

      {d.invites.length > 0 && (
        <Card>
          <CardHeader title={t('judging.invitesTitle')} subtitle={t('judging.invitesHelp')} />
          <div className="mt-4">
            <DataTable columns={inviteColumns} rows={d.invites} rowKey={(r) => r.id} caption={t('judging.invitesTitle')} />
          </div>
        </Card>
      )}

      {adding && (
        <AddJudgesDialog
          title={t('judging.addTitle')}
          description={t('judging.addHelp')}
          stages={d.stages}
          excludeIds={d.judges.map((j) => j.user.id)}
          submit={(payload) => api.post<AddJudgesResult>(`/challenges/${challengeId}/judges`, payload)}
          onDone={() => void reload()}
          onClose={() => setAdding(false)}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('judging.removeTitle', { name: removing?.user.full_name ?? '' })}
        description={t('judging.removeHelp')}
        confirmLabel={t('common.remove')}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
