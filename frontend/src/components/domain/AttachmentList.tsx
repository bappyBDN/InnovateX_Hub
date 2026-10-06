import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Feedback';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/dates';
import { fileSize } from '@/utils/format';

export interface AttachmentItem {
  id: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  scan_status?: string | null;
  created_at?: string | null;
}

export interface AttachmentListProps {
  entityType: string;
  entityId: string;
  /** Show upload and remove controls. */
  canEdit?: boolean;
  /** Hide the download button (e.g. confidential records for judges). */
  canDownload?: boolean;
  title?: string;
  className?: string;
}

/** Files of any record: list, upload, download (through the API, with auth) and remove. */
export function AttachmentList({ entityType, entityId, canEdit, canDownload = true, title, className }: AttachmentListProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [toRemove, setToRemove] = useState<AttachmentItem | null>(null);
  const key = queryKeys.attachments(entityType, entityId);

  const list = useQuery({
    queryKey: key,
    enabled: !!entityId,
    queryFn: async () => {
      const res = await api.get<AttachmentItem[] | { items: AttachmentItem[] }>('/attachments', {
        entity_type: entityType,
        entity_id: entityId,
      });
      return Array.isArray(res) ? res : res.items ?? [];
    },
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('entity_type', entityType);
        fd.append('entity_id', entityId);
        await api.upload('/attachments', fd);
      }
    },
    onSuccess: () => {
      toast.success(t('attachments.uploaded'));
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/attachments/${id}`),
    onSuccess: () => {
      toast.success(t('attachments.removed'));
      setToRemove(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const items = list.data ?? [];

  return (
    <section className={cn('space-y-2', className)} aria-label={title ?? t('attachments.title')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Paperclip className="h-4 w-4" aria-hidden />
          {title ?? t('attachments.title')}
          {items.length > 0 && <span className="tabular text-ink-muted">({items.length})</span>}
        </h3>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) upload.mutate(files);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => inputRef.current?.click()}>
              {upload.isPending ? t('attachments.uploading') : t('attachments.add')}
            </Button>
          </>
        )}
      </div>

      {list.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : list.isError ? (
        <p className="text-sm text-danger" role="alert">
          {errorMessage(list.error)}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('attachments.empty')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              <FileText className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{a.file_name}</p>
                <p className="tabular text-xs text-ink-muted">
                  {[fileSize(a.size_bytes), a.created_at ? formatDate(a.created_at) : ''].filter(Boolean).join(' · ')}
                </p>
              </div>
              {canDownload && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('common.download')} ${a.file_name}`}
                  icon={<Download className="h-4 w-4" aria-hidden />}
                  onClick={() => api.download(`/attachments/${a.id}/download`, a.file_name).catch((e) => toast.error(errorMessage(e)))}
                />
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('attachments.remove')} ${a.file_name}`}
                  icon={<Trash2 className="h-4 w-4" aria-hidden />}
                  onClick={() => setToRemove(a)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('attachments.removeConfirmTitle')}
        description={t('attachments.removeConfirmBody', { name: toRemove?.file_name ?? '' })}
        confirmLabel={t('attachments.remove')}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => toRemove && remove.mutate(toRemove.id)}
      />
    </section>
  );
}
