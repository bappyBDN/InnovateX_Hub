import { AlertTriangle, Check, Loader2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Layout';
import type { AutosaveStatus } from '@/hooks';
import { cn } from '@/utils/cn';

/** Shown on confidential records. */
export function ConfidentialBanner({ message, className }: { message?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="note" className={cn('flex items-center gap-2 rounded-panel border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger', className)}>
      <Lock className="h-4 w-4 shrink-0" aria-hidden />
      {message ?? t('confidential')}
    </div>
  );
}

export interface UserChipProps {
  name: string | null | undefined;
  /** Second line: job title, department or role. */
  subtitle?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

/** Avatar (initials) + name + optional subtitle. */
export function UserChip({ name, subtitle, size = 'md', className }: UserChipProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <Avatar name={name} size={size === 'sm' ? 'sm' : 'md'} />
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-medium text-ink">{name ?? '—'}</span>
        {subtitle && <span className="block truncate text-xs text-ink-muted">{subtitle}</span>}
      </span>
    </span>
  );
}

/** "Saving…" / "Saved ✓" / "Couldn't save — retrying" for useAutosave. */
export function SaveIndicator({ status, className }: { status: AutosaveStatus; className?: string }) {
  const { t } = useTranslation();
  if (status === 'idle') return null;
  return (
    <span aria-live="polite" className={cn('inline-flex items-center gap-1 text-sm', status === 'error' ? 'text-danger' : 'text-ink-muted', className)}>
      {status === 'saving' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {status === 'saved' && <Check className="h-4 w-4 text-success" aria-hidden />}
      {status === 'error' && <AlertTriangle className="h-4 w-4" aria-hidden />}
      {status === 'saving' ? t('common.saving') : status === 'saved' ? t('common.saved') : t('common.saveError')}
    </span>
  );
}

/** A note box: info (blue), warning (amber), success (green), danger (red), spark (shortlist / win moment). */
export function Callout({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'success' | 'danger' | 'spark';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-info/40 bg-info-soft text-info',
    warning: 'border-warning/40 bg-warning-soft text-warning',
    success: 'border-success/40 bg-success-soft text-success',
    danger: 'border-danger/40 bg-danger-soft text-danger',
    spark: 'border-spark bg-spark-soft text-spark-ink',
  };
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-panel border px-4 py-3', tones[tone], className)}>
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-sm text-ink">{children}</div>}
      </div>
      {action}
    </div>
  );
}
