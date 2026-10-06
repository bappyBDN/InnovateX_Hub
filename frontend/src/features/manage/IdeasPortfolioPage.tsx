import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Lightbulb, Lock, Search, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useAccess } from '@/auth';
import { StatusBadge } from '@/components/domain';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Input, PageHeader, Select, isNotFound, type Column } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { useDebounce } from '@/hooks';
import { cn } from '@/utils/cn';
import { parseServerDate, serverNow } from '@/utils/dates';
import { num, statusLabel } from '@/utils/format';
import { tr } from '@/utils/i18n';
import type { I18nText } from './evaluation/types';

interface IdeaCard {
  id: string;
  code: string | null;
  key: string;
  title: string;
  category: { id: string; name_i18n: I18nText } | null;
  org_unit: string | null;
  current_state_code: string;
  stage_entered_at: string | null;
  data_classification_code: string;
  is_awarded: boolean;
  score_latest: number | null;
  owner: { full_name: string } | null;
}

const CHIPS: Record<string, string[] | null> = {
  all: null,
  triage: ['SUBMITTED', 'TRIAGE'],
  review: ['UNDER_REVIEW', 'CLARIFICATION_REQUESTED', 'ON_HOLD'],
  shortlisted: ['SHORTLISTED'],
  delivery: ['PROTOTYPE', 'DEMO_VALIDATION', 'PILOT', 'PRODUCTION', 'IMPACT_VERIFIED', 'SCALED'],
  bank: ['NOT_SELECTED'],
};
const CHIP_LABEL: Record<string, string> = {
  all: 'portfolio.chipAll',
  triage: 'portfolio.chipTriage',
  review: 'portfolio.chipReview',
  shortlisted: 'portfolio.chipShortlisted',
  delivery: 'portfolio.chipDelivery',
  bank: 'portfolio.chipBank',
};

function daysIn(v: string | null): number | null {
  const d = parseServerDate(v);
  return d ? Math.max(0, Math.floor((serverNow().getTime() - d.getTime()) / 86_400_000)) : null;
}

