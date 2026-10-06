import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { useMe } from '@/auth/AuthProvider';
import { cn } from '@/utils/cn';
import { buildNav } from './nav';

export interface SidebarNavProps {
  /** Icons only (tablet). */
  collapsed?: boolean;
  onNavigate?: () => void;
}

/** The role-based menu. Used in the fixed sidebar (desktop/tablet) and the drawer (phone). */
export function SidebarNav({ collapsed, onNavigate }: SidebarNavProps) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const groups = buildNav(me);

  return (
    <nav aria-label={t('nav.mainNavigation')} className="flex-1 overflow-y-auto px-2 py-3">
      {groups.map((g, gi) => (
        <div key={g.key} className={cn(gi > 0 && 'mt-3 border-t border-line pt-3')}>
          {g.titleKey && !collapsed && (
            <p className="px-3 pb-1 text-xs font-medium text-ink-muted">{t(g.titleKey)}</p>
          )}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const label = item.rawLabel ?? t(item.labelKey);
              const Icon = item.icon;
              return (
                <li key={item.key}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    title={collapsed ? label : undefined}
                    aria-label={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'flex min-h-[40px] items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors duration-150',
                        collapsed && 'justify-center px-0',
                        isActive ? 'bg-primary-soft font-medium text-primary' : 'text-ink hover:bg-neutral-soft',
                      )
                    }
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
