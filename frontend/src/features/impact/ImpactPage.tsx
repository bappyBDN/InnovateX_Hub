import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useAccess } from '@/auth';
import { StatusBadge } from '@/components/domain';
import { Button, ButtonLink, Card, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, PageSkeleton, Select, Tabs, Textarea } from '@/components/ui';
import { formatDate } from '@/utils/dates';
import { num } from '@/utils/format';
import { AddKpiDialog, KpiCard, type KpiItem, type Measurement } from './KpiParts';
import { AssignVerifier } from './AssignVerifier';

interface ImpactIdea {
  id: string;
  code: string;
  title: string;
  current_state_code: string;
  owner: string | null;
  kpis: KpiItem[];
  can_edit: boolean;
}
export interface QueueItem {
  can_decide?: boolean;
  can_assign?: boolean;
  measurement: Measurement;
  kpi: { id: string; name: string; unit_code: string; baseline_value: number | null; target_value: number | null };
  initiative: { code: string; title: string };
}
interface ImpactData {
  mine: ImpactIdea[];
  portfolio: ImpactIdea[];
  verify_queue: QueueItem[];
  can_verify: boolean;
}
type Tab = 'mine' | 'verify' | 'portfolio';
export type Decision = 'VERIFIED' | 'ADJUSTED' | 'REJECTED';

