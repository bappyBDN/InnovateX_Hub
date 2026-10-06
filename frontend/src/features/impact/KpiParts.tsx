import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { StatusBadge } from '@/components/domain';
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { formatDate } from '@/utils/dates';
import { num } from '@/utils/format';
import { useAccess } from '@/auth';
import { AssignVerifier } from './AssignVerifier';

export interface Measurement {
  id: string;
  period_start: string | null;
  period_end: string | null;
  measured_value: number;
  source: string;
  measured_by: string | null;
  measured_by_name: string | null;
  note: string | null;
  verification_status: 'UNVERIFIED' | 'VERIFIED' | 'ADJUSTED' | 'REJECTED';
  verification_type: string | null;
  verified_value: number | null;
  verifier: string | null;
  verification_note: string | null;
  verified_at: string | null;
  assigned_verifier?: { id: string; full_name: string } | null;
}

export interface KpiItem {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  benefit_type_code: string | null;
  unit_code: string;
  direction: 'INCREASE' | 'DECREASE';
  baseline_value: number | null;
  baseline_period: string | null;
  target_value: number | null;
  target_date: string | null;
  is_primary: boolean;
  latest_value: number | null;
  is_verified: boolean;
  measurements: Measurement[];
}

const UNITS = ['hours', 'BDT', '%', 'count', 'days', 'kWh'];

function value(v: number | null | undefined, unit: string): string {
  if (v == null) return '—';
  return `${num(v, Number.isInteger(v) ? 0 : 1)} ${unit}`;
}

