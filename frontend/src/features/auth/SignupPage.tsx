import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api, errorMessage, getToken, setToken } from '@/api/client';
import logo from '@/assets/agl_logo.jpg';
import { Callout } from '@/components/domain';
import { Button, Combobox, Field, Input, Skeleton } from '@/components/ui';

interface SignupOptions {
  signup_enabled: boolean;
  allowed_domains: string;
  org_units: { id: string; name: string; unit_type: string; depth: number }[];
  departments: { id: string; name: string; sbu_id: string; depth: number }[];
  functions?: { id: string; name: string; sbu_id: string; parent_id: string | null }[];
  invitation: null | {
    valid: boolean;
    message?: string;
    email?: string;
    full_name?: string | null;
    roles?: string[];
    invited_by?: string | null;
  };
}
interface SignupResponse {
  access_token: string;
}

const APP = import.meta.env.VITE_APP_NAME || 'InnovateX Hub';
const EMPTY = {
  employee_no: '',
  full_name: '',
  email: '',
  job_title: '',
  org_unit_id: '',
  function_id: '',
  function_name: '',
  department_id: '',
  department_name: '',
  password: '',
  confirm: '',
};

function PasswordInput(props: { value: string; onChange: (v: string) => void; id?: string; autoComplete: string; showLabel: string; hideLabel: string }) {
  const [show, setShow] = useState(false);
  const { value, onChange, showLabel, hideLabel, ...rest } = props;
  return (
    <div className="relative">
      <Input {...rest} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} className="pr-11" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? hideLabel : showLabel}
        aria-pressed={show}
        className="absolute inset-y-0 right-1 my-auto grid h-9 w-9 place-items-center rounded-control text-ink-muted hover:bg-neutral-soft hover:text-ink"
      >
        {show ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
}

