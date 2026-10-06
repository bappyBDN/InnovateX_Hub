import { useQuery } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { ButtonLink, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Switch, Tabs } from '@/components/ui';
import { useDebounce } from '@/hooks';
import { tr, type I18nText } from '@/utils/i18n';
import { ChallengeCard } from './ChallengeCard';
import type { ChallengeCardData } from './types';

type Tab = 'open' | 'upcoming' | 'closed';
interface Domain {
  id: string;
  name_i18n: I18nText;
}

export default function ChallengeListPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (['open', 'upcoming', 'closed'].includes(params.get('tab') ?? '') ? params.get('tab') : 'open') as Tab;
  const [domain, setDomain] = useState('');
  const [mode, setMode] = useState('');
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [search, setSearch] = useState('');
  const q = useDebounce(search.trim(), 300);

  const filters = { tab, domain, mode, q, eligible_only: eligibleOnly };
  const list = useQuery({
    queryKey: queryKeys.challenges.list(filters),
    queryFn: () => api.get<Page<ChallengeCardData>>('/challenges', filters),
    placeholderData: (prev) => prev,
  });
  const domains = useQuery({ queryKey: queryKeys.masterdata.domains, queryFn: () => api.get<Domain[]>('/domains'), staleTime: 300_000 });

  const filtered = !!(domain || mode || q);
  const items = list.data?.items ?? [];

  return (
    <div>
      <PageHeader title={t('challenges.listTitle')} subtitle={t('challenges.listSubtitle')} />

      <Tabs
        ariaLabel={t('challenges.listTitle')}
        value={tab}
        onChange={(v) => setParams(v === 'open' ? {} : { tab: v }, { replace: true })}
        tabs={[
          { value: 'open', label: t('challenges.tabOpen') },
          { value: 'upcoming', label: t('challenges.tabUpcoming') },
          { value: 'closed', label: t('challenges.tabClosed') },
        ]}
      />

      <div className="my-4 grid gap-3 rounded-panel border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('challenges.filterSearch')}>
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('challenges.filterSearchPlaceholder')} />
        </Field>
        <Field label={t('challenges.filterDomain')}>
          <Select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t('challenges.allDomains')}
            options={(domains.data ?? []).map((d) => ({ value: d.id, label: tr(d.name_i18n) }))}
          />
        </Field>
        <Field label={t('challenges.filterMode')}>
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            placeholder={t('challenges.anyMode')}
            options={[
              { value: 'INDIVIDUAL', label: t('challenges.modeIndividual') },
              { value: 'TEAM', label: t('challenges.modeTeamShort') },
            ]}
          />
        </Field>
        <Switch checked={eligibleOnly} onChange={setEligibleOnly} label={t('challenges.eligibleForMe')} description={t('challenges.eligibleForMeHint')} className="self-center" />
      </div>

      {list.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label={t('common.loading')}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-panel" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        filtered || !eligibleOnly || tab !== 'open' ? (
          <EmptyState icon={<Flag className="h-8 w-8" />} title={tab === 'open' ? t('challenges.emptyFiltered') : tab === 'upcoming' ? t('challenges.emptyUpcoming') : t('challenges.emptyClosed')} />
        ) : (
          <EmptyState
            icon={<Flag className="h-8 w-8" />}
            title={t('challenges.emptyOpen')}
            action={<ButtonLink to="/ideas/new">{t('challenges.submitIdea')}</ButtonLink>}
          />
        )
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <ChallengeCard key={c.id} challenge={c} />
          ))}
        </div>
      )}
    </div>
  );
}
