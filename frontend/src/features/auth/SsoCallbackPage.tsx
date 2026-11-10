import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { APP_NAME } from '@/app/theme';
import logo from '@/assets/agl_logo.jpg';
import { useAuth } from '@/auth/AuthProvider';
import type { Me } from '@/auth/types';
import './login.css';

/* Landing page for "Open InnovateX Hub" in ProjectFlow: /sso-callback#token=…  (?token=… is accepted too).
   The one-time token is taken out of the address bar straight away, traded for a session, then the user lands on
   the dashboard. */

// A token works once, and React may run the effect twice in development: share one request per token.
const inFlight = new Map<string, Promise<Me>>();

function readToken(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
  const fromQuery = new URLSearchParams(window.location.search).get('token');
  return fromHash || fromQuery;
}

type State = { kind: 'working' } | { kind: 'error'; code: string; message: string };

export default function SsoCallbackPage() {
  const { t } = useTranslation();
  const { loginWithSso } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(readToken);
  const [state, setState] = useState<State>(() =>
    token ? { kind: 'working' } : { kind: 'error', code: 'SSO_MISSING', message: t('sso.missing') },
  );

  const config = useQuery({
    queryKey: ['auth', 'sso-config'],
    queryFn: () => api.get<{ enabled: boolean; projectflow_url: string | null }>('/auth/sso-config'),
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    // Keep the token out of the history, bookmarks and anything that reads the address later.
    if (window.location.hash || window.location.search) window.history.replaceState(null, '', window.location.pathname);
    if (!token) return;
    let alive = true;
    let request = inFlight.get(token);
    if (!request) {
      request = loginWithSso(token);
      inFlight.set(token, request);
    }
    request
      .then(() => {
        if (alive) navigate('/', { replace: true });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const code = e instanceof ApiError ? e.code : 'SSO_FAILED';
        const message = e instanceof ApiError && e.message ? e.message : t('sso.failed');
        setState({ kind: 'error', code, message });
      });
    return () => {
      alive = false;
    };
  }, [token, loginWithSso, navigate, t]);

  const pfUrl = config.data?.projectflow_url;

  return (
    <div className="ix-login-panel flex min-h-screen items-center justify-center px-4 py-10">
      <main className="w-full max-w-md rounded-dialog bg-surface p-7 text-center shadow-float sm:p-8" aria-live="polite">
        <span className="mx-auto inline-flex rounded-control bg-white p-1.5">
          <img src={logo} alt="Anwar Group of Industries" className="h-12 w-auto object-contain" />
        </span>
        <p className="ix-display mt-4 text-sm font-extrabold uppercase tracking-[0.14em] text-primary">{APP_NAME}</p>

        {state.kind === 'working' ? (
          <>
            <Loader2 className="mx-auto mt-6 h-10 w-10 animate-spin text-primary" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-ink">{t('sso.workingTitle')}</h1>
            <p className="mt-1.5 text-sm text-ink-muted">{t('sso.workingText')}</p>
          </>
        ) : (
          <>
            <span className="mx-auto mt-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="h-6 w-6" aria-hidden />
            </span>
            <h1 className="mt-4 text-xl font-semibold text-ink">{t('sso.errorTitle')}</h1>
            <p role="alert" className="mt-1.5 text-sm text-ink-muted">
              {state.message}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {pfUrl && (
                <a
                  href={pfUrl}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-control bg-primary px-4 font-semibold text-primary-fg hover:opacity-90"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  {t('sso.backToProjectFlow')}
                </a>
              )}
              <Link
                to="/login"
                className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-line px-4 font-medium text-ink hover:border-primary hover:text-primary"
              >
                {t('sso.signInWithEmail')}
              </Link>
            </div>
            <p className="mt-4 text-xs text-ink-muted">{t('login.help')}</p>
          </>
        )}
      </main>
    </div>
  );
}
