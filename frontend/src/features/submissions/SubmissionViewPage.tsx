import { useQuery } from '@tanstack/react-query';
import { EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  AttachmentList,
  Callout,
  ConfidentialBanner,
  DynamicFormView,
  StatusBadge,
  type FormDefinition,
  type FormValue,
} from '@/components/domain';
import { Badge, ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton, Skeleton, isNotFound } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime } from '@/utils/dates';
import { tr } from '@/utils/i18n';

interface SubmissionView {
  id: string;
  submission_type: string;
  status: string;
  version_no: number;
  submitted_at: string | null;
  content_hash: string | null;
  form: FormDefinition | null;
  content: FormValue | null;
  entry: { id: string; code: string; title: string; status_code: string; entry_type: string; team: string | null; lead: string | null };
  challenge: { id: string; slug: string; title_i18n: Record<string, string> };
  blind: boolean;
  confidential: boolean;
  read_only_note: string | null;
  can_download: boolean;
  attachment_entity: { entity_type: string; entity_id: string };
}
interface Version {
  version_no: number;
  submitted_at: string | null;
  content_hash: string | null;
  submitted_by: string | null;
}

export default function SubmissionViewPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.submissions.detail(id),
    queryFn: () => api.get<SubmissionView>(`/submissions/${id}`),
  });
  const versions = useQuery({
    queryKey: [...queryKeys.submissions.detail(id), 'versions'],
    queryFn: () => api.get<Version[]>(`/submissions/${id}/versions`),
    enabled: !!query.data,
  });

  if (query.isLoading) return <PageSkeleton rows={8} />;
  if (isNotFound(query.error)) return <NotFoundPage />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const s = query.data;
  const typeLabel = t(`submissions.type.${s.submission_type}`, s.submission_type);
  const entrant = s.blind ? t('submissions.hiddenBlind') : (s.entry.team ?? s.entry.lead ?? '—');

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${s.entry.code} · ${s.entry.title}`}
        subtitle={`${typeLabel} · ${tr(s.challenge.title_i18n)}`}
        breadcrumbs={[{ label: t('submissions.title'), to: '/submissions' }, { label: s.entry.code }]}
        meta={
          <span className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <StatusBadge status={s.entry.status_code} />
            {s.blind && (
              <Badge tone="info" icon={<EyeOff className="h-3 w-3" />}>
                {t('review.blind')}
              </Badge>
            )}
            <span>
              {t('submissions.entrant')}: {entrant}
            </span>
            {s.version_no > 0 && <span>{t('submissions.version', { no: s.version_no })}</span>}
            {s.submitted_at && <span>{t('submissions.submittedOn', { date: formatDateTime(s.submitted_at) })}</span>}
          </span>
        }
        actions={
          <ButtonLink to={`/entries/${s.entry.id}`} variant="secondary">
            {t('submissions.openEntry')}
          </ButtonLink>
        }
      />
      {s.confidential && <ConfidentialBanner />}
      {s.read_only_note && <Callout tone="info">{t('submissions.readOnlyJudge')}</Callout>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <Card className="min-w-0">
          <CardHeader title={typeLabel} />
          {s.form ? (
            <DynamicFormView form={s.form} value={s.content ?? {}} className="reading" />
          ) : (
            <EmptyState title={t('submissions.noContent')} />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            {s.blind && <p className="mb-2 text-sm text-ink-muted">{t('submissions.blindNote')}</p>}
            {!s.can_download && <p className="mb-2 text-sm text-ink-muted">{t('submissions.downloadDisabled')}</p>}
            <AttachmentList
              entityType={s.attachment_entity.entity_type}
              entityId={s.attachment_entity.entity_id}
              canEdit={false}
              canDownload={s.can_download}
              title={t('review.attachments')}
            />
          </Card>

          <Card>
            <CardHeader title={t('submissions.versionHistory')} />
            {versions.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : versions.isError ? (
              <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
            ) : (
              <ol className="space-y-3">
                {(versions.data ?? []).map((v) => (
                  <li key={v.version_no} className="border-l-2 border-line pl-3 text-sm">
                    <p className="font-medium text-ink">
                      {t('submissions.version', { no: v.version_no })}
                      {v.version_no === s.version_no && (
                        <Badge tone="primary" className="ml-2">
                          {t('status.CURRENT', 'Current')}
                        </Badge>
                      )}
                    </p>
                    <p className="text-ink-muted">
                      {v.submitted_at && formatDateTime(v.submitted_at)}
                      {!s.blind && v.submitted_by && ` · ${t('submissions.versionBy', { name: v.submitted_by })}`}
                    </p>
                    {v.content_hash && (
                      <p className="truncate font-mono text-xs text-ink-muted" title={v.content_hash}>
                        {t('submissions.hash')}: {v.content_hash.slice(0, 16)}…
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
