import { useMutation, useQuery } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage, type Page } from '@/api/client';
import { Callout } from '@/components/domain';
import { Button, Field, Select } from '@/components/ui';
import { statusLabel } from '@/utils/format';
import type { AddJudgesResult, JudgeUser, StageOption } from './types';

const DAYS = [3, 5, 7, 10, 14, 21, 30];

/** Everyone who has an account, for the "Person" dropdown list. */
export function usePeople() {
  return useQuery({
    queryKey: ['users', 'all-for-judging'],
    queryFn: () => api.get<Page<JudgeUser>>('/users', { limit: 100 }),
    staleTime: 60_000,
  });
}

/** Label of a stage choice: empty list = all stages. */
export function useStageLabel() {
  const { t } = useTranslation();
  return (stages: string[]) => (stages.length === 0 ? t('judging.allStages') : stages.map((s) => t(`judging.stage.${s}`, s)).join(' + '));
}

/**
 * Add judges with dropdown lists only: pick people one after another (each pick joins the list), then the stage
 * (challenge) or days to finish (idea), and add them all at once. `stages` is passed for a challenge only.
 */
export function QuickAddJudge({
  stages,
  excludeIds,
  submit,
  onDone,
  hideDays = false,
}: {
  /** Only the people dropdown (no stage, no days). */
  hideDays?: boolean;
  stages?: StageOption[];
  excludeIds: string[];
  submit: (payload: { user_ids: string[]; stages: string[]; due_days: number; emails: string; message: string }) => Promise<AddJudgesResult>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const people = usePeople();
  const [picked, setPicked] = useState<string[]>([]);
  const [stage, setStage] = useState('');
  const [days, setDays] = useState('10');
  const [skipped, setSkipped] = useState<AddJudgesResult['skipped']>([]);

  const add = useMutation({
    mutationFn: () => submit({ user_ids: picked, stages: stage ? [stage] : [], due_days: Number(days), emails: '', message: '' }),
    onSuccess: (res) => {
      setSkipped(res.skipped);
      if (res.added.length) toast.success(t('judging.added', { count: res.added.length }));
      setPicked([]);
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const everyone = people.data?.items ?? [];
  const options = everyone
    .filter((u) => !excludeIds.includes(u.id) && !picked.includes(u.id))
    .map((u) => ({ value: u.id, label: [u.full_name, u.job_title, u.org_unit].filter(Boolean).join(' — ') }));
  const name = (id: string) => everyone.find((u) => u.id === id)?.full_name ?? id;

  return (
    <div className="space-y-3">
      <div className="grid items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
        <Field label={t('judging.personMany')} help={t('judging.personManyHelp')}>
          <Select
            value=""
            onChange={(e) => e.target.value && setPicked((p) => [...p, e.target.value])}
            placeholder={people.isLoading ? t('common.loading') : picked.length ? t('judging.chooseAnother') : t('judging.choosePerson')}
            options={options}
          />
        </Field>
        {stages ? (
          <Field label={t('judging.stageField')}>
            <Select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              options={[{ value: '', label: t('judging.allStages') }, ...stages.filter((s) => s.in_challenge).map((s) => ({ value: s.code, label: t(`judging.stage.${s.code}`, s.name) }))]}
            />
          </Field>
        ) : hideDays ? (
          <span />
        ) : (
          <Field label={t('judging.dueDays')}>
            <Select value={days} onChange={(e) => setDays(e.target.value)} options={DAYS.map((d) => ({ value: String(d), label: t('judging.days', { count: d }) }))} />
          </Field>
        )}
        <Button icon={<UserPlus className="h-4 w-4" aria-hidden />} disabled={picked.length === 0} disabledReason={t('judging.choosePerson')} loading={add.isPending} onClick={() => add.mutate()}>
          {picked.length > 1 ? t('judging.addMany', { count: picked.length }) : t('judging.addOne')}
        </Button>
      </div>
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t('judging.chosen')}>
          {picked.map((id) => (
            <li key={id} className="flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink">
              {name(id)}
              <button type="button" className="rounded-full p-0.5 text-ink-muted hover:text-danger" aria-label={t('judging.removeName', { name: name(id) })} onClick={() => setPicked((p) => p.filter((x) => x !== id))}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <Callout tone="warning" title={t('judging.skippedTitle')}>
          <ul className="list-disc pl-5">
            {skipped.map((s) => (
              <li key={s.name}>
                {s.name} — {t(`judging.reason.${s.reason}`, statusLabel(s.reason))}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}
