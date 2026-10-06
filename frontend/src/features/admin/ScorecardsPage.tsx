import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  Select,
  Textarea,
} from '@/components/ui';
import { Callout } from '@/components/domain';
import { useUnsavedChangesGuard } from '@/hooks';
import { statusLabel } from '@/utils/format';
import { useAdminMutation } from './shared';

interface Criterion {
  id: string;
  code: string;
  name: string;
  guidance: string;
  weight_pct: number;
  min_rating: number | null;
  is_tie_breaker: boolean;
}
interface Scorecard {
  id: string;
  code: string;
  name: string;
  purpose: string;
  version: number;
  status: string;
  scale: { min: number; max: number; levels: { value: number; label: string; description: string }[] };
  criteria: Criterion[];
}
interface Row {
  key: string;
  id?: string;
  name: string;
  guidance: string;
  weight: string;
  min: string;
  tie: boolean;
}

const toRows = (c: Criterion[]): Row[] =>
  c.map((x) => ({ key: x.id, id: x.id, name: x.name, guidance: x.guidance ?? '', weight: String(x.weight_pct ?? 0), min: x.min_rating == null ? '' : String(x.min_rating), tie: x.is_tie_breaker }));

export default function ScorecardsPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);

  const cards = useQuery({ queryKey: queryKeys.admin.scorecards, queryFn: () => api.get<Scorecard[]>('/scorecards') });
  const card = cards.data?.find((c) => c.id === selected) ?? cards.data?.[0];

  useEffect(() => {
    if (card) {
      setRows(toRows(card.criteria));
      setDirty(false);
    }
    // Reset only when a different scorecard (or fresh server data) arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, cards.dataUpdatedAt]);
  useUnsavedChangesGuard(dirty);

  const total = useMemo(() => Math.round(rows.reduce((s, r) => s + (Number(r.weight) || 0), 0) * 100) / 100, [rows]);
  const missingName = rows.some((r) => !r.name.trim());
  const badWeight = rows.some((r) => !(Number(r.weight) > 0));
  const reason =
    rows.length === 0
      ? t('admin.scorecards.needCriterion')
      : missingName
        ? t('admin.scorecards.needNames')
        : badWeight
          ? t('admin.scorecards.needWeights')
          : total !== 100
            ? t('admin.scorecards.totalMustBe100', { total })
            : !dirty
              ? t('admin.scorecards.noChanges')
              : undefined;

  const save = useAdminMutation(
    () =>
      api.put(`/scorecards/${card!.id}/criteria`, {
        criteria: rows.map((r) => ({
          id: r.id,
          name: r.name.trim(),
          guidance: r.guidance.trim(),
          weight_pct: Number(r.weight),
          min_rating: r.min === '' ? null : Number(r.min),
          is_tie_breaker: r.tie,
        })),
      }),
    { success: t('admin.scorecards.saved'), invalidate: [queryKeys.admin.scorecards], onDone: () => setDirty(false) },
  );

  const edit = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : patch.tie ? { ...r, tie: false } : r)));
    setDirty(true);
  };

  if (cards.isLoading) return <PageSkeleton rows={5} />;
  if (cards.isError) return <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />;
  if (!card) return <EmptyState title={t('admin.scorecards.empty')} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.scorecards.title')} subtitle={t('admin.scorecards.subtitle')} />

      <Card>
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <Field label={t('admin.scorecards.choose')}>
            <Select
              value={card.id}
              onChange={(e) => {
                if (!dirty || window.confirm(t('common.unsavedChanges'))) setSelected(e.target.value);
              }}
              options={(cards.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5 pb-2">
            <Badge tone="neutral">{statusLabel(card.purpose)}</Badge>
            <Badge tone="neutral">v{card.version}</Badge>
            <Badge tone="success">{statusLabel(card.status)}</Badge>
          </div>
        </div>
      </Card>

      <Callout tone="warning">{t('admin.scorecards.liveNote')}</Callout>

      <Card>
        <CardHeader
          title={t('admin.scorecards.criteria')}
          subtitle={t('admin.scorecards.criteriaHint')}
          actions={
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setRows((rs) => [...rs, { key: `new-${Date.now()}`, name: '', guidance: '', weight: '0', min: '', tie: false }]);
                setDirty(true);
              }}
            >
              {t('admin.scorecards.addCriterion')}
            </Button>
          }
        />
        <ol className="space-y-4">
          {rows.map((r, i) => (
            <li key={r.key} className="rounded-panel border border-line p-4">
              <div className="grid gap-4 md:grid-cols-[1fr_120px_140px]">
                <Field label={t('admin.scorecards.criterionN', { n: i + 1 })} required error={!r.name.trim() ? t('admin.common.nameRequired') : null}>
                  <Input value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} />
                </Field>
                <Field label={t('admin.scorecards.weight')} required>
                  <Input type="number" min={0} max={100} step={1} value={r.weight} onChange={(e) => edit(r.key, { weight: e.target.value })} className="tabular" />
                </Field>
                <Field label={t('admin.scorecards.minRating')} help={t('admin.scorecards.minRatingHelp')}>
                  <Select
                    value={r.min}
                    onChange={(e) => edit(r.key, { min: e.target.value })}
                    placeholder={t('admin.scorecards.noMinimum')}
                    options={card.scale.levels.map((l) => ({ value: String(l.value), label: `${l.value} — ${l.label}` }))}
                  />
                </Field>
              </div>
              <Field label={t('admin.scorecards.guidance')} help={t('admin.scorecards.guidanceHelp')} className="mt-4">
                <Textarea rows={2} value={r.guidance} onChange={(e) => edit(r.key, { guidance: e.target.value })} />
              </Field>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <Checkbox checked={r.tie} onChange={(e) => edit(r.key, { tie: e.target.checked })} label={t('admin.scorecards.tieBreaker')} description={t('admin.scorecards.tieBreakerHelp')} />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    setRows((rs) => rs.filter((x) => x.key !== r.key));
                    setDirty(true);
                  }}
                >
                  {t('common.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ol>

        <div className="sticky bottom-0 -mx-4 mt-4 border-t border-line bg-surface px-4 py-3 sm:-mx-6 sm:px-6" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[200px] flex-1">
              <p className={total === 100 ? 'font-medium text-success' : 'font-medium text-danger'}>
                {t('admin.scorecards.total', { total })} {total === 100 ? '✓' : t('admin.scorecards.totalOff', { diff: Math.abs(Math.round((100 - total) * 100) / 100), dir: total < 100 ? t('admin.scorecards.short') : t('admin.scorecards.over') })}
              </p>
              <ProgressBar value={Math.min(total, 100)} tone={total === 100 ? 'success' : 'danger'} className="mt-1.5" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={!dirty}
                onClick={() => {
                  setRows(toRows(card.criteria));
                  setDirty(false);
                }}
              >
                {t('admin.scorecards.reset')}
              </Button>
              <Button disabled={!!reason} disabledReason={reason} loading={save.isPending} onClick={() => save.mutate(undefined)}>
                {t('admin.scorecards.save')}
              </Button>
            </div>
          </div>
          {reason && dirty && <p className="mt-1 text-sm text-ink-muted">{reason}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title={t('admin.scorecards.scale', { min: card.scale.min, max: card.scale.max })} subtitle={t('admin.scorecards.scaleHint')} />
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {card.scale.levels.map((l) => (
            <div key={l.value} className="rounded-panel border border-line p-3">
              <dt className="font-medium text-ink">
                <span className="tabular">{l.value}</span> · {l.label}
              </dt>
              <dd className="mt-1 text-sm text-ink-muted">{l.description}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
