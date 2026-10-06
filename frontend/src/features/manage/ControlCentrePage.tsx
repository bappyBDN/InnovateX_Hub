import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import { ButtonLink, ErrorState, PageHeader, PageSkeleton, Tabs, isNotFound } from '@/components/ui';
import { ChallengeFeedbackTab } from '@/features/judging/ChallengeFeedbackTab';
import { ChallengeJudgesTab } from '@/features/judging/ChallengeJudgesTab';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { tr } from '@/utils/i18n';
import { OverviewTab } from './centre/OverviewTab';
import { ActivityTab, DemoTab, EntriesTab, QaTab, ResultsTab, RoundsTab, SettingsTab } from './centre/tabs';
import type { CentreDetail } from './centre/types';

const TABS = ['overview', 'entries', 'qa', 'judges', 'feedback', 'rounds', 'demo', 'results', 'settings', 'activity'] as const;
type TabKey = (typeof TABS)[number];

export default function ControlCentrePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const raw = search.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'overview';

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
          { value: 'feedback', label: t('judgeFeedback.tab') },
          { value: 'rounds', label: t('manage.centre.tab.rounds'), count: detail.rounds.length },
          { value: 'demo', label: t('manage.centre.tab.demo') },
          { value: 'results', label: t('manage.centre.tab.results') },
          { value: 'settings', label: t('manage.centre.tab.settings') },
          { value: 'activity', label: t('manage.centre.tab.activity') },
        ]}
      />

      <div role="tabpanel" aria-label={tab === 'judges' ? t('judging.tab') : tab === 'feedback' ? t('judgeFeedback.tab') : t(`manage.centre.tab.${tab}`)}>
        {tab === 'judges' && <ChallengeJudgesTab challengeId={detail.id} refresh={refresh} />}
        {tab === 'feedback' && <ChallengeFeedbackTab challengeId={detail.id} />}
        {tab === 'overview' && <OverviewTab {...props} />}
        {tab === 'entries' && <EntriesTab {...props} />}
        {tab === 'qa' && <QaTab {...props} />}
        {tab === 'rounds' && <RoundsTab {...props} />}
        {tab === 'demo' && <DemoTab {...props} />}
        {tab === 'results' && <ResultsTab {...props} />}
        {tab === 'settings' && <SettingsTab {...props} />}
        {tab === 'activity' && <ActivityTab {...props} />}
      </div>
    </div>
  );
}
