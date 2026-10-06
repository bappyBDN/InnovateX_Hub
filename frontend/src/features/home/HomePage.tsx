import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Award, CheckCircle2, Circle, Lightbulb, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { DeadlineCountdown, JourneyRail, StatusBadge, type JourneyStage } from '@/components/domain';
import { ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton, Stat } from '@/components/ui';
import { ChallengeCard } from '@/features/challenges/ChallengeCard';
import type { ChallengeCardData, EntryCardData } from '@/features/challenges/types';
import { cn } from '@/utils/cn';
import { formatDateTime, serverNow } from '@/utils/dates';
import { num } from '@/utils/format';
import { tr, type I18nText } from '@/utils/i18n';

interface NeedsItem {
  tone: 'info' | 'warning' | 'danger' | 'success';
  text: string;
  action_label: string | null;
  link: string | null;
  due_at: string | null;
}
interface IdeaCard {
  id: string;
  code: string | null;
  key: string;
  title: string;
  category: { name_i18n: I18nText } | null;
  current_state_code: string;
  journey: JourneyStage[];
  next_step: { text: string; action_label: string | null; action_path: string | null };
}
interface HomeData {
  first_name: string;
  needs_you: NeedsItem[];
  my_entries: EntryCardData[];
  open_challenges: ChallengeCardData[];
  open_challenges_total: number;
  my_ideas: IdeaCard[];
  recognition: { points: number; badges: number };
  is_new_user: boolean;
  judge?: { assigned: number; done: number; open: number; overdue: number; due_soon: number; next_due_at: string | null; next_assignment_id: string | null };
  program?: {
    challenges_by_status: Record<string, number>;
    registrations_today: number;
    submissions_today: number;
    reviews_open: number;
    reviews_overdue: number;
    shortlists_waiting: number;
    results_waiting: number;
    ideas_to_triage: number;
  };
  executive?: {
    active_challenges: number;
    entries: number;
    shortlisted: number;
    pilots: number;
    production: number;
    verified_hours_saved: number;
    verified_value_bdt: number;
  };
  system?: { failed_emails: number; failed_jobs: number; pending_outbox: number };
}

