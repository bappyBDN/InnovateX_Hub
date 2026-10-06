import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Button, Select } from '@/components/ui';
import { usePeople } from '@/features/judging/QuickAdd';

/** Super Admin / DMD: choose who verifies a KPI measurement. It then appears in that person's judging panel. */
export function AssignVerifier({ measurementId, current }: { measurementId: string; current?: { id: string; full_name: string } | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const people = usePeople();
  const [pick, setPick] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/measurements/${measurementId}/verifier`, { user_id: pick }),
    onSuccess: () => {
      toast.success(t('kpiVerify.assigned'));
      setPick('');
      void qc.invalidateQueries({ queryKey: queryKeys.impact });
      void qc.invalidateQueries({ queryKey: ['kpis'] });
      void qc.invalidateQueries({ queryKey: ['ideas'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const options = (people.data?.items ?? [])
    .filter((u) => u.id !== current?.id)
    .map((u) => ({ value: u.id, label: [u.full_name, u.job_title].filter(Boolean).join(' — ') }));
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-panel border border-line bg-canvas p-3">
      <label className="min-w-[14rem] flex-1 text-sm text-ink">
        <span className="mb-1 block font-medium">{current ? t('kpiVerify.change') : t('kpiVerify.choose')}</span>
        <Select value={pick} onChange={(e) => setPick(e.target.value)} placeholder={people.isLoading ? t('common.loading') : t('kpiVerify.pickPerson')} options={options} />
      </label>
      <Button size="sm" icon={<UserCheck className="h-4 w-4" aria-hidden />} disabled={!pick} disabledReason={t('kpiVerify.pickPerson')} loading={save.isPending} onClick={() => save.mutate()}>
        {t('kpiVerify.send')}
      </Button>
    </div>
  );
}
