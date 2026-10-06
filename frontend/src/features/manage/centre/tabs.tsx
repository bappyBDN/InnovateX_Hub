import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarPlus, FileText, MessageCircleQuestion, Settings2, UserCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ProgressBar,
  Skeleton,
  Textarea,
  type Column,
} from '@/components/ui';
import { formatDateTime, fromLocalInputValue } from '@/utils/dates';
import { num, statusLabel } from '@/utils/format';
import type { ActivityRow, AssignResult, EntryRow, QuestionRow, RoundInfo, TabProps } from './types';

// ── Entries ─────────────────────────────────────────────────────────────────
export function EntriesTab({ detail, refresh }: TabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [target, setTarget] = useState<EntryRow | null>(null);
  const [reason, setReason] = useState('');
  const list = useQuery({
    queryKey: queryKeys.challenges.entries(detail.id),
    queryFn: () => api.get<Page<EntryRow>>(`/challenges/${detail.id}/entries`),
  });
  const withdraw = useMutation({
    mutationFn: () => api.post(`/entries/${target!.id}/actions/withdraw`, { reason }),
    onSuccess: async () => {
      toast.success(t('manage.centre.entryWithdrawn'));
      setTarget(null);
      setReason('');
      await Promise.all([qc.invalidateQueries({ queryKey: queryKeys.challenges.entries(detail.id) }), refresh()]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  const columns: Column<EntryRow>[] = [
    { key: 'code', header: t('manage.centre.entry.code'), sortValue: (r) => r.code, render: (r) => <span className="tabular text-ink-muted">{r.code}</span> },
    { key: 'title', header: t('manage.centre.entry.title'), sortValue: (r) => r.title, render: (r) => <span className="font-medium text-ink">{r.title}</span> },
    {
      key: 'entrant',
      header: t('manage.centre.entry.entrant'),
      sortValue: (r) => r.team ?? r.lead ?? '',
      render: (r) => (
        <span>
          {r.team ?? r.lead ?? '—'}
          {r.team && <span className="block text-xs text-ink-muted">{t('manage.centre.entry.ledBy', { name: r.lead })}</span>}
        </span>
      ),
    },
    { key: 'status', header: t('manage.list.status'), sortValue: (r) => r.status_code, render: (r) => <StatusBadge status={r.status_code} /> },
    {
      key: 'methodology',
      header: t('manage.centre.entry.methodology'),
      render: (r) =>
        r.methodology_submission_id && r.methodology_status !== 'DRAFT' && r.methodology_status !== 'NOT_STARTED' ? (
          <ButtonLink to={`/submissions/${r.methodology_submission_id}`} variant="ghost" size="sm" icon={<FileText className="h-4 w-4" aria-hidden />} onClick={(e) => e.stopPropagation()}>
            {statusLabel(r.methodology_status)}
          </ButtonLink>
        ) : (
          <span className="text-ink-muted">{statusLabel(r.methodology_status)}</span>
        ),
    },
    {
      key: 'score',
      header: t('manage.centre.entry.score'),
      align: 'right',
      sortValue: (r) => r.current_score ?? -1,
      render: (r) => <span className="tabular">{r.current_score == null ? '—' : `${num(r.current_score, 1)}${r.current_rank ? ` · #${r.current_rank}` : ''}`}</span>,
    },
    ...(detail.can_manage
      ? [
          {
            key: 'actions',
            header: '',
            render: (r: EntryRow) =>
              r.status_code !== 'WITHDRAWN' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTarget(r);
                  }}
                >
                  {t('manage.centre.withdraw')}
                </Button>
              ) : null,
          } satisfies Column<EntryRow>,
        ]
      : []),
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        onRowClick={(r) => navigate(`/entries/${r.id}`)}
        initialSort={{ key: 'code', dir: 'asc' }}
        caption={t('manage.centre.tab.entries')}
        empty={<EmptyState icon={<Users className="h-8 w-8" aria-hidden />} title={t('manage.centre.noEntries')} />}
      />
      <Dialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={t('manage.centre.withdrawTitle')}
        description={target ? `${target.code} · ${target.title}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => withdraw.mutate()} loading={withdraw.isPending} disabled={!reason.trim()}>
              {t('manage.centre.withdrawConfirm')}
            </Button>
          </>
        }
      >
        <Field label={t('manage.centre.reason')} help={t('manage.centre.withdrawHelp')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
        </Field>
      </Dialog>
    </>
  );
}

// ── Q&A ─────────────────────────────────────────────────────────────────────
export function QaTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [target, setTarget] = useState<QuestionRow | null>(null);
  const [answer, setAnswer] = useState('');
  const [publish, setPublish] = useState(true);
  const list = useQuery({
    queryKey: queryKeys.challenges.questions(detail.id),
    queryFn: () => api.get<QuestionRow[]>(`/challenges/${detail.id}/questions`),
  });
  const save = useMutation({
    mutationFn: () => api.post(`/questions/${target!.id}/answer`, { answer, is_published: publish }),
    onSuccess: async () => {
      toast.success(t('manage.centre.answerSaved'));
      setTarget(null);
      await qc.invalidateQueries({ queryKey: queryKeys.challenges.questions(detail.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const open = (q: QuestionRow) => {
    setTarget(q);
    setAnswer(q.answer ?? '');
    setPublish(q.answer ? q.is_published : true);
  };

  if (list.isLoading) return <Skeleton className="h-40 w-full" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data?.length) return <EmptyState icon={<MessageCircleQuestion className="h-8 w-8" aria-hidden />} title={t('manage.centre.noQuestions')} />;

  return (
    <>
      <ul className="space-y-3">
        {list.data.map((q) => (
          <li key={q.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="reading space-y-2">
                  <p className="font-medium text-ink">{q.question}</p>
                  <p className="text-sm text-ink-muted">
                    {t('manage.centre.askedBy', { name: q.asked_by ?? '—', date: formatDateTime(q.asked_at) })}
                  </p>
                  {q.answer ? (
                    <>
                      <p className="whitespace-pre-line text-ink">{q.answer}</p>
                      <p className="text-sm text-ink-muted">{t('manage.centre.answeredBy', { name: q.answered_by ?? '—', date: formatDateTime(q.answered_at) })}</p>
                    </>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {q.answer ? (
                    <Badge tone={q.is_published ? 'success' : 'neutral'}>{q.is_published ? t('manage.centre.published') : t('manage.centre.notPublished')}</Badge>
                  ) : (
                    <Badge tone="warning">{t('manage.centre.needsAnswer')}</Badge>
                  )}
                  {detail.can_manage && (
                    <Button variant={q.answer ? 'ghost' : 'primary'} size="sm" onClick={() => open(q)}>
                      {q.answer ? t('manage.centre.editAnswer') : t('manage.centre.answer')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Dialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={t('manage.centre.answerTitle')}
        description={target?.question}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!answer.trim()}>
              {publish ? t('manage.centre.publishAnswer') : t('manage.centre.saveAnswer')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('manage.centre.answer')} required>
            <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={5} maxLength={2000} />
          </Field>
          <Checkbox checked={publish} onChange={(e) => setPublish(e.target.checked)} label={t('manage.centre.publishToAll')} description={t('manage.centre.publishToAllHelp')} />
        </div>
      </Dialog>
    </>
  );
}

// ── Rounds ──────────────────────────────────────────────────────────────────
function RoundCard({ round, detail, refresh }: TabProps & { round: RoundInfo }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<AssignResult | null>(null);
  const assign = useMutation({
    mutationFn: () => api.post<AssignResult>(`/review-rounds/${round.id}/actions/assign`),
    onSuccess: async (r) => {
      setResult(r);
      toast.success(t('manage.centre.assigned', { count: r.created }));
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remind = useMutation({
    mutationFn: () => api.post<{ reminded: number }>(`/review-rounds/${round.id}/actions/remind`),
    onSuccess: (r) => toast.success(t('manage.centre.reminded', { count: r.reminded })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pending = round.assigned - round.submitted;
  return (
    <Card>
      <CardHeader
        title={round.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={round.status} />
            {round.blind && <Badge tone="info">{t('manage.centre.blind')}</Badge>}
            {round.due_at && <span>{t('manage.centre.dueAt', { date: formatDateTime(round.due_at) })}</span>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink to={`/manage/challenges/${detail.id}/rounds/${round.id}`} variant="secondary" size="sm">
              {t('manage.centre.openResults')}
            </ButtonLink>
            {round.shortlist && (
              <ButtonLink to={`/manage/challenges/${detail.id}/shortlist/${round.shortlist.id}`} variant="secondary" size="sm">
                {t('manage.centre.openShortlist', { status: statusLabel(round.shortlist.status) })}
              </ButtonLink>
            )}
          </div>
        }
      />
      <div className="mt-4 space-y-3">
        {round.assigned > 0 ? (
          <>
            <ProgressBar value={round.submitted} max={round.assigned} label={t('manage.centre.reviewProgress')} tone={round.overdue ? 'warning' : 'primary'} />
            <p className="tabular text-sm text-ink-muted">
              {t('manage.centre.reviewCounts', { assigned: round.assigned, submitted: round.submitted, overdue: round.overdue })}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-muted">{t('manage.centre.noAssignments')}</p>
        )}
        {detail.can_manage && round.status !== 'PUBLISHED' && round.status !== 'COMPLETED' && (
          <div className="flex flex-wrap gap-2">
            {detail.can_assign_judges && (
              <Button size="sm" icon={<UserCheck className="h-4 w-4" aria-hidden />} onClick={() => assign.mutate()} loading={assign.isPending}>
                {t('manage.centre.autoAssign')}
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<BellRing className="h-4 w-4" aria-hidden />} onClick={() => remind.mutate()} loading={remind.isPending} disabled={pending <= 0} disabledReason={t('manage.centre.nothingPending')}>
              {t('manage.centre.sendReminder')}
            </Button>
          </div>
        )}
        {result && (
          <Callout tone={result.short_of_reviewers.length ? 'warning' : 'info'} title={t('manage.centre.assignResult', { created: result.created, entries: result.entries })}>
            {result.entries === 0 && <p>{t('manage.centre.assignNothing')}</p>}
            {result.exclusions.length > 0 && (
              <>
                <p className="font-medium">{t('manage.centre.exclusions')}</p>
                <ul className="list-disc pl-5">
                  {result.exclusions.map((x, i) => (
                    <li key={i}>
                      {x.reviewer} — {x.entry} ({t(`manage.coi.${x.reason}`, statusLabel(x.reason))})
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.short_of_reviewers.length > 0 && <p>{t('manage.centre.shortOfReviewers', { entries: result.short_of_reviewers.join(', ') })}</p>}
          </Callout>
        )}
      </div>
    </Card>
  );
}

export function RoundsTab(props: TabProps) {
  const { t } = useTranslation();
  const { detail } = props;
  if (!detail.rounds.length) return <EmptyState title={t('manage.centre.noRounds')} />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('manage.centre.panel')}
          subtitle={`${t('manage.centre.panelCount', { count: detail.judges.length })} · ${t('judging.goToJudges')}`}
          actions={
            <ButtonLink to={`/manage/challenges/${detail.id}?tab=judges`} variant="secondary" size="sm">
              {t('judging.openJudges')}
            </ButtonLink>
          }
        />
        <ul className="mt-3 flex flex-wrap gap-2">
          {detail.judges.map((j) => j && <li key={j.id}><Badge>{j.full_name}</Badge></li>)}
        </ul>
      </Card>
      {detail.rounds.map((r) => (
        <RoundCard key={r.id} round={r} {...props} />
      ))}
    </div>
  );
}

// ── Demo Day ────────────────────────────────────────────────────────────────
export function DemoTab({ detail, refresh }: TabProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', starts_at: '', slot_count: 6, duration_min: 20, location: '', online_link: '' });
  const create = useMutation({
    mutationFn: () =>
      api.post(`/challenges/${detail.id}/demo-event`, {
        title: form.title || t('manage.centre.demoDefaultTitle'),
        starts_at: fromLocalInputValue(form.starts_at),
        slot_count: form.slot_count,
        duration_min: form.duration_min,
        location: form.location || null,
        online_link: form.online_link || null,
      }),
    onSuccess: async () => {
      toast.success(t('manage.centre.demoCreated'));
      setOpen(false);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ev = detail.demo_event;

  return (
    <>
      {!ev ? (
        <EmptyState
          icon={<CalendarPlus className="h-8 w-8" aria-hidden />}
          title={t('manage.centre.noDemo')}
          action={detail.can_manage ? <Button onClick={() => setOpen(true)}>{t('manage.centre.createDemo')}</Button> : undefined}
        />
      ) : (
        <Card>
          <CardHeader
            title={ev.title}
            subtitle={[formatDateTime(ev.starts_at), ev.location].filter(Boolean).join(' · ')}
            actions={<Badge tone="info">{t('manage.centre.slotsBooked', { booked: ev.slots.filter((s) => s.entry).length, total: ev.slots.length })}</Badge>}
          />
          {ev.online_link && (
            <p className="mt-2 text-sm">
              <a href={ev.online_link} className="text-primary underline" target="_blank" rel="noreferrer">
                {ev.online_link}
              </a>
            </p>
          )}
          <ul className="mt-4 divide-y divide-line">
            {ev.slots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="tabular text-ink">
                  {formatDateTime(s.starts_at)} · {t('manage.centre.minutes', { count: s.duration_min })}
                </span>
                {s.entry ? (
                  <ButtonLink to={`/entries/${s.entry.id}`} variant="ghost" size="sm">
                    {s.entry.code} · {s.entry.title}
                  </ButtonLink>
                ) : (
                  <span className="text-ink-muted">{t('manage.centre.slotFree')}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('manage.centre.createDemo')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.starts_at || form.slot_count < 1}>
              {t('manage.centre.createDemo')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('manage.centre.demoTitle')} className="sm:col-span-2">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('manage.centre.demoDefaultTitle')} />
          </Field>
          <Field label={t('manage.centre.demoStarts')} required className="sm:col-span-2">
            <Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
          </Field>
          <Field label={t('manage.centre.demoSlots')}>
            <Input type="number" min={1} max={40} value={form.slot_count} onChange={(e) => setForm({ ...form, slot_count: Number(e.target.value) || 0 })} />
          </Field>
          <Field label={t('manage.centre.demoDuration')}>
            <Input type="number" min={5} max={120} value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: Number(e.target.value) || 20 })} />
          </Field>
          <Field label={t('manage.centre.demoLocation')} className="sm:col-span-2">
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
          <Field label={t('manage.centre.demoLink')} className="sm:col-span-2">
            <Input type="url" value={form.online_link} onChange={(e) => setForm({ ...form, online_link: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────
export function ResultsTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const status = detail.results_status;
  return (
    <Card>
      <CardHeader
        title={t('manage.centre.resultsTitle')}
        subtitle={t(`manage.centre.resultsStatus.${status ?? 'NONE'}`)}
        actions={
          <ButtonLink to={`/manage/challenges/${detail.id}/results`} variant={status === 'PUBLISHED' ? 'secondary' : 'primary'}>
            {t('manage.centre.openResultsDecision')}
          </ButtonLink>
        }
      />
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(
          [
            ['finalists', detail.numbers.finalists],
            ['winners', detail.numbers.winners],
            ['feedback', detail.numbers.feedback_published],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm text-ink-muted">{t(`manage.centre.num.${k}`)}</dt>
            <dd className="tabular text-2xl font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-ink-muted">{t('manage.centre.resultsHumanNote')}</p>
    </Card>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
export function SettingsTab({ detail }: TabProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader
        title={t('manage.centre.settingsTitle')}
        subtitle={detail.status_code === 'DRAFT' ? t('manage.centre.settingsDraft') : t('manage.centre.settingsLocked')}
        actions={
          detail.can_manage ? (
            <ButtonLink to={`/manage/challenges/${detail.id}/edit`} icon={<Settings2 className="h-4 w-4" aria-hidden />}>
              {t('manage.centre.editChallenge')}
            </ButtonLink>
          ) : undefined
        }
      />
      {detail.status_code === 'DRAFT' && (
        <ul className="mt-4 space-y-1.5 text-sm">
          {detail.publish_checklist.map((c) => (
            <li key={c.code} className={c.ok ? 'text-success' : 'text-ink-muted'}>
              {c.ok ? '✓' : '○'} {t(`manage.checklist.${c.code}`, c.label)}
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-muted">{t('manage.list.owner')}</dt>
          <dd className="font-medium text-ink">{detail.owner?.full_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{t('manage.builder.sponsor')}</dt>
          <dd className="font-medium text-ink">{detail.sponsor?.full_name ?? '—'}</dd>
        </div>
      </dl>
    </Card>
  );
}

// ── Activity log ────────────────────────────────────────────────────────────
export function ActivityTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const log = useQuery({
    queryKey: ['manage', 'challenge', detail.id, 'activity'],
    queryFn: () => api.get<ActivityRow[]>(`/challenges/${detail.id}/activity`),
  });
  if (log.isLoading) return <Skeleton className="h-40 w-full" />;
  if (log.isError) return <ErrorState error={log.error} onRetry={() => log.refetch()} />;
  if (!log.data?.length) return <EmptyState title={t('manage.centre.noActivity')} />;
  return (
    <Card>
      <ol className="divide-y divide-line">
        {log.data.map((a, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
            <span className="text-ink">
              <Badge className="mr-2">{statusLabel(a.kind)}</Badge>
              {a.what}
            </span>
            <span className="text-ink-muted">
              {a.who} · {formatDateTime(a.at)}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
