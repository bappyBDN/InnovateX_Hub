import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Lock, MessageCircleQuestion, Trophy, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, DeadlineCountdown, JourneyRail, StatusBadge } from '@/components/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  PageSkeleton,
  Spinner,
  Tabs,
  Textarea,
  isNotFound,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/dates';
import { money, statusLabel } from '@/utils/format';
import { isFallbackLanguage, tr, type I18nText } from '@/utils/i18n';
import { participationText } from './ChallengeCard';
import type { ChallengeDetailData, Criterion, Question } from './types';

const TABS = ['overview', 'timeline', 'rules', 'resources', 'qa', 'entry'] as const;
type TabKey = (typeof TABS)[number];

function Prose({ title, text }: { title: string; text: I18nText }) {
  const { t } = useTranslation();
  const body = tr(text);
  if (!body) return null;
  return (
    <section>
      <h3 className="mb-1 text-lg font-semibold text-ink">{title}</h3>
      <p className="reading whitespace-pre-line text-ink">{body}</p>
      {isFallbackLanguage(text) && <p className="mt-1 text-xs text-ink-muted">{t('common.shownInEnglish')}</p>}
    </section>
  );
}

function CriteriaTable({ title, items }: { title: string; items: Criterion[] }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-2 font-medium text-ink">{title}</h4>
      <ul className="divide-y divide-line rounded-panel border border-line">
        {items.map((c) => (
          <li key={c.name} className="flex items-start justify-between gap-4 px-4 py-2.5">
            <div className="min-w-0">
              <p className="font-medium text-ink">{tr(c.name_i18n, c.name)}</p>
              {c.guidance && <p className="text-sm text-ink-muted">{c.guidance}</p>}
            </div>
            <span className="tabular shrink-0 font-semibold text-ink" aria-label={t('challenges.weight', { value: c.weight_pct })}>
              {c.weight_pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QaTab({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [touched, setTouched] = useState(false);
  const list = useQuery({ queryKey: queryKeys.challenges.questions(slug), queryFn: () => api.get<Question[]>(`/challenges/${slug}/questions`) });
  const ask = useMutation({
    mutationFn: () => api.post(`/challenges/${slug}/questions`, { question: text.trim(), is_anonymous: anonymous }),
    onSuccess: () => {
      toast.success(t('challenges.questionSent'));
      setText('');
      setTouched(false);
      void qc.invalidateQueries({ queryKey: queryKeys.challenges.questions(slug) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const tooShort = text.trim().length < 5;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {list.isLoading ? (
          <Spinner />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<MessageCircleQuestion className="h-8 w-8" />} title={t('challenges.noQuestions')} />
        ) : (
          list.data!.map((q) => (
            <Card key={q.id} className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium text-ink">{q.question}</p>
                {q.is_mine && <Badge tone="primary">{t('challenges.yourQuestion')}</Badge>}
              </div>
              {q.answer ? (
                <div className="rounded-control bg-canvas px-3 py-2">
                  <p className="whitespace-pre-line text-ink">{q.answer}</p>
                  <p className="mt-1 text-xs text-ink-muted">{t('challenges.answeredOn', { date: formatDateTime(q.answered_at) })}</p>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">{t('challenges.waitingForAnswer')}</p>
              )}
            </Card>
          ))
        )}
      </div>
      <Card className="h-fit">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!tooShort) ask.mutate();
          }}
        >
          <h3 className="text-lg font-semibold text-ink">{t('challenges.askQuestion')}</h3>
          <Field label={t('challenges.yourQuestionLabel')} required error={touched && tooShort ? t('challenges.questionTooShort') : null} hint={`${text.length} / 500`}>
            <Textarea value={text} maxLength={500} onChange={(e) => setText(e.target.value)} onBlur={() => setTouched(true)} />
          </Field>
          <Checkbox checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} label={t('challenges.askAnonymously')} description={t('challenges.askAnonymouslyHint')} />
          <Button type="submit" loading={ask.isPending}>
            {t('challenges.sendQuestion')}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function ChallengeDetailPage() {
  const { t } = useTranslation();
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: queryKeys.challenges.detail(slug), queryFn: () => api.get<ChallengeDetailData>(`/challenges/${slug}`) });

  if (q.isLoading) return <PageSkeleton />;
  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const entry = c.my_entry;
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested && TABS.includes(requested) && (requested !== 'entry' || entry) ? requested : 'overview';
  const reg = c.registration;
  const title = tr(c.title_i18n);

  // One clear next step: Register → Continue methodology → View my entry → See results.
  let action: React.ReactNode;
  if (c.results_published_at) {
    action = <ButtonLink to="/results" size="lg">{t('challenges.seeResults')}</ButtonLink>;
  } else if (entry) {
    action =
      entry.next_step.action_path && entry.next_step.action_label ? (
        <ButtonLink to={entry.next_step.action_path} size="lg">{entry.next_step.action_label}</ButtonLink>
      ) : (
        <ButtonLink to={`/entries/${entry.id}`} size="lg">{t('challenges.viewMyEntry')}</ButtonLink>
      );
  } else if (reg.is_open) {
    action = c.eligibility.eligible ? (
      <ButtonLink to={`/challenges/${c.slug}/register`} size="lg">{t('challenges.register')}</ButtonLink>
    ) : (
      <Button size="lg" disabled disabledReason={c.eligibility.reason ?? undefined}>{t('challenges.register')}</Button>
    );
  }

  const regLine = reg.is_open ? (
    <DeadlineCountdown closesAt={reg.closes_at} prefix={t('challenges.registrationClosesIn')} />
  ) : reg.opens_at && c.status_code === 'SCHEDULED' ? (
    <span className="text-sm text-ink-muted">{t('challenges.registrationOpensOn', { date: formatDateTime(reg.opens_at) })}</span>
  ) : reg.closes_at ? (
    <span className="text-sm text-ink-muted">{t('challenges.registrationClosedOn', { date: formatDateTime(reg.closes_at) })}</span>
  ) : null;

  return (
    <div>
      <PageHeader title={title} breadcrumbs={[{ label: t('challenges.listTitle'), to: '/challenges' }, { label: title }]} className="mb-4" meta={<StatusBadge status={c.status_code} />} />

      <Card padded={false} className="mb-5 overflow-hidden">
        <div className="h-3" style={{ backgroundColor: c.banner_color ?? 'rgb(var(--primary))' }} aria-hidden />
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 md:p-5">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink">
              <span className="tabular text-ink-muted">{c.code}</span>
              {c.domain && <Badge tone="primary">{tr(c.domain.name_i18n)}</Badge>}
              <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-ink-muted" aria-hidden />{participationText(t, c)}</span>
              {!!c.total_prize_budget && (
                <span className="inline-flex items-center gap-1.5"><Trophy className="h-4 w-4 text-spark" aria-hidden />{t('challenges.prizePoolValue', { amount: money(c.total_prize_budget, c.currency_code) })}</span>
              )}
            </div>
            {c.sponsor && <p className="text-sm text-ink-muted">{t('challenges.sponsorLine', { name: c.sponsor.full_name, title: c.sponsor.job_title ?? '' })}</p>}
            {regLine}
            {reg.count !== null && <p className="text-sm text-ink-muted">{t('challenges.registeredCount', { count: reg.count })}</p>}
            {!entry && !c.eligibility.eligible && c.eligibility.reason && <p className="text-sm font-medium text-warning">{c.eligibility.reason}</p>}
          </div>
          {action && <div className="w-full sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">{action}</div>}
        </div>
      </Card>

      <div className="overflow-x-auto">
        <Tabs
          ariaLabel={title}
          value={tab}
          onChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}
          tabs={[
            { value: 'overview', label: t('challenges.tabOverview') },
            { value: 'timeline', label: t('challenges.tabTimeline') },
            { value: 'rules', label: t('challenges.tabRules') },
            { value: 'resources', label: t('challenges.tabResources'), count: c.resources.length },
            { value: 'qa', label: t('challenges.tabQa') },
            ...(entry ? [{ value: 'entry', label: t('challenges.tabMyEntry') }] : []),
          ]}
        />
      </div>

      <div className="mt-5">
        {tab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="space-y-5 lg:col-span-2">
              <Prose title={t('challenges.theProblem')} text={c.problem_statement_i18n} />
              <Prose title={t('challenges.background')} text={c.background_i18n} />
              <Prose title={t('challenges.successLooksLike')} text={c.expected_outcome_i18n} />
              <section>
                <h3 className="mb-1 text-lg font-semibold text-ink">{t('challenges.whoCanJoin')}</h3>
                <p className="text-ink">{c.who_can_join} · {participationText(t, c)}</p>
              </section>
            </Card>
            <Card className="h-fit space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-ink">{t('challenges.howJudged')}</h3>
                <p className="text-sm text-ink-muted">{t('challenges.howJudgedHint')}</p>
              </div>
              <CriteriaTable title={t('challenges.methodologyCriteria')} items={c.methodology_criteria} />
              <CriteriaTable title={t('challenges.finalCriteria')} items={c.final_criteria} />
              {c.blind_review && <p className="text-sm text-ink-muted">{t('challenges.blindReviewNote')}</p>}
            </Card>
          </div>
        )}

        {tab === 'timeline' && (
          <Card padded={false}>
            <ol className="divide-y divide-line">
              {c.phases.map((p) => (
                <li key={p.id} className={cn('flex flex-wrap items-center justify-between gap-3 px-4 py-3', p.status === 'OPEN' && 'bg-primary-soft')}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={cn('tabular mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium', p.status === 'OPEN' ? 'bg-primary text-primary-fg' : p.status === 'CLOSED' ? 'bg-neutral-soft text-ink-muted' : 'border border-line text-ink-muted')}>
                      {p.sequence_no}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{tr(p.name_i18n)}</p>
                      <p className="tabular text-sm text-ink-muted">{formatDateTime(p.opens_at)} → {formatDateTime(p.closes_at)}</p>
                      {p.note && <p className="text-sm text-ink-muted">{p.note === 'Only if the panel asks' ? t('challenges.onlyIfPanelAsks') : p.note}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {p.status === 'OPEN' && <DeadlineCountdown closesAt={p.closes_at} compact />}
                    <Badge tone={p.status === 'OPEN' ? 'primary' : 'neutral'}>{p.status === 'OPEN' ? t('challenges.phaseNow') : p.status === 'CLOSED' ? t('challenges.phaseDone') : t('challenges.phaseUpcoming')}</Badge>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {tab === 'rules' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="space-y-4">
              <Prose title={t('challenges.rulesTitle')} text={c.rules_i18n} />
              <p className="text-sm text-ink-muted">{t(`challenges.prototypePolicy.${c.prototype_policy}`, { defaultValue: statusLabel(c.prototype_policy) })}</p>
            </Card>
            <Card>
              <h3 className="mb-3 text-lg font-semibold text-ink">{t('challenges.prizes')}</h3>
              {c.prizes.length === 0 ? (
                <p className="text-ink-muted">{t('challenges.noPrizes')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {c.prizes.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={cn('tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold', p.rank_from === 1 ? 'bg-spark-soft text-spark-ink' : 'bg-neutral-soft text-ink-muted')}>
                          {p.rank_from === p.rank_to ? p.rank_from : `${p.rank_from}–${p.rank_to}`}
                        </span>
                        <div className="min-w-0">
                          <p className="text-ink">{p.description}</p>
                          <p className="text-xs text-ink-muted">{statusLabel(p.prize_type)}</p>
                        </div>
                      </div>
                      {p.amount != null && <span className="tabular shrink-0 font-semibold text-ink">{money(p.amount, p.currency_code)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {tab === 'resources' &&
          (c.resources.length === 0 ? (
            <EmptyState title={t('challenges.noResources')} />
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {c.resources.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className={cn('font-medium', r.locked ? 'text-ink-muted' : 'text-ink')}>{r.title}</p>
                      <p className="text-xs text-ink-muted">{statusLabel(r.resource_type)}</p>
                    </div>
                    {r.locked ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                        <Lock className="h-4 w-4" aria-hidden />
                        {r.access_level === 'SHORTLISTED' ? t('challenges.availableAfterShortlist') : t('challenges.availableAfterRegister')}
                      </span>
                    ) : r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                        {t('challenges.openResource')}
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))}

        {tab === 'qa' && <QaTab slug={c.slug} />}

        {tab === 'entry' && entry && (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="tabular text-sm text-ink-muted">{entry.code}{entry.team ? ` · ${entry.team.name}` : ''}</p>
                <h3 className="text-lg font-semibold text-ink">{entry.title}</h3>
              </div>
              <StatusBadge status={entry.status_code} />
            </div>
            <JourneyRail stages={entry.journey} size="compact" />
            <Callout tone={entry.next_step.tone === 'danger' ? 'danger' : entry.next_step.tone ?? 'info'} title={t('challenges.nextStep')}
              action={entry.next_step.action_path && entry.next_step.action_label ? <ButtonLink to={entry.next_step.action_path} size="sm">{entry.next_step.action_label}</ButtonLink> : undefined}>
              {entry.next_step.text}
            </Callout>
            <div className="flex flex-wrap gap-2">
              <ButtonLink to={`/entries/${entry.id}`} variant="secondary">{t('challenges.viewMyEntry')}</ButtonLink>
              {entry.team && <ButtonLink to={`/teams/${entry.team.id}`} variant="secondary">{t('challenges.openTeam')}</ButtonLink>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
