import { useQuery } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api, errorMessage, getToken, setToken } from '@/api/client';
import { Callout } from '@/components/domain';
import { Button, Field, Input, Select, Skeleton } from '@/components/ui';

interface SignupOptions {
  signup_enabled: boolean;
  allowed_domains: string;
  org_units: { id: string; name: string; unit_type: string; depth: number }[];
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

/** Public page: anyone signs up as an employee; an invitation link adds a privileged role (Judge, …). */
export default function SignupPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const invite = params.get('invite') ?? '';

  const options = useQuery({
    queryKey: ['signup-options', invite],
    queryFn: () => api.get<SignupOptions>('/auth/signup-options', invite ? { invite } : undefined),
  });

  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm: '', job_title: '', department: '', org_unit_id: '', employee_no: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const inv = options.data?.invitation ?? null;
  const invited = !!inv?.valid;

  useEffect(() => {
    if (inv?.valid) setForm((f) => ({ ...f, email: inv.email ?? f.email, full_name: f.full_name || inv.full_name || '' }));
  }, [inv?.valid, inv?.email, inv?.full_name]);

  useEffect(() => {
    if (getToken()) window.location.assign('/'); // already signed in
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.password !== form.confirm) next.confirm = t('signup.passwordMismatch');
    if (!form.employee_no.trim()) next.employee_no = t('signup.employeeNoRequired');
    setErrors(next);
    setServerError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const res = await api.post<SignupResponse>(
        '/auth/signup',
        {
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          job_title: form.job_title || null,
          department: form.department.trim() || null,
          org_unit_id: form.org_unit_id || null,
          employee_no: form.employee_no.trim(),
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

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <main className="mx-auto w-full max-w-xl">
        <p className="text-sm font-medium text-primary">{import.meta.env.VITE_APP_NAME || 'InnovateX Hub'}</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{t('signup.title')}</h1>
        <p className="mt-1 text-ink-muted">{t('signup.subtitle')}</p>

        <div className="mt-6 rounded-panel border border-line bg-surface p-5 sm:p-6">
          {options.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : options.isError ? (
            <Callout tone="danger" title={errorMessage(options.error)} />
          ) : (
            <>
              {inv && inv.valid && (
                <div className="mb-5">
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
                <div className="mb-5">
                  <Callout tone="warning" title={t('signup.inviteInvalid')} action={<Link className="font-medium text-primary underline" to="/signup">{t('signup.signUpAsEmployee')}</Link>} />
                </div>
              )}
              {closed ? (
                <Callout tone="warning" title={t('signup.closed')} />
              ) : (
                <form onSubmit={submit} className="space-y-4" noValidate>
                  <Field label={t('signup.fullName')} required error={errors.full_name}>
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
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('signup.password')} required error={errors.password} help={t('signup.passwordHelp')}>
                      <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
                    </Field>
                    <Field label={t('signup.confirmPassword')} required error={errors.confirm}>
                      <Input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('signup.jobTitle')} hint={t('signup.optional')}>
                      <Input value={form.job_title} onChange={set('job_title')} autoComplete="organization-title" />
                    </Field>
                    <Field label={t('signup.employeeNo')} required error={errors.employee_no}>
                      <Input value={form.employee_no} onChange={set('employee_no')} />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('signup.orgUnit')} hint={t('signup.optional')} error={errors.org_unit_id}>
                      <Select
                        value={form.org_unit_id}
                        onChange={set('org_unit_id')}
                        placeholder={t('signup.orgUnitPlaceholder')}
                        options={(options.data?.org_units ?? []).map((u) => ({ value: u.id, label: u.name }))}
                      />
                    </Field>
                    <Field label={t('signup.department')} hint={t('signup.optional')} error={errors.department}>
                      <Input value={form.department} onChange={set('department')} />
                    </Field>
                  </div>
                  {serverError && (
                    <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                      {serverError}
                    </p>
                  )}
                  <Button type="submit" fullWidth size="lg" loading={busy} disabled={!form.full_name || !form.email || !form.password || !form.confirm || !form.employee_no.trim()}>
                    {busy ? t('signup.creating') : t('signup.submit')}
                  </Button>
                  {!invited && <p className="text-sm text-ink-muted">{t('signup.roleNote')}</p>}
                </form>
              )}
            </>
          )}
        </div>

        <p className="mt-4 text-sm text-ink-muted">
          {t('signup.haveAccount')}{' '}
          <Link className="font-medium text-primary underline" to="/login">
            {t('signup.signIn')}
          </Link>
        </p>
      </main>
    </div>
  );
}
