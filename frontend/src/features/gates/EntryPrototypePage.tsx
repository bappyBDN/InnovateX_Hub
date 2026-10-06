import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '@/api/client';
import { ButtonLink, ErrorState, PageHeader, PageSkeleton, isNotFound } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { GatePanel } from './GatePanel';

/** A challenge entry's prototype: the form (link and how to use it) and the judges' review. */
export default function EntryPrototypePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const entry = useQuery({ queryKey: ['entries', 'detail', id, 'for-prototype'], queryFn: () => api.get<{ id: string; code: string; title: string }>(`/entries/${id}`) });
  if (isNotFound(entry.error)) return <NotFoundPage />;
  if (entry.isError) return <ErrorState error={entry.error} onRetry={() => void entry.refetch()} />;
  if (entry.isLoading || !entry.data) return <PageSkeleton rows={4} />;
  const e = entry.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('gates.entryTitle')}
        subtitle={`${e.code} · ${e.title}`}
        breadcrumbs={[{ label: t('nav.myEntries'), to: '/entries' }, { label: e.code, to: `/entries/${e.id}` }, { label: t('gates.stage.PROTOTYPE') }]}
        actions={
          <ButtonLink to={`/entries/${e.id}`} variant="secondary">
            {t('gates.backToEntry')}
          </ButtonLink>
        }
      />
      <GatePanel entityType="challenge_entry" entityId={e.id} emptyText={t('gates.entryNotOpen')} onChange={() => void qc.invalidateQueries({ queryKey: ['entries'] })} />
    </div>
  );
}
