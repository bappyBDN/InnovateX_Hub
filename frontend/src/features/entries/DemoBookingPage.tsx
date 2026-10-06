import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, MapPin, Video } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout } from '@/components/domain';
import { Badge, ButtonLink, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, isNotFound, PageHeader, PageSkeleton } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/dates';
import type { DemoData, EntryDetail } from './types';

export default function DemoBookingPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = [...queryKeys.entries.detail(id), 'demo'] as const;
  const entry = useQuery({ queryKey: queryKeys.entries.detail(id), queryFn: () => api.get<EntryDetail>(`/entries/${id}`), enabled: !!id });
  const q = useQuery({ queryKey: key, queryFn: () => api.get<DemoData>(`/entries/${id}/demo`), enabled: !!id });
  const [picked, setPicked] = useState<DemoData['slots'][number] | null>(null);

  const book = useMutation({
    mutationFn: (slotId: string) => api.post(`/entries/${id}/demo/slots/${slotId}/book`),
    onSuccess: () => {
      toast.success(t('entries.demoBooked'));
      setPicked(null);
      void qc.invalidateQueries({ queryKey: queryKeys.entries.detail(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
    },
    onError: (e) => {
      setPicked(null);
      toast.error(errorMessage(e));
      void q.refetch(); // the slot may just have been taken
    },
  });

  if (q.isLoading || entry.isLoading) return <PageSkeleton rows={4} />;
  if (isNotFound(q.error) || isNotFound(entry.error)) return <NotFoundPage />;
  if (q.isError || entry.isError || !q.data || !entry.data)
    return <ErrorState error={q.error ?? entry.error} onRetry={() => { void q.refetch(); void entry.refetch(); }} />;

  const d = q.data;
  const e = entry.data;
  const rescheduling = !!d.my_slot;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('entries.myEntries'), to: '/entries' },
          { label: e.code, to: `/entries/${e.id}` },
          { label: t('entries.demoSlot') },
        ]}
        title={t('entries.demoTitle')}
        subtitle={e.title}
      />

      {!d.event ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" aria-hidden />}
          title={d.message ?? t('entries.demoNotScheduled')}
          action={<ButtonLink to={`/entries/${e.id}`} variant="secondary">{t('entries.backToEntry')}</ButtonLink>}
        />
      ) : (
        <div className="space-y-4">
          {d.my_slot ? (
            <Callout tone="success" title={<span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden />{t('entries.demoYourSlot')}</span>}>
              <p className="font-medium">{t('entries.demoSlotAt', { date: formatDateTime(d.my_slot.starts_at), minutes: d.my_slot.duration_min })}</p>
              <p>{d.reschedule_locked ? t('entries.demoRescheduleLocked') : t('entries.demoRescheduleHint')}</p>
            </Callout>
          ) : d.can_book ? (
            <Callout tone="warning" title={t('entries.demoPickSlot')} />
          ) : (
            d.message && <Callout tone="info">{d.message}</Callout>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title={d.event.title} subtitle={`${formatDateTime(d.event.starts_at)} – ${formatDateTime(d.event.ends_at)}`} />
              <ul className="grid gap-2 sm:grid-cols-2">
                {d.slots.map((s) => {
                  const selectable = d.can_book && s.available;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={!selectable}
                        onClick={() => setPicked(s)}
                        className={cn(
                          'flex min-h-[56px] w-full items-center justify-between gap-2 rounded-control border px-3 py-2 text-left',
                          s.is_mine
                            ? 'border-success bg-success-soft'
                            : selectable
                              ? 'border-line bg-surface hover:border-primary hover:bg-primary-soft'
                              : 'border-line bg-canvas text-ink-muted',
                        )}
                      >
                        <span>
                          <span className="tabular block font-medium text-ink">{formatDateTime(s.starts_at)}</span>
                          <span className="text-sm text-ink-muted">{t('entries.minutes', { count: s.duration_min })}</span>
                        </span>
                        {s.is_mine ? (
                          <Badge tone="success">{t('entries.slotYours')}</Badge>
                        ) : s.available ? (
                          <Badge tone="primary">{t('entries.slotFree')}</Badge>
                        ) : (
                          <Badge tone="neutral">{t('entries.slotTaken')}</Badge>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {d.slots.length === 0 && <p className="text-sm text-ink-muted">{t('entries.noSlots')}</p>}
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title={t('entries.demoWhere')} />
                <ul className="space-y-2 text-sm text-ink">
                  {d.event.location && (
                    <li className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                      {d.event.location}
                    </li>
                  )}
                  {d.event.online_link && (
                    <li className="flex items-start gap-2">
                      <Video className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                      <a href={d.event.online_link} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                        {t('entries.demoOnlineLink')}
                      </a>
                    </li>
                  )}
                </ul>
              </Card>
              {d.checklist && d.checklist.length > 0 && (
                <Card>
                  <CardHeader title={t('entries.demoPrepare')} />
                  <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
                    {d.checklist.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!picked}
        onOpenChange={(o) => !o && setPicked(null)}
        title={rescheduling ? t('entries.demoRescheduleTitle') : t('entries.demoBookTitle')}
        description={picked ? t('entries.demoSlotAt', { date: formatDateTime(picked.starts_at), minutes: picked.duration_min }) : undefined}
        confirmLabel={rescheduling ? t('entries.demoReschedule') : t('entries.demoBook')}
        loading={book.isPending}
        onConfirm={() => picked && book.mutate(picked.id)}
      />
    </>
  );
}
