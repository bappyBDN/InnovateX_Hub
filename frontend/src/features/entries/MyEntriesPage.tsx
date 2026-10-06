import { useQuery } from '@tanstack/react-query';
import { Flag, User, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { DeadlineCountdown, JourneyRail, StatusBadge } from '@/components/domain';
import { ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { tr } from '@/utils/i18n';
import type { EntryCardData } from './types';

export function EntryCard({ entry }: { entry: EntryCardData }) {
  const { t } = useTranslation();
  const step = entry.next_step;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="tabular text-sm text-ink-muted">{entry.code}</p>
          <h2 className="text-lg font-semibold text-ink">
            <Link to={`/entries/${entry.id}`} className="hover:underline">
              {entry.title}
            </Link>
          </h2>
          <p className="text-sm text-ink-muted">{tr(entry.challenge.title_i18n)}</p>
        </div>
        <StatusBadge status={entry.status_code} />
      </div>
      <p className="flex items-center gap-1.5 text-sm text-ink-muted">
        {entry.team ? <Users className="h-4 w-4" aria-hidden /> : <User className="h-4 w-4" aria-hidden />}
        {entry.team ? t('entries.teamWithCount', { name: entry.team.name, count: entry.team.member_count }) : t('entries.individual')}
      </p>
      <JourneyRail stages={entry.journey} size="compact" />
      {step.text && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0 text-sm text-ink">
            <p>{step.text}</p>
            {step.due_at && !entry.is_finished && <DeadlineCountdown closesAt={step.due_at} compact className="mt-1" />}
          </div>
          {step.action_path && step.action_label ? (
            <ButtonLink to={step.action_path} size="sm">
              {step.action_label}
            </ButtonLink>
          ) : (
            <ButtonLink to={`/entries/${entry.id}`} size="sm" variant="secondary">
              {t('entries.openEntry')}
            </ButtonLink>
          )}
        </div>
      )}
    </Card>
  );
}

export default function MyEntriesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('active');
  const q = useQuery({ queryKey: queryKeys.entries.mine, queryFn: () => api.get<Page<EntryCardData>>('/me/entries') });
  const items = q.data?.items ?? [];
  const active = items.filter((e) => !e.is_finished);
  const finished = items.filter((e) => e.is_finished);
  const shown = tab === 'active' ? active : finished;

  return (
    <>
      <PageHeader
        title={t('entries.myEntries')}
        subtitle={t('entries.myEntriesSubtitle')}
        actions={<ButtonLink to="/challenges" variant="secondary">{t('entries.browseChallenges')}</ButtonLink>}
      />
      {q.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Flag className="h-8 w-8" aria-hidden />}
          title={t('entries.emptyTitle')}
          action={<ButtonLink to="/challenges">{t('entries.browseChallenges')}</ButtonLink>}
        />
      ) : (
        <>
          <Tabs
            ariaLabel={t('entries.myEntries')}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'active', label: t('entries.tabActive'), count: active.length },
              { value: 'finished', label: t('entries.tabFinished'), count: finished.length },
            ]}
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {shown.map((e) => (
              <EntryCard key={e.id} entry={e} />
            ))}
          </div>
          {shown.length === 0 && (
            <EmptyState
              className="mt-4"
              title={tab === 'active' ? t('entries.noActive') : t('entries.noFinished')}
              action={tab === 'active' ? <ButtonLink to="/challenges">{t('entries.browseChallenges')}</ButtonLink> : undefined}
            />
          )}
        </>
      )}
    </>
  );
}
