import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { APP_NAME } from '@/app/theme';
import { useAuth } from '@/auth/AuthProvider';
import type { DemoAccount, DemoAccountsResponse, Role } from '@/auth/types';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Avatar } from '@/components/ui/Layout';
import { setLanguage } from '@/i18n';
import { cn } from '@/utils/cn';

const ROLE_ORDER: Role[] = [
  'DMD', 'SUPER_ADMIN', 'PROGRAM_OWNER', 'EXECUTIVE', 'JUDGE', 'ADMIN', 'HR', 'FINANCE_VERIFIER', 'SPONSOR', 'EMPLOYEE',
];

function safeNext(next: string | null): string {
  // Only same-site paths, so a crafted link can't redirect elsewhere.
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const demo = useQuery({
    queryKey: queryKeys.demoAccounts,
    queryFn: () => api.get<DemoAccountsResponse>('/auth/demo-accounts'),
    retry: false,
    staleTime: Infinity,
  });

  const groups = useMemo(() => {
    const byRole = new Map<Role, DemoAccount[]>();
    for (const a of demo.data?.accounts ?? []) {
      const primary = ROLE_ORDER.find((r) => a.roles.includes(r)) ?? 'EMPLOYEE';
      byRole.set(primary, [...(byRole.get(primary) ?? []), a]);
    }
    return ROLE_ORDER.filter((r) => byRole.has(r)).map((r) => ({ role: r, accounts: byRole.get(r)! }));
  }, [demo.data]);

  if (isAuthenticated && !busy) return <Navigate to={next} replace />;

  const signIn = async (em: string, pw: string) => {
    setError(null);
    setBusy(em);
    try {
      await login(em, pw);
      navigate(next, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? e.message : t('login.failed'));
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (email && password) void signIn(email.trim(), password);
  };

  const lang = i18n.language.startsWith('bn') ? 'bn' : 'en';

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto grid max-w-content gap-8 px-4 py-8 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:py-14">
        <main>
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-control bg-primary font-semibold text-primary-fg">
                iX
              </span>
              <span className="text-lg font-semibold text-ink">{APP_NAME}</span>
            </div>
            <div role="group" aria-label={t('common.language')} className="flex overflow-hidden rounded-control border border-line text-sm">
              {(['en', 'bn'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  lang={l}
                  aria-pressed={lang === l}
                  onClick={() => setLanguage(l)}
                  className={cn('min-h-[36px] px-2.5 font-medium', lang === l ? 'bg-primary text-primary-fg' : 'bg-surface text-ink')}
                >
                  {l === 'en' ? 'EN' : 'বাংলা'}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-panel border border-line bg-surface p-5 md:p-6">
            <h1 className="text-2xl font-semibold text-ink">{t('login.title')}</h1>
            <p className="mt-1 text-ink-muted">{t('app.tagline')}</p>

            <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
              <Field label={t('login.email')} required>
                <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label={t('login.password')} required>
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && (
                <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" fullWidth size="lg" loading={busy !== null && busy === email.trim()} disabled={!email || !password || busy !== null}>
                {busy ? t('login.signingIn') : t('login.signIn')}
              </Button>
            </form>
            <p className="mt-4 text-sm text-ink">
              {t('signup.noAccount')}{' '}
              <Link className="font-medium text-primary underline" to="/signup">
                {t('signup.createAccount')}
              </Link>
            </p>
            <p className="mt-2 text-sm text-ink-muted">{t('login.ssoNote')}</p>
          </div>
          <p className="mt-4 text-sm text-ink-muted">{t('login.help')}</p>
        </main>

        <section aria-labelledby="demo-title">
          <h2 id="demo-title" className="text-xl font-semibold text-ink">
            {t('login.demoTitle')}
          </h2>
          {demo.isLoading ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !demo.data || groups.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">{t('login.help')}</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-muted">
                {t('login.demoHint', { password: demo.data.password })}
              </p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {groups.map((g) => (
                  <div key={g.role}>
                    <h3 className="mb-1.5 text-sm font-medium text-ink-muted">{t(`role.${g.role}`, g.role)}</h3>
                    <ul className="space-y-1.5">
                      {g.accounts.map((a) => (
                        <li key={a.email}>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void signIn(a.email, demo.data.password)}
                            aria-label={t('login.signInAs', { name: a.full_name })}
                            className="flex w-full items-center gap-3 rounded-panel border border-line bg-surface px-3 py-2 text-left transition-colors duration-150 hover:border-primary disabled:opacity-60"
                          >
                            <Avatar name={a.full_name} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-ink">{a.full_name}</span>
                              <span className="block truncate text-xs text-ink-muted">
                                {[a.job_title, a.note].filter(Boolean).join(' · ') || a.email}
                              </span>
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