export default function ImpactPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab | null>(null);
  const [addKpiFor, setAddKpiFor] = useState<ImpactIdea | null>(null);
  const [deciding, setDeciding] = useState<{ item: QueueItem; decision: Decision } | null>(null);

  const me = useAccess().me;
  const impact = useQuery({ queryKey: queryKeys.impact, queryFn: () => api.get<ImpactData>('/impact') });

  if (impact.isLoading) return <PageSkeleton rows={5} />;
  if (impact.error) return <ErrorState error={impact.error} onRetry={() => void impact.refetch()} />;
  const d = impact.data!;
  const tabs = [
    { value: 'mine', label: t('impact.tabs.mine'), count: d.mine.length },
    ...(d.can_verify ? [{ value: 'verify', label: t('impact.tabs.verify'), count: d.verify_queue.length }] : []),
    ...(d.portfolio.length ? [{ value: 'portfolio', label: t('impact.tabs.portfolio'), count: d.portfolio.length }] : []),
  ];
  const active: Tab = tab ?? (d.can_verify && d.verify_queue.length ? 'verify' : d.mine.length || !d.portfolio.length ? 'mine' : 'portfolio');

  const ideas = (items: ImpactIdea[]) =>
    items.map((idea) => (
      <section key={idea.id} aria-labelledby={`idea-${idea.id}`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="tabular text-xs text-ink-muted">
              {idea.code}
              {idea.owner ? ` · ${idea.owner}` : ''}
            </p>
            <h2 id={`idea-${idea.id}`} className="text-lg font-semibold text-ink">
              <Link to={`/ideas/${idea.code}`} className="hover:text-primary hover:underline">
                {idea.title}
              </Link>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={idea.current_state_code} />
            {idea.can_edit && (
              <Button variant="secondary" size="sm" onClick={() => setAddKpiFor(idea)}>
                {t('impact.addKpi')}
              </Button>
            )}
          </div>
        </div>
        {idea.kpis.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-muted">{t('impact.noKpis')}</p>
          </Card>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {idea.kpis.map((k) => (
              <KpiCard key={k.id} kpi={k} canEdit={idea.can_edit} />
            ))}
          </div>
        )}
      </section>
    ));

  return (
    <>
      <PageHeader title={t('impact.title')} subtitle={t('impact.subtitle')} />
      {tabs.length > 1 && <Tabs ariaLabel={t('impact.title')} tabs={tabs} value={active} onChange={(v) => setTab(v as Tab)} className="mb-4" />}

      {active === 'mine' &&
        (d.mine.length === 0 ? (
          <EmptyState
            icon={<LineChart className="h-8 w-8" aria-hidden />}
            title={t('impact.emptyTitle')}
            description={t('impact.emptyBody')}
            action={<ButtonLink to="/ideas">{t('impact.goToIdeas')}</ButtonLink>}
          />
        ) : (
          <div className="space-y-8">{ideas(d.mine)}</div>
        ))}

      {active === 'portfolio' && <div className="space-y-8">{ideas(d.portfolio)}</div>}

      {active === 'verify' &&
        (d.verify_queue.length === 0 ? (
          <EmptyState title={t('impact.queueEmptyTitle')} description={t('impact.queueEmptyBody')} />
        ) : (
          <ul className="space-y-3">
            {d.verify_queue.map((q) => (
              <li key={q.measurement.id}>
                <Card className="space-y-3">
                  <div>
                    <p className="tabular text-xs text-ink-muted">
                      {q.initiative.code} · {q.initiative.title}
                    </p>
                    <h2 className="font-semibold text-ink">{q.kpi.name}</h2>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Fact label={t('impact.kpi.baseline')} value={q.kpi.baseline_value} unit={q.kpi.unit_code} />
                    <Fact label={t('impact.kpi.target')} value={q.kpi.target_value} unit={q.kpi.unit_code} />
                    <Fact label={t('impact.queue.measured')} value={q.measurement.measured_value} unit={q.kpi.unit_code} strong />
                    <div>
                      <dt className="text-xs text-ink-muted">{t('impact.queue.period')}</dt>
                      <dd className="text-ink">{formatDate(q.measurement.period_end)}</dd>
                    </div>
                  </dl>
                  <p className="text-sm text-ink-muted">
                    {t('impact.queue.recordedBy', { name: q.measurement.measured_by_name ?? '—' })}
                    {q.measurement.note ? ` — ${q.measurement.note}` : ''}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {q.measurement.assigned_verifier ? t('kpiVerify.waitingFor', { name: q.measurement.assigned_verifier.full_name }) : t('kpiVerify.noVerifier')}
                  </p>
                  {q.can_assign && <AssignVerifier measurementId={q.measurement.id} current={q.measurement.assigned_verifier} />}
                  {q.can_decide && q.measurement.assigned_verifier?.id === me?.id && (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setDeciding({ item: q, decision: 'VERIFIED' })}>{t('impact.queue.verify')}</Button>
                      <Button variant="secondary" onClick={() => setDeciding({ item: q, decision: 'ADJUSTED' })}>
                        {t('impact.queue.adjust')}
                      </Button>
                      <Button variant="secondary" onClick={() => setDeciding({ item: q, decision: 'REJECTED' })}>
                        {t('impact.queue.reject')}
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        ))}

      {addKpiFor && <AddKpiDialog entityType="initiative" entityId={addKpiFor.id} onClose={() => setAddKpiFor(null)} />}
      {deciding && <VerifyDialog {...deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function Fact({ label, value, unit, strong }: { label: string; value: number | null; unit: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`tabular ${strong ? 'text-lg font-semibold text-ink' : 'text-ink'}`}>{value != null ? `${num(value, Number.isInteger(value) ? 0 : 1)} ${unit}` : '—'}</dd>
    </div>
  );
}

export function VerifyDialog({ item, decision, onClose }: { item: QueueItem; decision: Decision; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [type, setType] = useState('BUSINESS');
  const [val, setVal] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ value?: string; note?: string }>({});
  const label = t(`impact.queue.${decision === 'VERIFIED' ? 'verify' : decision === 'ADJUSTED' ? 'adjust' : 'reject'}`);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/measurements/${item.measurement.id}/verify`, {
        status: decision,
        verification_type: type,
        verified_value: decision === 'ADJUSTED' ? Number(val) : null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t(`impact.queue.done.${decision}`));
      void qc.invalidateQueries({ queryKey: queryKeys.impact });
      void qc.invalidateQueries({ queryKey: ['kpis'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const go = () => {
    const next: typeof errors = {};
    if (decision === 'ADJUSTED' && (val.trim() === '' || Number.isNaN(Number(val)))) next.value = t('impact.errors.value');
    if (decision !== 'VERIFIED' && !note.trim()) next.note = t('impact.errors.note');
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${label}?`}
      description={`${item.kpi.name} — ${num(item.measurement.measured_value, 1)} ${item.kpi.unit_code} (${item.initiative.code})`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={decision === 'REJECTED' ? 'danger' : 'primary'} loading={save.isPending} onClick={go}>
            {label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('impact.queue.type')}>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={['BUSINESS', 'FINANCE', 'TECHNICAL'].map((v) => ({ value: v, label: t(`impact.queue.types.${v}`) }))}
          />
        </Field>
        {decision === 'ADJUSTED' && (
          <Field label={t('impact.queue.newValue', { unit: item.kpi.unit_code })} required error={errors.value}>
            <Input type="number" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />
          </Field>
        )}
        <Field
          label={decision === 'REJECTED' ? t('impact.queue.reason') : t('impact.fields.note')}
          required={decision !== 'VERIFIED'}
          error={errors.note}
          help={t('impact.queue.noteHelp')}
        >
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
