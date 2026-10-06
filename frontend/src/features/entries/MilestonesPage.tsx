import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import {
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
  isNotFound,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  Select,
  Textarea,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDate, formatDateTime } from '@/utils/dates';
import type { EntryDetail, MilestoneRow, MilestonesData } from './types';

const STATUSES = ['PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED'] as const;
const BUILD_STATES = ['SHORTLISTED', 'BUILDING', 'PROTOTYPE_SUBMITTED', 'PROTOTYPE_REVIEWED', 'FINALIST', 'FINAL_SUBMITTED'];

export default function MilestonesPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = queryKeys.entries.milestones(id);

  const entry = useQuery({ queryKey: queryKeys.entries.detail(id), queryFn: () => api.get<EntryDetail>(`/entries/${id}`), enabled: !!id });
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<MilestonesData>('/milestones', { entity_type: 'challenge_entry', entity_id: id }),
    enabled: !!id,
  });

  const teamId = entry.data?.is_member ? entry.data.team?.id : undefined;
  const team = useQuery({
    queryKey: queryKeys.teams.detail(teamId ?? ''),
    queryFn: () => api.get<{ members: Array<{ user_id: string; full_name: string }> }>(`/teams/${teamId}`),
    enabled: !!teamId,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', due_date: '', owner_user_id: '' });
  const [titleError, setTitleError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<MilestoneRow | null>(null);
  const [update, setUpdate] = useState({ update_text: '', percent_complete: '', blockers: '', help_needed: '' });
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [notShortlisted, setNotShortlisted] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: queryKeys.entries.detail(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.entries.mine });
    void qc.invalidateQueries({ queryKey: queryKeys.home });
  };
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'NOT_SHORTLISTED') setNotShortlisted(true);
    toast.error(errorMessage(e));
  };

  const add = useMutation({
    mutationFn: () =>
      api.post('/milestones', {
        entity_type: 'challenge_entry',
        entity_id: id,
        title: draft.title.trim(),
        due_date: draft.due_date || null,
        owner_user_id: draft.owner_user_id || null,
        status: 'PLANNED',
      }),
    onSuccess: () => {
      toast.success(t('entries.milestoneAdded'));
      setAddOpen(false);
      setDraft({ title: '', due_date: '', owner_user_id: '' });
      refresh();
    },
    onError,
  });
  const patch = useMutation({
    mutationFn: ({ mid, body }: { mid: string; body: Record<string, unknown> }) => api.patch(`/milestones/${mid}`, body),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (mid: string) => api.del(`/milestones/${mid}`),
    onSuccess: () => {
      toast.success(t('entries.milestoneRemoved'));
      setToDelete(null);
      refresh();
    },
    onError,
  });
  const post = useMutation({
    mutationFn: () =>
      api.post('/progress-updates', {
        entity_type: 'challenge_entry',
        entity_id: id,
        update_text: update.update_text.trim(),
        percent_complete: Math.max(0, Math.min(100, Number(update.percent_complete) || 0)),
        blockers: update.blockers.trim() || null,
        help_needed: update.help_needed.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('entries.updatePosted'));
      setUpdate({ update_text: '', percent_complete: '', blockers: '', help_needed: '' });
      refresh();
    },
    onError,
  });

  if (q.isLoading || entry.isLoading) return <PageSkeleton rows={5} />;
  if (isNotFound(q.error) || isNotFound(entry.error)) return <NotFoundPage />;
  if (q.isError || entry.isError || !q.data || !entry.data)
    return <ErrorState error={q.error ?? entry.error} onRetry={() => { void q.refetch(); void entry.refetch(); }} />;

  const e = entry.data;
  const ms = q.data.milestones;
  const canEdit = e.is_member && BUILD_STATES.includes(e.status_code) && !notShortlisted;
  const locked = !BUILD_STATES.includes(e.status_code) || notShortlisted;

  // Swap two neighbours by rewriting sort_order for both.
  const move = async (index: number, dir: -1 | 1) => {
    const other = index + dir;
    if (other < 0 || other >= ms.length) return;
    try {
      await Promise.all([
        api.patch(`/milestones/${ms[index].id}`, { sort_order: other + 1 }),
        api.patch(`/milestones/${ms[other].id}`, { sort_order: index + 1 }),
      ]);
      refresh();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('entries.myEntries'), to: '/entries' },
          { label: e.code, to: `/entries/${e.id}` },
          { label: t('entries.buildPlan') },
        ]}
        title={t('entries.buildPlanTitle')}
        subtitle={e.title}
        actions={
          canEdit ? (
            <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAddOpen(true)}>
              {t('entries.addMilestone')}
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        {locked && (
          <Callout tone="info" action={<ButtonLink to={`/entries/${e.id}`} size="sm" variant="secondary">{t('entries.backToEntry')}</ButtonLink>}>
            {t('entries.buildPlanLocked')}
          </Callout>
        )}
        {!locked && !e.is_member && <Callout tone="info">{t('entries.readOnlyBody')}</Callout>}

        <Card>
          <CardHeader title={t('entries.milestones')} subtitle={ms.length ? undefined : t('entries.milestonesHelp')} />
          {ms.length > 0 && (
            <ProgressBar className="mb-4" value={q.data.percent_complete} label={t('entries.milestonesDone', { pct: q.data.percent_complete })} tone="success" />
          )}
          {ms.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="h-8 w-8" aria-hidden />}
              title={t('entries.noMilestones')}
              action={canEdit ? <Button onClick={() => setAddOpen(true)}>{t('entries.addMilestone')}</Button> : undefined}
            />
          ) : (
            <ol className="divide-y divide-line">
              {ms.map((m, i) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                  {canEdit && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        className="rounded-control p-1 text-ink-muted hover:bg-neutral-soft disabled:opacity-30"
                        aria-label={t('entries.moveUp', { title: m.title })}
                        disabled={i === 0}
                        onClick={() => void move(i, -1)}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="rounded-control p-1 text-ink-muted hover:bg-neutral-soft disabled:opacity-30"
                        aria-label={t('entries.moveDown', { title: m.title })}
                        disabled={i === ms.length - 1}
                        onClick={() => void move(i, 1)}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  )}
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="font-medium text-ink">{m.title}</p>
                    <p className="text-sm text-ink-muted">
                      {m.due_date ? t('entries.dueOn', { date: formatDate(m.due_date) }) : t('entries.noDueDate')}
                      {m.owner ? ` · ${m.owner}` : ''}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`st-${m.id}`}>
                        {t('entries.statusOf', { title: m.title })}
                      </label>
                      <select
                        id={`st-${m.id}`}
                        className="control min-h-[40px] w-auto"
                        value={m.status}
                        onChange={(ev) => patch.mutate({ mid: m.id, body: { status: ev.target.value } })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t(`entries.msStatus.${s}`)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="rounded-control p-2 text-ink-muted hover:bg-danger-soft hover:text-danger"
                        aria-label={t('entries.removeMilestone', { title: m.title })}
                        onClick={() => setToDelete(m)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <StatusBadge status={m.status} label={t(`entries.msStatus.${m.status}`)} />
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {canEdit && (
          <Card>
            <CardHeader title={t('entries.weeklyUpdate')} subtitle={t('entries.weeklyUpdateHelp')} />
            <form
              className="space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!update.update_text.trim()) {
                  setUpdateError(t('entries.updateRequired'));
                  return;
                }
                setUpdateError(null);
                post.mutate();
              }}
            >
              <Field label={t('entries.whatWeDid')} required error={updateError}>
                <Textarea rows={3} value={update.update_text} onChange={(ev) => setUpdate({ ...update, update_text: ev.target.value })} />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('entries.blockers')}>
                  <Textarea rows={2} value={update.blockers} onChange={(ev) => setUpdate({ ...update, blockers: ev.target.value })} />
                </Field>
                <Field label={t('entries.helpNeeded')}>
                  <Textarea rows={2} value={update.help_needed} onChange={(ev) => setUpdate({ ...update, help_needed: ev.target.value })} />
                </Field>
              </div>
              <Field label={t('entries.percentComplete')} className="max-w-[12rem]">
                <Input type="number" min={0} max={100} value={update.percent_complete} onChange={(ev) => setUpdate({ ...update, percent_complete: ev.target.value })} />
              </Field>
              <Button type="submit" loading={post.isPending}>
                {t('entries.postUpdate')}
              </Button>
            </form>
          </Card>
        )}

        <Card>
          <CardHeader title={t('entries.pastUpdates')} />
          {q.data.updates.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('entries.noUpdates')}</p>
          ) : (
            <ul className="space-y-4">
              {q.data.updates.map((u) => (
                <li key={u.id} className="border-l-2 border-line pl-3">
                  <p className="text-sm text-ink-muted">
                    {formatDateTime(u.created_at)}
                    {u.posted_by_name ? ` · ${u.posted_by_name}` : ''}
                    {u.percent_complete != null ? ` · ${t('entries.pctComplete', { pct: u.percent_complete })}` : ''}
                  </p>
                  <p className="reading whitespace-pre-wrap text-ink">{u.update_text}</p>
                  {u.blockers && (
                    <p className="text-sm text-ink">
                      <span className="font-medium">{t('entries.blockers')}:</span> {u.blockers}
                    </p>
                  )}
                  {u.help_needed && (
                    <p className="text-sm text-ink">
                      <span className="font-medium">{t('entries.helpNeeded')}:</span> {u.help_needed}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t('entries.addMilestone')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={add.isPending}
              onClick={() => {
                if (!draft.title.trim()) {
                  setTitleError(t('entries.milestoneTitleRequired'));
                  return;
                }
                setTitleError(null);
                add.mutate();
              }}
            >
              {t('entries.addMilestone')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('entries.milestoneTitle')} required error={titleError}>
            <Input value={draft.title} onChange={(ev) => setDraft({ ...draft, title: ev.target.value })} maxLength={250} />
          </Field>
          <Field label={t('entries.dueDate')}>
            <Input type="date" value={draft.due_date} onChange={(ev) => setDraft({ ...draft, due_date: ev.target.value })} />
          </Field>
          {e.lead && (
            <Field label={t('entries.owner')} help={t('entries.ownerHelp')}>
              <Select
                value={draft.owner_user_id}
                onChange={(ev) => setDraft({ ...draft, owner_user_id: ev.target.value })}
                placeholder={t('entries.noOwner')}
                options={
                  team.data?.members?.length
                    ? team.data.members.map((m) => ({ value: m.user_id, label: m.full_name }))
                    : [{ value: e.lead.id, label: e.lead.full_name }]
                }
              />
            </Field>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('entries.removeMilestoneTitle')}
        description={toDelete?.title}
        confirmLabel={t('entries.removeMilestoneConfirm')}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </>
  );
}