/** Tiny trend line of measured values (text summary sits beside it; decorative only). */
function Trend({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 120;
  const h = 32;
  const coords = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - 3 - ((p - min) / span) * (h - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-28 text-primary" aria-hidden>
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function invalidateImpact(qc: ReturnType<typeof useQueryClient>, kpi: { entity_type: string; entity_id: string }) {
  void qc.invalidateQueries({ queryKey: queryKeys.kpis(kpi.entity_type, kpi.entity_id) });
  void qc.invalidateQueries({ queryKey: queryKeys.impact });
}

/** One KPI: baseline → target → actual, trend and the list of measurements with their verification. */
export function KpiCard({ kpi, canEdit }: { kpi: KpiItem; canEdit?: boolean }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const isAdmin = useAccess().hasRole('SUPER_ADMIN');
  const points = kpi.measurements.map((m) => m.verified_value ?? m.measured_value);
  const reached =
    kpi.latest_value != null && kpi.target_value != null
      ? kpi.direction === 'DECREASE'
        ? kpi.latest_value <= kpi.target_value
        : kpi.latest_value >= kpi.target_value
      : false;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{kpi.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {kpi.is_primary && <Badge tone="primary">{t('impact.kpi.primary')}</Badge>}
            {kpi.is_verified ? (
              <Badge tone="success" icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden />}>
                {t('impact.kpi.verified')}
              </Badge>
            ) : (
              <Badge tone="neutral">{t('impact.kpi.notVerified')}</Badge>
            )}
            {reached && <Badge tone="success">{t('impact.kpi.targetReached')}</Badge>}
          </div>
        </div>
        {canEdit && (
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
            {t('impact.addMeasurement')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <Figure label={t('impact.kpi.baseline')} value={value(kpi.baseline_value, kpi.unit_code)} hint={kpi.baseline_period} />
        <ArrowRight className="mb-2 h-4 w-4 text-ink-muted" aria-hidden />
        <Figure label={t('impact.kpi.target')} value={value(kpi.target_value, kpi.unit_code)} hint={kpi.target_date ? formatDate(kpi.target_date) : null} />
        <ArrowRight className="mb-2 h-4 w-4 text-ink-muted" aria-hidden />
        <Figure label={t('impact.kpi.actual')} value={value(kpi.latest_value, kpi.unit_code)} strong />
        <div className="ml-auto">
          <Trend points={points} />
        </div>
      </div>

      {kpi.measurements.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('impact.kpi.noMeasurements')}</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {[...kpi.measurements].reverse().map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="tabular font-medium text-ink">
                  {value(m.measured_value, kpi.unit_code)}
                  {m.verification_status === 'ADJUSTED' && m.verified_value != null && (
                    <span className="text-ink-muted"> → {value(m.verified_value, kpi.unit_code)}</span>
                  )}
                  <span className="ml-2 font-normal text-ink-muted">{m.period_end ? formatDate(m.period_end) : ''}</span>
                </p>
                {m.note && <p className="text-ink-muted">{m.note}</p>}
                {m.verifier && m.verification_status !== 'UNVERIFIED' && (
                  <p className="text-xs text-ink-muted">
                    {t('impact.kpi.verifiedBy', { name: m.verifier, date: formatDate(m.verified_at) })}
                    {m.verification_note ? ` — ${m.verification_note}` : ''}
                  </p>
                )}
              </div>
              <StatusBadge status={m.verification_status} />
              {m.verification_status === 'UNVERIFIED' && (
                <div className="w-full space-y-2">
                  <p className="text-xs text-ink-muted">
                    {m.assigned_verifier ? t('kpiVerify.waitingFor', { name: m.assigned_verifier.full_name }) : t('kpiVerify.noVerifier')}
                  </p>
                  {isAdmin && <AssignVerifier measurementId={m.id} current={m.assigned_verifier} />}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddMeasurementDialog kpi={kpi} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function Figure({ label, value: v, hint, strong }: { label: string; value: string; hint?: string | null; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`tabular ${strong ? 'text-xl font-semibold text-ink' : 'text-base font-medium text-ink'}`}>{v}</p>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function AddMeasurementDialog({ kpi, onClose }: { kpi: KpiItem; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [val, setVal] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/kpis/${kpi.id}/measurements`, { measured_value: Number(val), period_end: end || null, note: note.trim() || null }),
    onSuccess: () => {
      toast.success(t('impact.measurementAdded'));
      invalidateImpact(qc, kpi);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    if (val.trim() === '' || Number.isNaN(Number(val))) {
      setError(t('impact.errors.value'));
      return;
    }
    save.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('impact.addMeasurement')}
      description={kpi.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {t('impact.addMeasurement')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('impact.fields.value', { unit: kpi.unit_code })} required error={error}>
          <Input type="number" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => setError(null)} />
        </Field>
        <Field label={t('impact.fields.periodEnd')} help={t('impact.fields.periodEndHelp')}>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label={t('impact.fields.note')} help={t('impact.fields.noteHelp')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function AddKpiDialog({ entityType, entityId, onClose }: { entityType: string; entityId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', unit_code: 'hours', direction: 'DECREASE', baseline: '', target: '', period: '', primary: false });
  const [error, setError] = useState<string | null>(null);
  const toNum = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

  const save = useMutation({
    mutationFn: () =>
      api.post('/kpis', {
        entity_type: entityType,
        entity_id: entityId,
        name: f.name.trim(),
        unit_code: f.unit_code,
        direction: f.direction,
        baseline_value: toNum(f.baseline),
        baseline_period: f.period.trim() || null,
        target_value: toNum(f.target),
        is_primary: f.primary,
      }),
    onSuccess: () => {
      toast.success(t('impact.kpiAdded'));
      invalidateImpact(qc, { entity_type: entityType, entity_id: entityId });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('impact.addKpi')}
      description={t('impact.addKpiHelp')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => (f.name.trim() ? save.mutate() : setError(t('impact.errors.name')))}
          >
            {t('impact.addKpi')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('impact.fields.kpiName')} required error={error} help={t('impact.fields.kpiNameHelp')}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => setError(null)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('impact.fields.unit')}>
            <Select value={f.unit_code} onChange={(e) => setF({ ...f, unit_code: e.target.value })} options={UNITS.map((u) => ({ value: u, label: u }))} />
          </Field>
          <Field label={t('impact.fields.direction')}>
            <Select
              value={f.direction}
              onChange={(e) => setF({ ...f, direction: e.target.value })}
              options={[
                { value: 'DECREASE', label: t('impact.fields.decrease') },
                { value: 'INCREASE', label: t('impact.fields.increase') },
              ]}
            />
          </Field>
          <Field label={t('impact.kpi.baseline')}>
            <Input type="number" inputMode="decimal" value={f.baseline} onChange={(e) => setF({ ...f, baseline: e.target.value })} />
          </Field>
          <Field label={t('impact.kpi.target')}>
            <Input type="number" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
          </Field>
        </div>
        <Field label={t('impact.fields.baselinePeriod')} help={t('impact.fields.baselinePeriodHelp')}>
          <Input value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} />
        </Field>
        <Checkbox label={t('impact.fields.primary')} checked={f.primary} onChange={(e) => setF({ ...f, primary: e.target.checked })} />
      </div>
    </Dialog>
  );
}
