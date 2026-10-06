import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Switch,
  Tabs,
  type Column,
} from '@/components/ui';
import { statusLabel } from '@/utils/format';
import { useAdminMutation } from './shared';

type Kind = 'domains' | 'categories' | 'skills';
const KINDS: Kind[] = ['domains', 'categories', 'skills'];

/** One shape for both the simple lists and lookup values. */
interface Item {
  id: string;
  code: string;
  en: string;
  bn: string;
  is_active: boolean;
  extra?: string | null;
}
interface SimpleRow {
  id: string;
  code: string;
  name: string;
  name_i18n: Record<string, string>;
  is_active?: boolean;
  category?: string | null;
}
interface LookupRow {
  id: string;
  code: string;
  label: string;
  label_i18n: Record<string, string>;
  is_active: boolean;
}

export default function MasterDataPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<string>('domains');
  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.master.title')} subtitle={t('admin.master.subtitle')} />
      <Tabs
        ariaLabel={t('admin.master.title')}
        value={tab}
        onChange={setTab}
        tabs={[...KINDS.map((k) => ({ value: k, label: t(`admin.master.tab.${k}`) })), { value: 'lookups', label: t('admin.master.tab.lookups') }]}
      />
      {tab === 'lookups' ? <Lookups /> : <SimpleList key={tab} kind={tab as Kind} />}
    </div>
  );
}

