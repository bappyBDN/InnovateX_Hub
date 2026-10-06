import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Eye, Plus, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useMe } from '@/auth';
import { AttachmentList, Callout, JourneyRail, SaveIndicator } from '@/components/domain';
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Dialog,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  Select,
  Switch,
  Textarea,
  isNotFound,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { useOnline, useUnsavedChangesGuard, type AutosaveStatus } from '@/hooks';
import { cn } from '@/utils/cn';
import { tr } from '@/utils/i18n';
import {
  PickedUser,
  UserPicker,
  useCategories,
  useLookups,
  useOrgUnits,
  type IdeaDetail,
  type IdeaFields,
  type IdeaLink,
  type UserBrief,
} from './shared';

interface Contributor {
  user: UserBrief;
  share: string;
}

interface FormState extends IdeaFields {
  links: IdeaLink[];
  contributors: Contributor[];
}

const EMPTY: FormState = {
  title: '',
  summary: '',
  problem_statement: '',
  affected_users: '',
  current_process: '',
  proposed_solution: '',
  technology_used: '',
  differentiator: '',
  category_id: null,
  innovation_type_code: null,
  org_unit_id: null,
  sponsor_user_id: null,
  data_classification_code: 'INTERNAL',
  scalability_level_code: null,
  risk_flags: [],
  benefit_types: [],
  primary_kpi: '',
  baseline_value: '',
  target_value: '',
  expected_benefit: '',
  expected_timeline: '',
  estimated_cost: null,
  dependencies: '',
  declaration_accepted: false,
  on_behalf_of_user_id: null,
  links: [],
  contributors: [],
};

const STEP_KEYS = ['about', 'problem', 'solution', 'value', 'team', 'submit'] as const;
/** Which step holds each field, so server errors can link to the right place. */
const FIELD_STEP: Record<string, number> = {
  title: 0,
  org_unit_id: 0,
  category_id: 0,
  innovation_type_code: 0,
  problem_statement: 1,
  current_process: 1,
  proposed_solution: 2,
  expected_benefit: 3,
  primary_kpi: 3,
  scalability_level_code: 3,
  data_classification_code: 4,
  expected_timeline: 4,
  declaration_accepted: 5,
};
const REQUIRED: (keyof IdeaFields)[] = [
  'title',
  'org_unit_id',
  'category_id',
  'innovation_type_code',
  'problem_statement',
  'current_process',
  'proposed_solution',
  'expected_benefit',
  'primary_kpi',
  'scalability_level_code',
  'data_classification_code',
  'expected_timeline',
];

const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function toPayload(f: FormState) {
  const { links, contributors, ...fields } = f;
  const text = (v: string | null) => (v && v.trim() ? v : null);
  return {
    ...fields,
    title: f.title.trim() || 'Untitled idea',
    summary: text(f.summary),
    content: { links: links.filter((l) => l.url.trim()) },
    members: contributors.map((c) => ({
      user_id: c.user.id,
      credit_share_pct: c.share.trim() && !Number.isNaN(Number(c.share)) ? Number(c.share) : null,
    })),
  };
}

function fromDetail(d: IdeaDetail): FormState {
  const s = (v: string | null | undefined) => v ?? '';
  return {
    title: d.title === 'Untitled idea' ? '' : d.title,
    summary: s(d.summary),
    problem_statement: s(d.problem_statement),
    affected_users: s(d.affected_users),
    current_process: s(d.current_process),
    proposed_solution: s(d.proposed_solution),
    technology_used: s(d.technology_used),
    differentiator: s(d.differentiator),
    category_id: d.category_id,
    innovation_type_code: d.innovation_type_code,
    org_unit_id: d.org_unit_id,
    sponsor_user_id: d.sponsor_user_id,
    data_classification_code: d.data_classification_code ?? 'INTERNAL',
    scalability_level_code: d.scalability_level_code,
    risk_flags: d.risk_flags ?? [],
    benefit_types: d.benefit_types ?? [],
    primary_kpi: s(d.primary_kpi),
    baseline_value: s(d.baseline_value),
    target_value: s(d.target_value),
    expected_benefit: s(d.expected_benefit),
    expected_timeline: s(d.expected_timeline),
    estimated_cost: d.estimated_cost,
    dependencies: s(d.dependencies),
    declaration_accepted: !!d.declaration_accepted,
    on_behalf_of_user_id: d.on_behalf_of_user_id,
    links: d.content?.links ?? [],
    contributors: d.members
      .filter((m) => m.member_role !== 'OWNER')
      .map((m) => ({ user: m, share: m.credit_share_pct != null ? String(m.credit_share_pct) : '' })),
  };
}

