import { Check, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import i18n from '@/i18n';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/dates';
import { statusLabel } from '@/utils/format';
import { tr, type I18nText } from '@/utils/i18n';

export type FieldType =
  | 'TEXT' | 'LONG_TEXT' | 'RICH_TEXT' | 'NUMBER' | 'MONEY' | 'DATE' | 'SELECT' | 'MULTI_SELECT'
  | 'URL' | 'CHECKBOX' | 'DECLARATION' | 'KPI_TABLE' | 'FILE' | (string & {});

export interface FormFieldDef {
  id: string;
  field_key: string;
  label_i18n: I18nText;
  help_i18n?: I18nText;
  placeholder_i18n?: I18nText;
  field_type: FieldType;
  options?: Array<{ value: string; label: string }>;
  is_required?: boolean;
  validation?: { max_len?: number; min_len?: number; min?: number; max?: number } | null;
}

export interface FormSectionDef {
  id: string;
  code: string;
  title_i18n: I18nText;
  help_i18n?: I18nText;
  scored_on?: string[];
  fields: FormFieldDef[];
}

export interface FormDefinition {
  id: string;
  code: string;
  name_i18n: I18nText;
  purpose?: string;
  version?: number;
  sections: FormSectionDef[];
}

export type FormValue = Record<string, unknown>;
export type FormErrors = Record<string, string>;
export interface KpiRow {
  name: string;
  baseline: string;
  target: string;
  unit: string;
}

function isEmpty(v: unknown): boolean {
  if (v == null || v === '' || v === false) return true;
  if (Array.isArray(v)) {
    if (v.length === 0) return true;
    // KPI rows: empty when no row has a name
    if (typeof v[0] === 'object' && v[0] !== null) return !v.some((r) => !!(r as KpiRow).name?.toString().trim());
  }
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

function validateField(f: FormFieldDef, v: unknown): string | null {
  const t = i18n.t.bind(i18n);
  if (f.field_type === 'FILE') return null;
  if (isEmpty(v)) return f.is_required ? t('form.requiredError') : null;
  const val = f.validation ?? {};
  if (typeof v === 'string' && val.max_len && v.length > val.max_len) return t('form.maxLenError', { max: val.max_len });
  if (f.field_type === 'NUMBER' || f.field_type === 'MONEY') {
    const n = Number(v);
    if (Number.isNaN(n)) return t('form.numberError');
    if (val.min != null && n < val.min) return t('form.minError', { min: val.min });
    if (val.max != null && n > val.max) return t('form.maxError', { max: val.max });
  }
  if (f.field_type === 'URL' && typeof v === 'string' && !/^https?:\/\/\S+$/i.test(v.trim())) return t('form.urlError');
  return null;
}

/** All problems in the form: `{ [field_key]: message }`. Empty object = valid. */
export function validateForm(form: FormDefinition, value: FormValue): FormErrors {
  const errors: FormErrors = {};
  for (const s of form.sections) {
    for (const f of s.fields) {
      const e = validateField(f, value?.[f.field_key]);
      if (e) errors[f.field_key] = e;
    }
  }
  return errors;
}

function sectionProgress(section: FormSectionDef, value: FormValue): { done: number; total: number } {
  const req = section.fields.filter((f) => f.is_required && f.field_type !== 'FILE');
  const pool = req.length ? req : section.fields.filter((f) => f.field_type !== 'FILE');
  return { done: pool.filter((f) => !isEmpty(value?.[f.field_key])).length, total: pool.length };
}

/** 0–100: share of required fields answered (all fields if none are required). */
export function completeness(form: FormDefinition, value: FormValue): number {
  let done = 0;
  let total = 0;
  for (const s of form.sections) {
    const p = sectionProgress(s, value);
    done += p.done;
    total += p.total;
  }
  return total ? Math.round((done / total) * 100) : 100;
}

export interface DynamicFormProps {
  form: FormDefinition;
  value: FormValue;
  onChange: (value: FormValue) => void;
  readOnly?: boolean;
  /** Errors to show regardless of touch state (e.g. after pressing Submit, or from the server). */
  errors?: FormErrors;
  /** Extra content on the last step, next to Back (e.g. a Submit button). */
  lastStepAction?: ReactNode;
  /** Content under the fields of every step (e.g. an AttachmentList). */
  children?: ReactNode;
  className?: string;
}

/** Renders any backend form with a section stepper, validation on blur, counters and completion. */
export function DynamicForm({ form, value, onChange, readOnly, errors, lastStepAction, children, className }: DynamicFormProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const sections = form.sections;
  const section = sections[Math.min(active, sections.length - 1)];
  const all = useMemo(() => validateForm(form, value), [form, value]);
  const pctDone = completeness(form, value);

  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const touch = (key: string) => setTouched((s) => (s[key] ? s : { ...s, [key]: true }));
  const errorFor = (key: string) => errors?.[key] ?? (touched[key] ? all[key] : undefined);
  const externalErrors = errors ? Object.keys(errors) : [];

  if (!section) return null;

  return (
    <div className={cn('grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)]', className)}>
      <nav aria-label={t('form.steps')} className="min-w-0 md:sticky md:top-20 md:self-start">
        <p className="mb-2 hidden text-sm font-medium text-ink-muted md:block">{t('form.steps')}</p>
        <ol className="relative flex gap-1 overflow-x-auto md:flex-col">
          {sections.map((s, i) => {
            const p = sectionProgress(s, value);
            const complete = p.total > 0 && p.done === p.total && !s.fields.some((f) => all[f.field_key]);
            const hasErr = s.fields.some((f) => errors?.[f.field_key]);
            const isActive = i === active;
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-current={isActive ? 'step' : undefined}
                  className={cn(
                    'flex min-h-[40px] w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm',
                    isActive ? 'bg-primary-soft font-medium text-primary' : 'text-ink hover:bg-neutral-soft',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                      complete ? 'border-success bg-success text-white' : hasErr ? 'border-danger text-danger' : isActive ? 'border-primary text-primary' : 'border-line text-ink-muted',
                    )}
                  >
                    {complete ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="whitespace-nowrap md:whitespace-normal">{tr(s.title_i18n, s.code)}</span>
                  <span className="sr-only">
                    {complete ? ' (complete)' : hasErr ? ' (has errors)' : ` (${p.done} of ${p.total})`}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <ProgressBar className="mt-4" value={pctDone} label={t('form.complete', { pct: pctDone })} />
      </nav>

      <div className="min-w-0">
        {externalErrors.length > 0 && (
          <div role="alert" className="mb-4 rounded-panel border border-danger bg-danger-soft p-3 text-sm text-danger">
            <p className="font-medium">{t('form.fixErrors', { count: externalErrors.length })}</p>
            <ul className="mt-1 list-disc pl-5">
              {sections.flatMap((s, i) =>
                s.fields
                  .filter((f) => errors?.[f.field_key])
                  .map((f) => (
                    <li key={f.field_key}>
                      <button type="button" className="underline" onClick={() => setActive(i)}>
                        {tr(f.label_i18n, f.field_key)}
                      </button>
                    </li>
                  )),
              )}
            </ul>
          </div>
        )}

        <h2 className="text-xl font-semibold text-ink">
          {active + 1}. {tr(section.title_i18n, section.code)}
        </h2>
        {tr(section.help_i18n) && <p className="reading mt-1 text-sm text-ink-muted">{tr(section.help_i18n)}</p>}

        <div className="mt-4 space-y-5">
          {section.fields.map((f) => (
            <FieldRenderer
              key={f.id}
              field={f}
              value={value?.[f.field_key]}
              onChange={(v) => set(f.field_key, v)}
              onBlur={() => touch(f.field_key)}
              error={errorFor(f.field_key)}
              readOnly={readOnly}
            />
          ))}
        </div>

        {children && <div className="mt-6">{children}</div>}

        {section.scored_on && section.scored_on.length > 0 && (
          <p className="mt-6 rounded-control bg-info-soft px-3 py-2 text-sm text-info">
            {t('form.scoredOn')} <span className="font-medium">{section.scored_on.map((c) => statusLabel(c)).join(', ')}</span>
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <Button variant="secondary" disabled={active === 0} onClick={() => setActive((i) => Math.max(0, i - 1))}>
            {t('common.previous')}
          </Button>
          {active < sections.length - 1 ? (
            <Button
              onClick={() => {
                section.fields.forEach((f) => touch(f.field_key));
                setActive((i) => Math.min(sections.length - 1, i + 1));
              }}
            >
              {t('common.next')}
            </Button>
          ) : (
            lastStepAction
          )}
        </div>
      </div>
    </div>
  );
}

interface FieldRendererProps {
  field: FormFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  error?: string;
  readOnly?: boolean;
}

function FieldRenderer({ field: f, value, onChange, onBlur, error, readOnly }: FieldRendererProps) {
  const { t } = useTranslation();
  const label = tr(f.label_i18n, f.field_key);
  const help = tr(f.help_i18n) || undefined;
  const placeholder = tr(f.placeholder_i18n) || undefined;
  const maxLen = f.validation?.max_len;
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);
  const counter = maxLen ? `${str.length} / ${maxLen}` : undefined;
  const common = { disabled: readOnly, onBlur };

  switch (f.field_type) {
    case 'LONG_TEXT':
    case 'RICH_TEXT':
      return (
        <Field label={label} help={help} error={error} required={f.is_required} hint={counter}>
          <Textarea rows={6} value={str} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
    case 'NUMBER':
    case 'MONEY':
      return (
        <Field label={label} help={help} error={error} required={f.is_required} hint={f.field_type === 'MONEY' ? 'BDT' : undefined}>
          <Input
            type="number"
            inputMode="decimal"
            value={str}
            min={f.validation?.min}
            max={f.validation?.max}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            {...common}
          />
        </Field>
      );
    case 'DATE':
      return (
        <Field label={label} help={help} error={error} required={f.is_required}>
          <Input type="date" value={str} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
    case 'URL':
      return (
        <Field label={label} help={help} error={error} required={f.is_required}>
          <Input type="url" value={str} placeholder={placeholder ?? 'https://'} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
    case 'SELECT':
      return (
        <Field label={label} help={help} error={error} required={f.is_required}>
          <Select value={str} options={f.options ?? []} placeholder={t('form.select')} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
    case 'MULTI_SELECT': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="space-y-1.5" onBlur={onBlur}>
          <legend className="text-sm font-medium text-ink">
            {label}
            {f.is_required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(f.options ?? []).map((o) => (
              <Checkbox
                key={o.value}
                label={o.label}
                checked={selected.includes(o.value)}
                disabled={readOnly}
                onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((x) => x !== o.value))}
              />
            ))}
          </div>
          {help && <p className="text-sm text-ink-muted">{help}</p>}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        </fieldset>
      );
    }
    case 'CHECKBOX':
    case 'DECLARATION':
      return (
        <div className={cn(f.field_type === 'DECLARATION' && 'rounded-panel border border-line bg-canvas p-3')}>
          <Checkbox
            label={
              <>
                {label}
                {f.is_required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
              </>
            }
            description={help}
            checked={!!value}
            disabled={readOnly}
            onBlur={onBlur}
            onChange={(e) => onChange(e.target.checked)}
          />
          {error && <p className="mt-1 text-sm text-danger" role="alert">{error}</p>}
        </div>
      );
    case 'KPI_TABLE':
      return <KpiTableField label={label} help={help} error={error} required={f.is_required} value={value} onChange={onChange} onBlur={onBlur} readOnly={readOnly} />;
    case 'FILE':
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="text-sm text-ink-muted">{help ?? t('form.fileNote')}</p>
        </div>
      );
    case 'TEXT':
    default:
      return (
        <Field label={label} help={help} error={error} required={f.is_required} hint={counter}>
          <Input type="text" value={str} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...common} />
        </Field>
      );
  }
}

function KpiTableField({
  label, help, error, required, value, onChange, onBlur, readOnly,
}: {
  label: string; help?: string; error?: string; required?: boolean; value: unknown;
  onChange: (v: unknown) => void; onBlur: () => void; readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const rows: KpiRow[] = Array.isArray(value) ? (value as KpiRow[]) : [];
  const update = (i: number, patch: Partial<KpiRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cols: Array<{ k: keyof KpiRow; label: string }> = [
    { k: 'name', label: t('form.kpiName') },
    { k: 'baseline', label: t('form.kpiBaseline') },
    { k: 'target', label: t('form.kpiTarget') },
    { k: 'unit', label: t('form.kpiUnit') },
  ];
  return (
    <fieldset className="space-y-2" onBlur={onBlur}>
      <legend className="text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </legend>
      {help && <p className="text-sm text-ink-muted">{help}</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-panel border border-line p-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          {cols.map((c) => (
            <label key={c.k} className={cn('text-xs text-ink-muted', c.k === 'name' && 'col-span-2 md:col-span-1')}>
              {c.label}
              <Input className="mt-1" value={r[c.k] ?? ''} disabled={readOnly} onChange={(e) => update(i, { [c.k]: e.target.value } as Partial<KpiRow>)} />
            </label>
          ))}
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              className="self-end"
              aria-label={`${t('common.remove')} ${r.name || i + 1}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
            />
          )}
        </div>
      ))}
      {!readOnly && (
        <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => onChange([...rows, { name: '', baseline: '', target: '', unit: '' }])}>
          {t('form.addRow')}
        </Button>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </fieldset>
  );
}

export interface DynamicFormViewProps {
  form: FormDefinition;
  value: FormValue;
  /** Hide fields with no answer. */
  hideEmpty?: boolean;
  className?: string;
}

/** Read-only render of the answers — exactly what judges see; also used for Preview. */
export function DynamicFormView({ form, value, hideEmpty, className }: DynamicFormViewProps) {
  const { t } = useTranslation();
  return (
    <div className={cn('space-y-6', className)}>
      {form.sections.map((s, i) => (
        <section key={s.id} id={`section-${s.code}`} aria-labelledby={`h-${s.id}`}>
          <h3 id={`h-${s.id}`} className="text-lg font-semibold text-ink">
            {i + 1}. {tr(s.title_i18n, s.code)}
          </h3>
          <dl className="mt-2 space-y-3">
            {s.fields
              .filter((f) => f.field_type !== 'FILE' && !(hideEmpty && isEmpty(value?.[f.field_key])))
              .map((f) => (
                <div key={f.id}>
                  <dt className="text-sm font-medium text-ink-muted">{tr(f.label_i18n, f.field_key)}</dt>
                  <dd className="reading mt-0.5 whitespace-pre-wrap text-ink">
                    {isEmpty(value?.[f.field_key]) ? (
                      <span className="text-ink-muted">{t('form.notAnswered')}</span>
                    ) : (
                      <AnswerValue field={f} value={value[f.field_key]} />
                    )}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function AnswerValue({ field: f, value }: { field: FormFieldDef; value: unknown }) {
  const { t } = useTranslation();
  const optLabel = (v: string) => f.options?.find((o) => o.value === v)?.label ?? v;
  switch (f.field_type) {
    case 'KPI_TABLE': {
      const rows = (Array.isArray(value) ? value : []) as KpiRow[];
      return (
        <span className="block overflow-x-auto">
          <table className="mt-1 w-full max-w-xl text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="py-1 pr-3 font-medium">{t('form.kpiName')}</th>
                <th className="py-1 pr-3 font-medium">{t('form.kpiBaseline')}</th>
                <th className="py-1 pr-3 font-medium">{t('form.kpiTarget')}</th>
                <th className="py-1 font-medium">{t('form.kpiUnit')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-1 pr-3">{r.name}</td>
                  <td className="py-1 pr-3">{r.baseline}</td>
                  <td className="py-1 pr-3">{r.target}</td>
                  <td className="py-1">{r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </span>
      );
    }
    case 'MULTI_SELECT':
      return <>{(Array.isArray(value) ? (value as string[]) : []).map(optLabel).join(', ')}</>;
    case 'SELECT':
      return <>{optLabel(String(value))}</>;
    case 'CHECKBOX':
    case 'DECLARATION':
      return <>{value ? t('common.yes') : t('common.no')}</>;
    case 'DATE':
      return <>{formatDate(String(value), String(value))}</>;
    case 'URL':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline">
          {String(value)}
        </a>
      );
    default:
      return <>{String(value)}</>;
  }
}
