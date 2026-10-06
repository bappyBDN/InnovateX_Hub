import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Button, Card, CardHeader, EmptyState, ErrorState, Input, PageHeader, Skeleton, Stat, Switch } from '@/components/ui';
import { Callout } from '@/components/domain';
import { statusLabel } from '@/utils/format';
import { ChangedBy, useAdminMutation } from './shared';

interface Setting {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string | null;
  updated_by: string | null;
}
interface Flag {
  id: string;
  code: string;
  is_enabled: boolean;
  description: string | null;
  updated_at: string | null;
  updated_by: string | null;
}
interface Health {
  failed_emails: number;
  sent_emails: number;
  pending_outbox: number;
  failed_outbox: number;
  audit_rows: number;
  database: string;
}

const PRIVACY_FLAGS = ['PEOPLES_CHOICE', 'LEADERBOARDS'];

export default function SettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: queryKeys.admin.settings, queryFn: () => api.get<Setting[]>('/settings') });
  const flags = useQuery({ queryKey: queryKeys.admin.flags, queryFn: () => api.get<Flag[]>('/feature-flags') });
  const health = useQuery({ queryKey: queryKeys.admin.health, queryFn: () => api.get<Health>('/admin/system-health'), refetchInterval: 30_000 });

  const setFlag = useAdminMutation((v: { code: string; on: boolean }) => api.patch(`/feature-flags/${v.code}`, { is_enabled: v.on }), {
    success: t('admin.settings.saved'),
    invalidate: [queryKeys.admin.flags, queryKeys.me],
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.settings.title')} subtitle={t('admin.settings.subtitle')} />

      <Card>
        <CardHeader title={t('admin.settings.health')} subtitle={t('admin.settings.healthHint')} />
        {health.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : health.isError ? (
          <ErrorState error={health.error} onRetry={() => void health.refetch()} />
        ) : health.data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label={t('admin.settings.failedEmails')} value={health.data.failed_emails} tone={health.data.failed_emails ? 'danger' : 'success'} to="/admin/notifications" />
            <Stat label={t('admin.settings.sentEmails')} value={health.data.sent_emails} />
            <Stat label={t('admin.settings.pendingJobs')} value={health.data.pending_outbox} tone={health.data.pending_outbox > 20 ? 'warning' : undefined} />
            <Stat label={t('admin.settings.failedJobs')} value={health.data.failed_outbox} tone={health.data.failed_outbox ? 'danger' : 'success'} />
            <Stat label={t('admin.settings.database')} value={health.data.database === 'ok' ? t('admin.settings.ok') : health.data.database} hint={t('admin.settings.auditRows', { count: health.data.audit_rows })} tone={health.data.database === 'ok' ? 'success' : 'danger'} />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title={t('admin.settings.general')} subtitle={t('admin.settings.generalHint')} />
        {settings.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : settings.isError ? (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
        ) : !settings.data?.length ? (
          <EmptyState title={t('admin.settings.empty')} />
        ) : (
          <ul className="divide-y divide-line">
            {settings.data.map((s) => (
              <SettingRow key={s.key} setting={s} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={t('admin.settings.flags')} subtitle={t('admin.settings.flagsHint')} />
        {flags.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : flags.isError ? (
          <ErrorState error={flags.error} onRetry={() => void flags.refetch()} />
        ) : !flags.data?.length ? (
          <EmptyState title={t('admin.settings.noFlags')} />
        ) : (
          <ul className="divide-y divide-line">
            {flags.data.map((f) => (
              <li key={f.code} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <Switch
                  checked={f.is_enabled}
                  disabled={setFlag.isPending && setFlag.variables?.code === f.code}
                  onChange={(on) => setFlag.mutate({ code: f.code, on })}
                  label={<span className="font-medium">{t(`admin.settings.flag.${f.code}`, statusLabel(f.code))}</span>}
                  description={f.description}
                />
                {PRIVACY_FLAGS.includes(f.code) && <Callout tone="warning">{t('admin.settings.privacyNote')}</Callout>}
                <ChangedBy by={f.updated_by} at={f.updated_at} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SettingRow({ setting }: { setting: Setting }) {
  const { t } = useTranslation();
  const kind = typeof setting.value === 'boolean' ? 'boolean' : typeof setting.value === 'number' ? 'number' : 'text';
  const original = setting.value == null ? '' : String(setting.value);
  const [draft, setDraft] = useState(original);
  const save = useAdminMutation((value: unknown) => api.patch(`/settings/${setting.key}`, { value }), {
    success: t('admin.settings.saved'),
    invalidate: [queryKeys.admin.settings],
  });
  const label = t(`admin.settings.key.${setting.key}`, statusLabel(setting.key));
  const invalid = kind === 'number' ? draft === '' || Number.isNaN(Number(draft)) || Number(draft) < 0 : false;
  const inputId = `setting-${setting.key}`;

  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0">
      {kind === 'boolean' ? (
        <Switch checked={setting.value === true} disabled={save.isPending} onChange={(on) => save.mutate(on)} label={<span className="font-medium">{label}</span>} description={setting.description} />
      ) : (
        <div className="grid gap-2 md:grid-cols-[1fr_minmax(240px,360px)] md:items-start md:gap-6">
          <div>
            <label htmlFor={inputId} className="font-medium text-ink">
              {label}
            </label>
            {setting.description && <p className="text-sm text-ink-muted">{setting.description}</p>}
          </div>
          <div>
            <div className="flex gap-2">
              <Input
                id={inputId}
                type={kind === 'number' ? 'number' : 'text'}
                min={kind === 'number' ? 0 : undefined}
                value={draft}
                aria-invalid={invalid || undefined}
                onChange={(e) => setDraft(e.target.value)}
                className={kind === 'number' ? 'tabular' : undefined}
              />
              <Button
                variant="secondary"
                disabled={draft === original || invalid}
                loading={save.isPending}
                onClick={() => save.mutate(kind === 'number' ? Number(draft) : draft.trim())}
              >
                {t('common.save')}
              </Button>
            </div>
            {invalid && (
              <p className="mt-1 text-sm text-danger" role="alert">
                {t('admin.settings.numberRequired')}
              </p>
            )}
          </div>
        </div>
      )}
      <ChangedBy by={setting.updated_by} at={setting.updated_at} />
    </li>
  );
}
