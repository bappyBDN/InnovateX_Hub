import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  Badge,
  Button,
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
  Switch,
  Tabs,
  Textarea,
} from '@/components/ui';
import { Callout, StatusBadge } from '@/components/domain';
import { formatDateTime } from '@/utils/dates';
import { statusLabel } from '@/utils/format';
import { ChangedBy, useAdminMutation } from './shared';

interface Template {
  id: string;
  code: string;
  event_type: string;
  channel: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
}
interface Rule {
  id: string;
  event_type: string;
  channel: string;
  recipient_type: string;
  recipient_value: string;
  cc_value: string | null;
  template_code: string | null;
  is_active: boolean;
  updated_at: string | null;
  updated_by: string | null;
}
interface Delivery {
  id: string;
  event_type: string | null;
  recipient_address: string | null;
  template_code: string | null;
  rendered_subject: string | null;
  rendered_body: string | null;
  status: string;
  attempts: number;
  sent_at: string | null;
  created_at: string | null;
  error: string | null;
}
interface RoleRow {
  code: string;
  name: string;
}
interface Setting {
  key: string;
  value: unknown;
}

const SAMPLE: Record<string, string> = {
  innovation_id: 'INNO-2026-000123',
  title: 'Smart kiln scheduling',
  submitter: 'Rahim Uddin',
  owner: 'Rahim Uddin',
  function: 'Kiln & Process',
  classification: 'INTERNAL',
  summary: 'Match kiln firing to raw-mill running hours.',
  status: 'Submitted',
  submitted_at: '20 Nov 2026, 5:00 PM',
  review_sla: '5 working days',
  entry_code: 'ENT-2026-007-0042',
  round: 'Methodology review',
  due_date: '28 Nov 2026, 5:00 PM',
  code: 'INNO-2026-000123',
  old_status: 'Under review',
  new_status: 'Shortlisted',
  decision: 'Your entry is shortlisted',
  challenge: 'Cut kiln energy use by 10%',
  team: 'Team Spark',
  requester: 'Sadia Islam',
  version: '3',
  secure_link: 'https://innovatex.example/ideas/INNO-2026-000123',
  app_name: 'InnovateX Hub',
};
const render = (tpl: string) => tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => SAMPLE[k] ?? `[${k}]`);
const variablesIn = (tpl: string) => Array.from(new Set(Array.from(tpl.matchAll(/\{\{\s*(\w+)\s*\}\}/g), (m) => m[1])));

export default function NotificationsAdminPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('templates');
  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.notify.title')} subtitle={t('admin.notify.subtitle')} />
      <Tabs
        ariaLabel={t('admin.notify.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'templates', label: t('admin.notify.tab.templates') },
          { value: 'rules', label: t('admin.notify.tab.rules') },
          { value: 'log', label: t('admin.notify.tab.log') },
        ]}
      />
      {tab === 'templates' && <Templates />}
      {tab === 'rules' && <Rules />}
      {tab === 'log' && <DeliveryLog />}
    </div>
  );
}

