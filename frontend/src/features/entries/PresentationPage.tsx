import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarCheck2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { Callout } from '@/components/domain';
import { Badge, Button, ButtonLink, Card, CardHeader, Dialog, ErrorState, Field, Input, PageHeader, PageSkeleton, Textarea, isNotFound } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime, fromLocalInputValue, toLocalInputValue } from '@/utils/dates';

export interface PresentationRequestView {
  id: string;
  status: 'PROPOSED' | 'COUNTER_PROPOSED' | 'ACCEPTED' | 'CANCELLED';
  proposed_start: string | null;
  note: string | null;
  suggested_start: string | null;
  admin_note: string | null;
  scheduled_start: string | null;
  proposed_by: string | null;
  created_at: string | null;
}
interface PresentationData {
  window: { opens_at: string | null; closes_at: string | null };
  current: PresentationRequestView | null;
  history: PresentationRequestView[];
  scheduled_at: string | null;
  is_finalist: boolean;
  can_propose: boolean;
  can_decide: boolean;
  can_accept_suggestion: boolean;
  entry: { id: string; code: string; title: string };
}

const STATUS_TONE = { PROPOSED: 'warning', COUNTER_PROPOSED: 'info', ACCEPTED: 'success', CANCELLED: 'neutral' } as const;

