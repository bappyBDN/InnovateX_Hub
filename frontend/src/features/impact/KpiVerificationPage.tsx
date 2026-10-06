import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '@/api/client';
import { Callout, StatusBadge } from '@/components/domain';
import { Button, ButtonLink, Card, CardHeader, ErrorState, PageHeader, PageSkeleton, isNotFound } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDate } from '@/utils/dates';
import { num } from '@/utils/format';
import { AssignVerifier } from './AssignVerifier';
import type { Measurement } from './KpiParts';
import { VerifyDialog, type Decision, type QueueItem } from './ImpactPage';

interface Detail {
  measurement: Measurement;
  kpi: { id: string; name: string; unit_code: string; direction: string; baseline_value: number | null; target_value: number | null };
  history: Measurement[];
  initiative: { code: string; title: string; summary?: string | null };
  can_decide: boolean;
  can_assign: boolean;
}

/** The chosen verifier's page in My judging: check the measured number, then verify, adjust or reject it. */
export default function KpiVerificationPage() {
  const { t } = useTranslation();
  const { measurementId: id = '' } = useParams();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const q = useQuery({ queryKey: ['kpi-verification', id], queryFn: () => api.get<Detail>(`/kpi-verifications/${id}`) });
  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <PageSkeleton rows={5} />;
  const d = q.data;
  const unit = d.kpi.unit_code;
  const item: QueueItem = { measurement: d.measurement, kpi: d.kpi, initiative: d.initiative };
  const fact = (label: string, v: number | null, strong?: boolean) => (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`tabular ${strong ? 'text-xl font-semibold text-ink' : 'text-ink'}`}>{v != null ? `${num(v, Number.isInteger(v) ? 0 : 1)} ${unit}` : '—'}</dd>
    </div>
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title={`${d.initiative.code} · ${d.kpi.name}`}
        subtitle={d.initiative.title}
        breadcrumbs={[{ label: t('review.queueTitle'), to: '/review' }, { label: d.initiative.code }]}
        meta={<StatusBadge status={d.measurement.verification_status} />}
        actions={<ButtonLink to="/review" variant="secondary">{t('review.backToQueue')}</ButtonLink>}
      />
      <Card className="space-y-4">
        <CardHeader title={t('kpiVerify.checkTitle')} subtitle={t('kpiVerify.checkHelp')} />
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {fact(t('impact.kpi.baseline'), d.kpi.baseline_value)}
          {fact(t('impact.kpi.target'), d.kpi.target_value)}
          {fact(t('impact.queue.measured'), d.measurement.measured_value, true)}
          <div>
            <dt className="text-xs text-ink-muted">{t('impact.queue.period')}</dt>
            <dd className="text-ink">{formatDate(d.measurement.period_end)}</dd>
          </div>
        </dl>
        <p className="text-sm text-ink-muted">
          {t('impact.queue.recordedBy', { name: d.measurement.measured_by_name ?? '—' })}
          {d.measurement.note ? ` — ${d.measurement.note}` : ''}
        </p>
        {d.measurement.verification_status !== 'UNVERIFIED' && (
          <Callout tone="info">
            {t('impact.kpi.verifiedBy', { name: d.measurement.verifier ?? '—', date: formatDate(d.measurement.verified_at) })}
            {d.measurement.verification_note ? ` — ${d.measurement.verification_note}` : ''}
          </Callout>
        )}
        {d.can_decide && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button onClick={() => setDeciding('VERIFIED')}>{t('impact.queue.verify')}</Button>
            <Button variant="secondary" onClick={() => setDeciding('ADJUSTED')}>{t('impact.queue.adjust')}</Button>
            <Button variant="secondary" onClick={() => setDeciding('REJECTED')}>{t('impact.queue.reject')}</Button>
          </div>
        )}
        {d.can_assign && <AssignVerifier measurementId={d.measurement.id} current={d.measurement.assigned_verifier} />}
      </Card>
      {d.history.length > 1 && (
        <Card>
          <CardHeader title={t('kpiVerify.history')} />
          <ul className="mt-2 divide-y divide-line text-sm">
            {[...d.history].reverse().map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <span className="tabular text-ink">
                  {num(m.measured_value, 1)} {unit} <span className="text-ink-muted">{m.period_end ? formatDate(m.period_end) : ''}</span>
                </span>
                <StatusBadge status={m.verification_status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {deciding && <VerifyDialog item={item} decision={deciding} onClose={() => { setDeciding(null); void q.refetch(); }} />}
    </div>
  );
}