function SimpleList({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  const key = ['masterdata', kind, 'all'];
  const list = useQuery({ queryKey: key, queryFn: () => api.get<SimpleRow[]>(`/${kind}`, { include_inactive: true }) });
  const items: Item[] | undefined = list.data?.map((r) => ({
    id: r.id,
    code: r.code,
    en: r.name_i18n?.en ?? r.name,
    bn: r.name_i18n?.bn ?? '',
    is_active: r.is_active ?? true,
    extra: r.category,
  }));
  return (
    <ItemTable
      title={t(`admin.master.tab.${kind}`)}
      hint={t(`admin.master.hint.${kind}`)}
      items={items}
      loading={list.isLoading}
      error={list.isError ? list.error : null}
      onRetry={() => void list.refetch()}
      canDeactivate={kind !== 'skills'}
      invalidate={[key, [kind]]}
      create={(v) => api.post(`/${kind}`, { name: v.en, name_bn: v.bn || null, is_active: v.is_active })}
      update={(id, v) => api.patch(`/${kind}/${id}`, { name: v.en, name_bn: v.bn || null, is_active: v.is_active })}
    />
  );
}

function Lookups() {
  const { t } = useTranslation();
  const key = ['lookups', 'all'];
  const lookups = useQuery({ queryKey: key, queryFn: () => api.get<Record<string, LookupRow[]>>('/lookups') });
  const types = Object.keys(lookups.data ?? {});
  const [type, setType] = useState('');
  const current = type && types.includes(type) ? type : types[0];

  if (lookups.isError) return <ErrorState error={lookups.error} onRetry={() => void lookups.refetch()} />;
  return (
    <div className="space-y-4">
      {types.length > 0 && (
        <Tabs
          ariaLabel={t('admin.master.tab.lookups')}
          value={current}
          onChange={setType}
          tabs={types.map((x) => ({ value: x, label: t(`admin.master.lookup.${x}`, statusLabel(x)), count: lookups.data?.[x].length }))}
        />
      )}
      <ItemTable
        key={current}
        title={current ? t(`admin.master.lookup.${current}`, statusLabel(current)) : t('admin.master.tab.lookups')}
        hint={t('admin.master.hint.lookups')}
        items={current ? lookups.data?.[current].map((v) => ({ id: v.id, code: v.code, en: v.label_i18n?.en ?? v.label, bn: v.label_i18n?.bn ?? '', is_active: v.is_active })) : undefined}
        loading={lookups.isLoading}
        error={null}
        onRetry={() => void lookups.refetch()}
        canDeactivate
        invalidate={[key, ['lookups']]}
        create={(v) => api.post(`/lookups/${current}`, { label: v.en, label_bn: v.bn || null, is_active: v.is_active })}
        update={(id, v) => api.patch(`/lookups/values/${id}`, { label: v.en, label_bn: v.bn || null, is_active: v.is_active })}
      />
    </div>
  );
}

interface Values {
  en: string;
  bn: string;
  is_active: boolean;
}

function ItemTable({
  title,
  hint,
  items,
  loading,
  error,
  onRetry,
  canDeactivate,
  invalidate,
  create,
  update,
}: {
  title: string;
  hint: string;
  items: Item[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  canDeactivate: boolean;
  invalidate: unknown[][];
  create: (v: Values) => Promise<unknown>;
  update: (id: string, v: Values) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);

  const save = useAdminMutation((v: Values) => (editing && editing !== 'new' ? update(editing.id, v) : create(v)), {
    success: t('admin.master.saved'),
    invalidate,
    onDone: () => setEditing(null),
  });
  const toggle = useAdminMutation((i: Item) => update(i.id, { en: i.en, bn: i.bn, is_active: !i.is_active }), {
    success: t('admin.master.saved'),
    invalidate,
  });

  const columns: Column<Item>[] = [
    { key: 'en', header: t('admin.common.nameEn'), sortValue: (i) => i.en, render: (i) => <span className="font-medium">{i.en}</span> },
    { key: 'bn', header: t('admin.common.nameBn'), render: (i) => (i.bn ? <span lang="bn">{i.bn}</span> : <span className="text-ink-muted">{t('admin.master.noBangla')}</span>) },
    { key: 'code', header: t('admin.master.code'), hideOnMobile: true, render: (i) => <code className="text-xs text-ink-muted">{i.code}</code> },
    {
      key: 'is_active',
      header: t('admin.master.status'),
      render: (i) => (i.is_active ? <Badge tone="success">{t('admin.common.active')}</Badge> : <Badge tone="neutral">{t('admin.common.inactive')}</Badge>),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (i) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => setEditing(i)}>
            {t('common.edit')}
          </Button>
          {canDeactivate && (
            <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === i.id} onClick={() => toggle.mutate(i)}>
              {i.is_active ? t('admin.master.deactivate') : t('admin.master.activate')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={hint}
        actions={
          <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>
            {t('common.add')}
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(i) => i.id}
          loading={loading}
          empty={<EmptyState title={t('admin.master.empty')} action={<Button onClick={() => setEditing('new')}>{t('common.add')}</Button>} />}
        />
      )}
      {editing && (
        <ItemDialog
          title={editing === 'new' ? t('admin.master.addTo', { list: title }) : t('admin.master.editItem', { name: editing.en })}
          initial={editing === 'new' ? { en: '', bn: '', is_active: true } : editing}
          canDeactivate={canDeactivate}
          saving={save.isPending}
          onSave={(v) => save.mutate(v)}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function ItemDialog({
  title,
  initial,
  canDeactivate,
  saving,
  onSave,
  onClose,
}: {
  title: string;
  initial: Values;
  canDeactivate: boolean;
  saving: boolean;
  onSave: (v: Values) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState<Values>({ en: initial.en, bn: initial.bn, is_active: initial.is_active });
  const [tried, setTried] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={saving}
            onClick={() => {
              setTried(true);
              if (v.en.trim()) onSave({ ...v, en: v.en.trim(), bn: v.bn.trim() });
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('admin.common.nameEn')} required error={tried && !v.en.trim() ? t('admin.common.nameRequired') : null}>
          <Input value={v.en} onChange={(e) => setV({ ...v, en: e.target.value })} />
        </Field>
        <Field label={t('admin.common.nameBn')}>
          <Input value={v.bn} onChange={(e) => setV({ ...v, bn: e.target.value })} lang="bn" />
        </Field>
        {canDeactivate && (
          <Switch checked={v.is_active} onChange={(c) => setV({ ...v, is_active: c })} label={t('admin.common.active')} description={t('admin.master.activeHelp')} />
        )}
      </div>
    </Dialog>
  );
}
