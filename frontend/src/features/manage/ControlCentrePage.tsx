import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import { ButtonLink, ErrorState, PageHeader, PageSkeleton, Tabs, isNotFound } from '@/components/ui';
import { ChallengeFeedbackTab } from '@/features/judging/ChallengeFeedbackTab';
import { PresentationsTab } from './centre/PresentationsTab';
import { ChallengeJudgesTab } from '@/features/judging/ChallengeJudgesTab';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { cn } from '@/utils/cn';
import { tr } from '@/utils/i18n';
import { OverviewTab } from './centre/OverviewTab';
import { ActivityTab, DemoTab, EntriesTab, QaTab, ResultsTab, RoundsTab, SettingsTab } from './centre/tabs';
import type { CentreDetail } from './centre/types';

const TABS = ['overview', 'entries', 'qa', 'judges', 'rounds', 'demo', 'results', 'settings', 'activity'] as const;
type TabKey = (typeof TABS)[number];
/** Older links: judge feedback now sits under Judges, presentation requests under Demo Day. */
const MERGED: Record<string, TabKey> = { feedback: 'judges', presentations: 'demo' };

/** The five things a person needs to know about a challenge; the detailed phase is shown in the badge. */
const FAMILIES = ['DRAFT', 'OPEN', 'IN_REVIEW', 'RESULTS_PUBLISHED', 'CLOSED'] as const;
const FAMILY_OF: Record<string, (typeof FAMILIES)[number]> = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'OPEN',
  OPEN_FOR_REGISTRATION: 'OPEN',
  METHODOLOGY_OPEN: 'OPEN',
  BUILD: 'OPEN',
  FINAL_SUBMISSION: 'OPEN',
  METHODOLOGY_REVIEW: 'IN_REVIEW',
  SHORTLISTING: 'IN_REVIEW',
  PROTOTYPE_REVIEW: 'IN_REVIEW',
  DEMO_AND_JUDGING: 'IN_REVIEW',
  RESULTS_PENDING_APPROVAL: 'IN_REVIEW',
  RESULTS_PUBLISHED: 'RESULTS_PUBLISHED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CLOSED',
  ON_HOLD: 'CLOSED',
};

function StageTrack({ status }: { status: string }) {
  const { t } = useTranslation();
  const current = FAMILIES.indexOf(FAMILY_OF[status] ?? 'OPEN');
  return (
    <ol className="grid grid-cols-5 gap-1 sm:gap-2" aria-label={t('manage.centre.stageTrack')}>
      {FAMILIES.map((f, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        return (
          <li key={f} aria-current={state === 'current' ? 'step' : undefined} className="min-w-0">
            <span
              className={cn(
                'block h-1.5 rounded-full',
                state === 'upcoming' ? 'bg-line' : state === 'current' ? 'bg-primary' : 'bg-primary/40',
              )}
            />
            <span
              className={cn(
                'mt-1.5 block truncate text-center text-xs sm:text-sm',
                state === 'current' ? 'font-semibold text-ink' : 'text-ink-muted',
              )}
            >
              {t(`manage.list.group.${f}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ControlCentrePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const raw = search.get('tab') ?? '';
  const tab: TabKey = MERGED[raw] ?? (TABS.includes(raw as TabKey) ? (raw as TabKey) : 'overview');

  const query = useQuery({
    queryKey: queryKeys.manage.challenge(id),
    queryFn: () => api.get<CentreDetail>(`/manage/challenges/${id}`),
  });

  if (isNotFound(query.error)) return <NotFoundPage />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.isLoading || !query.data) return <PageSkeleton rows={6} />;

  const detail = query.data;
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.manage.challenge(id) }),
      qc.invalidateQueries({ queryKey: ['manage', 'challenges'] }),
      qc.invalidateQueries({ queryKey: queryKeys.challenges.all }),
    ]);
  const props = { detail, refresh };
  const isDraft = detail.status_code === 'DRAFT';

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr(detail.title_i18n)}
        subtitle={t('manage.centre.subtitle')}
        breadcrumbs={[{ label: t('manage.list.pageTitle'), to: '/manage/challenges' }, { label: detail.code }]}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.status_code} />
            {detail.domain && <span className="text-sm text-ink-muted">{tr(detail.domain.name_i18n)}</span>}
          </span>
        }
        actions={
          <>
            {!isDraft && (
              <ButtonLink to={`/challenges/${detail.slug}`} variant="secondary" icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
                {t('manage.centre.viewPublicPage')}
              </ButtonLink>
            )}
            {detail.can_manage && (
              <ButtonLink to={`/manage/challenges/${detail.id}/edit`} icon={<Pencil className="h-4 w-4" aria-hidden />}>
                {isDraft ? t('manage.centre.continueSetup') : t('manage.centre.editChallenge')}
              </ButtonLink>
            )}
          </>
        }
      />

      <StageTrack status={detail.status_code} />

      {isDraft && <Callout tone="info">{t('manage.centre.draftNote')}</Callout>}
      {!detail.can_manage && <Callout tone="info">{t('manage.centre.readOnly')}</Callout>}

      <Tabs
        ariaLabel={t('manage.centre.subtitle')}
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams(search);
          next.set('tab', v);
          setSearch(next, { replace: true });
        }}
        tabs={[
          { value: 'overview', label: t('manage.centre.tab.overview') },
          { value: 'entries', label: t('manage.centre.tab.entries'), count: detail.numbers.registered },
          { value: 'qa', label: t('manage.centre.tab.qa') },
          { value: 'judges', label: t('judging.tab'), count: detail.judges.length },
          { value: 'rounds', label: t('manage.centre.tab.rounds'), count: detail.rounds.length },
          { value: 'demo', label: t('manage.centre.tab.demo') },
          { value: 'results', label: t('manage.centre.tab.results') },
          { value: 'settings', label: t('manage.centre.tab.settings') },
          { value: 'activity', label: t('manage.centre.tab.activity') },
        ]}
      />

      <div role="tabpanel" aria-label={tab === 'judges' ? t('judging.tab') : t(`manage.centre.tab.${tab}`)}>
        {tab === 'judges' && (
          <div className="space-y-8">
            <ChallengeJudgesTab challengeId={detail.id} refresh={refresh} />
            <section aria-labelledby="judge-feedback" className="space-y-3">
              <h2 id="judge-feedback" className="text-lg font-semibold text-ink">
                {t('judgeFeedback.tab')}
              </h2>
              <ChallengeFeedbackTab challengeId={detail.id} />
            </section>
          </div>
        )}
        {tab === 'overview' && <OverviewTab {...props} />}
        {tab === 'entries' && <EntriesTab {...props} />}
        {tab === 'qa' && <QaTab {...props} />}
        {tab === 'rounds' && <RoundsTab {...props} />}
        {tab === 'demo' && (
          <div className="space-y-8">
            <DemoTab {...props} />
            <section aria-labelledby="presentation-requests" className="space-y-3">
              <h2 id="presentation-requests" className="text-lg font-semibold text-ink">
                {t('presentation.tab')}
              </h2>
              <PresentationsTab challengeId={detail.id} />
            </section>
          </div>
        )}
        {tab === 'results' && <ResultsTab {...props} />}
        {tab === 'settings' && <SettingsTab {...props} />}
        {tab === 'activity' && <ActivityTab {...props} />}
      </div>
    </div>
  );
}
