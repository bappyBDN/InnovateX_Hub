import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileSearch, Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useAccess } from '@/auth';
import { Callout, StatusBadge } from '@/components/domain';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  type Column,
} from '@/components/ui';
import { useDebounce } from '@/hooks';
import { formatDateTime } from '@/utils/dates';
import { tr } from '@/utils/i18n';

interface Row {
  id: string;
  entry_id: string;
  code: string;
  title: string;
  entrant: string | null;
  submission_type: string;
  status: string;
  entry_status: string;
  version_no: number;
  submitted_at: string | null;
  challenge: { id: string; title_i18n: Record<string, string>; slug: string };
  domain: string | null;
  confidential: boolean;
  score: number | null;
}
interface Response {
  items: Row[];
  total: number;
  page: number;
  can_export: boolean;
  challenges: { id: string; title: string }[];
}

const TYPES = ['METHODOLOGY', 'PROTOTYPE', 'FINAL_PROJECT'];
const STATUSES = ['SUBMITTED', 'LOCKED'];
const PAGE_SIZE = 50;

export default function SubmissionsBrowserPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasRole, isPrivileged } = useAccess();
  const [challengeId, setChallengeId] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(keyword, 400);

  const params = { challenge_id: challengeId, type, status, q, page };
  const query = useQuery({
    queryKey: queryKeys.submissions.list(params),
    queryFn: () => api.get<Response>('/submissions', params),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const rows = data?.items ?? [];
  const showScore = rows.some((r) => r.score != null);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const filtered = !!(challengeId || type || status || keyword);
  const set = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };
  const clear = () => {
    setChallengeId('');
    setType('');
    setStatus('');
    setKeyword('');
    setPage(1);
  };

  const columns: Column<Row>[] = [
    { key: 'code', header: t('submissions.colCode'), render: (r) => <span className="font-medium text-ink">{r.code}</span> },
    {
      key: 'title',
      header: t('submissions.colTitle'),
      sortValue: (r) => r.title,
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {r.title}
          {r.confidential && (
            <Badge tone="danger" icon={<Lock className="h-3 w-3" />}>
              {t('submissions.confidential')}
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'entrant', header: t('submissions.colEntrant'), render: (r) => r.entrant ?? '—' },
    { key: 'challenge', header: t('submissions.colChallenge'), render: (r) => tr(r.challenge.title_i18n), hideOnMobile: true },
    { key: 'type', header: t('submissions.colType'), render: (r) => t(`submissions.type.${r.submission_type}`, r.submission_type) },
    {
      key: 'submitted_at',
      header: t('submissions.colSubmitted'),
      sortValue: (r) => r.submitted_at,
      render: (r) => <span className="tabular">{r.submitted_at ? formatDateTime(r.submitted_at) : '—'}</span>,
    },
    { key: 'status', header: t('submissions.colStatus'), render: (r) => <StatusBadge status={r.entry_status} /> },
    ...(showScore
      ? [
          {
            key: 'score',
            header: t('submissions.colScore'),
            align: 'right' as const,
            sortValue: (r: Row) => r.score,
            render: (r: Row) => <span className="tabular">{r.score != null ? r.score.toFixed(1) : '—'}</span>,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t('submissions.title')} subtitle={t('submissions.subtitle')} />
      {hasRole('JUDGE') && !isPrivileged && <Callout tone="info">{t('submissions.readOnlyJudge')}</Callout>}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('submissions.filterChallenge')}>
            <Select
              value={challengeId}
              onChange={(e) => set(setChallengeId)(e.target.value)}
              placeholder={t('submissions.allChallenges')}
              options={(data?.challenges ?? []).map((c) => ({ value: c.id, label: c.title }))}
            />
          </Field>
          <Field label={t('submissions.filterType')}>
            <Select
              value={type}
              onChange={(e) => set(setType)(e.target.value)}
              placeholder={t('submissions.allTypes')}
              options={TYPES.map((v) => ({ value: v, label: t(`submissions.type.${v}`) }))}
            />
          </Field>
          <Field label={t('submissions.filterStatus')}>
            <Select
              value={status}
              onChange={(e) => set(setStatus)(e.target.value)}
              placeholder={t('submissions.allStatuses')}
              options={STATUSES.map((v) => ({ value: v, label: t(`status.${v}`, v.charAt(0) + v.slice(1).toLowerCase()) }))}
            />
          </Field>
          <Field label={t('submissions.filterKeyword')}>
            <Input value={keyword} onChange={(e) => set(setKeyword)(e.target.value)} placeholder={t('submissions.keywordPlaceholder')} />
          </Field>
        </div>
      </Card>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {data && <p className="text-sm text-ink-muted">{t('submissions.count', { count: data.total })}</p>}
          <DataTable
            columns={columns}
            rows={rows}
            loading={query.isLoading}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/submissions/${r.id}`)}
            caption={t('submissions.title')}
            empty={
              <EmptyState
                icon={<FileSearch className="h-8 w-8" />}
                title={t('submissions.empty')}
                description={filtered ? t('submissions.emptyHint') : undefined}
                action={
                  filtered ? (
                    <Button variant="secondary" onClick={clear}>
                      {t('submissions.clearFilters')}
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          {pages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('submissions.previous')}
              </Button>
              <span className="tabular text-sm text-ink-muted">{t('submissions.pageOf', { page, pages })}</span>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t('submissions.next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
