import { Check, Trophy } from 'lucide-react';
import { cn } from '@/utils/cn';
import { formatDayMonth, parseServerDate } from '@/utils/dates';

export type JourneyState = 'done' | 'current' | 'upcoming' | 'skipped' | 'won';

export interface JourneyStage {
  code: string;
  label: string;
  state: JourneyState;
  /** ISO date or ready-made text. */
  date?: string | null;
  /** e.g. "Due 28 Nov", "Not required". */
  note?: string | null;
}

export interface JourneyRailProps {
  stages: JourneyStage[];
  size?: 'compact' | 'full';
  className?: string;
}

function dateText(d?: string | null): string {
  if (!d) return '';
  return parseServerDate(d) && /^\d{4}-\d{2}-\d{2}/.test(d) ? formatDayMonth(d) : d;
}

const STATE_TEXT: Record<JourneyState, string> = {
  done: 'done',
  current: 'current stage',
  upcoming: 'upcoming',
  skipped: 'skipped',
  won: 'achieved',
};

/**
 * The stage tracker shown on every entry and idea (spec §6.1).
 * Done = solid, current = highlighted ring with its date/note, upcoming = outlined,
 * skipped = dashed and labelled, won = filled with the spark colour.
 */
export function JourneyRail({ stages, size = 'full', className }: JourneyRailProps) {
  const full = size === 'full';
  const current = stages.find((s) => s.state === 'current') ?? [...stages].reverse().find((s) => s.state === 'won' || s.state === 'done');
  const dot = full ? 'h-6 w-6' : 'h-3.5 w-3.5';

  return (
    <div className={cn(full && 'overflow-x-auto pb-1', className)}>
      <ol
        aria-label="Journey"
        className={cn('flex items-start', full ? 'min-w-[560px]' : 'w-full')}
      >
        {stages.map((s, i) => {
          const prev = stages[i - 1];
          const reached = s.state === 'done' || s.state === 'current' || s.state === 'won';
          const lineSolid = i > 0 && reached && prev && prev.state !== 'upcoming';
          return (
            <li
              key={s.code}
              aria-current={s.state === 'current' ? 'step' : undefined}
              className={cn('relative flex flex-1 flex-col items-center', full ? 'px-1' : '')}
            >
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-1/2 w-full',
                    full ? 'top-3' : 'top-[7px]',
                    lineSolid ? 'border-t-2 border-primary' : 'border-t-2 border-line',
                    (s.state === 'skipped' || prev?.state === 'skipped') && 'border-dashed',
                  )}
                />
              )}
              <span
                aria-hidden
                title={full ? undefined : s.label}
                className={cn(
                  'relative z-10 inline-flex shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200',
                  dot,
                  s.state === 'done' && 'border-primary bg-primary text-primary-fg',
                  s.state === 'current' && 'border-primary bg-surface ring-4 ring-primary-soft',
                  s.state === 'upcoming' && 'border-line bg-surface',
                  s.state === 'skipped' && 'border-dashed border-line bg-canvas',
                  s.state === 'won' && 'border-spark bg-spark text-white',
                )}
              >
                {full && s.state === 'done' && <Check className="h-3.5 w-3.5" />}
                {full && s.state === 'won' && <Trophy className="h-3.5 w-3.5" />}
                {s.state === 'current' && <span className={cn('rounded-full bg-primary', full ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5')} />}
              </span>
              {full ? (
                <span className="mt-2 text-center">
                  <span
                    className={cn(
                      'block text-xs',
                      s.state === 'current' ? 'font-semibold text-primary' : s.state === 'won' ? 'font-semibold text-spark-ink' : 'text-ink',
                      (s.state === 'upcoming' || s.state === 'skipped') && 'text-ink-muted',
                    )}
                  >
                    {s.label}
                  </span>
                  {s.state === 'skipped' && <span className="block text-xs text-ink-muted">{s.note || 'Skipped'}</span>}
                  {s.state !== 'skipped' && s.note && (
                    <span className={cn('block text-xs', s.state === 'current' ? 'text-ink' : 'text-ink-muted')}>{s.note}</span>
                  )}
                  {s.state !== 'skipped' && s.date && <span className="tabular block text-xs text-ink-muted">{dateText(s.date)}</span>}
                  <span className="sr-only"> ({STATE_TEXT[s.state]})</span>
                </span>
              ) : (
                <span className="sr-only">
                  {s.label} ({STATE_TEXT[s.state]})
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {!full && current && (
        <p className="mt-2 text-sm text-ink">
          <span className={cn('font-medium', current.state === 'won' ? 'text-spark-ink' : 'text-primary')}>{current.label}</span>
          {(current.note || current.date) && (
            <span className="text-ink-muted"> · {current.note || dateText(current.date)}</span>
          )}
        </p>
      )}
    </div>
  );
}
