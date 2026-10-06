import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ExternalLink, Library, Search, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton } from '@/components/ui';
import { useDebounce } from '@/hooks';
import { formatDate } from '@/utils/dates';

interface Asset {
  id: string;
  code: string;
  title: string;
  description: string | null;
  asset_type: string;
  repo_url: string | null;
  maturity: string;
  technology: string | null;
  impact_summary: string | null;
  reused_by: string[];
  published_at: string | null;
  owner: { full_name: string; email?: string | null; org_unit?: string | null; job_title?: string | null } | null;
  innovation_id: string | null;
  is_awarded: boolean;
  status: string | null;
}

const TYPES = ['AGENT', 'PROMPT', 'API', 'COMPONENT', 'TEMPLATE', 'PROCESS', 'DATASET', 'DASHBOARD'];

export default function CataloguePage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const term = useDebounce(q.trim(), 300);
  const params = { q: term, asset_type: type };
  const list = useQuery({
    queryKey: queryKeys.catalogue(params),
    queryFn: () => api.get<Page<Asset>>('/catalogue/assets', params),
    placeholderData: (prev) => prev,
  });
  const items = list.data?.items ?? [];
  const filtered = !!term || !!type;

  return (
    <>
      <PageHeader title={t('catalogue.title')} subtitle={t('catalogue.subtitle')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input aria-label={t('catalogue.search')} placeholder={t('catalogue.search')} className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select
          aria-label={t('catalogue.type')}
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder={t('catalogue.allTypes')}
          options={TYPES.map((v) => ({ value: v, label: t(`catalogue.types.${v}`) }))}
        />
      </div>

      {list.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Library className="h-8 w-8" aria-hidden />}
          title={filtered ? t('catalogue.noMatchTitle') : t('catalogue.emptyTitle')}
          description={filtered ? t('catalogue.noMatchBody') : t('catalogue.emptyBody')}
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted" aria-live="polite">
            {t('catalogue.count', { count: items.length })}
          </p>
          <ul className="grid gap-4 md:grid-cols-2">
            {items.map((a) => (
              <li key={a.id}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="tabular text-xs text-ink-muted">
                        {a.innovation_id ?? a.code}
                        {a.published_at ? ` · ${formatDate(a.published_at)}` : ''}
                      </p>
                      <h2 className="text-lg font-semibold text-ink">{a.title}</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {a.is_awarded && (
                        <Badge tone="spark" icon={<Trophy className="h-3.5 w-3.5" aria-hidden />}>
                          {t('catalogue.awarded')}
                        </Badge>
                      )}
                      <Badge tone="primary">{t(`catalogue.types.${a.asset_type}`, a.asset_type)}</Badge>
                    </div>
                  </div>
                  {a.description && <p className="reading text-ink">{a.description}</p>}
                  {a.impact_summary && (
                    <p className="flex gap-2 rounded-control bg-success-soft p-3 text-sm text-ink">
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                      <span>
                        <span className="font-medium">{t('catalogue.impact')}: </span>
                        {a.impact_summary}
                      </span>
                    </p>
                  )}
                  <dl className="mt-auto grid gap-2 border-t border-line pt-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-ink-muted">{t('catalogue.technology')}</dt>
                      <dd className="text-ink">{a.technology || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">{t('catalogue.contact')}</dt>
                      <dd className="text-ink">
                        {a.owner?.full_name ?? '—'}
                        {a.owner?.org_unit ? <span className="text-ink-muted"> · {a.owner.org_unit}</span> : null}
                        {a.owner?.email ? <span className="block break-all text-ink-muted">{a.owner.email}</span> : null}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-ink-muted">{t('catalogue.reusedBy')}</dt>
                      <dd className="text-ink">{a.reused_by?.length ? a.reused_by.join(', ') : t('catalogue.notReusedYet')}</dd>
                    </div>
                  </dl>
                  {a.repo_url && (
                    <a href={a.repo_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-primary underline">
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      {t('catalogue.openRepo')}
                    </a>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
