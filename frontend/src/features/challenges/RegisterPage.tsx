import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Link2, User, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError, api, idempotencyKey } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, DeadlineCountdown, JourneyRail } from '@/components/domain';
import { Button, ButtonLink, Card, Checkbox, ErrorState, Field, Input, PageHeader, PageSkeleton, Textarea, isNotFound } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/dates';
import { tr } from '@/utils/i18n';
import type { ChallengeDetailData, EntryCardData } from './types';

type Mode = 'INDIVIDUAL' | 'TEAM';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold text-ink">
        <span className="tabular flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-primary-fg">{n}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

export default function RegisterPage() {
  const { t } = useTranslation();
  const { slug = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.challenges.detail(slug), queryFn: () => api.get<ChallengeDetailData>(`/challenges/${slug}`) });

  const [mode, setMode] = useState<Mode | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [teamName, setTeamName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<EntryCardData | null>(null);
  const [key] = useState(idempotencyKey);

  const register = useMutation({
    mutationFn: (entryType: Mode) =>
      api.post<EntryCardData>(
        `/challenges/${q.data!.id}/entries`,
        { entry_type: entryType, title: title.trim(), summary: summary.trim() || null, team_name: entryType === 'TEAM' ? teamName.trim() : null, accept_declaration: accepted },
        { headers: { 'Idempotency-Key': key } },
      ),
    onSuccess: (entry) => {
      setDone(entry);
      toast.success(t('challenges.registered'));
      void qc.invalidateQueries({ queryKey: queryKeys.challenges.all });
      void qc.invalidateQueries({ queryKey: queryKeys.entries.all });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
    onError: (e) => setServerError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', t('error.generic'))),
  });

  if (q.isLoading) return <PageSkeleton />;
  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const name = tr(c.title_i18n);
  const crumbs = [{ label: t('challenges.listTitle'), to: '/challenges' }, { label: name, to: `/challenges/${c.slug}` }, { label: t('challenges.register') }];
  const methodology = c.phases.find((p) => p.phase_type === 'METHODOLOGY');

  if (done) {
    return (
      <div className="mx-auto max-w-reading space-y-5">
        <PageHeader title={t('challenges.registeredTitle')} breadcrumbs={crumbs} className="mb-0" />
        <Card className="space-y-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
            <div>
              <p className="font-semibold text-ink">{done.title}</p>
              <p className="text-ink-muted">{t('challenges.entryCodeLine', { code: done.code })}{done.team ? ` · ${done.team.name}` : ''}</p>
            </div>
          </div>
          <JourneyRail stages={done.journey} size="full" />
          {methodology && (
            <Callout tone="info" title={t('challenges.methodologyDeadline', { date: formatDateTime(methodology.closes_at) })}>
              <DeadlineCountdown closesAt={methodology.closes_at} compact />
            </Callout>
          )}
          {done.team && (
            <Callout tone="spark" title={t('challenges.inviteTeamTitle')} action={<ButtonLink to={`/teams/${done.team.id}`} icon={<Link2 className="h-4 w-4" aria-hidden />}>{t('challenges.createJoinLink')}</ButtonLink>}>
              {t('challenges.inviteTeamBody')}
            </Callout>
          )}
          <div className="flex flex-wrap gap-2">
            <ButtonLink to={`/entries/${done.id}`} variant={done.team ? 'secondary' : 'primary'}>{t('challenges.openMyEntry')}</ButtonLink>
            <ButtonLink to={`/challenges/${c.slug}`} variant="ghost">{t('challenges.backToChallenge')}</ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  // Blocks: each has a clear message and a next step.
  let block: React.ReactNode = null;
  if (c.my_entry_id) {
    block = (
      <Callout tone="info" title={t('challenges.alreadyRegistered')} action={<ButtonLink to={`/entries/${c.my_entry_id}`}>{t('challenges.viewMyEntry')}</ButtonLink>}>
        {c.my_entry?.team && <Link to={`/teams/${c.my_entry.team.id}`} className="text-primary hover:underline">{t('challenges.goToTeam', { team: c.my_entry.team.name })}</Link>}
      </Callout>
    );
  } else if (!c.registration.is_open) {
    block = (
      <Callout tone="warning" title={c.status_code === 'SCHEDULED' ? t('challenges.registrationOpensOn', { date: formatDateTime(c.registration.opens_at) }) : t('challenges.registrationClosedOn', { date: formatDateTime(c.registration.closes_at) })}
        action={<ButtonLink to={`/challenges/${c.slug}`} variant="secondary">{t('challenges.backToChallenge')}</ButtonLink>} />
    );
  } else if (!c.eligibility.eligible) {
    block = <Callout tone="warning" title={c.eligibility.reason ?? t('challenges.notEligibleGeneric')} action={<ButtonLink to="/challenges" variant="secondary">{t('challenges.browseOthers')}</ButtonLink>} />;
  }
  if (block) {
    return (
      <div className="mx-auto max-w-reading">
        <PageHeader title={t('challenges.registerTitle', { name })} breadcrumbs={crumbs} />
        {block}
      </div>
    );
  }

  const modes: Mode[] = c.participation_mode === 'BOTH' ? ['INDIVIDUAL', 'TEAM'] : [c.participation_mode];
  const chosen: Mode | null = mode ?? (modes.length === 1 ? modes[0] : null);
  const errors = {
    mode: !chosen ? t('challenges.errMode') : null,
    title: title.trim().length < 3 ? t('challenges.errTitle') : null,
    team: chosen === 'TEAM' && !teamName.trim() ? t('challenges.errTeamName') : null,
    accepted: !accepted ? t('challenges.errDeclaration') : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const existingEntry = serverError?.code === 'ALREADY_REGISTERED' ? (serverError.details.entry_id as string | undefined) : undefined;

  return (
    <form
      className="mx-auto max-w-reading space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setShowErrors(true);
        setServerError(null);
        if (!hasErrors && chosen) register.mutate(chosen);
      }}
    >
      <PageHeader title={t('challenges.registerTitle', { name })} breadcrumbs={crumbs} className="mb-2" subtitle={<DeadlineCountdown closesAt={c.registration.closes_at} prefix={t('challenges.registrationClosesIn')} />} />

      {serverError && (
        <Callout tone="danger" title={serverError.message} action={existingEntry ? <ButtonLink to={`/entries/${existingEntry}`} size="sm">{t('challenges.viewMyEntry')}</ButtonLink> : undefined} />
      )}
      {showErrors && hasErrors && (
        <div role="alert" className="rounded-panel border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <p className="font-medium">{t('challenges.fixErrors')}</p>
          <ul className="list-disc pl-5">{Object.values(errors).filter(Boolean).map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}

      <Step n={1} title={t('challenges.stepHow')}>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('challenges.stepHow')}>
          {modes.map((m) => {
            const active = chosen === m;
            return (
              <label key={m} className={cn('flex cursor-pointer items-start gap-3 rounded-panel border p-4', active ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary')}>
                <input type="radio" name="mode" className="mt-1 accent-[rgb(var(--primary))]" checked={active} onChange={() => setMode(m)} />
                <span>
                  <span className="flex items-center gap-2 font-medium text-ink">
                    {m === 'TEAM' ? <Users className="h-4 w-4" aria-hidden /> : <User className="h-4 w-4" aria-hidden />}
                    {m === 'TEAM' ? t('challenges.asTeam') : t('challenges.asIndividual')}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {m === 'TEAM' ? t('challenges.asTeamHint', { min: c.team_min_size, max: c.team_max_size }) : t('challenges.asIndividualHint')}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {showErrors && errors.mode && <p className="mt-2 text-sm text-danger" role="alert">{errors.mode}</p>}
      </Step>

      <Step n={2} title={t('challenges.stepDetails')}>
        <div className="space-y-4">
          <Field label={t('challenges.workingTitle')} required help={t('challenges.workingTitleHelp')} error={showErrors ? errors.title : null} hint={`${title.length} / 250`}>
            <Input value={title} maxLength={250} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          {chosen === 'TEAM' && (
            <Field label={t('challenges.teamName')} required error={showErrors ? errors.team : null}>
              <Input value={teamName} maxLength={120} onChange={(e) => setTeamName(e.target.value)} />
            </Field>
          )}
          <Field label={t('challenges.shortSummary')} help={t('challenges.shortSummaryHelp')} hint={`${summary.length} / 600`}>
            <Textarea value={summary} maxLength={600} rows={3} onChange={(e) => setSummary(e.target.value)} />
          </Field>
        </div>
      </Step>

      <Step n={3} title={t('challenges.stepAgree')}>
        <details className="mb-4 rounded-control bg-canvas px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-primary">{t('challenges.readRules')}</summary>
          <p className="mt-2 whitespace-pre-line text-ink">{tr(c.rules_i18n)}</p>
        </details>
        <Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)} label={t('challenges.declaration')} />
        {showErrors && errors.accepted && <p className="mt-2 text-sm text-danger" role="alert">{errors.accepted}</p>}
      </Step>

      <div className="sticky bottom-16 z-10 flex flex-wrap justify-end gap-2 rounded-panel border border-line bg-surface p-3 md:static md:border-0 md:bg-transparent md:p-0">
        <ButtonLink to={`/challenges/${c.slug}`} variant="secondary">{t('common.cancel')}</ButtonLink>
        <Button type="submit" loading={register.isPending}>{t('challenges.register')}</Button>
      </div>
    </form>
  );
}
