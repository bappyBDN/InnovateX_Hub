import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { QuickAddJudge } from './QuickAdd';
import type { AddJudgesResult } from './types';

interface DefaultJudges {
  judges: { id: string; full_name: string; job_title?: string | null; org_unit?: string | null }[];
  can_edit: boolean;
}

/** The people every new idea goes to automatically. Setting this once removes the per-idea "choose judges" step. */
export function DefaultIdeaJudgesCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['idea-judges', 'default'] as const;
  const list = useQuery({ queryKey: key, queryFn: () => api.get<DefaultJudges>('/idea-judges') });
  const reload = () => qc.invalidateQueries({ queryKey: key });
  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/idea-judges/${userId}`),
    onSuccess: async () => {
      toast.success(t('judging.removed'));
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-ink">{t('judging.defaultTitle')}</h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-muted">{t('judging.defaultHelp')}</p>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            {list.data.can_edit && (
              <div className="rounded-panel border border-line bg-canvas p-4">
                <QuickAddJudge
                  hideDays
                  excludeIds={list.data.judges.map((j) => j.id)}
                  submit={(payload) => api.post<AddJudgesResult>('/idea-judges', payload)}
                  onDone={() => void reload()}
                />
              </div>
            )}
            {list.data.judges.length === 0 ? (
              <p className="rounded-panel border border-dashed border-warning bg-warning-soft px-4 py-3 text-sm text-ink">{t('judging.defaultEmpty')}</p>
            ) : (
              <ul className="divide-y divide-line rounded-panel border border-line">
                {list.data.judges.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{j.full_name}</span>
                      {(j.job_title || j.org_unit) && (
                        <span className="block truncate text-xs text-ink-muted">{[j.job_title, j.org_unit].filter(Boolean).join(' · ')}</span>
                      )}
                    </span>
                    {list.data.can_edit && (
                      <Button variant="ghost" size="sm" loading={remove.isPending && remove.variables === j.id} onClick={() => remove.mutate(j.id)}>
                        {t('common.remove')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
