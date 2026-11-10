import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Eye, EyeOff, Lightbulb, ShieldCheck, Trophy } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { APP_NAME } from '@/app/theme';
import logo from '@/assets/agl_logo.jpg';
import { useAuth } from '@/auth/AuthProvider';
import type { DemoAccount, DemoAccountsResponse, Role } from '@/auth/types';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { Avatar } from '@/components/ui/Layout';
import { setLanguage } from '@/i18n';
import { cn } from '@/utils/cn';
import './login.css';

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
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Demo accounts only exist when the server runs in demo mode; otherwise this quietly returns nothing.
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
  const points = [
    { icon: Lightbulb, title: t('login.point1Title'), text: t('login.point1Text') },
    { icon: ShieldCheck, title: t('login.point2Title'), text: t('login.point2Text') },
    { icon: Trophy, title: t('login.point3Title'), text: t('login.point3Text'), gold: true },
  ];

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <aside className="ix-login-panel hidden flex-col justify-between p-10 lg:flex xl:p-14" aria-label={APP_NAME}>
        <Link to="/" className="inline-flex w-fit items-center gap-3 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#46C9C3]">
          <span className="inline-flex rounded-control bg-white p-1.5 shadow-sm">
            <img src={logo} alt="Anwar Group of Industries" className="h-9 w-auto object-contain" />
          </span>
          <span className="flex flex-col leading-tight">
            <strong className="ix-display text-[15px] font-extrabold tracking-wide">{APP_NAME}</strong>
            <span className="text-xs text-[#A3B6C4]">Anwar Group of Industries</span>
          </span>
        </Link>

        <div className="max-w-xl">
          <p className="ix-login-rise mb-4 inline-flex items-center gap-2.5 text-sm text-[#A3B6C4]" data-d="1">
            <span className="h-2 w-2 rounded-full bg-[#46C9C3] shadow-[0_0_0_4px_rgba(70,201,195,.18)]" aria-hidden />
            {t('login.kicker')}
          </p>
          <h2 className="ix-login-rise ix-display text-4xl font-extrabold leading-[1.05] tracking-tight xl:text-5xl" data-d="1">
            {t('login.panelTitle')} <span className="text-[#F3C352]">{t('login.panelTitleAccent')}</span>
          </h2>
          <p className="ix-login-rise mt-5 max-w-md text-base text-[#A3B6C4]" data-d="2">
            {t('app.tagline')}
          </p>
          <ul className="ix-login-rise mt-10 space-y-5" data-d="3">
            {points.map(({ icon: Icon, title, text, gold }) => (
              <li key={title} className="flex gap-4">
                <span
                  className={cn(
                    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 bg-[#132A3B]',
                    gold ? 'border-[#E8A317] text-[#F3C352]' : 'border-[#46C9C3] text-[#E8EFF3]',
                  )}
                  aria-hidden
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-[#A3B6C4]">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-[#A3B6C4]">© {new Date().getFullYear()} Anwar Group of Industries</p>
      </aside>

      {/* Sign-in form */}
      <div className="flex min-h-screen flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="inline-flex min-h-[36px] items-center gap-1.5 rounded-control px-1 text-sm font-medium text-ink-muted hover:text-primary">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('login.backHome')}
          </Link>
          <div role="group" aria-label={t('common.language')} className="flex overflow-hidden rounded-control border border-line text-sm">
            {(['en', 'bn'] as const).map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={lang === l}
                onClick={() => setLanguage(l)}
                className={cn('min-h-[36px] px-2.5 font-medium transition-colors', lang === l ? 'bg-primary text-primary-fg' : 'bg-surface text-ink hover:bg-neutral-soft')}
              >
                {l === 'en' ? 'EN' : 'বাংলা'}
              </button>
            ))}
          </div>
        </div>

        <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <img src={logo} alt="Anwar Group of Industries" className="h-16 w-auto object-contain lg:hidden" />
            <p className="ix-display mt-3 text-sm font-extrabold uppercase tracking-[0.14em] text-primary lg:mt-0">{APP_NAME}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{t('login.welcome')}</h1>
            <p className="mt-1.5 text-ink-muted">{t('login.subtitle')}</p>
          </div>

          <div className="rounded-dialog border border-line bg-surface p-6 shadow-float sm:p-7">
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <Field label={t('login.email')} required>
                <Input
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="name@anwargroup.net"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label={t('login.password')} required>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-ink-muted hover:text-primary"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
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

            <div className="mt-6 border-t border-line pt-5 text-center text-sm text-ink">
              {t('signup.noAccount')}{' '}
              <Link className="font-semibold text-primary hover:underline" to="/signup">
                {t('signup.createAccount')}
              </Link>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-ink-muted lg:text-left">{t('login.ssoNote')}</p>
          <p className="mt-1 text-center text-xs text-ink-muted lg:text-left">{t('login.help')}</p>

          {groups.length > 0 && demo.data && (
            <section aria-labelledby="demo-title" className="mt-8">
              <h2 id="demo-title" className="text-base font-semibold text-ink">
                {t('login.demoTitle')}
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">{t('login.demoHint', { password: demo.data.password })}</p>
              <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <div key={g.role}>
                    <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{t(`role.${g.role}`, g.role)}</h3>
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
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
