import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useAccess } from '@/auth';
import { StatusBadge } from '@/components/domain';
import {
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  ProgressBar,
  Select,
  isNotFound,
  type Column,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime } from '@/utils/dates';
import { statusLabel } from '@/utils/format';
import { tr, type I18nText } from '@/utils/i18n';

interface ManageRow {
  id: string;
  code: string;
  slug: string;
  title_i18n: I18nText;
  status_code: string;
  domain: { id: string; code: string; name_i18n: I18nText } | null;
  current_phase: { phase_type: string; name_i18n: I18nText; closes_at: string | null } | null;
  numbers: {
    registered: number;
    methodologies_submitted: number;
    reviews_done_pct: number;
    reviews_assigned: number;
    reviews_overdue: number;
    shortlisted: number;
  };
  next_date: string | null;
  owner: string | null;
}

interface Domain {
  id: string;
  name_i18n: I18nText;
}

const STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'OPEN_FOR_REGISTRATION',
  'METHODOLOGY_OPEN',
  'METHODOLOGY_REVIEW',
  'SHORTLISTING',
  'BUILD',
  'PROTOTYPE_REVIEW',
  'FINAL_SUBMISSION',
  'DEMO_AND_JUDGING',
  'RESULTS_PENDING_APPROVAL',
  'RESULTS_PUBLISHED',
  'CLOSED',
];

export default function ManageChallengesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isPrivileged } = useAccess();
  const [status, setStatus] = useState('');
  const [domain, setDomain] = useState('');
  const [q, setQ] = useState('');

  const params = { status, domain };
  const list = useQuery({
    queryKey: queryKeys.manage.challenges(params),
    queryFn: () => api.get<Page<ManageRow>>('/manage/challenges', params),
  });
  const domains = useQuery({ queryKey: queryKeys.masterdata.domains, queryFn: () => api.get<Domain[]>('/domains') });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = list.data?.items ?? [];
    return needle ? items.filter((r) => `${r.code} ${tr(r.title_i18n)}`.toLowerCase().includes(needle)) : items;
  }, [list.data, q]);

  if (isNotFound(list.error)) return <NotFoundPage />;

  const columns: Column<ManageRow>[] = [
    { key: 'code', header: t('manage.list.code'), sortValue: (r) => r.code, render: (r) => <span className="tabular text-ink-muted">{r.code}</span> },
    {
      key: 'title',
      header: t('manage.list.title'),
      sortValue: (r) => tr(r.title_i18n),
      render: (r) => <span className="font-medium text-ink">{tr(r.title_i18n)}</span>,
    },
    { key: 'domain', header: t('manage.list.domain'), sortValue: (r) => tr(r.domain?.name_i18n), render: (r) => tr(r.domain?.name_i18n, '—'), hideOnMobile: true },
    {
      key: 'status',
      header: t('manage.list.status'),
      sortValue: (r) => r.status_code,
      render: (r) => (
        <div className="space-y-1">
          <StatusBadge status={r.status_code} />
          {r.current_phase && r.status_code !== 'DRAFT' && (
            <div className="text-xs text-ink-muted">{tr(r.current_phase.name_i18n)}</div>
          )}
        </div>
      ),
    },
    { key: 'registered', header: t('manage.list.registrations'), align: 'right', sortValue: (r) => r.numbers.registered, render: (r) => <span className="tabular">{r.numbers.registered}</span> },
    {
      key: 'submitted',
      header: t('manage.list.submissions'),
      align: 'right',
      sortValue: (r) => r.numbers.methodologies_submitted,
      render: (r) => <span className="tabular">{r.numbers.methodologies_submitted}</span>,
    },
    {
      key: 'reviews',
      header: t('manage.list.reviewsDone'),
      sortValue: (r) => r.numbers.reviews_done_pct,
      render: (r) =>
        r.numbers.reviews_assigned ? (
          <div className="min-w-[110px]">
            <ProgressBar value={r.numbers.reviews_done_pct} showValue tone={r.numbers.reviews_overdue ? 'warning' : 'primary'} />
            {r.numbers.reviews_overdue > 0 && (
              <div className="mt-0.5 text-xs text-warning">{t('manage.list.overdue', { count: r.numbers.reviews_overdue })}</div>
            )}
          </div>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    { key: 'next', header: t('manage.list.nextDate'), sortValue: (r) => r.next_date ?? '', render: (r) => formatDateTime(r.next_date), hideOnMobile: true },
    { key: 'owner', header: t('manage.list.owner'), sortValue: (r) => r.owner ?? '', render: (r) => r.owner ?? '—', hideOnMobile: true },
    // Super Admin and Program Owner can edit any challenge, also after it is published.
    ...(isPrivileged
      ? [
          {
            key: 'edit',
            header: '',
            align: 'right',
            render: (r: ManageRow) => (
              <span onClick={(e) => e.stopPropagation()}>
                <ButtonLink to={`/manage/challenges/${r.id}/edit`} variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" aria-hidden />}>
                  {t('common.edit')}
                </ButtonLink>
              </span>
            ),
          } satisfies Column<ManageRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('manage.list.pageTitle')}
        subtitle={t('manage.list.pageSubtitle')}
        actions={
          isPrivileged ? (
            <ButtonLink to="/manage/challenges/new" icon={<Plus className="h-4 w-4" aria-hidden />}>
              {t('manage.list.create')}
            </ButtonLink>
          ) : undefined
        }
      />

      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('manage.list.search')}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('manage.list.searchPlaceholder')} />
          </Field>
          <Field label={t('manage.list.status')}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder={t('manage.list.allStatuses')}
              options={STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
            />
          </Field>
          <Field label={t('manage.list.domain')}>
            <Select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t('manage.list.allDomains')}
              options={(domains.data ?? []).map((d) => ({ value: d.id, label: tr(d.name_i18n) }))}
            />
          </Field>
        </div>
      </Card>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          onRowClick={(r) => navigate(`/manage/challenges/${r.id}`)}
          initialSort={{ key: 'code', dir: 'desc' }}
          caption={t('manage.list.pageTitle')}
          empty={
            <EmptyState
              icon={<Trophy className="h-8 w-8" aria-hidden />}
              title={status || domain || q ? t('manage.list.emptyFiltered') : t('manage.list.empty')}
              action={
                isPrivileged ? (
                  <ButtonLink to="/manage/challenges/new">{t('manage.list.create')}</ButtonLink>
                ) : undefined
              }
            />
          }
        />
      )}
    </div>
  );
}
