import { ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { initials } from '@/utils/format';

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'spark' | 'primary';

export const toneClasses: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-ink-muted',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  spark: 'bg-spark-soft text-spark-ink',
  primary: 'bg-primary-soft text-primary',
};

export function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Card({ className, children, padded = true, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={cn('rounded-panel border border-line bg-surface', padded && 'p-4 md:p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface Crumb {
  label: ReactNode;
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Primary action first; it is the most visible button on the page. */
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Badges etc. shown next to the title. */
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, breadcrumbs, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
            {breadcrumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                {c.to ? (
                  <Link to={c.to} className="hover:text-primary hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-ink">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">{title}</h1>
            {meta}
          </div>
          {subtitle && <p className="mt-1 text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
      </div>
    </header>
  );
}

export function Avatar({ name, size = 'md', className }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-base' }[size];
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-medium text-primary', s, className)}
    >
      {initials(name)}
    </span>
  );
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  to?: string;
  className?: string;
}

/** A key number with its label; `hero` size is used on dashboards via StatTile. */
export function Stat({ label, value, hint, icon, tone, to, className }: StatProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink-muted">{label}</span>
        {icon && <span className={cn('rounded-control p-1.5', toneClasses[tone ?? 'neutral'])}>{icon}</span>}
      </div>
      <div className="tabular mt-1 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </>
  );
  const cls = cn('block rounded-panel border border-line bg-surface p-4', to && 'hover:border-primary', className);
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
