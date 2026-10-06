import * as DM from '@radix-ui/react-dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut, Menu, Moon, Search, Sun, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar } from '@/components/ui/Layout';
import { useDebounce } from '@/hooks';
import { setLanguage } from '@/i18n';
import { cn } from '@/utils/cn';
import { relativeFromNow } from '@/utils/dates';
import { statusLabel } from '@/utils/format';
import { APP_NAME, applyTheme, getTheme, type Theme } from '../theme';

export interface NotificationItem {
  id: string;
  title: string;
  body?: string | null;
  link_path?: string | null;
  needs_action: boolean;
  is_read: boolean;
  created_at: string;
  event_type?: string | null;
}
export interface NotificationList {
  items: NotificationItem[];
  unread: number;
}

interface SearchHit {
  type: string;
  id: string;
  code?: string | null;
  title: string;
  link_path: string;
}

const iconBtn =
  'relative inline-flex h-10 w-10 items-center justify-center rounded-control text-ink hover:bg-neutral-soft';
const menuContent =
  'z-50 min-w-[220px] rounded-panel border border-line bg-surface p-1 shadow-float';
const menuItem =
  'flex cursor-pointer select-none items-center gap-2 rounded-control px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-neutral-soft';

function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const dq = useDebounce(q.trim(), 300);
  const enabled = dq.length >= 2;
  const res = useQuery({
    queryKey: queryKeys.search(dq),
    queryFn: () => api.get<{ items: SearchHit[] }>('/search', { q: dq }),
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const items = res.data?.items ?? [];
  return (
    <div ref={boxRef} className="relative hidden w-full max-w-md sm:block" role="search">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && items[0]) navigate(items[0].link_path);
        }}
        aria-label={t('common.searchPlaceholder')}
        placeholder={t('common.searchPlaceholder')}
        className="control pl-9"
      />
      {open && enabled && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-panel border border-line bg-surface p-1 shadow-float">
          {res.isLoading ? (
            <p className="px-3 py-2 text-sm text-ink-muted">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-muted">{t('common.noResults')}</p>
          ) : (
            <ul>
              {items.map((hit) => (
                <li key={`${hit.type}-${hit.id}`}>
                  <Link to={hit.link_path} className="block rounded-control px-3 py-2 hover:bg-neutral-soft" onClick={() => setOpen(false)}>
                    <span className="block truncate text-sm text-ink">{hit.title}</span>
                    <span className="tabular block text-xs text-ink-muted">
                      {statusLabel(hit.type)}
                      {hit.code ? ` · ${hit.code}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function LanguageSwitch() {
  const { i18n, t } = useTranslation();
  const lang = i18n.language.startsWith('bn') ? 'bn' : 'en';
  return (
    <div role="group" aria-label={t('common.language')} className="flex overflow-hidden rounded-control border border-line text-sm">
      {(['en', 'bn'] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => setLanguage(l)}
          className={cn('min-h-[36px] px-2.5 font-medium', lang === l ? 'bg-primary text-primary-fg' : 'bg-surface text-ink hover:bg-neutral-soft')}
        >
          {l === 'en' ? 'EN' : 'বাং'}
        </button>
      ))}
    </div>
  );
}

function NotificationBell() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: queryKeys.notifications.list('all'),
    queryFn: () => api.get<NotificationList>('/me/notifications', { filter: 'all' }),
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: (id: string) => api.post(`/me/notifications/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
  const unread = list.data?.unread ?? me?.unread_notifications ?? 0;
  const latest = (list.data?.items ?? []).slice(0, 5);

  return (
    <DM.Root>
      <DM.Trigger className={iconBtn} aria-label={t('notifications.bell', { count: unread })}>
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="tabular absolute right-1 top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-medium leading-[18px] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className={cn(menuContent, 'w-[min(360px,calc(100vw-1.5rem))]')}>
          <DM.Label className="px-3 py-2 text-sm font-semibold text-ink">{t('notifications.latest')}</DM.Label>
          {latest.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-muted">{t('notifications.empty')}</p>
          ) : (
            latest.map((n) => (
              <DM.Item
                key={n.id}
                className={cn(menuItem, 'items-start')}
                onSelect={() => {
                  if (!n.is_read) read.mutate(n.id);
                  if (n.link_path) navigate(n.link_path);
                }}
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                <span className="min-w-0">
                  <span className={cn('block text-sm', !n.is_read && 'font-medium')}>{n.title}</span>
                  <span className="block text-xs text-ink-muted">{relativeFromNow(n.created_at)}</span>
                </span>
              </DM.Item>
            ))
          )}
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item className={cn(menuItem, 'justify-center font-medium text-primary')} onSelect={() => navigate('/notifications')}>
            {t('notifications.viewAll')}
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };
  return (
    <DM.Root>
      <DM.Trigger className="inline-flex h-10 items-center gap-2 rounded-control px-1.5 hover:bg-neutral-soft" aria-label={me?.full_name ?? t('nav.profile')}>
        <Avatar name={me?.full_name} size="sm" />
        <span className="hidden max-w-[140px] truncate text-sm font-medium text-ink lg:block">{me?.full_name}</span>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className={menuContent}>
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-ink">{me?.full_name}</p>
            <p className="text-xs text-ink-muted">{me?.email}</p>
            <p className="mt-1 text-xs text-ink-muted">{(me?.roles ?? []).map((r) => t(`role.${r}`, r)).join(' · ')}</p>
          </div>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item className={menuItem} onSelect={() => navigate('/profile')}>
            <User className="h-4 w-4" aria-hidden />
            {t('nav.profile')}
          </DM.Item>
          <DM.Item
            className={menuItem}
            onSelect={(e) => {
              e.preventDefault();
              toggleTheme();
            }}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            {theme === 'dark' ? t('common.lightTheme') : t('common.darkTheme')}
          </DM.Item>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item
            className={menuItem}
            onSelect={() => {
              logout();
              navigate('/login', { replace: true });
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t('common.signOut')}
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-3 md:px-4">
      <button type="button" className={cn(iconBtn, 'md:hidden')} onClick={onOpenMenu} aria-label={t('nav.openMenu')}>
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold text-ink">
        <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-control bg-primary text-sm font-semibold text-primary-fg">
          iX
        </span>
        <span className="hidden sm:inline">{APP_NAME}</span>
      </Link>
      <div className="flex flex-1 justify-center px-2">
        <GlobalSearch />
      </div>
      <LanguageSwitch />
      <NotificationBell />
      <UserMenu />
    </header>
  );
}