/** Pick a date and time inside the allowed period. */
export function TimePickerDialog({
  title,
  description,
  window,
  confirmLabel,
  withNote,
  initial,
  loading,
  onClose,
  onConfirm,
}: {
  title: string;
  description?: string;
  window: { opens_at: string | null; closes_at: string | null };
  confirmLabel: string;
  withNote?: boolean;
  initial?: string | null;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (iso: string, note: string) => void;
}) {
  const { t } = useTranslation();
  const [when, setWhen] = useState(toLocalInputValue(initial ?? window.opens_at));
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={loading} disabled={!when} onClick={() => onConfirm(fromLocalInputValue(when) ?? '', note)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-control bg-info-soft px-3 py-2 text-sm text-info">
          {t('presentation.windowHelp', { from: formatDateTime(window.opens_at), to: formatDateTime(window.closes_at) })}
        </p>
        <Field label={t('presentation.dateTime')} required>
          <Input type="datetime-local" value={when} min={toLocalInputValue(window.opens_at)} max={toLocalInputValue(window.closes_at)} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        {withNote && (
          <Field label={t('presentation.note')}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** A finalist chooses a time for the live presentation inside the final-submission period; the admin accepts or suggests another. */
export default function PresentationPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'propose' | 'suggest' | null>(null);
  const q = useQuery({ queryKey: ['presentation', id], queryFn: () => api.get<PresentationData>(`/entries/${id}/presentation`) });
  const reload = () => {
    setDialog(null);
    void qc.invalidateQueries({ queryKey: ['presentation', id] });
    void qc.invalidateQueries({ queryKey: ['presentations'] });
  };
  const propose = useMutation({
    mutationFn: (v: { at: string; note: string }) => api.post(`/entries/${id}/presentation`, { proposed_at: v.at, note: v.note }),
    onSuccess: () => {
      toast.success(t('presentation.proposed'));
      reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const accept = useMutation({
    mutationFn: (rid: string) => api.post(`/presentation-requests/${rid}/accept`),
    onSuccess: () => {
      toast.success(t('presentation.accepted'));
      reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const suggest = useMutation({
    mutationFn: (v: { rid: string; at: string; note: string }) => api.post(`/presentation-requests/${v.rid}/suggest`, { suggested_at: v.at, note: v.note }),
    onSuccess: () => {
      toast.success(t('presentation.suggested'));
      reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const agree = useMutation({
    mutationFn: (rid: string) => api.post(`/presentation-requests/${rid}/accept-suggestion`),
    onSuccess: () => {
      toast.success(t('presentation.accepted'));
      reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <PageSkeleton rows={4} />;
  const d = q.data;
  const cur = d.current;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('presentation.title')}
        subtitle={`${d.entry.code} · ${d.entry.title}`}
        breadcrumbs={[{ label: t('nav.myEntries'), to: '/entries' }, { label: d.entry.code, to: `/entries/${d.entry.id}` }, { label: t('presentation.title') }]}
        actions={
          <ButtonLink to={`/entries/${d.entry.id}`} variant="secondary">
            {t('gates.backToEntry')}
          </ButtonLink>
        }
      />
      {!d.is_finalist && <Callout tone="info">{t('presentation.notFinalist')}</Callout>}
      {d.window.opens_at && (
        <Callout tone="info" title={t('presentation.periodTitle')}>
          {t('presentation.windowHelp', { from: formatDateTime(d.window.opens_at), to: formatDateTime(d.window.closes_at) })}
        </Callout>
      )}

      <Card className="space-y-4">
        <CardHeader title={t('presentation.statusTitle')} actions={cur ? <Badge tone={STATUS_TONE[cur.status]}>{t(`presentation.status.${cur.status}`)}</Badge> : undefined} />
        {!cur && <p className="text-sm text-ink-muted">{t('presentation.noneYet')}</p>}
        {cur?.status === 'ACCEPTED' && (
          <Callout tone="success" title={t('presentation.confirmed', { date: formatDateTime(d.scheduled_at) })}>
            {t('presentation.confirmedHelp')}
          </Callout>
        )}
        {cur?.status === 'PROPOSED' && (
          <p className="text-sm text-ink">
            {t('presentation.waiting', { date: formatDateTime(cur.proposed_start) })}
            {cur.note && <span className="block text-ink-muted">{cur.note}</span>}
          </p>
        )}
        {cur?.status === 'COUNTER_PROPOSED' && (
          <Callout tone="warning" title={t('presentation.counterTitle', { date: formatDateTime(cur.suggested_start) })}>
            {cur.admin_note ?? t('presentation.counterHelp')}
          </Callout>
        )}
        <div className="flex flex-wrap gap-2">
          {d.can_accept_suggestion && cur && (
            <Button icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />} loading={agree.isPending} onClick={() => agree.mutate(cur.id)}>
              {t('presentation.agree')}
            </Button>
          )}
          {d.can_propose && (
            <Button variant={d.can_accept_suggestion ? 'secondary' : 'primary'} icon={<CalendarClock className="h-4 w-4" aria-hidden />} onClick={() => setDialog('propose')}>
              {cur && cur.status !== 'CANCELLED' ? t('presentation.proposeAnother') : t('presentation.propose')}
            </Button>
          )}
          {d.can_decide && cur && (
            <>
              <Button icon={<CalendarCheck2 className="h-4 w-4" aria-hidden />} loading={accept.isPending} onClick={() => accept.mutate(cur.id)}>
                {t('presentation.accept')}
              </Button>
              <Button variant="secondary" onClick={() => setDialog('suggest')}>
                {t('presentation.suggest')}
              </Button>
            </>
          )}
        </div>
      </Card>

      {d.history.length > 1 && (
        <Card>
          <CardHeader title={t('presentation.history')} />
          <ul className="mt-2 divide-y divide-line text-sm">
            {d.history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="tabular text-ink">{formatDateTime(r.proposed_start)}</span>
                <Badge tone={STATUS_TONE[r.status]}>{t(`presentation.status.${r.status}`)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {dialog === 'propose' && (
        <TimePickerDialog
          title={t('presentation.propose')}
          description={t('presentation.proposeHelp')}
          window={d.window}
          withNote
          confirmLabel={t('presentation.send')}
          loading={propose.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(at, note) => propose.mutate({ at, note })}
        />
      )}
      {dialog === 'suggest' && cur && (
        <TimePickerDialog
          title={t('presentation.suggest')}
          description={t('presentation.suggestHelp')}
          window={d.window}
          withNote
          initial={cur.proposed_start}
          confirmLabel={t('presentation.sendSuggestion')}
          loading={suggest.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(at, note) => suggest.mutate({ rid: cur.id, at, note })}
        />
      )}
    </div>
  );
}