function Templates() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Template | null>(null);
  const list = useQuery({ queryKey: queryKeys.admin.templates, queryFn: () => api.get<Template[]>('/notification-templates') });
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <Card>
      <CardHeader title={t('admin.notify.templates')} subtitle={t('admin.notify.templatesHint')} />
      <DataTable<Template>
        loading={list.isLoading}
        rows={list.data}
        rowKey={(x) => x.id}
        onRowClick={setEditing}
        empty={<EmptyState title={t('admin.notify.noTemplates')} />}
        columns={[
          { key: 'code', header: t('admin.notify.code'), render: (x) => <code className="text-xs">{x.code}</code> },
          { key: 'event_type', header: t('admin.notify.event'), sortValue: (x) => x.event_type, render: (x) => statusLabel(x.event_type) },
          { key: 'subject_template', header: t('admin.notify.subject'), render: (x) => <span className="break-words">{x.subject_template}</span> },
          { key: 'is_active', header: t('admin.master.status'), render: (x) => (x.is_active ? <Badge tone="success">{t('admin.common.active')}</Badge> : <Badge tone="neutral">{t('admin.common.inactive')}</Badge>) },
          { key: 'updated_at', header: t('admin.common.lastChanged'), hideOnMobile: true, render: (x) => <ChangedBy by={x.updated_by} at={x.updated_at} /> },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (x) => (
              <Button
                size="sm"
                variant="ghost"
                icon={<Pencil className="h-4 w-4" aria-hidden />}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(x);
                }}
              >
                {t('common.edit')}
              </Button>
            ),
          },
        ]}
      />
      {editing && <TemplateDialog tpl={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TemplateDialog({ tpl, onClose }: { tpl: Template; onClose: () => void }) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(tpl.subject_template);
  const [body, setBody] = useState(tpl.body_template ?? '');
  const [active, setActive] = useState(tpl.is_active);
  const [tried, setTried] = useState(false);
  const vars = useMemo(() => Array.from(new Set([...variablesIn(tpl.subject_template + (tpl.body_template ?? '')), 'secure_link', 'app_name'])), [tpl]);
  const save = useAdminMutation(() => api.put(`/notification-templates/${tpl.id}`, { subject_template: subject, body_template: body, is_active: active }), {
    success: t('admin.notify.templateSaved'),
    invalidate: [queryKeys.admin.templates],
    onDone: onClose,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={t('admin.notify.editTemplate', { code: tpl.code })}
      description={statusLabel(tpl.event_type)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (subject.trim()) save.mutate(undefined);
            }}
          >
            {t('admin.notify.saveTemplate')}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label={t('admin.notify.subject')} required error={tried && !subject.trim() ? t('admin.notify.subjectRequired') : null}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label={t('admin.notify.body')} help={t('admin.notify.bodyHelp')}>
            <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-sm" />
          </Field>
          <div>
            <p className="text-sm font-medium text-ink">{t('admin.notify.variables')}</p>
            <p className="mb-2 text-sm text-ink-muted">{t('admin.notify.variablesHint')}</p>
            <div className="flex flex-wrap gap-1.5">
              {vars.map((v) => (
                <button key={v} type="button" className="rounded-full border border-line px-2 py-0.5 font-mono text-xs text-ink hover:bg-neutral-soft" onClick={() => setBody((b) => `${b}{{${v}}}`)}>
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
          <Switch checked={active} onChange={setActive} label={t('admin.notify.templateActive')} description={t('admin.notify.templateActiveHelp')} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink">{t('admin.notify.preview')}</p>
          <div className="rounded-panel border border-line bg-canvas p-4" aria-live="polite">
            <p className="break-words font-medium text-ink">{render(subject) || '—'}</p>
            <hr className="my-3 border-line" />
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{render(body)}</p>
          </div>
          <p className="mt-2 text-sm text-ink-muted">{t('admin.notify.previewHint')}</p>
        </div>
      </div>
    </Dialog>
  );
}

function Rules() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const list = useQuery({ queryKey: queryKeys.admin.rules, queryFn: () => api.get<Rule[]>('/notification-rules') });
  const remove = useAdminMutation((id: string) => api.del(`/notification-rules/${id}`), {
    success: t('admin.notify.ruleRemoved'),
    invalidate: [queryKeys.admin.rules],
    onDone: () => setRemoving(null),
  });
  const recipient = (r: Rule) =>
    r.recipient_type === 'ROLE'
      ? t('admin.notify.everyoneWithRole', { role: t(`role.${r.recipient_value}`, statusLabel(r.recipient_value)) })
      : r.recipient_type === 'SETTING'
        ? t('admin.notify.fromSetting', { key: r.recipient_value })
        : r.recipient_value;

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <div className="space-y-4">
      <Callout tone="info">{t('admin.notify.rulesNote')}</Callout>
      <Card>
        <CardHeader
          title={t('admin.notify.rules')}
          subtitle={t('admin.notify.rulesHint')}
          actions={
            <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>
              {t('admin.notify.addRule')}
            </Button>
          }
        />
        <DataTable<Rule>
          loading={list.isLoading}
          rows={list.data}
          rowKey={(r) => r.id}
          empty={<EmptyState title={t('admin.notify.noRules')} action={<Button onClick={() => setEditing('new')}>{t('admin.notify.addRule')}</Button>} />}
          columns={[
            { key: 'event_type', header: t('admin.notify.event'), render: (r) => <span className="font-medium">{statusLabel(r.event_type)}</span> },
            { key: 'recipient', header: t('admin.notify.to'), render: (r) => <span className="break-all">{recipient(r)}</span> },
            { key: 'cc_value', header: t('admin.notify.cc'), hideOnMobile: true, render: (r) => r.cc_value || '—' },
            { key: 'is_active', header: t('admin.master.status'), render: (r) => (r.is_active ? <Badge tone="success">{t('admin.common.active')}</Badge> : <Badge tone="neutral">{t('admin.common.inactive')}</Badge>) },
            { key: 'updated_at', header: t('admin.common.lastChanged'), hideOnMobile: true, render: (r) => <ChangedBy by={r.updated_by} at={r.updated_at} /> },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (r) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => setEditing(r)}>
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => setRemoving(r)}>
                    {t('common.remove')}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {editing && <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('admin.notify.removeRuleTitle')}
        description={removing ? t('admin.notify.removeRuleBody', { event: statusLabel(removing.event_type), to: recipient(removing) }) : ''}
        confirmLabel={t('admin.notify.removeRule')}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [event, setEvent] = useState(rule?.event_type ?? '');
  const [type, setType] = useState(rule?.recipient_type ?? 'FIXED_EMAIL');
  const [value, setValue] = useState(rule?.recipient_value ?? '');
  const [cc, setCc] = useState(rule?.cc_value ?? '');
  const [active, setActive] = useState(rule?.is_active ?? true);
  const [tried, setTried] = useState(false);

  const templates = useQuery({ queryKey: queryKeys.admin.templates, queryFn: () => api.get<Template[]>('/notification-templates') });
  const roles = useQuery({ queryKey: queryKeys.admin.roles, queryFn: () => api.get<RoleRow[]>('/roles') });
  // Settings are Super Admin only; a Program Owner types the setting key instead.
  const settings = useQuery({ queryKey: queryKeys.admin.settings, queryFn: () => api.get<Setting[]>('/settings'), retry: false });
  const events = useMemo(() => {
    const set = new Set((templates.data ?? []).map((x) => x.event_type));
    if (rule?.event_type) set.add(rule.event_type);
    return Array.from(set).sort();
  }, [templates.data, rule]);
  const mailboxes = (settings.data ?? []).filter((s) => typeof s.value === 'string' && String(s.value).includes('@'));

  const emailOk = type !== 'FIXED_EMAIL' || /^\S+@\S+\.\S+$/.test(value.trim());
  const save = useAdminMutation(
    () => {
      const body = { event_type: event, recipient_type: type, recipient_value: value.trim(), cc_value: cc.trim() || null, is_active: active };
      return rule ? api.put(`/notification-rules/${rule.id}`, body) : api.post('/notification-rules', body);
    },
    { success: t('admin.notify.ruleSaved'), invalidate: [queryKeys.admin.rules], onDone: onClose },
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule ? t('admin.notify.editRule') : t('admin.notify.addRule')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (event && value.trim() && emailOk) save.mutate(undefined);
            }}
          >
            {t('admin.notify.saveRule')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('admin.notify.event')} required help={t('admin.notify.eventHelp')} error={tried && !event ? t('admin.notify.eventRequired') : null}>
          <Select value={event} onChange={(e) => setEvent(e.target.value)} placeholder={t('admin.notify.chooseEvent')} options={events.map((x) => ({ value: x, label: statusLabel(x) }))} />
        </Field>
        <Field label={t('admin.notify.recipientType')}>
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setValue('');
            }}
            options={['FIXED_EMAIL', 'ROLE', 'SETTING'].map((x) => ({ value: x, label: t(`admin.notify.recipient.${x}`) }))}
          />
        </Field>
        <Field
          label={t(`admin.notify.valueLabel.${type}`, t('admin.notify.to'))}
          required
          error={tried && !value.trim() ? t('admin.notify.valueRequired') : tried && !emailOk ? t('admin.notify.emailInvalid') : null}
        >
          {type === 'ROLE' ? (
            <Select value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('admin.users.chooseRole')} options={(roles.data ?? []).map((r) => ({ value: r.code, label: r.name }))} />
          ) : type === 'SETTING' && mailboxes.length > 0 ? (
            <Select value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('admin.notify.chooseSetting')} options={mailboxes.map((s) => ({ value: s.key, label: `${s.key} (${String(s.value)})` }))} />
          ) : (
            <Input type={type === 'FIXED_EMAIL' ? 'email' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </Field>
        <Field label={t('admin.notify.cc')} help={t('admin.notify.ccHelp')}>
          <Input type="email" value={cc} onChange={(e) => setCc(e.target.value)} />
        </Field>
        <Switch checked={active} onChange={setActive} label={t('admin.notify.ruleActive')} />
      </div>
    </Dialog>
  );
}