/** Public page: anyone signs up as an employee; an invitation link adds a privileged role (Judge, …). */
export default function SignupPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const invite = params.get('invite') ?? '';

  const options = useQuery({
    queryKey: ['signup-options', invite],
    queryFn: () => api.get<SignupOptions>('/auth/signup-options', invite ? { invite } : undefined),
  });

  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => update({ [key]: e.target.value });

  const inv = options.data?.invitation ?? null;
  const invited = !!inv?.valid;

  useEffect(() => {
    if (inv?.valid) setForm((f) => ({ ...f, email: inv.email ?? f.email, full_name: f.full_name || inv.full_name || '' }));
  }, [inv?.valid, inv?.email, inv?.full_name]);

  useEffect(() => {
    if (getToken()) window.location.assign('/'); // already signed in
  }, []);

  const sbu = form.org_unit_id;
  const departments = (options.data?.departments ?? []).filter((d) => d.sbu_id === sbu);
  // Functions of the SBU; those of the chosen department first, and each name once.
  const allFunctions = (options.data?.functions ?? []).filter((f) => f.sbu_id === sbu);
  const ordered = [...allFunctions].sort((a, b) => Number(b.parent_id === form.department_id) - Number(a.parent_id === form.department_id));
  const seen = new Set<string>();
  const functions = ordered.filter((f) => !seen.has(f.name.toLowerCase()) && seen.add(f.name.toLowerCase()));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.employee_no.trim()) next.employee_no = t('signup.employeeNoRequired');
    if (form.full_name.trim().length < 3) next.full_name = t('signup.nameRequired');
    if (!form.email.trim()) next.email = t('signup.emailRequired');
    if (form.password !== form.confirm) next.confirm = t('signup.passwordMismatch');
    setErrors(next);
    setServerError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const res = await api.post<SignupResponse>(
        '/auth/signup',
        {
          employee_no: form.employee_no.trim(),
          full_name: form.full_name,
          email: form.email,
          job_title: form.job_title || null,
          org_unit_id: sbu || null,
          department_id: form.department_id || null,
          department_name: form.department_id ? null : form.department_name || null,
          function_id: form.function_id || null,
          function_name: form.function_id ? null : form.function_name || null,
          password: form.password,
          invite_token: invited ? invite : null,
        },
        { noAuthRedirect: true },
      );
      setToken(res.access_token);
      window.location.assign('/'); // full reload so the session starts cleanly
    } catch (err) {
      const fields = err instanceof ApiError ? (err.details?.fields as Record<string, string> | undefined) : undefined;
      if (fields) setErrors(fields);
      setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  const closed = options.data && !options.data.signup_enabled && !invited;
  const pw = { showLabel: t('signup.showPassword'), hideLabel: t('signup.hidePassword') };

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:py-12">
      <main className="mx-auto w-full max-w-3xl rounded-panel border border-line bg-surface px-5 py-8 shadow-sm sm:px-10">
        <header className="flex flex-col items-center text-center">
          <img src={logo} alt="Anwar Group of Industries" className="h-20 w-auto object-contain" />
          <p className="mt-3 text-lg font-semibold tracking-tight text-primary">{APP}</p>
          <h1 className="mt-4 text-3xl font-bold text-ink">{t('signup.heading')}</h1>
          <p className="mt-1 max-w-md text-sm text-ink-muted">{t('signup.subtitle')}</p>
        </header>

        <div className="mt-8">
          {options.isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : options.isError ? (
            <Callout tone="danger" title={errorMessage(options.error)} />
          ) : (
            <>
              {inv && inv.valid && (
                <div className="mb-6">
                  <Callout tone="spark" title={t('signup.invitedTitle')}>
                    <p className="flex items-start gap-2">
                      <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        {inv.invited_by
                          ? t('signup.invitedBody', { inviter: inv.invited_by, roles: (inv.roles ?? []).join(', ') })
                          : t('signup.invitedBodyNoName', { roles: (inv.roles ?? []).join(', ') })}
                      </span>
                    </p>
                  </Callout>
                </div>
              )}
              {inv && !inv.valid && (
                <div className="mb-6">
                  <Callout tone="warning" title={t('signup.inviteInvalid')} action={<Link className="font-medium text-primary underline" to="/signup">{t('signup.signUpAsEmployee')}</Link>} />
                </div>
              )}
              {closed ? (
                <Callout tone="warning" title={t('signup.closed')} />
              ) : (
                <form onSubmit={submit} noValidate>
                  <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                    <Field label={t('signup.employeeId')} required error={errors.employee_no}>
                      <Input value={form.employee_no} onChange={set('employee_no')} autoFocus />
                    </Field>
                    <Field label={t('signup.name')} required error={errors.full_name}>
                      <Input value={form.full_name} onChange={set('full_name')} autoComplete="name" />
                    </Field>

                    <Field
                      label={t('signup.email')}
                      required
                      error={errors.email}
                      help={invited ? t('signup.emailLocked') : options.data?.allowed_domains ? t('signup.emailDomains', { domains: options.data.allowed_domains }) : undefined}
                    >
                      <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" readOnly={invited} />
                    </Field>
                    <Field label={t('signup.designation')} error={errors.job_title}>
                      <Input value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" />
                    </Field>

                    <Field label={t('signup.orgUnit')} error={errors.org_unit_id}>
                      <Combobox
                        value={form.org_unit_id}
                        onChange={(v) => update({ org_unit_id: v, department_id: '', department_name: '', function_id: '', function_name: '' })}
                        placeholder={t('signup.searchSbu')}
                        emptyText={t('signup.noMatch')}
                        options={(options.data?.org_units ?? []).map((u) => ({ value: u.id, label: u.name }))}
                      />
                    </Field>
                    <Field label={t('signup.function')} error={errors.function_id}>
                      <Combobox
                        value={form.function_id}
                        typed={form.function_name}
                        onChange={(v, typed) => update({ function_id: v, function_name: typed })}
                        allowCreate
                        createLabel={(s) => t('signup.useNew', { value: s })}
                        placeholder={t('signup.searchFunction')}
                        emptyText={sbu ? t('signup.typeNew') : t('signup.chooseSbuFirst')}
                        options={functions.map((f) => ({ value: f.id, label: f.name }))}
                      />
                    </Field>

                    <Field label={t('signup.department')} error={errors.department_id} className="sm:col-span-2">
                      <Combobox
                        value={form.department_id}
                        typed={form.department_name}
                        onChange={(v, typed) => update({ department_id: v, department_name: typed })}
                        allowCreate
                        createLabel={(s) => t('signup.useNew', { value: s })}
                        placeholder={t('signup.searchDepartment')}
                        emptyText={sbu ? t('signup.typeNew') : t('signup.chooseSbuFirst')}
                        options={departments.map((d) => ({ value: d.id, label: d.name, depth: d.depth }))}
                      />
                    </Field>

                    <Field label={t('signup.password')} required error={errors.password} help={t('signup.passwordHelp')}>
                      <PasswordInput value={form.password} onChange={(v) => update({ password: v })} autoComplete="new-password" {...pw} />
                    </Field>
                    <Field label={t('signup.confirmPassword')} required error={errors.confirm}>
                      <PasswordInput value={form.confirm} onChange={(v) => update({ confirm: v })} autoComplete="new-password" {...pw} />
                    </Field>
                  </div>

                  {serverError && (
                    <p role="alert" className="mt-5 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                      {serverError}
                    </p>
                  )}
                  <Button type="submit" fullWidth size="lg" loading={busy} className="mt-6">
                    {busy ? t('signup.creating') : t('signup.heading')}
                  </Button>
                  {!invited && <p className="mt-3 text-center text-xs text-ink-muted">{t('signup.roleNote')}</p>}
                </form>
              )}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-ink">
          {t('signup.haveAccount')}{' '}
          <Link className="font-medium text-primary hover:underline" to="/login">
            {t('signup.login')}
          </Link>
        </p>
      </main>
    </div>
  );
}
