import { useQuery } from '@tanstack/react-query';
import { KeyRound, MailPlus, Network, ScrollText, Settings, UserCog, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { BarChart, Callout } from '@/components/domain';
import { Badge, ButtonLink, Card, CardHeader, ErrorState, PageHeader, PageSkeleton, Stat } from '@/components/ui';
import { formatDateTime } from '@/utils/dates';

interface Overview {
  users_total: number;
  users_active: number;
  signups_this_week: number;
  invitations_pending: number;
  by_role: { code: string; name: string; count: number }[];
  recent_signups: { id: string; full_name: string; email: string | null; org_unit: string | null; created_at: string | null; is_active: boolean }[];
  signup_enabled: boolean;
}

const CARDS: { key: string; to: string; icon: LucideIcon }[] = [
  { key: 'users', to: '/admin/users', icon: UserCog },
  { key: 'invitations', to: '/admin/invitations', icon: MailPlus },
  { key: 'privileges', to: '/admin/privileges', icon: KeyRound },
  { key: 'org', to: '/admin/org', icon: Network },
  { key: 'settings', to: '/admin/settings', icon: Settings },
  { key: 'audit', to: '/admin/audit', icon: ScrollText },
];

/** Landing page of the Super Admin panel: who has access, what is waiting, and where to manage it. */
export default function AdminHomePage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/admin/overview') });

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('adminPanel.title')}
        subtitle={t('adminPanel.subtitle')}
        actions={<ButtonLink to="/admin/invitations" icon={<MailPlus className="h-4 w-4" aria-hidden />}>{t('adminPanel.invite.new')}</ButtonLink>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('adminPanel.usersTotal')} value={d.users_total} to="/admin/users" />
        <Stat label={t('adminPanel.usersActive')} value={d.users_active} />
        <Stat label={t('adminPanel.signupsWeek')} value={d.signups_this_week} />
        <Stat label={t('adminPanel.invitesPending')} value={d.invitations_pending} to="/admin/invitations" />
      </div>

      <Callout
        tone={d.signup_enabled ? 'info' : 'warning'}
        title={d.signup_enabled ? t('adminPanel.signupOn') : t('adminPanel.signupOff')}
        action={<Link className="font-medium text-primary underline" to="/admin/settings">{t('adminPanel.signupSetting')}</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(({ key, to, icon: Icon }) => (
          <Link key={key} to={to} className="group rounded-panel border border-line bg-surface p-4 hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <div className="flex items-start gap-3">
              <span className="rounded-control bg-primary-soft p-2 text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span>
                <span className="block font-medium text-ink group-hover:text-primary">{t(`adminPanel.cards.${key}`)}</span>
                <span className="mt-0.5 block text-sm text-ink-muted">{t(`adminPanel.cards.${key}Desc`)}</span>
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('adminPanel.peopleByRole')} />
          <BarChart data={d.by_role.map((r) => ({ label: r.name, value: r.count }))} />
        </Card>
        <Card>
          <CardHeader title={t('adminPanel.recentSignups')} />
          {d.recent_signups.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('adminPanel.noSignups')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.recent_signups.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{u.full_name}</span>
                    <span className="block truncate text-sm text-ink-muted">{[u.email, u.org_unit].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex items-center gap-2 text-sm text-ink-muted">
                    {!u.is_active && <Badge tone="danger">{t('adminPanel.inactive')}</Badge>}
                    {u.created_at ? formatDateTime(u.created_at) : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
