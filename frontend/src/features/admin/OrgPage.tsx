import { useQuery } from '@tanstack/react-query';
import { Building2, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
  Switch,
} from '@/components/ui';
import { tr } from '@/utils/i18n';
import { useAdminMutation } from './shared';

interface Unit {
  id: string;
  parent_id: string | null;
  unit_type: string;
  code: string;
  name: string;
  name_i18n: Record<string, string>;
  path: string;
  is_active: boolean;
  head: { full_name: string } | null;
  members: number;
}

const TYPES = ['GROUP', 'COMPANY', 'BUSINESS', 'FUNCTION', 'DEPARTMENT', 'TEAM', 'PROJECT'];
const CHILD_TYPE: Record<string, string> = {
  GROUP: 'COMPANY',
  COMPANY: 'FUNCTION',
  BUSINESS: 'FUNCTION',
  FUNCTION: 'DEPARTMENT',
  DEPARTMENT: 'TEAM',
  TEAM: 'PROJECT',
};

type Editing = { mode: 'add'; parent: Unit | null } | { mode: 'edit'; unit: Unit };

export default function OrgPage() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Editing | null>(null);
  const units = useQuery({ queryKey: queryKeys.masterdata.orgUnits, queryFn: () => api.get<Unit[]>('/org-units') });

  // The API returns units ordered by path, so depth = number of dots in the path.
  const rows = useMemo(() => (units.data ?? []).map((u) => ({ u, depth: u.path.split('.').length - 1 })), [units.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.org.title')}
        subtitle={t('admin.org.subtitle')}
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing({ mode: 'add', parent: null })}>
            {t('admin.org.addTop')}
          </Button>
        }
      />

      {units.isLoading ? (
        <PageSkeleton rows={6} />
      ) : units.isError ? (
        <ErrorState error={units.error} onRetry={() => void units.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-8 w-8" aria-hidden />}
          title={t('admin.org.empty')}
          action={<Button onClick={() => setEditing({ mode: 'add', parent: null })}>{t('admin.org.addTop')}</Button>}
        />
      ) : (
        <Card padded={false}>
          <ul role="tree" aria-label={t('admin.org.title')} className="divide-y divide-line">
            {rows.map(({ u, depth }) => (
              <li
                key={u.id}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={false}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                style={{ paddingLeft: `${16 + Math.min(depth, 5) * 20}px` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={depth === 0 ? 'font-semibold text-ink' : 'font-medium text-ink'}>{tr(u.name_i18n, u.name)}</span>
                    <Badge tone="neutral">{t(`admin.org.type.${u.unit_type}`, u.unit_type)}</Badge>
                    {!u.is_active && <Badge tone="warning">{t('admin.common.inactive')}</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {u.code} · {t('admin.org.people', { count: u.members })}
                    {u.head && <> · {t('admin.org.head', { name: u.head.full_name })}</>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing({ mode: 'add', parent: u })}>
                    {t('admin.org.addChild')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => setEditing({ mode: 'edit', unit: u })}>
                    {t('common.edit')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && <UnitDialog editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UnitDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { t } = useTranslation();
  const unit = editing.mode === 'edit' ? editing.unit : null;
  const parent = editing.mode === 'add' ? editing.parent : null;
  const [name, setName] = useState(unit?.name_i18n.en ?? unit?.name ?? '');
  const [nameBn, setNameBn] = useState(unit?.name_i18n.bn ?? '');
  const [code, setCode] = useState(unit?.code ?? '');
  const [type, setType] = useState(unit?.unit_type ?? (parent ? CHILD_TYPE[parent.unit_type] ?? 'TEAM' : 'GROUP'));
  const [active, setActive] = useState(unit?.is_active ?? true);
  const [tried, setTried] = useState(false);

  const save = useAdminMutation(
    () => {
      const body = { parent_id: unit?.parent_id ?? parent?.id ?? null, unit_type: type, code: code.trim(), name: name.trim(), name_bn: nameBn.trim() || null, is_active: active };
      return unit ? api.patch(`/org-units/${unit.id}`, body) : api.post('/org-units', body);
    },
    { success: unit ? t('admin.org.saved') : t('admin.org.added'), invalidate: [queryKeys.masterdata.orgUnits], onDone: onClose },
  );
  const submit = () => {
    setTried(true);
    if (name.trim() && code.trim()) save.mutate(undefined);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={unit ? t('admin.org.editTitle', { name: unit.name }) : parent ? t('admin.org.addUnder', { name: parent.name }) : t('admin.org.addTop')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {unit ? t('common.save') : t('admin.org.addUnit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('admin.common.nameEn')} required error={tried && !name.trim() ? t('admin.common.nameRequired') : null}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('admin.common.nameBn')}>
          <Input value={nameBn} onChange={(e) => setNameBn(e.target.value)} lang="bn" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('admin.org.code')}
            required
            help={unit ? t('admin.org.codeLocked') : t('admin.org.codeHelp')}
            error={tried && !code.trim() ? t('admin.org.codeRequired') : null}
          >
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={!!unit} />
          </Field>
          <Field label={t('admin.org.unitType')}>
            <Select value={type} onChange={(e) => setType(e.target.value)} options={TYPES.map((x) => ({ value: x, label: t(`admin.org.type.${x}`, x) }))} />
          </Field>
        </div>
        <Switch checked={active} onChange={setActive} label={t('admin.common.active')} description={t('admin.org.activeHelp')} />
      </div>
    </Dialog>
  );
}
