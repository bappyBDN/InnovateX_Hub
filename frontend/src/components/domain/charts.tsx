/** Small dependency-free charts: one hue (primary), direct text labels, readable without colour. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { num } from '@/utils/format';

export interface ChartDatum {
  label: string;
  value: number;
  /** Extra text after the value, e.g. "12%". */
  hint?: string;
}

interface ChartFrameProps {
  title?: ReactNode;
  /** One sentence with the key number, shown above the chart (spec §11.2). */
  summary?: ReactNode;
  className?: string;
  children: ReactNode;
}

function ChartFrame({ title, summary, className, children }: ChartFrameProps) {
  return (
    <figure className={cn('space-y-3', className)}>
      {(title || summary) && (
        <figcaption>
          {title && <p className="font-semibold text-ink">{title}</p>}
          {summary && <p className="text-sm text-ink-muted">{summary}</p>}
        </figcaption>
      )}
      {children}
    </figure>
  );
}

export interface BarChartProps extends Omit<ChartFrameProps, 'children'> {
  data: ChartDatum[];
  format?: (n: number) => string;
  /** Scale maximum; defaults to the largest value. */
  maxValue?: number;
  emptyText?: string;
}

/** Horizontal bars with the label on the left and the value on the right. */
export function BarChart({ data, format = (n) => num(n), maxValue, emptyText = 'No data yet.', ...frame }: BarChartProps) {
  const max = maxValue ?? Math.max(0, ...data.map((d) => d.value));
  return (
    <ChartFrame {...frame}>
      {data.length === 0 ? (
        <p className="text-sm text-ink-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {data.map((d) => (
            <li key={d.label} className="grid grid-cols-[minmax(90px,30%)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-ink" title={d.label}>
                {d.label}
              </span>
              <span className="h-3 overflow-hidden rounded-full bg-neutral-soft" aria-hidden>
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${max > 0 ? Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0) : 0}%` }}
                />
              </span>
              <span className="tabular min-w-[2.5rem] text-right font-medium text-ink">
                {format(d.value)}
                {d.hint && <span className="ml-1 font-normal text-ink-muted">{d.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}

export interface FunnelChartProps extends Omit<ChartFrameProps, 'children'> {
  /** In order, e.g. Registered → Methodology → Shortlisted → Winner. */
  stages: ChartDatum[];
  format?: (n: number) => string;
}

/** Funnel: each stage is a centred bar sized against the first stage, with conversion from the stage before. */
export function FunnelChart({ stages, format = (n) => num(n), ...frame }: FunnelChartProps) {
  const top = stages[0]?.value ?? 0;
  return (
    <ChartFrame {...frame}>
      <ol className="space-y-1.5">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1].value : null;
          const conv = prev ? Math.round((s.value / prev) * 100) : null;
          const width = top > 0 ? Math.max((s.value / top) * 100, 8) : 8;
          return (
            <li key={s.label} className="grid grid-cols-[minmax(90px,28%)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-ink" title={s.label}>
                {s.label}
              </span>
              <span className="flex justify-center" aria-hidden>
                <span className="block h-7 rounded-control bg-primary" style={{ width: `${width}%`, opacity: 1 - i * 0.08 }} />
              </span>
              <span className="tabular min-w-[5rem] text-right">
                <span className="font-medium text-ink">{format(s.value)}</span>
                {conv != null && <span className="ml-1 text-ink-muted">({conv}%)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}

export interface StatTileProps {
  label: ReactNode;
  /** Hero number (2rem). */
  value: ReactNode;
  hint?: ReactNode;
  /** Use the spark colour — only for rewards / winners. */
  spark?: boolean;
  to?: string;
  className?: string;
}

/** Dashboard hero number. */
export function StatTile({ label, value, hint, spark, to, className }: StatTileProps) {
  const body = (
    <>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={cn('tabular mt-1 text-[2rem] font-semibold leading-tight', spark ? 'text-spark-ink' : 'text-ink')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
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