const toneIcon = {
  info: <Circle className="h-4 w-4 text-info" aria-hidden />,
  success: <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />,
  warning: <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />,
  danger: <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />,
};

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function HomePage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: queryKeys.home, queryFn: () => api.get<HomeData>('/home') });

  if (q.isLoading) return <PageSkeleton rows={5} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: import.meta.env.VITE_DISPLAY_TIMEZONE || 'Asia/Dhaka' }).format(serverNow()),
  );
  const greeting = hour < 12 ? t('home.goodMorning', { name: d.first_name }) : hour < 17 ? t('home.goodAfternoon', { name: d.first_name }) : t('home.goodEvening', { name: d.first_name });

  return (
    <div className="space-y-8">
      <PageHeader title={greeting} subtitle={t('home.subtitle')} className="mb-0" />

      {d.is_new_user && (
        <EmptyState
          icon={<Sparkles className="h-8 w-8" />}
          title={t('home.welcomeTitle')}
          description={t('home.welcomeBody')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink to="/challenges">{t('home.browseChallenges')}</ButtonLink>
              <ButtonLink to="/ideas/new" variant="secondary">
                {t('home.submitIdea')}
              </ButtonLink>
            </div>
          }
        />
      )}

      {!d.is_new_user && (
        <Section title={t('home.needsYou')}>
          {d.needs_you.length === 0 ? (
            <Card className="flex items-center gap-3 text-ink-muted">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
              {t('home.nothingNeeded')}
            </Card>
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {d.needs_you.map((n, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 shrink-0">{toneIcon[n.tone] ?? toneIcon.info}</span>
                      <div className="min-w-0">
                        <p className="text-ink">{n.text}</p>
                        {n.due_at && <DeadlineCountdown closesAt={n.due_at} className="mt-0.5" />}
                      </div>
                    </div>
                    {n.link && n.action_label && (
                      <ButtonLink to={n.link} size="sm" variant={i === 0 ? 'primary' : 'secondary'}>
                        {n.action_label}
                      </ButtonLink>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>
      )}

      {d.judge && (
        <Section title={t('home.judgeTitle')} action={d.judge.next_assignment_id ? <ButtonLink to={`/review/${d.judge.next_assignment_id}`} size="sm">{t('home.startNextReview')}</ButtonLink> : undefined}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('home.reviewsOpen')} value={d.judge.open} to="/review" hint={d.judge.next_due_at ? t('home.nextDue', { date: formatDateTime(d.judge.next_due_at) }) : undefined} />
            <Stat label={t('home.reviewsDueSoon')} value={d.judge.due_soon} to="/review" tone="warning" />
            <Stat label={t('home.reviewsOverdue')} value={d.judge.overdue} to="/review" tone="danger" hint={d.judge.overdue ? t('home.overdueHint') : undefined} />
            <Stat label={t('home.reviewsDone')} value={`${d.judge.done}/${d.judge.assigned}`} to="/review" />
          </div>
        </Section>
      )}

      {d.program && (
        <Section title={t('home.programTitle')} action={<ButtonLink to="/manage/challenges" size="sm" variant="secondary">{t('home.manageChallenges')}</ButtonLink>}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('home.registrationsToday')} value={d.program.registrations_today} to="/manage/challenges" />
            <Stat label={t('home.submissionsToday')} value={d.program.submissions_today} to="/manage/challenges" />
            <Stat label={t('home.reviewsOverdue')} value={d.program.reviews_overdue} to="/manage/challenges" hint={t('home.ofOpenReviews', { count: d.program.reviews_open })} />
            <Stat label={t('home.shortlistsWaiting')} value={d.program.shortlists_waiting} to="/manage/challenges" />
            <Stat label={t('home.resultsWaiting')} value={d.program.results_waiting} to="/manage/challenges" />
            <Stat label={t('home.ideasToTriage')} value={d.program.ideas_to_triage} to="/manage/ideas" />
          </div>
          <Card>
            <h3 className="mb-2 text-sm font-medium text-ink-muted">{t('home.challengesByPhase')}</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(d.program.challenges_by_status).map(([status, count]) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <StatusBadge status={status} />
                  <span className="tabular text-sm font-medium text-ink">{count}</span>
                </span>
              ))}
            </div>
          </Card>
        </Section>
      )}

      {d.executive && (
        <Section title={t('home.executiveTitle')} action={<ButtonLink to="/dashboards/executive" size="sm" variant="secondary">{t('home.openDashboards')}</ButtonLink>}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Stat label={t('home.activeChallenges')} value={d.executive.active_challenges} to="/dashboards/executive" />
            <Stat label={t('home.entries')} value={d.executive.entries} to="/dashboards/executive" />
            <Stat label={t('home.shortlisted')} value={d.executive.shortlisted} to="/dashboards/executive" />
            <Stat label={t('home.pilots')} value={d.executive.pilots} to="/dashboards/executive" />
            <Stat label={t('home.inProduction')} value={d.executive.production} to="/dashboards/executive" />
            <Stat label={t('home.verifiedHours')} value={num(d.executive.verified_hours_saved)} to="/dashboards/executive" />
            <Stat label={t('home.verifiedValue')} value={num(d.executive.verified_value_bdt)} to="/dashboards/executive" />
          </div>
        </Section>
      )}

      {d.system && (
        <Section title={t('home.systemTitle')}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label={t('home.failedEmails')} value={d.system.failed_emails} to="/admin/notifications" tone={d.system.failed_emails ? 'danger' : undefined} />
            <Stat label={t('home.failedJobs')} value={d.system.failed_jobs} to="/admin/notifications" />
            <Stat label={t('home.pendingOutbox')} value={d.system.pending_outbox} to="/admin/notifications" />
          </div>
        </Section>
      )}

      {d.my_entries.length > 0 && (
        <Section title={t('home.myEntries')} action={<Link to="/entries" className="text-sm font-medium text-primary hover:underline">{t('common.seeAll')}</Link>}>
          <div className="grid gap-3 lg:grid-cols-2">
            {d.my_entries.map((e) => (
              <Card key={e.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="tabular text-xs text-ink-muted">{e.code}{e.team ? ` · ${e.team.name}` : ''}</p>
                    <h3 className="font-semibold text-ink">
                      <Link to={`/entries/${e.id}`} className="hover:text-primary hover:underline">{e.title}</Link>
                    </h3>
                    <p className="text-sm text-ink-muted">{tr(e.challenge.title_i18n)}</p>
                  </div>
                  <StatusBadge status={e.status_code} />
                </div>
                <JourneyRail stages={e.journey} size="compact" />
                <p className={cn('text-sm', e.next_step.tone === 'warning' ? 'text-warning' : 'text-ink-muted')}>{e.next_step.text}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {d.open_challenges.length > 0 && (
        <Section
          title={t('home.openChallenges', { count: d.open_challenges_total })}
          action={<Link to="/challenges" className="text-sm font-medium text-primary hover:underline">{t('common.seeAll')}</Link>}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {d.open_challenges.map((c) => (
              <ChallengeCard key={c.id} challenge={c} />
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title={t('home.myIdeas')} action={<Link to="/ideas" className="text-sm font-medium text-primary hover:underline">{t('common.seeAll')}</Link>}>
            {d.my_ideas.length === 0 ? (
              <EmptyState
                icon={<Lightbulb className="h-8 w-8" />}
                title={t('home.noIdeas')}
                action={<ButtonLink to="/ideas/new" variant="secondary">{t('home.submitIdea')}</ButtonLink>}
              />
            ) : (
              <Card padded={false}>
                <ul className="divide-y divide-line">
                  {d.my_ideas.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="tabular text-xs text-ink-muted">{i.code ?? t('home.draft')}</p>
                        <Link to={`/ideas/${i.key}`} className="font-medium text-ink hover:text-primary hover:underline">{i.title}</Link>
                        <p className="text-sm text-ink-muted">{i.next_step.text}</p>
                      </div>
                      <StatusBadge status={i.current_state_code} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>
        </div>
        <Section title={t('home.recognition')}>
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Award className="h-5 w-5 text-spark" aria-hidden />{t('home.pointsValue', { count: d.recognition.points })}</span>} subtitle={t('home.badgesValue', { count: d.recognition.badges })} className="mb-2" />
            <p className="text-sm text-ink-muted">{t('home.recognitionHint')}</p>
            <ButtonLink to="/profile" variant="secondary" size="sm" className="mt-3">{t('home.openProfile')}</ButtonLink>
          </Card>
        </Section>
      </div>
    </div>
  );
}