export default function IdeaFormPage() {
  const { t } = useTranslation();
  const { code: routeKey } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const online = useOnline();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [ideaId, setIdeaId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!routeKey);
  const [state, setState] = useState('DRAFT');
  const [colleague, setColleague] = useState<UserBrief | null>(null);
  const [forColleague, setForColleague] = useState(false);
  const [sponsor, setSponsor] = useState<UserBrief | null>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [preview, setPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ code: string } | null>(null);

  const lookups = useLookups();
  const categories = useCategories();
  const orgUnits = useOrgUnits();

  const existing = useQuery({
    queryKey: queryKeys.ideas.detail(routeKey ?? ''),
    queryFn: () => api.get<IdeaDetail>(`/initiatives/${routeKey}`),
    enabled: !!routeKey,
  });

  // ---- load an existing draft once -------------------------------------------------------
  const lastSaved = useRef<string>(JSON.stringify(toPayload(EMPTY)));
  useEffect(() => {
    if (!existing.data || loaded) return;
    const f = fromDetail(existing.data);
    setForm(f);
    setIdeaId(existing.data.id);
    setState(existing.data.current_state_code);
    setSponsor(existing.data.sponsor);
    setColleague(existing.data.on_behalf_of);
    setForColleague(!!existing.data.on_behalf_of_user_id);
    lastSaved.current = JSON.stringify(toPayload(f));
    setLoaded(true);
  }, [existing.data, loaded]);

  // Default the organization unit to the user's own unit on a new idea.
  useEffect(() => {
    if (!routeKey && me?.org_unit?.id) setForm((f) => (f.org_unit_id ? f : { ...f, org_unit_id: me.org_unit!.id }));
  }, [me, routeKey]);

  // ---- autosave: create the draft on first meaningful input, then PATCH ----------------------
  const formRef = useRef(form);
  formRef.current = form;
  const idRef = useRef(ideaId);
  idRef.current = ideaId;
  const busy = useRef<Promise<void> | null>(null);

  const saveNow = useCallback(async (): Promise<void> => {
    if (busy.current) await busy.current;
    const payload = toPayload(formRef.current);
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastSaved.current && idRef.current) return;
    if (!idRef.current && formRef.current.title.trim().length < 3) return;
    const run = (async () => {
      setStatus('saving');
      try {
        if (!idRef.current) {
          const res = await api.post<{ id: string }>('/initiatives', payload);
          idRef.current = res.id;
          setIdeaId(res.id);
          // Keep the address in step without remounting the form.
          window.history.replaceState(window.history.state, '', `/ideas/${res.id}/edit`);
        } else {
          await api.patch(`/initiatives/${idRef.current}`, payload);
        }
        lastSaved.current = snapshot;
        setStatus('saved');
      } catch (e) {
        setStatus('error');
        throw e;
      }
    })();
    busy.current = run.finally(() => {
      busy.current = null;
    });
    await run;
  }, []);

  const snapshot = useMemo(() => JSON.stringify(toPayload(form)), [form]);
  const dirty = loaded && snapshot !== lastSaved.current && form.title.trim().length >= 3;
  useEffect(() => {
    if (!loaded || done || !online) return;
    if (snapshot === lastSaved.current) return;
    const id = setTimeout(() => {
      saveNow().catch(() => undefined);
    }, 3000);
    return () => clearTimeout(id);
  }, [snapshot, loaded, done, online, saveNow]);
  useUnsavedChangesGuard(dirty && !done);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key as string]) setErrors(({ [key as string]: _drop, ...rest }) => rest);
  };
  const toggle = (key: 'risk_flags' | 'benefit_types', code: string) => {
    const cur = form[key] ?? [];
    set(key, cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]);
  };
  /** Validate one field when the user leaves it (never while typing). */
  const check = (key: keyof IdeaFields) => {
    if (REQUIRED.includes(key) && blank(form[key])) setErrors((e) => ({ ...e, [key]: t('ideas.form.requiredField') }));
  };

  const goTo = async (next: number) => {
    setStep(Math.max(0, Math.min(STEP_KEYS.length - 1, next)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    saveNow().catch(() => undefined);
  };

  const submit = async () => {
    const local: Record<string, string> = {};
    REQUIRED.forEach((k) => {
      if (blank(form[k])) local[k] = t('ideas.form.requiredField');
    });
    if (!form.declaration_accepted) local.declaration_accepted = t('ideas.form.declarationRequired');
    if (Object.keys(local).length) {
      setErrors(local);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    try {
      await saveNow();
      const res = await api.post<{ code: string }>(`/initiatives/${idRef.current}/actions/submit`);
      void qc.invalidateQueries({ queryKey: queryKeys.ideas.all });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
      toast.success(t('ideas.form.submitted'));
      window.history.replaceState(window.history.state, '', `/ideas/${res.code}`);
      setDone({ code: res.code });
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof ApiError && e.details?.fields) {
        setErrors(e.details.fields as Record<string, string>);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else toast.error(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const saveAndReturn = async () => {
    try {
      await saveNow();
      void qc.invalidateQueries({ queryKey: queryKeys.ideas.all });
      toast.success(t('ideas.form.changesSaved'));
      navigate(`/ideas/${existing.data?.key ?? idRef.current}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  // ---- derived -------------------------------------------------------------------------------
  const stepDone = (i: number) => {
    const keys = Object.entries(FIELD_STEP).filter(([, s]) => s === i).map(([k]) => k as keyof IdeaFields);
    return keys.every((k) => (k === 'declaration_accepted' ? !!form.declaration_accepted : !blank(form[k])));
  };
  const filled = REQUIRED.filter((k) => !blank(form[k])).length + (form.declaration_accepted ? 1 : 0);
  const percent = Math.round((filled * 100) / (REQUIRED.length + 1));
  const lookup = (type: string) =>
    (lookups.data?.[type] ?? []).filter((v) => v.is_active).map((v) => ({ value: v.code, label: tr(v.label_i18n, v.label) }));
  const unitOptions = (orgUnits.data ?? [])
    .filter((u) => u.is_active)
    .map((u) => ({ value: u.id, label: `${'— '.repeat(Math.max(0, u.path.split('.').length - 1))}${tr(u.name_i18n, u.name)}` }));
  const categoryOptions = (categories.data ?? []).map((c) => ({ value: c.id, label: tr(c.name_i18n, c.name) }));
  const sharesGiven = form.contributors.reduce((sum, c) => sum + (Number(c.share) || 0), 0);
  const allShares = form.contributors.length > 0 && form.contributors.every((c) => c.share.trim() !== '');
  const sharesInvalid = allShares && (sharesGiven <= 0 || sharesGiven >= 100);
  const ownerShare = allShares && !sharesInvalid ? 100 - sharesGiven : Math.round((100 / (form.contributors.length + 1)) * 100) / 100;
  const ownerName = forColleague && colleague ? colleague.full_name : me?.full_name ?? '';
  const errorList = Object.entries(errors);
  const isDraft = state === 'DRAFT';

  // ---- states --------------------------------------------------------------------------------
  if (done) return <Submitted code={done.code} />;
  if (routeKey && existing.isLoading) return <PageSkeleton rows={6} />;
  if (routeKey && existing.error) {
    if (isNotFound(existing.error)) return <NotFoundPage />;
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }
  if (existing.data && !existing.data.can_edit && !existing.data.can_manage) {
    return (
      <>
        <PageHeader title={existing.data.title} breadcrumbs={[{ label: t('ideas.myIdeas'), to: '/ideas' }, { label: existing.data.code ?? t('ideas.draft') }]} />
        <Callout tone="info" title={t('ideas.form.lockedTitle')} action={<ButtonLink to={`/ideas/${existing.data.key}`}>{t('ideas.openIdea')}</ButtonLink>}>
          {t('ideas.form.lockedBody')}
        </Callout>
      </>
    );
  }
  if (!loaded) return <PageSkeleton rows={6} />;

  const err = (k: string) => errors[k] ?? null;
  const counter = (v: string | null, max: number) => `${(v ?? '').length} / ${max}`;

  const steps: ReactNode[] = [
    // 1 — About the idea
    <div className="space-y-5" key="about">
      <Field label={t('ideas.fields.title')} required error={err('title')} help={t('ideas.fields.titleHelp')} hint={counter(form.title, 250)}>
        <Input value={form.title} maxLength={250} onChange={(e) => set('title', e.target.value)} onBlur={() => check('title')} />
      </Field>
      <div className="rounded-panel border border-line p-4">
        <Switch
          checked={forColleague}
          onChange={(on) => {
            setForColleague(on);
            if (!on) {
              setColleague(null);
              set('on_behalf_of_user_id', null);
            }
          }}
          label={t('ideas.fields.forColleague')}
          description={t('ideas.fields.forColleagueHelp')}
        />
        {forColleague && (
          <div className="mt-4">
            <Field label={t('ideas.fields.colleague')} help={t('ideas.fields.colleagueHelp')}>
              {colleague ? (
                <div>
                  <PickedUser
                    user={colleague}
                    removeLabel={t('common.remove')}
                    onRemove={() => {
                      setColleague(null);
                      set('on_behalf_of_user_id', null);
                    }}
                  />
                </div>
              ) : (
                <UserPicker
                  excludeIds={me ? [me.id] : []}
                  onSelect={(u) => {
                    setColleague(u);
                    set('on_behalf_of_user_id', u.id);
                  }}
                />
              )}
            </Field>
          </div>
        )}
      </div>
      <Field label={t('ideas.fields.orgUnit')} required error={err('org_unit_id')} help={t('ideas.fields.orgUnitHelp')}>
        <Select value={form.org_unit_id ?? ''} options={unitOptions} placeholder={t('ideas.form.choose')} onChange={(e) => set('org_unit_id', e.target.value || null)} onBlur={() => check('org_unit_id')} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('ideas.fields.category')} required error={err('category_id')}>
          <Select value={form.category_id ?? ''} options={categoryOptions} placeholder={t('ideas.form.choose')} onChange={(e) => set('category_id', e.target.value || null)} onBlur={() => check('category_id')} />
        </Field>
        <Field label={t('ideas.fields.type')} required error={err('innovation_type_code')} help={t('ideas.fields.typeHelp')}>
          <Select value={form.innovation_type_code ?? ''} options={lookup('INNOVATION_TYPE')} placeholder={t('ideas.form.choose')} onChange={(e) => set('innovation_type_code', e.target.value || null)} onBlur={() => check('innovation_type_code')} />
        </Field>
      </div>
    </div>,

    // 2 — Problem
    <div className="space-y-5" key="problem">
      <Field label={t('ideas.fields.problem')} required error={err('problem_statement')} help={t('ideas.fields.problemHelp')} hint={counter(form.problem_statement, 3000)}>
        <Textarea rows={5} maxLength={3000} value={form.problem_statement ?? ''} onChange={(e) => set('problem_statement', e.target.value)} onBlur={() => check('problem_statement')} />
      </Field>
      <Field label={t('ideas.fields.affected')} help={t('ideas.fields.affectedHelp')}>
        <Textarea rows={2} value={form.affected_users ?? ''} onChange={(e) => set('affected_users', e.target.value)} />
      </Field>
      <Field label={t('ideas.fields.currentProcess')} required error={err('current_process')} help={t('ideas.fields.currentProcessHelp')} hint={counter(form.current_process, 3000)}>
        <Textarea rows={4} maxLength={3000} value={form.current_process ?? ''} onChange={(e) => set('current_process', e.target.value)} onBlur={() => check('current_process')} />
      </Field>
    </div>,

    // 3 — Proposed innovation
    <div className="space-y-5" key="solution">
      <Field label={t('ideas.fields.solution')} required error={err('proposed_solution')} help={t('ideas.fields.solutionHelp')} hint={counter(form.proposed_solution, 3000)}>
        <Textarea rows={5} maxLength={3000} value={form.proposed_solution ?? ''} onChange={(e) => set('proposed_solution', e.target.value)} onBlur={() => check('proposed_solution')} />
      </Field>
      <Field label={t('ideas.fields.summary')} help={t('ideas.fields.summaryHelp')} hint={counter(form.summary, 280)}>
        <Textarea rows={2} maxLength={280} value={form.summary ?? ''} onChange={(e) => set('summary', e.target.value)} />
      </Field>
      <Field label={t('ideas.fields.technology')} help={t('ideas.fields.technologyHelp')}>
        <Textarea rows={2} value={form.technology_used ?? ''} onChange={(e) => set('technology_used', e.target.value)} />
      </Field>
      <Field label={t('ideas.fields.differentiator')} help={t('ideas.fields.differentiatorHelp')}>
        <Textarea rows={3} value={form.differentiator ?? ''} onChange={(e) => set('differentiator', e.target.value)} />
      </Field>
    </div>,

    // 4 — Value and impact
    <div className="space-y-5" key="value">
      <Field label={t('ideas.fields.kpi')} required error={err('primary_kpi')} help={t('ideas.fields.kpiHelp')}>
        <Input value={form.primary_kpi ?? ''} maxLength={200} onChange={(e) => set('primary_kpi', e.target.value)} onBlur={() => check('primary_kpi')} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('ideas.fields.baseline')} help={t('ideas.fields.baselineHelp')}>
          <Input value={form.baseline_value ?? ''} maxLength={200} onChange={(e) => set('baseline_value', e.target.value)} />
        </Field>
        <Field label={t('ideas.fields.target')} help={t('ideas.fields.targetHelp')}>
          <Input value={form.target_value ?? ''} maxLength={200} onChange={(e) => set('target_value', e.target.value)} />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-ink">{t('ideas.fields.benefitTypes')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {lookup('BENEFIT_TYPE').map((o) => (
            <Checkbox key={o.value} label={o.label} checked={(form.benefit_types ?? []).includes(o.value)} onChange={() => toggle('benefit_types', o.value)} />
          ))}
        </div>
      </fieldset>
      <Field label={t('ideas.fields.benefit')} required error={err('expected_benefit')} help={t('ideas.fields.benefitHelp')} hint={counter(form.expected_benefit, 2000)}>
        <Textarea rows={4} maxLength={2000} value={form.expected_benefit ?? ''} onChange={(e) => set('expected_benefit', e.target.value)} onBlur={() => check('expected_benefit')} />
      </Field>
      <Field label={t('ideas.fields.scalability')} required error={err('scalability_level_code')} help={t('ideas.fields.scalabilityHelp')}>
        <Select value={form.scalability_level_code ?? ''} options={lookup('SCALABILITY_LEVEL')} placeholder={t('ideas.form.choose')} onChange={(e) => set('scalability_level_code', e.target.value || null)} onBlur={() => check('scalability_level_code')} />
      </Field>
    </div>,

    // 5 — Team and governance
    <div className="space-y-5" key="team">
      <div>
        <p className="text-sm font-medium text-ink">{t('ideas.fields.owner')}</p>
        <p className="mt-1 text-sm text-ink-muted">{t('ideas.fields.ownerHelp')}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-control border border-line px-3 py-2">
          <span className="font-medium text-ink">{ownerName}</span>
          <span className="tabular text-sm text-ink-muted">{t('ideas.fields.credit', { pct: ownerShare })}</span>
        </div>
      </div>
      <div>
        <Field label={t('ideas.fields.contributors')} help={t('ideas.fields.contributorsHelp')}>
          <UserPicker
            excludeIds={[...(me ? [me.id] : []), ...(colleague ? [colleague.id] : []), ...form.contributors.map((c) => c.user.id)]}
            onSelect={(u) => set('contributors', [...form.contributors, { user: u, share: '' }])}
          />
        </Field>
        {form.contributors.length > 0 && (
          <ul className="mt-3 space-y-2">
            {form.contributors.map((c, i) => (
              <li key={c.user.id} className="flex flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{c.user.full_name}</p>
                  <p className="truncate text-xs text-ink-muted">{c.user.org_unit}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <span className="sr-only">{t('ideas.fields.shareFor', { name: c.user.full_name })}</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={99}
                    className="w-20"
                    placeholder={String(ownerShare)}
                    value={c.share}
                    onChange={(e) => set('contributors', form.contributors.map((x, j) => (j === i ? { ...x, share: e.target.value } : x)))}
                  />
                  %
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('ideas.fields.removePerson', { name: c.user.full_name })}
                  icon={<Trash2 className="h-4 w-4" aria-hidden />}
                  onClick={() => set('contributors', form.contributors.filter((_, j) => j !== i))}
                />
              </li>
            ))}
          </ul>
        )}
        {form.contributors.length > 0 && (
          <p className={cn('mt-2 text-sm', sharesInvalid ? 'text-danger' : 'text-ink-muted')} role={sharesInvalid ? 'alert' : undefined}>
            {sharesInvalid ? t('ideas.fields.sharesInvalid') : allShares ? t('ideas.fields.sharesOk', { pct: ownerShare }) : t('ideas.fields.sharesEqual')}
          </p>
        )}
      </div>
      <Field label={t('ideas.fields.sponsor')} help={t('ideas.fields.sponsorHelp')}>
        {sponsor ? (
          <div>
            <PickedUser
              user={sponsor}
              removeLabel={t('common.remove')}
              onRemove={() => {
                setSponsor(null);
                set('sponsor_user_id', null);
              }}
            />
          </div>
        ) : (
          <UserPicker
            onSelect={(u) => {
              setSponsor(u);
              set('sponsor_user_id', u.id);
            }}
          />
        )}
      </Field>
      <fieldset>
        <legend className="text-sm font-medium text-ink">{t('ideas.fields.risks')}</legend>
        <p className="text-sm text-ink-muted">{t('ideas.fields.risksHelp')}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {lookup('RISK_TYPE').map((o) => (
            <Checkbox key={o.value} label={o.label} checked={(form.risk_flags ?? []).includes(o.value)} onChange={() => toggle('risk_flags', o.value)} />
          ))}
        </div>
      </fieldset>
      <Field label={t('ideas.fields.classification')} required error={err('data_classification_code')} help={t('ideas.fields.classificationHelp')}>
        <Select value={form.data_classification_code ?? ''} options={lookup('DATA_CLASSIFICATION')} placeholder={t('ideas.form.choose')} onChange={(e) => set('data_classification_code', e.target.value || null)} onBlur={() => check('data_classification_code')} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('ideas.fields.timeline')} required error={err('expected_timeline')} help={t('ideas.fields.timelineHelp')}>
          <Input value={form.expected_timeline ?? ''} maxLength={200} onChange={(e) => set('expected_timeline', e.target.value)} onBlur={() => check('expected_timeline')} />
        </Field>
        <Field label={t('ideas.fields.cost')} help={t('ideas.fields.costHelp')}>
          <Input type="number" inputMode="decimal" min={0} value={form.estimated_cost ?? ''} onChange={(e) => set('estimated_cost', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
      </div>
      <Field label={t('ideas.fields.dependencies')} help={t('ideas.fields.dependenciesHelp')}>
        <Textarea rows={2} value={form.dependencies ?? ''} onChange={(e) => set('dependencies', e.target.value)} />
      </Field>
    </div>,

    // 6 — Evidence and submit
    <div className="space-y-6" key="submit">
      <div>
        <h3 className="text-sm font-medium text-ink">{t('ideas.fields.files')}</h3>
        <p className="mb-2 text-sm text-ink-muted">{t('ideas.fields.filesHelp')}</p>
        {ideaId ? (
          <AttachmentList entityType="initiative" entityId={ideaId} canEdit />
        ) : (
          <p className="rounded-control border border-dashed border-line p-4 text-sm text-ink-muted">{t('ideas.fields.filesNeedTitle')}</p>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium text-ink">{t('ideas.fields.links')}</h3>
        <p className="mb-2 text-sm text-ink-muted">{t('ideas.fields.linksHelp')}</p>
        <ul className="space-y-2">
          {form.links.map((l, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <Input aria-label={t('ideas.fields.linkTitle')} placeholder={t('ideas.fields.linkTitle')} value={l.title ?? ''} onChange={(e) => set('links', form.links.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <Input aria-label={t('ideas.fields.linkUrl')} type="url" placeholder="https://" value={l.url} onChange={(e) => set('links', form.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" aria-label={t('ideas.fields.removeLink')} icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => set('links', form.links.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="sm" className="mt-2" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => set('links', [...form.links, { url: '', title: '' }])}>
          {t('ideas.fields.addLink')}
        </Button>
      </div>
      {isDraft && (
        <div className={cn('rounded-panel border p-4', err('declaration_accepted') ? 'border-danger' : 'border-line')}>
          <Checkbox
            label={t('ideas.fields.declaration')}
            description={t('ideas.fields.declarationHelp')}
            checked={!!form.declaration_accepted}
            onChange={(e) => set('declaration_accepted', e.target.checked)}
          />
          {err('declaration_accepted') && (
            <p className="mt-2 text-sm text-danger" role="alert">
              {err('declaration_accepted')}
            </p>
          )}
        </div>
      )}
    </div>,
  ];

  return (
    <>
      <PageHeader
        title={isDraft ? t('ideas.form.pageTitle') : t('ideas.form.editTitle')}
        subtitle={t('ideas.form.pageSubtitle')}
        breadcrumbs={[{ label: t('ideas.myIdeas'), to: '/ideas' }, { label: form.title || t('ideas.form.newIdea') }]}
        actions={
          <>
            <SaveIndicator status={status} />
            <Button variant="secondary" icon={<Eye className="h-4 w-4" aria-hidden />} onClick={() => setPreview(true)}>
              {t('ideas.form.preview')}
            </Button>
          </>
        }
      />
      {!online && <Callout tone="warning" className="mb-4">{t('ideas.form.offline')}</Callout>}
      {errorList.length > 0 && (
        <Callout tone="danger" title={t('ideas.form.errorSummary', { count: errorList.length })} className="mb-4">
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {errorList.map(([field, message]) => (
              <li key={field}>
                <button type="button" className="text-left underline" onClick={() => void goTo(FIELD_STEP[field] ?? 0)}>
                  {message} — {t(`ideas.steps.${STEP_KEYS[FIELD_STEP[field] ?? 0]}`)}
                </button>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label={t('ideas.form.steps')} className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <ol className="relative flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            {STEP_KEYS.map((k, i) => {
              const hasError = errorList.some(([f]) => (FIELD_STEP[f] ?? 0) === i);
              const complete = stepDone(i) && i !== step;
              return (
                <li key={k} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => void goTo(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm',
                      i === step ? 'bg-primary-soft font-medium text-primary' : 'text-ink hover:bg-neutral-soft',
                    )}
                  >
                    <span
                      className={cn(
                        'tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                        hasError ? 'border-danger text-danger' : complete ? 'border-success bg-success text-white' : i === step ? 'border-primary text-primary' : 'border-line text-ink-muted',
                      )}
                    >
                      {complete && !hasError ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                    </span>
                    <span className="whitespace-nowrap lg:whitespace-normal">{t(`ideas.steps.${k}`)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <ProgressBar value={percent} label={t('ideas.form.complete', { pct: percent })} showValue className="mt-3 hidden lg:block" />
        </nav>

        <Card>
          <h2 className="mb-1 text-xl font-semibold text-ink">
            {step + 1}. {t(`ideas.steps.${STEP_KEYS[step]}`)}
          </h2>
          <p className="mb-5 text-sm text-ink-muted">{t(`ideas.stepHelp.${STEP_KEYS[step]}`)}</p>
          {steps[step]}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => void goTo(step - 1)} disabled={step === 0}>
              {t('common.back')}
            </Button>
            {step < STEP_KEYS.length - 1 ? (
              <Button onClick={() => void goTo(step + 1)}>{t('ideas.form.nextStep')}</Button>
            ) : isDraft ? (
              <Button loading={submitting} icon={<Send className="h-4 w-4" aria-hidden />} onClick={() => void submit()} disabled={sharesInvalid} disabledReason={sharesInvalid ? t('ideas.fields.sharesInvalid') : undefined}>
                {t('ideas.form.submit')}
              </Button>
            ) : (
              <Button onClick={() => void saveAndReturn()}>{t('ideas.form.saveAndReturn')}</Button>
            )}
          </div>
        </Card>
      </div>

      <Dialog open={preview} onOpenChange={setPreview} title={t('ideas.form.previewTitle')} description={t('ideas.form.previewHelp')} size="lg" footer={<Button onClick={() => setPreview(false)}>{t('common.close')}</Button>}>
        <dl className="space-y-4">
          {(
            [
              ['title', form.title],
              ['category', categoryOptions.find((c) => c.value === form.category_id)?.label],
              ['type', lookup('INNOVATION_TYPE').find((o) => o.value === form.innovation_type_code)?.label],
              ['owner', ownerName],
              ['problem', form.problem_statement],
              ['affected', form.affected_users],
              ['currentProcess', form.current_process],
              ['solution', form.proposed_solution],
              ['technology', form.technology_used],
              ['differentiator', form.differentiator],
              ['kpi', form.primary_kpi],
              ['baseline', form.baseline_value],
              ['target', form.target_value],
              ['benefit', form.expected_benefit],
              ['scalability', lookup('SCALABILITY_LEVEL').find((o) => o.value === form.scalability_level_code)?.label],
              ['classification', lookup('DATA_CLASSIFICATION').find((o) => o.value === form.data_classification_code)?.label],
              ['timeline', form.expected_timeline],
              ['dependencies', form.dependencies],
            ] as [string, string | null | undefined][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm font-medium text-ink-muted">{t(`ideas.fields.${k}`)}</dt>
              <dd className="reading whitespace-pre-wrap text-ink">{v && v.trim() ? v : <span className="text-ink-muted">{t('ideas.form.notFilled')}</span>}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </>
  );
}

/** Confirmation page after a successful submit: Innovation ID, tracking link and the journey rail. */
function Submitted({ code }: { code: string }) {
  const { t } = useTranslation();
  const idea = useQuery({ queryKey: queryKeys.ideas.detail(code), queryFn: () => api.get<IdeaDetail>(`/initiatives/${code}`) });
  return (
    <div className="mx-auto max-w-reading">
      <Card className="space-y-5 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t('ideas.done.title')}</h1>
          <p className="mt-1 text-ink-muted">{t('ideas.done.body')}</p>
        </div>
        <div className="rounded-panel bg-primary-soft p-4">
          <p className="text-sm text-ink-muted">{t('ideas.done.id')}</p>
          <p className="tabular text-2xl font-semibold text-primary">{code}</p>
          <Link to={`/ideas/${code}`} className="text-sm text-primary underline">
            {t('ideas.done.trackingLink')}
          </Link>
        </div>
        {idea.data && (
          <div className="overflow-x-auto text-left">
            <JourneyRail stages={idea.data.journey} size="full" />
          </div>
        )}
        <p className="text-sm text-ink-muted">{t('ideas.done.emailed')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink to={`/ideas/${code}`}>{t('ideas.done.track')}</ButtonLink>
          <ButtonLink to="/ideas" variant="secondary">
            {t('ideas.myIdeas')}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
