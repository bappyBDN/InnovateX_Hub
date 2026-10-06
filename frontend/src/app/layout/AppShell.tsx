import * as RD from '@radix-ui/react-dialog';
import { MoreHorizontal, WifiOff, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMe } from '@/auth/AuthProvider';
import { PageSkeleton } from '@/components/ui/Feedback';
import { useOnline } from '@/hooks';
import { cn } from '@/utils/cn';
import { APP_NAME } from '../theme';
import { bottomNavItems } from './nav';
import { SidebarNav } from './Sidebar';
import { TopBar } from './TopBar';

function BottomNav({ onMore }: { onMore: () => void }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const items = bottomNavItems(me);
  const cls = (active: boolean) =>
    cn(
      'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs',
      active ? 'font-medium text-primary' : 'text-ink-muted',
    );
  return (
    <nav aria-label={t('nav.menu')} className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface md:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.key} to={item.to} end={item.end} className={({ isActive }) => cls(isActive)}>
            <Icon className="h-5 w-5" aria-hidden />
            <span className="max-w-full truncate">{item.rawLabel ?? t(item.labelKey)}</span>
          </NavLink>
        );
      })}
      <button type="button" onClick={onMore} className={cls(false)}>
        <MoreHorizontal className="h-5 w-5" aria-hidden />
        <span>{t('nav.more')}</span>
      </button>
    </nav>
  );
}

/** App shell (spec §4.2): top bar, sidebar (full ≥1024, icons 768–1023, drawer <768), bottom bar on phones. */
export function AppShell() {
  const { t } = useTranslation();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const online = useOnline();

  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-fg"
      >
        {t('app.skipToContent')}
      </a>
      <TopBar onOpenMenu={() => setDrawer(true)} />
      {!online && (
        <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-3 py-2 text-sm text-warning">
          <WifiOff className="h-4 w-4" aria-hidden />
          {t('error.offline')}
        </div>
      )}
      <div className="flex">
        {/* Tablet: icons only */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-16 shrink-0 flex-col border-r border-line bg-surface md:flex lg:hidden">
          <SidebarNav collapsed />
        </aside>
        {/* Desktop: full sidebar */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <SidebarNav />
        </aside>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-24 pt-5 outline-none md:px-6 md:pb-10">
          <div className="mx-auto max-w-content">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      <BottomNav onMore={() => setDrawer(true)} />

      {/* Phone drawer */}
      <RD.Root open={drawer} onOpenChange={setDrawer}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-50 bg-black/40 md:hidden" />
          <RD.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-float md:hidden"
          >
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <RD.Title className="font-semibold text-ink">{APP_NAME}</RD.Title>
              <RD.Close className="rounded-control p-2 hover:bg-neutral-soft" aria-label={t('nav.closeMenu')}>
                <X className="h-5 w-5" aria-hidden />
              </RD.Close>
            </div>
            <SidebarNav onNavigate={() => setDrawer(false)} />
          </RD.Content>
        </RD.Portal>
      </RD.Root>
    </div>
  );
}

export default AppShell;
