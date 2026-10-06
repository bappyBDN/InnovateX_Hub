import { useQuery } from '@tanstack/react-query';
import { Check, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { Callout } from '@/components/domain';
import { Badge, Button, Card, ErrorState, PageHeader, PageSkeleton } from '@/components/ui';
import { statusLabel } from '@/utils/format';
import { useAdminMutation } from './shared';

interface RoleCol {
  code: string;
  name: string;
  description: string | null;
  locked: boolean;
  full_access: boolean;
  sees_all_submissions: boolean;
  holders: number;
  permissions: string[];
}
interface Perm {
  code: string;
  module: string;
  description: string | null;
}

const KEY = ['admin', 'privileges'];

/** Role × privilege matrix. Super Admin and DMD always have everything; other roles are editable. */
export default function PrivilegesPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<{ roles: RoleCol[]; permissions: Perm[] }>('/admin/privileges') });
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(q.data.roles.map((r) => [r.code, new Set(r.permissions)])));
  }, [q.data]);

  const save = useAdminMutation((role: RoleCol) => api.put(`/admin/privileges/${role.code}`, { permissions: [...(draft[role.code] ?? [])] }), {
    invalidate: [KEY],
  });

  const modules = useMemo(() => {
    const groups = new Map<string, Perm[]>();
    for (const p of q.data?.permissions ?? []) groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
    return [...groups.entries()];
  }, [q.data]);

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const roles = q.data.roles;
  const dirty = (r: RoleCol) => {
    const d = draft[r.code];
    return !!d && (d.size !== r.permissions.length || r.permissions.some((p) => !d.has(p)));
  };
  const toggle = (role: string, perm: string) =>
    setDraft((cur) => {
      const next = new Set(cur[role]);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return { ...cur, [role]: next };
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('adminPanel.priv.title')}
        subtitle={t('adminPanel.priv.subtitle')}
        breadcrumbs={[{ label: t('adminPanel.title'), to: '/admin' }, { label: t('adminPanel.priv.title') }]}
      />
      <Callout tone="info" title={t('adminPanel.priv.fullAccessNote')}>
        <p>{t('adminPanel.priv.scopeNote')}</p>
      </Callout>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line align-bottom">
                <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-medium text-ink-muted">
                  {t('adminPanel.priv.privilege')}
                </th>
                {roles.map((r) => (
                  <th key={r.code} scope="col" className="px-2 py-3 text-center font-medium text-ink">
                    <span className="block">{r.name}</span>
                    <span className="block text-xs font-normal text-ink-muted">{t('adminPanel.priv.holders', { count: r.holders })}</span>
                    {r.full_access && <Badge tone="spark">{t('adminPanel.priv.fullAccess')}</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map(([module, perms]) => (
                <ModuleRows key={module} module={module} perms={perms} roles={roles} draft={draft} onToggle={toggle} />
              ))}
              <tr className="border-t border-line">
                <td className="sticky left-0 bg-surface px-4 py-3" />
                {roles.map((r) => (
                  <td key={r.code} className="px-2 py-3 text-center">
                    {r.locked ? (
                      <Lock className="mx-auto h-4 w-4 text-ink-muted" aria-label={r.full_access ? t('adminPanel.priv.fullAccess') : t('adminPanel.priv.fixedNote')} />
                    ) : (
                      <Button
                        size="sm"
                        variant={dirty(r) ? 'primary' : 'secondary'}
                        disabled={!dirty(r)}
                        loading={save.isPending && save.variables?.code === r.code}
                        onClick={() => save.mutate(r)}
                        aria-label={`${t('adminPanel.priv.save')}: ${r.name}`}
                      >
                        {t('common.save')}
                      </Button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ModuleRows({ module, perms, roles, draft, onToggle }: { module: string; perms: Perm[]; roles: RoleCol[]; draft: Record<string, Set<string>>; onToggle: (role: string, perm: string) => void }) {
  return (
    <>
      <tr className="bg-canvas">
        <th scope="colgroup" colSpan={roles.length + 1} className="px-4 py-1.5 text-left text-xs font-semibold text-ink-muted">
          {statusLabel(module)}
        </th>
      </tr>
      {perms.map((p) => (
        <tr key={p.code} className="border-t border-line">
          <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal">
            <span className="block text-ink">{statusLabel(p.code.split('.').slice(1).join(' ')) || p.code}</span>
            <span className="block text-xs text-ink-muted">{p.code}</span>
          </th>
          {roles.map((r) => {
            const on = draft[r.code]?.has(p.code) ?? false;
            return (
              <td key={r.code} className="px-2 py-2 text-center">
                {r.locked ? (
                  on ? <Check className="mx-auto h-4 w-4 text-success" aria-label="Yes" /> : <span className="text-ink-muted" aria-label="No">—</span>
                ) : (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--primary))]"
                    checked={on}
                    onChange={() => onToggle(r.code, p.code)}
                    aria-label={`${r.name}: ${p.code}`}
                  />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
