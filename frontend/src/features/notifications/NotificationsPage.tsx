import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, CheckCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { NotificationItem, NotificationList } from '@/app/layout/TopBar';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Tabs } from '@/components/ui/Tabs';
import { cn } from '@/utils/cn';
import { dayKey, formatDateTime, relativeFromNow, serverNow } from '@/utils/dates';

type Filter = 'all' | 'action' | 'updates';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const apiFilter = filter === 'action' ? 'action' : 'all';

  const list = useQuery({
    queryKey: queryKeys.notifications.list(apiFilter),
    queryFn: () => api.get<NotificationList>('/me/notifications', { filter: apiFilter }),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
    void qc.invalidateQueries({ queryKey: queryKeys.me });
  };
  const read = useMutation({
    mutationFn: (id: string) => api.post(`/me/notifications/${id}/read`),
    onSuccess: refresh,
  });
  const readAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read-all'),
    onSuccess: () => {
      toast.success(t('notifications.markedAllRead'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    return filter === 'updates' ? all.filter((n) => !n.needs_action) : all;
  }, [list.data, filter]);

  const today = dayKey(serverNow());
  const groups = [
    { key: 'today', title: t('notifications.today'), items: items.filter((n) => dayKey(n.created_at) === today) },
    { key: 'earlier', title: t('notifications.earlier'), items: items.filter((n) => dayKey(n.created_at) !== today) },
  ].filter((g) => g.items.length > 0);

  const open = (n: NotificationItem) => {
    if (!n.is_read) read.mutate(n.id);
    if (n.link_path) navigate(n.link_path);
  };

  const unread = list.data?.unread ?? 0;

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        subtitle={t('notifications.subtitle')}
        actions={
          <Button
            variant="secondary"
            icon={<CheckCheck className="h-4 w-4" aria-hidden />}
            disabled={unread === 0}
            loading={readAll.isPending}
            onClick={() => readAll.mutate()}
          >
            {t('notifications.markAllRead')}
          </Button>
        }
      />
      <Tabs
        ariaLabel={t('notifications.title')}
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        tabs={[
          { value: 'all', label: t('notifications.filterAll') },
          { value: 'action', label: t('notifications.filterAction') },
          { value: 'updates', label: t('notifications.filterUpdates') },
        ]}
      />

      <div className="mt-4 max-w-reading">
        {list.isLoading ? (
          <div className="space-y-2" role="status" aria-label={t('common.loading')}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-panel" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState icon={<BellOff className="h-8 w-8" />} title={t('notifications.empty')} />
        ) : (
          groups.map((g) => (
            <section key={g.key} className="mb-6" aria-labelledby={`grp-${g.key}`}>
              <h2 id={`grp-${g.key}`} className="mb-2 text-sm font-medium text-ink-muted">
                {g.title}
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
                {g.items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => open(n)}
                      className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-soft', !n.is_read && 'bg-primary-soft/40')}
                    >
                      <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={cn('text-sm text-ink', !n.is_read && 'font-semibold')}>{n.title}</span>
                          {n.needs_action && <Badge tone="warning">{t('notifications.needsAction')}</Badge>}
                          {!n.is_read && <span className="sr-only">({t('notifications.unread')})</span>}
                        </span>
                        {n.body && <span className="mt-0.5 block text-sm text-ink-muted">{n.body}</span>}
                        <span className="tabular mt-1 block text-xs text-ink-muted" title={formatDateTime(n.created_at)}>
                          {g.key === 'today' ? relativeFromNow(n.created_at) : formatDateTime(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