export default function IdeasPortfolioPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasRole } = useAccess();
  const [chip, setChip] = useState('all');
  const [category, setCategory] = useState('');
  const [classification, setClassification] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounce(search.trim(), 300);

  const filters = { scope: 'all', category, classification, q, page_size: 500 };
  const query = useQuery({
    queryKey: queryKeys.ideas.list(filters),
    queryFn: () => api.get<Page<IdeaCard>>('/initiatives', filters),
    placeholderData: (prev) => prev,
  });
  const categories = useQuery({
    queryKey: queryKeys.masterdata.categories,
    queryFn: () => api.get<{ id: string; name_i18n: I18nText }[]>('/categories'),
  });
  const lookups = useQuery({
    queryKey: queryKeys.masterdata.lookups('all'),
    queryFn: () => api.get<Record<string, { code: string; label: string }[]>>('/lookups'),
  });
  const canExport = hasRole('SUPER_ADMIN', 'PROGRAM_OWNER', 'EXECUTIVE');
  const states = CHIPS[chip];
  const exportCsv = useMutation({
    mutationFn: () => {
      const p = new URLSearchParams();
      if (states?.length === 1) p.set('state', states[0]);
      if (q) p.set('q', q);
      const qs = p.toString();
      return api.download(`/exports/initiatives${qs ? `?${qs}` : ''}`, 'innovatex-ideas.csv');
    },
    onSuccess: () => toast.success(t('portfolio.exported')),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isNotFound(query.error)) return <NotFoundPage />;

  const all = query.data?.items ?? [];
  const count = (key: string) => (CHIPS[key] ? all.filter((i) => CHIPS[key]!.includes(i.current_state_code)).length : all.length);
  const rows = states ? all.filter((i) => states.includes(i.current_state_code)) : all;
  const filtered = chip !== 'all' || category || classification || search;
  const clear = () => {
    setChip('all');
    setCategory('');
    setClassification('');
    setSearch('');
  };

  const columns: Column<IdeaCard>[] = [
    { key: 'code', header: t('portfolio.id'), sortValue: (r) => r.code ?? '', render: (r) => <span className="tabular whitespace-nowrap">{r.code ?? '—'}</span> },
    {
      key: 'title',
      header: t('portfolio.ideaTitle'),
      sortValue: (r) => r.title,
      render: (r) => (
        <span className="font-medium text-ink">
          {r.title}
          {r.is_awarded && <Trophy className="ml-1.5 inline h-4 w-4 text-spark-ink" aria-label={t('portfolio.awarded')} />}
        </span>
      ),
    },
    { key: 'category', header: t('portfolio.category'), hideOnMobile: true, sortValue: (r) => tr(r.category?.name_i18n), render: (r) => tr(r.category?.name_i18n) || '—' },
    { key: 'org_unit', header: t('portfolio.orgUnit'), hideOnMobile: true, sortValue: (r) => r.org_unit ?? '', render: (r) => r.org_unit ?? '—' },
    { key: 'owner', header: t('portfolio.owner'), sortValue: (r) => r.owner?.full_name ?? '', render: (r) => r.owner?.full_name ?? '—' },
    { key: 'state', header: t('portfolio.state'), sortValue: (r) => r.current_state_code, render: (r) => <StatusBadge status={r.current_state_code} /> },
    {
      key: 'days',
      header: t('portfolio.daysInStage'),
      align: 'right',
      sortValue: (r) => daysIn(r.stage_entered_at) ?? -1,
      render: (r) => <span className="tabular">{daysIn(r.stage_entered_at) ?? '—'}</span>,
    },
    {
      key: 'score',
      header: t('portfolio.score'),
      align: 'right',
      sortValue: (r) => r.score_latest ?? -1,
      render: (r) => <span className="tabular">{r.score_latest == null ? '—' : num(r.score_latest, 1)}</span>,
    },
    {
      key: 'classification',
      header: t('portfolio.classification'),
      hideOnMobile: true,
      sortValue: (r) => r.data_classification_code,
      render: (r) =>
        ['CONFIDENTIAL', 'RESTRICTED'].includes(r.data_classification_code) ? (
          <Badge tone="danger" icon={<Lock className="h-3.5 w-3.5" aria-hidden />}>
            {statusLabel(r.data_classification_code)}
          </Badge>
        ) : (
          <span className="text-ink-muted">{statusLabel(r.data_classification_code)}</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('portfolio.title')}
        subtitle={t('portfolio.subtitle')}
        actions={
          canExport && (
            <Button variant="secondary" icon={<Download className="h-4 w-4" aria-hidden />} loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
              {t('portfolio.export')}
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('portfolio.state')}>
        {Object.keys(CHIPS).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={chip === key}
            onClick={() => setChip(key)}
            className={cn(
              'min-h-[36px] rounded-full border px-3 py-1 text-sm',
              chip === key ? 'border-primary bg-primary-soft font-medium text-ink' : 'border-line bg-surface text-ink-muted hover:border-primary',
            )}
          >
            {t(CHIP_LABEL[key])} <span className="tabular">({count(key)})</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('portfolio.search')} aria-label={t('portfolio.search')} />
        </div>
        <Select
          aria-label={t('portfolio.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[{ value: '', label: t('portfolio.allCategories') }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: tr(c.name_i18n) }))]}
        />
        <Select
          aria-label={t('portfolio.classification')}
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          options={[
            { value: '', label: t('portfolio.allClassifications') },
            ...(lookups.data?.DATA_CLASSIFICATION ?? []).map((c) => ({ value: c.code, label: c.label })),
          ]}
        />
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Card padded={false}>
          <p className="px-4 pt-3 text-sm text-ink-muted">{t('portfolio.count', { count: rows.length })}</p>
          <DataTable
            columns={columns}
            rows={query.isLoading ? undefined : rows}
            loading={query.isLoading}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/ideas/${r.key}`)}
            initialSort={{ key: 'days', dir: 'desc' }}
            empty={
              <EmptyState
                icon={<Lightbulb className="h-8 w-8" aria-hidden />}
                title={t('portfolio.empty')}
                description={t('portfolio.emptyHelp')}
                action={filtered ? <Button variant="secondary" onClick={clear}>{t('portfolio.clear')}</Button> : undefined}
              />
            }
          />
        </Card>
      )}
    </div>
  );
}
