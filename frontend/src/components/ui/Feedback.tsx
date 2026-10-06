import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api/client';
import { cn } from '@/utils/cn';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-control bg-neutral-soft', className)} aria-hidden />;
}

/** Generic page skeleton so a page is never blank while loading. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-1/2" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-panel" />
      ))}
    </div>
  );
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-ink-muted', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className={label ? undefined : 'sr-only'}>{label ?? t('common.loading')}</span>
    </span>
  );
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'spark';
  className?: string;
}
const toneBg = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', spark: 'bg-spark' };

export function ProgressBar({ value, max = 100, label, showValue, tone = 'primary', className }: ProgressBarProps) {
  const p = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cn('space-y-1', className)}>
      {(label || showValue) && (
        <div className="flex justify-between text-xs text-ink-muted">
          <span>{label}</span>
          {showValue && <span className="tabular">{Math.round(p)}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(p)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-neutral-soft"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-200', toneBg[tone])} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** One action button (or link). */
  action?: ReactNode;
  className?: string;
}
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-panel border border-dashed border-line px-6 py-10 text-center', className)}>
      <span className="text-ink-muted" aria-hidden>
        {icon ?? <Inbox className="h-8 w-8" />}
      </span>
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-ink-muted">{description}</p>}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}
/** What went wrong + Try again + request ID for support (spec §13.1). */
export function ErrorState({ error, title, message, onRetry, className }: ErrorStateProps) {
  const { t } = useTranslation();
  const apiErr = error instanceof ApiError ? error : null;
  const text = message ?? apiErr?.message ?? (error instanceof Error ? error.message : null) ?? t('error.generic');
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 rounded-panel border border-line bg-surface px-6 py-10 text-center', className)}>
      <AlertTriangle className="h-8 w-8 text-danger" aria-hidden />
      <p className="font-medium text-ink">{title ?? t('error.title')}</p>
      <p className="max-w-md text-sm text-ink-muted">{text}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.tryAgain')}
        </Button>
      )}
      {apiErr?.requestId && (
        <p className="text-xs text-ink-muted">
          {t('common.requestId')}: <code className="tabular">{apiErr.requestId}</code>
        </p>
      )}
    </div>
  );
}

/** True when an API error means "not found / no access" — render <NotFoundPage /> for it. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}
