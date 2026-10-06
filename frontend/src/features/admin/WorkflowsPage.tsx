import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
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
  PageSkeleton,
  Tabs,
  type Tone,
} from '@/components/ui';
import { statusLabel } from '@/utils/format';
import { useAdminMutation } from './shared';

interface State {
  id: string;
  code: string;
  name: string;
  state_group: string;
  is_initial: boolean;
  is_terminal: boolean;
  sla_hours: number | null;
  owner_label: string;
}
interface Transition {
  id: string;
  from_state: string;
  to_state: string;
  action_code: string;
  label: string;
  allowed_permission: string | null;
  requires_comment: boolean;
  guard_rules: Record<string, unknown> | null;
}
interface Workflow {
  id: string;
  code: string;
  entity_type: string;
  description: string | null;
  states: State[];
  transitions: Transition[];
}

const GROUPS = ['DRAFT', 'WAITING', 'ACTIVE', 'SUCCESS', 'CLOSED'];
const GROUP_TONE: Record<string, Tone> = { DRAFT: 'neutral', WAITING: 'info', ACTIVE: 'primary', SUCCESS: 'success', CLOSED: 'neutral' };

export default function WorkflowsPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<State | null>(null);
  const flows = useQuery({ queryKey: queryKeys.admin.workflows, queryFn: () => api.get<Workflow[]>('/workflows') });

  if (flows.isLoading) return <PageSkeleton rows={5} />;
  if (flows.isError) return <ErrorState error={flows.error} onRetry={() => void flows.refetch()} />;
  const wf = flows.data?.find((w) => w.id === selected) ?? flows.data?.[0];
  if (!wf) return <EmptyState title={t('admin.workflows.empty')} />;

  const nameOf = (code: string) => wf.states.find((s) => s.code === code)?.name ?? statusLabel(code);
  const guardText = (g: Record<string, unknown> | null) =>
    Object.entries(g ?? {})
      .filter(([, v]) => v)
      .map(([k]) => t(`admin.workflows.guard.${k}`, statusLabel(k)));

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.workflows.title')} subtitle={t('admin.workflows.subtitle')} />
      <Tabs
        ariaLabel={t('admin.workflows.title')}
        value={wf.id}
        onChange={setSelected}
        tabs={(flows.data ?? []).map((w) => ({ value: w.id, label: t(`admin.workflows.name.${w.code}`, statusLabel(w.code)), count: w.states.length }))}
      />
      {wf.description && <p className="reading text-ink-muted">{wf.description}</p>}

      <Card>
        <CardHeader title={t('admin.workflows.diagram')} subtitle={t('admin.workflows.diagramHint')} />
        <div className="overflow-x-auto">
          <div className="flex min-w-max items-stretch gap-2">
            {GROUPS.filter((g) => wf.states.some((s) => s.state_group === g)).map((g, gi, all) => (
              <div key={g} className="flex items-stretch gap-2">
                <section className="w-52 rounded-panel border border-line bg-canvas p-3" aria-label={t(`admin.workflows.group.${g}`, statusLabel(g))}>
                  <h3 className="mb-2 text-sm font-medium text-ink-muted">{t(`admin.workflows.group.${g}`, statusLabel(g))}</h3>
                  <ul className="space-y-2">
                    {wf.states
                      .filter((s) => s.state_group === g)
                      .map((s) => {
                        const next = wf.transitions.filter((x) => x.from_state === s.code);
                        return (
                          <li key={s.id} className="rounded-control border border-line bg-surface p-2">
                            <p className="text-sm font-medium text-ink">{s.name}</p>
                            {s.is_initial && <span className="text-xs text-ink-muted">{t('admin.workflows.start')}</span>}
                            {s.is_terminal && <span className="text-xs text-ink-muted">{t('admin.workflows.end')}</span>}
                            {next.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {next.map((x) => (
                                  <li key={x.id} className="flex items-center gap-1 text-xs text-ink-muted">
                                    <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                                    <span className="sr-only">{t('admin.workflows.goesTo')}</span>
                                    {nameOf(x.to_state)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </section>
                {gi < all.length - 1 && <ArrowRight className="mt-4 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('admin.workflows.states')} subtitle={t('admin.workflows.statesHint')} />
        <DataTable<State>
          rows={wf.states}
          rowKey={(s) => s.id}
          columns={[
            { key: 'name', header: t('admin.workflows.stateName'), render: (s) => <span className="font-medium">{s.name}</span> },
            { key: 'state_group', header: t('admin.workflows.groupCol'), render: (s) => <Badge tone={GROUP_TONE[s.state_group] ?? 'neutral'}>{t(`admin.workflows.group.${s.state_group}`, statusLabel(s.state_group))}</Badge> },
            { key: 'sla_hours', header: t('admin.workflows.sla'), render: (s) => (s.sla_hours ? t('admin.workflows.hours', { count: s.sla_hours }) : t('admin.workflows.noSla')) },
            { key: 'owner_label', header: t('admin.workflows.ownerLabel'), hideOnMobile: true, render: (s) => s.owner_label || '—' },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (s) => (
                <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => setEditing(s)}>
                  {t('common.edit')}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card>
        <CardHeader title={t('admin.workflows.transitions')} subtitle={t('admin.workflows.transitionsHint')} />
        <DataTable<Transition>
          rows={wf.transitions}
          rowKey={(x) => x.id}
          empty={<EmptyState title={t('admin.workflows.noTransitions')} description={t('admin.workflows.noTransitionsHint')} />}
          columns={[
            {
              key: 'from',
              header: t('admin.workflows.fromTo'),
              render: (x) => (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {nameOf(x.from_state)} <ArrowRight className="h-3.5 w-3.5 text-ink-muted" aria-label={t('admin.workflows.goesTo')} /> <span className="font-medium">{nameOf(x.to_state)}</span>
                </span>
              ),
            },
            { key: 'label', header: t('admin.workflows.button'), render: (x) => x.label },
            {
              key: 'allowed_permission',
              header: t('admin.workflows.permission'),
              render: (x) => (x.allowed_permission ? <code className="text-xs">{x.allowed_permission}</code> : <Badge tone="neutral">{t('admin.workflows.ownerAction')}</Badge>),
            },
            { key: 'requires_comment', header: t('admin.workflows.comment'), render: (x) => (x.requires_comment ? <Badge tone="warning">{t('common.required')}</Badge> : '—') },
            {
              key: 'guard_rules',
              header: t('admin.workflows.guards'),
              render: (x) => {
                const g = guardText(x.guard_rules);
                return g.length ? (
                  <ul className="text-sm">
                    {g.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  '—'
                );
              },
            },
          ]}
        />
      </Card>

      {editing && <StateDialog state={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StateDialog({ state, onClose }: { state: State; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(state.name);
  const [sla, setSla] = useState(state.sla_hours == null ? '' : String(state.sla_hours));
  const [tried, setTried] = useState(false);
  const save = useAdminMutation(() => api.patch(`/workflows/states/${state.id}`, { name: name.trim(), sla_hours: sla === '' ? null : Number(sla) }), {
    success: t('admin.workflows.saved'),
    invalidate: [queryKeys.admin.workflows],
    onDone: onClose,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.workflows.editState', { name: state.name })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (name.trim()) save.mutate(undefined);
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('admin.workflows.stateName')} required help={t('admin.workflows.stateNameHelp')} error={tried && !name.trim() ? t('admin.common.nameRequired') : null}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('admin.workflows.slaHours')} help={t('admin.workflows.slaHelp')}>
          <Input type="number" min={0} value={sla} onChange={(e) => setSla(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
