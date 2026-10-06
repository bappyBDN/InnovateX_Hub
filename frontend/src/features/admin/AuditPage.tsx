import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, type Tone } from '@/components/ui';
import { useDebounce } from '@/hooks';
import { formatDateTime } from '@/utils/dates';
import { statusLabel } from '@/utils/format';

interface AuditRow {
  id: string;
  occurred_at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  changes: Record<string, unknown> | null;
  request_id: string | null;
  row_hash: string | null;
}
interface AuditPageData {
  items: AuditRow[];
  total: number;
  page: number;
  actions: string[];
}

const PAGE_SIZE = 25;
const TONE: Record<string, Tone> = { CONFIG_CHANGE: 'warning', OVERRIDE: 'danger', DELETE: 'danger', SCORE_CHANGE: 'info', EXPORT: 'info', VIEW_CONFIDENTIAL: 'warning', CREATE: 'success', LOGIN: 'neutral', UPDATE: 'primary' };
const ENTITY_TYPES = ['challenge', 'challenge_entry', 'initiative', 'entry_submission', 'shortlist', 'review_round', 'team', 'user', 'scorecard', 'system_setting', 'feature_flag', 'notification_rule', 'notification_template', 'form_field', 'kpi_measurement', 'attachment'];

const show = (v: unknown): string => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));

export default function AuditPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const search = useDebounce(q, 300);
  const params = { q: search, action, entity_type: entity, page, page_size: PAGE_SIZE };

  const log = useQuery({
    queryKey: queryKeys.admin.audit(params),
    queryFn: () => api.get<AuditPageData>('/audit-logs', params),
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((log.data?.total ?? 0) / PAGE_SIZE));
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.audit.title')} subtitle={t('admin.audit.subtitle')} meta={<Badge tone="neutral" icon={<ShieldCheck className="h-3 w-3" aria-hidden />}>{t('admin.audit.appendOnly')}</Badge>} />

      <Card>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t('admin.audit.search')}>
            <Input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder={t('admin.audit.searchPlaceholder')} />
          </Field>
          <Field label={t('admin.audit.action')}>
            <Select value={action} onChange={(e) => reset(setAction)(e.target.value)} placeholder={t('admin.audit.allActions')} options={(log.data?.actions ?? []).map((a) => ({ value: a, label: statusLabel(a) }))} />
          </Field>
          <Field label={t('admin.audit.record')}>
            <Select value={entity} onChange={(e) => reset(setEntity)(e.target.value)} placeholder={t('admin.audit.allRecords')} options={ENTITY_TYPES.map((x) => ({ value: x, label: statusLabel(x) }))} />
          </Field>
        </div>
      </Card>

      {log.isLoading ? (
        <div className="space-y-2" role="status" aria-label={t('common.loading')}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : !log.data?.items.length ? (
        <EmptyState
          title={t('admin.audit.empty')}
          description={t('admin.audit.emptyHint')}
          action={
            (q || action || entity) && (
              <Button
                variant="secondary"
                onClick={() => {
                  setQ('');
                  setAction('');
                  setEntity('');
                  setPage(1);
                }}
              >
                {t('admin.audit.clear')}
              </Button>
            )
          }
        />
      ) : (
        <Card padded={false}>
          <p className="border-b border-line px-4 py-2 text-sm text-ink-muted" aria-live="polite">
            {t('admin.audit.count', { count: log.data.total })}
          </p>
          <ul className="divide-y divide-line">
            {log.data.items.map((a) => {
              const expanded = open === a.id;
              const changes = Object.entries(a.changes ?? {});
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : a.id)}
                  >
                    {expanded ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-ink-muted" aria-hidden /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-muted" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={TONE[a.action] ?? 'neutral'}>{statusLabel(a.action)}</Badge>
                        <span className="text-sm text-ink-muted">{statusLabel(a.entity_type)}</span>
                      </span>
                      <span className="mt-1 block break-words text-ink">{a.summary || '—'}</span>
                      <span className="mt-0.5 block text-sm text-ink-muted">
                        {a.actor} · <span className="tabular">{formatDateTime(a.occurred_at)}</span>
                      </span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="space-y-3 border-t border-line bg-canvas px-4 py-3 pl-11">
                      {changes.length === 0 ? (
                        <p className="text-sm text-ink-muted">{t('admin.audit.noChanges')}</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[420px] text-sm">
                            <caption className="sr-only">{t('admin.audit.changes')}</caption>
                            <thead>
                              <tr className="text-left text-ink-muted">
                                <th className="pb-1 pr-4 font-medium">{t('admin.audit.field')}</th>
                                <th className="pb-1 pr-4 font-medium">{t('admin.audit.oldValue')}</th>
                                <th className="pb-1 font-medium">{t('admin.audit.newValue')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes.map(([field, v]) => {
                                const pair = Array.isArray(v) && v.length === 2 ? v : [null, v];
                                return (
                                  <tr key={field} className="align-top">
                                    <th scope="row" className="py-1 pr-4 text-left font-medium text-ink">
                                      {statusLabel(field)}
                                    </th>
                                    <td className="py-1 pr-4 text-ink-muted">
                                      <pre className="whitespace-pre-wrap break-words font-sans">{show(pair[0])}</pre>
                                    </td>
                                    <td className="py-1 text-ink">
                                      <span className="flex items-start gap-1.5">
                                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />
                                        <pre className="whitespace-pre-wrap break-words font-sans">{show(pair[1])}</pre>
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <dl className="grid gap-x-6 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
                        {a.entity_id && (
                          <div>
                            <dt className="inline">{t('admin.audit.recordId')}: </dt>
                            <dd className="inline break-all font-mono">{a.entity_id}</dd>
                          </div>
                        )}
                        {a.request_id && (
                          <div>
                            <dt className="inline">{t('common.requestId')}: </dt>
                            <dd className="inline font-mono">{a.request_id}</dd>
                          </div>
                        )}
                        {a.row_hash && (
                          <div className="sm:col-span-2">
                            <dt className="inline">{t('admin.audit.hash')}: </dt>
                            <dd className="inline break-all font-mono">{a.row_hash}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label={t('admin.common.pagination')}>
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('admin.common.prevPage')}
          </Button>
          <span className="text-sm text-ink-muted">{t('admin.common.pageOf', { page, pages })}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('admin.common.nextPage')}
          </Button>
        </nav>
      )}
    </div>
  );
}
