import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useServerTime } from '@/hooks';
import { cn } from '@/utils/cn';
import { countdownParts, formatDateTime, type DateInput } from '@/utils/dates';

export interface DeadlineCountdownProps {
  closesAt: DateInput;
  /** Text before the time, default "Closes in". Use e.g. "Registration closes in". */
  prefix?: string;
  /** Text once the time has passed, default "Closed". */
  closedLabel?: string;
  /** Hide the exact date. */
  compact?: boolean;
  className?: string;
}

const H = 3600_000;

/** "Closes in 2d 4h (20 Nov 2026, 5:00 PM)". Amber under 48 h, red under 6 h. Uses server time. */
export function DeadlineCountdown({ closesAt, prefix, closedLabel, compact, className }: DeadlineCountdownProps) {
  const { t } = useTranslation();
  const now = useServerTime(60_000);
  if (!closesAt) return null;
  const parts = countdownParts(closesAt, now);
  const exact = formatDateTime(closesAt);
  const tone = !parts ? 'text-ink-muted' : parts.msLeft < 6 * H ? 'text-danger' : parts.msLeft < 48 * H ? 'text-warning' : 'text-ink';

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5 text-sm', tone, className)}>
      <Clock className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-medium">
        {parts
          ? prefix
            ? `${prefix} ${parts.text}`
            : t('deadline.closesIn', { time: parts.text })
          : closedLabel ?? t('deadline.closed')}
      </span>
      {!compact && <span className="tabular text-ink-muted">({exact})</span>}
    </span>
  );
}
