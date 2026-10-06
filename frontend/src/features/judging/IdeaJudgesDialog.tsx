import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { StatusBadge } from '@/components/domain';
import { Button, Dialog, ErrorState, Skeleton } from '@/components/ui';
import { formatDateTime } from '@/utils/dates';
import { AddJudgesDialog } from './AddJudgesDialog';
import { QuickAddJudge } from './QuickAdd';
import type { AddJudgesResult, IdeaJudges } from './types';

/**
 * Judges of one idea: add a person from a dropdown list, see who judges it, remove them, invite others by email.
 * Used inside the dialog on the idea page and on the admin Judges page. Only the admin can change anything.
 */
export function IdeaJudgesPanel({
  ideaKey,
  ideaCode,
  onDone,
  base = `/initiatives/${ideaKey}`,
  kind = 'idea',
}: {
  ideaKey: string;
  ideaCode: string;
  onDone?: () => void;
  /** API path of the thing being judged. An idea by default; `/entries/{id}` for a challenge entry. */
  base?: string;
  kind?: 'idea' | 'entry';
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const key = [kind === 'entry' ? 'entries' : 'ideas', ideaKey, 'judges'] as const;
  const list = useQuery({ queryKey: key, queryFn: () => api.get<IdeaJudges>(`${base}/judges`) });
  const reload = () => {
    onDone?.();
    return qc.invalidateQueries({ queryKey: key });
  };
  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`${base}/judges/${userId}`),
    onSuccess: async () => {
      toast.success(t('judging.removed'));
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

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const d = list.data;
  if (!d) return <Skeleton className="h-24 w-full" />;
  const submit = (payload: unknown) => api.post<AddJudgesResult>(`${base}/judges`, payload);

  return (
    <div className="space-y-4">
      {d.can_edit && (
        <div className="rounded-panel border border-line bg-canvas p-4">
          <QuickAddJudge excludeIds={d.judges.map((j) => j.user.id)} submit={submit} onDone={() => void reload()} />
        </div>
      )}
      {d.judges.length === 0 && d.invites.length === 0 && <p className="text-sm text-ink-muted">{t(kind === 'entry' ? 'judging.entryEmpty' : 'judging.ideaEmpty')}</p>}
      {d.total > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-panel border border-line bg-primary-soft px-4 py-3">
          <span className="text-sm text-ink">
            <span className="font-medium">{t('judging.averageScore')}</span>
            <span className="block text-xs text-ink-muted">{t('judging.averageHelp', { scored: d.scored, total: d.total })}</span>
          </span>
          <span className="tabular text-2xl font-semibold text-ink">{d.average_score == null ? '—' : `${d.average_score.toFixed(1)} / 100`}</span>
        </div>
      )}
      {d.judges.length > 0 && (
        <ul className="divide-y divide-line rounded-panel border border-line">
          {d.judges.map((j) => (
            <li key={j.user.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-ink">{j.user.full_name}</span>
                <span className="block text-xs text-ink-muted">
                  {[j.user.job_title, j.due_at ? t('judging.dueBy', { date: formatDateTime(j.due_at) }) : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {j.score != null && <span className="tabular font-medium text-ink">{j.score.toFixed(1)}</span>}
                <StatusBadge status={j.status} />
                {d.can_edit && j.status !== 'SUBMITTED' && (
                  <Button variant="ghost" size="sm" loading={remove.isPending && remove.variables === j.user.id} onClick={() => remove.mutate(j.user.id)}>
                    {t('common.remove')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.invites.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink">{t('judging.invitesTitle')}</p>
          <ul className="mt-2 divide-y divide-line rounded-panel border border-line">
            {d.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium text-ink">{i.email}</span>
                {d.can_edit && (
                  <Button variant="ghost" size="sm" loading={cancelInvite.isPending && cancelInvite.variables === i.id} onClick={() => cancelInvite.mutate(i.id)}>
                    {t('judging.cancelInvite')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.can_edit && kind !== 'entry' && (
        <Button variant="secondary" size="sm" icon={<Mail className="h-4 w-4" aria-hidden />} onClick={() => setInviting(true)}>
          {t('judging.inviteButton')}
        </Button>
      )}
      {inviting && (
        <AddJudgesDialog
          title={t(kind === 'entry' ? 'judging.addEntryTitle' : 'judging.addIdeaTitle', { code: ideaCode })}
          description={t(kind === 'entry' ? 'judging.addEntryHelp' : 'judging.addIdeaHelp')}
          excludeIds={d.judges.map((j) => j.user.id)}
          withDueDays
          submit={submit}
          onDone={() => void reload()}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}

export function IdeaJudgesDialog({ ideaKey, ideaCode, onClose, onDone }: { ideaKey: string; ideaCode: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('judging.ideaTitle', { code: ideaCode })}
      description={t('judging.ideaHelp')}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <IdeaJudgesPanel ideaKey={ideaKey} ideaCode={ideaCode} onDone={onDone} />
    </Dialog>
  );
}

/** Choose judges for one challenge entry: one or many, with a due date. Same as for an idea. */
export function EntryJudgesDialog({ entryId, entryCode, onClose, onDone }: { entryId: string; entryCode: string; onClose: () => void; onDone?: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('judging.entryTitle', { code: entryCode })}
      description={t('judging.entryHelp')}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <IdeaJudgesPanel ideaKey={entryId} ideaCode={entryCode} base={`/entries/${entryId}`} kind="entry" onDone={onDone} />
    </Dialog>
  );
}
