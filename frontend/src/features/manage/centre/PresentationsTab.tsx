import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { StatusBadge } from '@/components/domain';
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { TimePickerDialog, type PresentationRequestView } from '@/features/entries/PresentationPage';
import { formatDateTime } from '@/utils/dates';

interface Overview {
  window: { opens_at: string | null; closes_at: string | null };
  items: { entry: { id: string; code: string; title: string; status_code: string; entrant: string | null }; current: PresentationRequestView | null }[];
  can_decide: boolean;
}
const TONE = { PROPOSED: 'warning', COUNTER_PROPOSED: 'info', ACCEPTED: 'success', CANCELLED: 'neutral' } as const;

/** The finalists and the time each proposed for the live presentation. The admin accepts it or suggests another time. */
export function PresentationsTab({ challengeId }: { challengeId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [suggest, setSuggest] = useState<PresentationRequestView | null>(null);
  const q = useQuery({ queryKey: ['presentations', challengeId], queryFn: () => api.get<Overview>(`/manage/challenges/${challengeId}/presentations`) });
  const done = () => {
    setSuggest(null);
    void qc.invalidateQueries({ queryKey: ['presentations', challengeId] });
  };
  const accept = useMutation({
    mutationFn: (rid: string) => api.post(`/presentation-requests/${rid}/accept`),
    onSuccess: () => {
      toast.success(t('presentation.accepted'));
      done();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const counter = useMutation({
    mutationFn: (v: { rid: string; at: string; note: string }) => api.post(`/presentation-requests/${v.rid}/suggest`, { suggested_at: v.at, note: v.note }),
    onSuccess: () => {
      toast.success(t('presentation.suggested'));
      done();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        {t('presentation.adminHelp')} {d.window.opens_at && t('presentation.windowHelp', { from: formatDateTime(d.window.opens_at), to: formatDateTime(d.window.closes_at) })}
      </p>
      {d.items.length === 0 && <EmptyState icon={<CalendarCheck2 className="h-8 w-8" aria-hidden />} title={t('presentation.noFinalists')} />}
      {d.items.map(({ entry, current }) => (
        <Card key={entry.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">{entry.title}</p>
              <p className="text-sm text-ink-muted">
                {entry.code}
                {entry.entrant ? ` · ${entry.entrant}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={entry.status_code} />
              {current ? <Badge tone={TONE[current.status]}>{t(`presentation.status.${current.status}`)}</Badge> : <Badge>{t('presentation.noneYetShort')}</Badge>}
            </div>
          </div>
          {current && (
            <p className="mt-2 text-sm text-ink">
              {current.status === 'ACCEPTED'
                ? t('presentation.confirmed', { date: formatDateTime(current.scheduled_start) })
                : current.status === 'COUNTER_PROPOSED'
                  ? t('presentation.youSuggested', { date: formatDateTime(current.suggested_start) })
                  : t('presentation.waiting', { date: formatDateTime(current.proposed_start) })}
              {current.note && <span className="block text-ink-muted">{current.note}</span>}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {d.can_decide && current?.status === 'PROPOSED' && (
              <>
                <Button size="sm" loading={accept.isPending && accept.variables === current.id} onClick={() => accept.mutate(current.id)}>
                  {t('presentation.accept')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setSuggest(current)}>
                  {t('presentation.suggest')}
                </Button>
              </>
            )}
            <ButtonLink to={`/entries/${entry.id}/presentation`} size="sm" variant="ghost">
              {t('common.open')}
            </ButtonLink>
          </div>
        </Card>
      ))}
      {suggest && (
        <TimePickerDialog
          title={t('presentation.suggest')}
          description={t('presentation.suggestHelp')}
          window={d.window}
          withNote
          initial={suggest.proposed_start}
          confirmLabel={t('presentation.sendSuggestion')}
          loading={counter.isPending}
          onClose={() => setSuggest(null)}
          onConfirm={(at, note) => counter.mutate({ rid: suggest.id, at, note })}
        />
      )}
    </div>
  );
}