function DeliveryLog() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Delivery | null>(null);
  const params = { status, page };
  const log = useQuery({
    queryKey: queryKeys.admin.deliveries(params),
    queryFn: () => api.get<Page<Delivery>>('/notification-deliveries', params),
    placeholderData: keepPreviousData,
  });
  const retry = useAdminMutation((id: string) => api.post<Delivery>(`/notification-deliveries/${id}/retry`), {
    invalidate: [['admin', 'notification-deliveries'], queryKeys.admin.health],
    onDone: (d) => (d.status === 'SENT' ? toast.success(t('admin.notify.retrySent')) : toast.error(d.error || t('admin.notify.retryFailed'))),
  });
  const pages = Math.max(1, Math.ceil((log.data?.total ?? 0) / 50));

  if (log.isError) return <ErrorState error={log.error} onRetry={() => void log.refetch()} />;
  return (
    <Card>
      <CardHeader title={t('admin.notify.log')} subtitle={t('admin.notify.logHint', { count: log.data?.total ?? 0 })} />
      <div className="mb-4 max-w-xs">
        <Field label={t('admin.master.status')}>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            placeholder={t('common.all')}
            options={['SENT', 'FAILED', 'QUEUED'].map((x) => ({ value: x, label: statusLabel(x) }))}
          />
        </Field>
      </div>
      <DataTable<Delivery>
        loading={log.isLoading}
        rows={log.data?.items}
        rowKey={(d) => d.id}
        onRowClick={setOpen}
        empty={<EmptyState title={status === 'FAILED' ? t('admin.notify.noFailed') : t('admin.notify.noDeliveries')} />}
        columns={[
          { key: 'created_at', header: t('admin.notify.when'), render: (d) => <span className="tabular whitespace-nowrap">{formatDateTime(d.sent_at ?? d.created_at)}</span> },
          { key: 'recipient_address', header: t('admin.notify.to'), render: (d) => <span className="break-all">{d.recipient_address ?? '—'}</span> },
          { key: 'rendered_subject', header: t('admin.notify.subject'), render: (d) => <span className="break-words">{d.rendered_subject ?? '—'}</span> },
          {
            key: 'status',
            header: t('admin.master.status'),
            render: (d) => (
              <div>
                <StatusBadge status={d.status} />
                {d.status === 'FAILED' && d.error && <p className="mt-1 max-w-xs break-words text-xs text-danger">{d.error}</p>}
              </div>
            ),
          },
          { key: 'attempts', header: t('admin.notify.attempts'), hideOnMobile: true, align: 'right', render: (d) => <span className="tabular">{d.attempts}</span> },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (d) =>
              d.status === 'FAILED' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCw className="h-4 w-4" aria-hidden />}
                  loading={retry.isPending && retry.variables === d.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    retry.mutate(d.id);
                  }}
                >
                  {t('admin.notify.retry')}
                </Button>
              ) : null,
          },
        ]}
      />
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label={t('admin.common.pagination')}>
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('admin.common.prevPage')}
          </Button>
          <span className="text-sm text-ink-muted">{t('admin.common.pageOf', { page, pages })}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('admin.common.nextPage')}
          </Button>
        </nav>
      )}
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)} title={open.rendered_subject ?? t('admin.notify.email')} description={`${t('admin.notify.to')}: ${open.recipient_address ?? '—'}`}>
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{open.rendered_body}</p>
        </Dialog>
      )}
    </Card>
  );
}
