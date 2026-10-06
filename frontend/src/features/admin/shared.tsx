import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { formatDateTime } from '@/utils/dates';

/** Mutation with a success toast, the server's own message on error, and query invalidation. */
export function useAdminMutation<TVars, TData = unknown>(
  fn: (vars: TVars) => Promise<TData>,
  opts: { success?: string; invalidate?: QueryKey[]; onDone?: (data: TData, vars: TVars) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      if (opts.success) toast.success(opts.success);
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      opts.onDone?.(data, vars);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** "Last changed by … on …" — shown on every admin setting. */
export function ChangedBy({ by, at }: { by?: string | null; at?: string | null }) {
  const { t } = useTranslation();
  if (!at) return null;
  return (
    <p className="text-xs text-ink-muted">
      {by
        ? t('admin.common.changedBy', { name: by, date: formatDateTime(at) })
        : t('admin.common.changedOn', { date: formatDateTime(at) })}
    </p>
  );
}

export interface I18nName {
  en?: string | null;
  bn?: string | null;
}
