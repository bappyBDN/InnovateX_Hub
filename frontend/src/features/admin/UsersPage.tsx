import { useQuery } from '@tanstack/react-query';
import { Check, KeyRound, ShieldPlus, UserCheck, UserX, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  type Column,
} from '@/components/ui';
import { UserChip } from '@/components/domain';
import { useDebounce } from '@/hooks';
import { formatDate, formatDateTime, fromLocalInputValue } from '@/utils/dates';
import { tr } from '@/utils/i18n';
import { useAdminMutation } from './shared';

interface Assignment {
  id: string;
  role: string;
  role_name: string;
  scope_type: string;
  scope_id: string | null;
  valid_to: string | null;
}
interface AdminUser {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  org_unit: string | null;
  is_active: boolean;
  has_corporate_login: boolean;
  last_login_at: string | null;
  assignments: Assignment[];
}
interface RoleRow {
  id: string;
  code: string;
  name: string;
  name_i18n: Record<string, string>;
  description: string | null;
  hierarchy_level: number;
  sees_all_submissions: boolean;
  is_assignable: boolean;
}
interface OrgUnit {
  id: string;
  name: string;
  unit_type: string;
}
interface ChallengeRow {
  id: string;
  code: string;
  title_i18n: Record<string, string>;
}

export default function UsersPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const search = useDebounce(q, 300);
  const [assignTo, setAssignTo] = useState<AdminUser | null>(null);
  const [removing, setRemoving] = useState<{ user: AdminUser; a: Assignment } | null>(null);

  const users = useQuery({
    queryKey: queryKeys.admin.users({ q: search, role }),
    queryFn: () => api.get<Page<AdminUser>>('/admin/users', { q: search, role }),
  });
  const roles = useQuery({ queryKey: queryKeys.admin.roles, queryFn: () => api.get<RoleRow[]>('/roles') });
  const units = useQuery({ queryKey: queryKeys.masterdata.orgUnits, queryFn: () => api.get<OrgUnit[]>('/org-units') });
  const challenges = useQuery({
    queryKey: queryKeys.manage.challenges(),
    queryFn: () => api.get<Page<ChallengeRow>>('/manage/challenges'),
  });

  const scopeName = useMemo(() => {
    const map = new Map<string, string>();
    units.data?.forEach((u) => map.set(u.id, u.name));
    challenges.data?.items.forEach((c) => map.set(c.id, tr(c.title_i18n)));
    return map;
  }, [units.data, challenges.data]);

  const [deactivating, setDeactivating] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const account = useAdminMutation(
    (v: { user: AdminUser; body: { is_active?: boolean; new_password?: string } }) => api.patch(`/admin/users/${v.user.id}`, v.body),
    {
      invalidate: [['admin', 'users'], ['admin', 'overview']],
      onDone: (_d, v) => {
        toast.success(
          v.body.new_password ? t('adminPanel.account.passwordReset') : v.body.is_active ? t('adminPanel.account.activated') : t('adminPanel.account.deactivated'),
        );
        setDeactivating(null);
        setResetting(null);
        setNewPassword('');
      },
    },
  );

  const remove = useAdminMutation((id: string) => api.del(`/admin/role-assignments/${id}`), {
    success: t('admin.users.roleRemoved'),
    invalidate: [['admin', 'users'], queryKeys.me],
    onDone: () => setRemoving(null),
  });

  const scopeText = (a: Assignment) =>
    a.scope_type === 'GLOBAL'
      ? null
      : `${t(`admin.users.scope.${a.scope_type}`, a.scope_type)}: ${scopeName.get(a.scope_id ?? '') ?? '—'}`;

  const columns: Column<AdminUser>[] = [
    {
      key: 'full_name',
      header: t('admin.users.name'),
      sortValue: (u) => u.full_name,
      render: (u) => (
        <span className="flex flex-wrap items-center gap-2">
          <UserChip name={u.full_name} subtitle={u.email ?? t('admin.users.noLogin')} />
          {!u.is_active && <Badge tone="danger">{t('adminPanel.account.inactiveBadge')}</Badge>}
        </span>
      ),
    },
    { key: 'org_unit', header: t('admin.users.department'), sortValue: (u) => u.org_unit, render: (u) => u.org_unit ?? '—' },
    { key: 'job_title', header: t('admin.users.jobTitle'), hideOnMobile: true, render: (u) => u.job_title ?? '—' },
    {
      key: 'roles',
      header: t('admin.users.roles'),
      render: (u) =>
        u.assignments.length === 0 ? (
          <span className="text-sm text-ink-muted">{t('role.EMPLOYEE', 'Participant / Employee')}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {u.assignments.map((a) => (
              <Badge key={a.id} tone={a.role === 'SUPER_ADMIN' ? 'primary' : 'info'}>
                {a.role_name}
                {scopeText(a) && <span className="font-normal"> · {scopeText(a)}</span>}
                {a.valid_to && <span className="font-normal"> · {t('admin.users.until', { date: formatDate(a.valid_to) })}</span>}
                <button
                  type="button"
                  className="-mr-1 ml-1 rounded-full p-0.5 hover:bg-black/10 focus-visible:outline focus-visible:outline-2"
                  aria-label={t('admin.users.removeRoleAria', { role: a.role_name, name: u.full_name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRemoving({ user: u, a });
                  }}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'last_login_at',
      header: t('admin.users.lastLogin'),
      hideOnMobile: true,
      sortValue: (u) => u.last_login_at,
      render: (u) => (u.last_login_at ? formatDateTime(u.last_login_at) : t('admin.users.never')),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <span className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" icon={<ShieldPlus className="h-4 w-4" aria-hidden />} onClick={() => setAssignTo(u)}>
            {t('admin.users.assignRole')}
          </Button>
          {u.email && (
            <Button size="sm" variant="ghost" icon={<KeyRound className="h-4 w-4" aria-hidden />} onClick={() => setResetting(u)}>
              {t('adminPanel.account.resetPassword')}
            </Button>
          )}
          {u.is_active ? (
            <Button size="sm" variant="ghost" icon={<UserX className="h-4 w-4" aria-hidden />} onClick={() => setDeactivating(u)}>
              {t('adminPanel.account.deactivate')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<UserCheck className="h-4 w-4" aria-hidden />}
              loading={account.isPending && account.variables?.user.id === u.id}
              onClick={() => account.mutate({ user: u, body: { is_active: true } })}
            >
              {t('adminPanel.account.activate')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.users.title')}
        subtitle={t('admin.users.subtitle')}
        breadcrumbs={[{ label: t('adminPanel.title'), to: '/admin' }, { label: t('admin.users.title') }]}
        actions={<ButtonLink to="/admin/invitations" variant="secondary">{t('adminPanel.invite.new')}</ButtonLink>}
      />

      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={t('adminPanel.account.deactivateTitle', { name: deactivating?.full_name ?? '' })}
        description={t('adminPanel.account.deactivateBody')}
        confirmLabel={t('adminPanel.account.deactivate')}
        variant="danger"
        loading={account.isPending}
        onConfirm={() => deactivating && account.mutate({ user: deactivating, body: { is_active: false } })}
      />
      <Dialog
        open={!!resetting}
        onOpenChange={(o) => !o && (setResetting(null), setNewPassword(''))}
        title={t('adminPanel.account.resetTitle', { name: resetting?.full_name ?? '' })}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => (setResetting(null), setNewPassword(''))}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={newPassword.length < 8}
              loading={account.isPending}
              onClick={() => resetting && account.mutate({ user: resetting, body: { new_password: newPassword } })}
            >
              {t('adminPanel.account.resetPassword')}
            </Button>
          </>
        }
      >
        <Field label={t('adminPanel.account.newPassword')} required help={t('signup.passwordHelp')}>
          <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="off" />
        </Field>
      </Dialog>

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_240px]">
          <Field label={t('admin.users.search')}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.users.searchPlaceholder')} />
          </Field>
          <Field label={t('admin.users.filterRole')}>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t('admin.users.allRoles')}
              options={(roles.data ?? []).filter((r) => r.is_assignable).map((r) => ({ value: r.code, label: tr(r.name_i18n, r.name) }))}
            />
          </Field>
        </div>
        {users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={users.data?.items}
            rowKey={(u) => u.id}
            loading={users.isLoading}
            initialSort={{ key: 'full_name', dir: 'asc' }}
            empty={<EmptyState title={t('admin.users.empty')} description={t('admin.users.emptyHint')} />}
          />
        )}
      </Card>

      <Card>
        <CardHeader title={t('admin.users.rolesPanel')} subtitle={t('admin.users.rolesPanelHint')} />
        {roles.isError ? (
          <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
        ) : (
          <DataTable<RoleRow>
            loading={roles.isLoading}
            rows={roles.data}
            rowKey={(r) => r.id}
            columns={[
              { key: 'hierarchy_level', header: t('admin.users.level'), render: (r) => <span className="tabular">{r.hierarchy_level}</span> },
              { key: 'name', header: t('admin.users.role'), render: (r) => <span className="font-medium">{tr(r.name_i18n, r.name)}</span> },
              { key: 'description', header: t('admin.users.whatTheySee'), render: (r) => r.description ?? '—' },
              {
                key: 'sees_all_submissions',
                header: t('admin.users.seesAll'),
                render: (r) =>
                  r.sees_all_submissions ? (
                    <Badge tone="success" icon={<Check className="h-3 w-3" aria-hidden />}>
                      {t('common.yes')}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">{t('common.no')}</Badge>
                  ),
              },
              {
                key: 'is_assignable',
                header: t('admin.users.howGiven'),
                hideOnMobile: true,
                render: (r) => (r.is_assignable ? t('admin.users.assignedByAdmin') : t('admin.users.automatic')),
              },
            ]}
          />
        )}
      </Card>

      {assignTo && (
        <AssignDialog
          user={assignTo}
          roles={(roles.data ?? []).filter((r) => r.is_assignable)}
          units={units.data ?? []}
          challenges={challenges.data?.items ?? []}
          onClose={() => setAssignTo(null)}
        />
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('admin.users.removeTitle')}
        description={removing ? t('admin.users.removeBody', { role: removing.a.role_name, name: removing.user.full_name }) : ''}
        confirmLabel={t('admin.users.removeRole')}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.a.id)}
      />
    </div>
  );
}

function AssignDialog({
  user,
  roles,
  units,
  challenges,
  onClose,
}: {
  user: AdminUser;
  roles: RoleRow[];
  units: OrgUnit[];
  challenges: ChallengeRow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState('');
  const [scope, setScope] = useState<'GLOBAL' | 'ORG_UNIT' | 'CHALLENGE'>('GLOBAL');
  const [scopeId, setScopeId] = useState('');
  const [until, setUntil] = useState('');
  const [tried, setTried] = useState(false);

  const assign = useAdminMutation(
    () =>
      api.post('/admin/role-assignments', {
        user_id: user.id,
        role,
        scope_type: scope,
        scope_id: scope === 'GLOBAL' ? null : scopeId,
        valid_to: until ? fromLocalInputValue(until) : null,
      }),
    { success: t('admin.users.roleAssigned'), invalidate: [['admin', 'users'], queryKeys.me], onDone: onClose },
  );

  const roleError = tried && !role ? t('admin.users.chooseRole') : null;
  const scopeError = tried && scope !== 'GLOBAL' && !scopeId ? t('admin.users.chooseScope') : null;
  const submit = () => {
    setTried(true);
    if (!role || (scope !== 'GLOBAL' && !scopeId)) return;
    assign.mutate(undefined);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.users.assignTitle', { name: user.full_name })}
      description={t('admin.users.assignHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={assign.isPending}>
            {t('admin.users.assignRole')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('admin.users.role')} required error={roleError}>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={t('admin.users.chooseRole')}
            options={roles.map((r) => ({ value: r.code, label: tr(r.name_i18n, r.name) }))}
          />
        </Field>
        {role && <p className="text-sm text-ink-muted">{roles.find((r) => r.code === role)?.description}</p>}
        <Field label={t('admin.users.scopeLabel')}>
          <Select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as typeof scope);
              setScopeId('');
            }}
            options={[
              { value: 'GLOBAL', label: t('admin.users.scope.GLOBAL') },
              { value: 'ORG_UNIT', label: t('admin.users.scope.ORG_UNIT') },
              { value: 'CHALLENGE', label: t('admin.users.scope.CHALLENGE') },
            ]}
          />
        </Field>
        {scope === 'ORG_UNIT' && (
          <Field label={t('admin.users.company')} required error={scopeError}>
            <Select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder={t('admin.users.chooseScope')}
              options={units.map((u) => ({ value: u.id, label: u.name }))}
            />
          </Field>
        )}
        {scope === 'CHALLENGE' && (
          <Field label={t('admin.users.challenge')} required error={scopeError}>
            <Select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder={t('admin.users.chooseScope')}
              options={challenges.map((c) => ({ value: c.id, label: `${c.code} · ${tr(c.title_i18n)}` }))}
            />
          </Field>
        )}
        <Field label={t('admin.users.endDate')} help={t('admin.users.endDateHelp')}>
          <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
