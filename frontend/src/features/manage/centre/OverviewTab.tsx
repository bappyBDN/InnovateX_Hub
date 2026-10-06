import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Megaphone, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { DeadlineCountdown, StatTile, StatusBadge } from '@/components/domain';
import { Button, Card, CardHeader, ConfirmDialog, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDateTime, fromLocalInputValue, toLocalInputValue } from '@/utils/dates';
import { tr } from '@/utils/i18n';
import { TimelineBar } from '../builder/steps';
import type { TabProps } from './types';

export function OverviewTab({ detail, refresh }: TabProps) {
  const { t } = useTranslation();
  const n = detail.numbers;
  const open = detail.phases.filter((p) => p.status === 'OPEN');
  const extendable = detail.phases.filter((p) => p.status !== 'CLOSED');
  const [dialog, setDialog] = useState<'extend' | 'announce' | 'close' | null>(null);
  const [phase, setPhase] = useState('');
  const [newClose, setNewClose] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');

  const done = (text: string) => async () => {
    toast.success(text);
    setDialog(null);
    setReason('');
    setMessage('');
    await refresh();
  };
  const fail = (e: unknown) => toast.error(errorMessage(e));

  const extend = useMutation({
    mutationFn: () => api.post(`/challenges/${detail.id}/actions/extend-deadline`, { phase_type: phase, new_closes_at: fromLocalInputValue(newClose), reason }),
    onSuccess: done(t('manage.centre.deadlineExtended')),
    onError: fail,
  });
  const announce = useMutation({
    mutationFn: () => api.post<{ sent_to: number }>(`/challenges/${detail.id}/actions/announce`, { message }),
    onSuccess: (r) => done(t('manage.centre.announcementSent', { count: r.sent_to }))(),
    onError: fail,
  });
  const closePhase = useMutation({
    mutationFn: () => api.post(`/challenges/${detail.id}/actions/close-phase`, { phase_type: phase }),
    onSuccess: done(t('manage.centre.phaseClosed')),
    onError: fail,
  });

  const openDialog = (kind: 'extend' | 'close') => {
    const first = (kind === 'extend' ? extendable : open)[0];
    setPhase(first?.phase_type ?? '');
    setNewClose(first ? toLocalInputValue(first.closes_at) : '');
    setDialog(kind);
  };
  const chosen = detail.phases.find((p) => p.phase_type === phase);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm text-ink-muted">{t('manage.centre.currentPhase')}</p>
            <p className="text-xl font-semibold text-ink">{detail.current_phase ? tr(detail.current_phase.name_i18n) : '—'}</p>
            {detail.current_phase?.status === 'OPEN' && <DeadlineCountdown closesAt={detail.current_phase.closes_at} />}
            {detail.current_phase?.status === 'UPCOMING' && (
              <p className="text-sm text-ink-muted">{t('manage.centre.opensOn', { date: formatDateTime(detail.current_phase.opens_at) })}</p>
            )}
          </div>
          {detail.can_manage && detail.status_code !== 'DRAFT' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<CalendarClock className="h-4 w-4" aria-hidden />} onClick={() => openDialog('extend')} disabled={!extendable.length}>
                {t('manage.centre.extendDeadline')}
              </Button>
              <Button variant="secondary" size="sm" icon={<Megaphone className="h-4 w-4" aria-hidden />} onClick={() => setDialog('announce')}>
                {t('manage.centre.sendAnnouncement')}
              </Button>
              <Button variant="secondary" size="sm" icon={<SkipForward className="h-4 w-4" aria-hidden />} onClick={() => openDialog('close')} disabled={!open.length} disabledReason={t('manage.centre.noOpenPhase')}>
                {t('manage.centre.closePhaseEarly')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label={t('manage.centre.num.registered')} value={n.registered} />
        <StatTile label={t('manage.centre.num.teams')} value={n.teams} />
        <StatTile label={t('manage.centre.num.methodologies')} value={n.methodologies_submitted} />
        <StatTile label={t('manage.centre.num.reviews')} value={`${n.reviews_done}/${n.reviews_assigned}`} hint={n.reviews_overdue ? t('manage.list.overdue', { count: n.reviews_overdue }) : undefined} />
        <StatTile label={t('manage.centre.num.shortlisted')} value={n.shortlisted} />
        <StatTile label={t('manage.centre.num.feedback')} value={n.feedback_published} />
      </div>

      <Card>
        <CardHeader title={t('manage.centre.timeline')} />
        <div className="mt-6">
          <TimelineBar phases={detail.phases.map((p) => ({ phase_type: p.phase_type, opens_at: p.opens_at, closes_at: p.closes_at }))} />
        </div>
        <ol className="mt-4 divide-y divide-line">
          {detail.phases.map((p) => (
            <li key={p.id} className={cn('flex flex-wrap items-center justify-between gap-2 py-2 text-sm', p.status === 'OPEN' && 'font-medium')}>
              <span className="text-ink">
                {tr(p.name_i18n)}
                {p.note && <span className="ml-2 font-normal text-ink-muted">({t('manage.centre.onlyIfPanelAsks')})</span>}
              </span>
              <span className="flex items-center gap-3 text-ink-muted">
                <span className="tabular">
                  {formatDateTime(p.opens_at)} – {formatDateTime(p.closes_at)}
                </span>
                <StatusBadge status={p.status} label={p.status === 'OPEN' ? t('manage.now') : undefined} />
              </span>
            </li>
          ))}
          {detail.phases.length === 0 && <li className="py-2 text-sm text-ink-muted">{t('manage.centre.noPhases')}</li>}
        </ol>
      </Card>

      <Dialog
        open={dialog === 'extend'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('manage.centre.extendTitle')}
        description={t('manage.centre.extendBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => extend.mutate()}
              loading={extend.isPending}
              disabled={!phase || !newClose || !reason.trim()}
            >
              {t('manage.centre.extendDeadline')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('manage.centre.phase')}>
            <Select
              value={phase}
              onChange={(e) => {
                setPhase(e.target.value);
                const p = detail.phases.find((x) => x.phase_type === e.target.value);
                setNewClose(p ? toLocalInputValue(p.closes_at) : '');
              }}
              options={extendable.map((p) => ({ value: p.phase_type, label: tr(p.name_i18n) }))}
            />
          </Field>
          <Field label={t('manage.centre.newClosesAt')} help={chosen ? t('manage.centre.currentlyCloses', { date: formatDateTime(chosen.closes_at) }) : undefined} required>
            <Input type="datetime-local" value={newClose} onChange={(e) => setNewClose(e.target.value)} />
          </Field>
          <Field label={t('manage.centre.reason')} help={t('manage.centre.reasonAudited')} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'announce'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('manage.centre.announceTitle')}
        description={t('manage.centre.announceBody', { count: n.registered })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => announce.mutate()} loading={announce.isPending} disabled={!message.trim()}>
              {t('manage.centre.sendAnnouncement')}
            </Button>
          </>
        }
      >
        <Field label={t('manage.centre.message')} required hint={`${message.length}/1000`}>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={1000} />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={dialog === 'close'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('manage.centre.closeTitle')}
        description={t('manage.centre.closeBody')}
        confirmLabel={t('manage.centre.closePhaseEarly')}
        variant="danger"
        loading={closePhase.isPending}
        onConfirm={() => closePhase.mutate()}
      >
        <Field label={t('manage.centre.phase')}>
          <Select value={phase} onChange={(e) => setPhase(e.target.value)} options={open.map((p) => ({ value: p.phase_type, label: tr(p.name_i18n) }))} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
