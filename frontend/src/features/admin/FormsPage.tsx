import { useQuery } from '@tanstack/react-query';
import { Monitor, Pencil, Plus, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
  Textarea,
} from '@/components/ui';
import { Callout, DynamicForm, StatusBadge, type FormDefinition, type FormFieldDef, type FormValue } from '@/components/domain';
import { cn } from '@/utils/cn';
import { statusLabel } from '@/utils/format';
import { tr } from '@/utils/i18n';
import { useAdminMutation } from './shared';

interface FormRow {
  id: string;
  code: string;
  name: string;
  purpose: string;
  version: number;
  status: string;
}

const FIELD_TYPES = ['TEXT', 'LONG_TEXT', 'NUMBER', 'MONEY', 'DATE', 'URL', 'CHECKBOX', 'DECLARATION', 'KPI_TABLE'];

type Editing = { sectionId: string; field: FormFieldDef | null };

/** The builder edits the English text; Bangla stays as it is on the server. */
const en = (v: unknown): string => (typeof v === 'string' ? v : ((v as { en?: string | null } | null | undefined)?.en ?? ''));

export default function FormsPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<FormFieldDef | null>(null);
  const [preview, setPreview] = useState<FormValue>({});
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');

  const forms = useQuery({ queryKey: queryKeys.admin.forms, queryFn: () => api.get<FormRow[]>('/forms') });
  const formId = selected || forms.data?.[0]?.id || '';
  const form = useQuery({
    queryKey: queryKeys.admin.form(formId),
    queryFn: () => api.get<FormDefinition>(`/forms/${formId}`),
    enabled: !!formId,
  });
  useEffect(() => setPreview({}), [formId]);

  const remove = useAdminMutation((id: string) => api.del(`/forms/fields/${id}`), {
    success: t('admin.forms.fieldRemoved'),
    invalidate: [queryKeys.admin.form(formId)],
    onDone: () => setRemoving(null),
  });

  if (forms.isLoading) return <PageSkeleton rows={5} />;
  if (forms.isError) return <ErrorState error={forms.error} onRetry={() => void forms.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.forms.title')} subtitle={t('admin.forms.subtitle')} />
      {!forms.data?.length ? (
        <EmptyState title={t('admin.forms.empty')} />
      ) : (
        <>
          <Card>
            <Field label={t('admin.forms.choose')}>
              <Select
                value={formId}
                onChange={(e) => setSelected(e.target.value)}
                options={forms.data.map((f) => ({ value: f.id, label: `${f.name} — ${statusLabel(f.purpose)} · v${f.version}` }))}
              />
            </Field>
          </Card>

          {form.isLoading ? (
            <PageSkeleton rows={4} />
          ) : form.isError ? (
            <ErrorState error={form.error} onRetry={() => void form.refetch()} />
          ) : form.data ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-ink">{tr(form.data.name_i18n)}</h2>
                  <Badge tone="neutral">{statusLabel(form.data.purpose)}</Badge>
                  <Badge tone="neutral">v{form.data.version}</Badge>
                  <StatusBadge status={(form.data as FormDefinition & { status?: string }).status ?? 'PUBLISHED'} />
                </div>
                <Callout tone="info">{t('admin.forms.liveNote')}</Callout>
                {form.data.sections.map((s, i) => (
                  <Card key={s.id}>
                    <CardHeader
                      title={`${i + 1}. ${tr(s.title_i18n)}`}
                      subtitle={s.scored_on?.length ? t('admin.forms.scoredOn', { criteria: s.scored_on.join(', ') }) : tr(s.help_i18n) || undefined}
                      actions={
                        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing({ sectionId: s.id, field: null })}>
                          {t('admin.forms.addField')}
                        </Button>
                      }
                    />
                    {s.fields.length === 0 ? (
                      <p className="text-sm text-ink-muted">{t('admin.forms.noFields')}</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {s.fields.map((f) => (
                          <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-ink">{tr(f.label_i18n)}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Badge tone="neutral">{t(`admin.forms.type.${f.field_type}`, statusLabel(f.field_type))}</Badge>
                                {f.is_required && <Badge tone="warning">{t('common.required')}</Badge>}
                                {f.validation?.max_len ? <Badge tone="neutral">{t('admin.forms.maxChars', { count: f.validation.max_len })}</Badge> : null}
                              </div>
                              {tr(f.help_i18n) && <p className="mt-1 text-sm text-ink-muted">{tr(f.help_i18n)}</p>}
                            </div>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => setEditing({ sectionId: s.id, field: f })}>
                                {t('common.edit')}
                              </Button>
                              <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => setRemoving(f)}>
                                {t('common.remove')}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ))}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-ink">{t('admin.forms.preview')}</h2>
                  <div className="flex gap-1" role="group" aria-label={t('admin.forms.previewWidth')}>
                    <Button size="sm" variant={device === 'desktop' ? 'primary' : 'secondary'} aria-pressed={device === 'desktop'} icon={<Monitor className="h-4 w-4" aria-hidden />} onClick={() => setDevice('desktop')}>
                      {t('admin.forms.desktop')}
                    </Button>
                    <Button size="sm" variant={device === 'phone' ? 'primary' : 'secondary'} aria-pressed={device === 'phone'} icon={<Smartphone className="h-4 w-4" aria-hidden />} onClick={() => setDevice('phone')}>
                      {t('admin.forms.phone')}
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-ink-muted">{t('admin.forms.previewHint')}</p>
                <div className={cn('rounded-panel border border-line bg-canvas p-3', device === 'phone' && 'mx-auto max-w-[390px]')}>
                  {/* The form lays out by viewport width, so the phone view forces its one-column layout. */}
                  <DynamicForm
                    form={form.data}
                    value={preview}
                    onChange={setPreview}
                    className={cn(device === 'phone' && '!grid-cols-1 [&_nav]:!static [&_ol]:!flex-row [&_.grid]:!grid-cols-2')}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {editing && <FieldDialog formId={formId} editing={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('admin.forms.removeTitle')}
        description={removing ? t('admin.forms.removeBody', { label: tr(removing.label_i18n) }) : ''}
        confirmLabel={t('admin.forms.removeField')}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

function FieldDialog({ formId, editing, onClose }: { formId: string; editing: Editing; onClose: () => void }) {
  const { t } = useTranslation();
  const f = editing.field;
  const [label, setLabel] = useState(en(f?.label_i18n));
  const [help, setHelp] = useState(en(f?.help_i18n));
  const [type, setType] = useState<string>(f?.field_type ?? 'LONG_TEXT');
  const [required, setRequired] = useState(f?.is_required ?? false);
  const [maxLen, setMaxLen] = useState(f?.validation?.max_len ? String(f.validation.max_len) : '');
  const [tried, setTried] = useState(false);
  const types = FIELD_TYPES.includes(type) ? FIELD_TYPES : [...FIELD_TYPES, type];
  const hasLength = type === 'TEXT' || type === 'LONG_TEXT';

  const save = useAdminMutation(
    () => {
      const body = { label: label.trim(), help: help.trim() || null, field_type: type, is_required: required, max_len: hasLength && maxLen ? Number(maxLen) : null };
      return f ? api.patch(`/forms/fields/${f.id}`, body) : api.post(`/forms/sections/${editing.sectionId}/fields`, body);
    },
    { success: f ? t('admin.forms.fieldSaved') : t('admin.forms.fieldAdded'), invalidate: [queryKeys.admin.form(formId)], onDone: onClose },
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={f ? t('admin.forms.editField') : t('admin.forms.addField')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (label.trim()) save.mutate(undefined);
            }}
          >
            {f ? t('common.save') : t('admin.forms.addField')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('admin.forms.label')} required help={t('admin.forms.labelHelp')} error={tried && !label.trim() ? t('admin.forms.labelRequired') : null}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t('admin.forms.help')} help={t('admin.forms.helpHelp')}>
          <Textarea rows={2} value={help} onChange={(e) => setHelp(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.forms.fieldType')}>
            <Select value={type} onChange={(e) => setType(e.target.value)} options={types.map((x) => ({ value: x, label: t(`admin.forms.type.${x}`, statusLabel(x)) }))} />
          </Field>
          {hasLength && (
            <Field label={t('admin.forms.maxLength')} help={t('admin.forms.maxLengthHelp')}>
              <Input type="number" min={1} value={maxLen} onChange={(e) => setMaxLen(e.target.value)} />
            </Field>
          )}
        </div>
        <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} label={t('admin.forms.requiredField')} description={t('admin.forms.requiredHelp')} />
      </div>
    </Dialog>
  );
}
