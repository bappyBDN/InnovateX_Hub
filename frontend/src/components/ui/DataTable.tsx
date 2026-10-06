import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { EmptyState, Skeleton } from './Feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell content; defaults to `row[key]`. */
  render?: (row: T) => ReactNode;
  /** Makes the column sortable. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hide this column in the phone card layout. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  /** Shown when there are no rows. */
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  rowClassName?: (row: T) => string | undefined;
  caption?: string;
  className?: string;
}

function cell<T>(col: Column<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  const v = (row as Record<string, unknown>)[col.key];
  return v == null ? '—' : String(v);
}

/** Sortable table on tablet/desktop; each row becomes a card under 768px (spec §13.6). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  initialSort,
  rowClassName,
  caption,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sort, setSort] = useState(initialSort ?? null);

  const sorted = useMemo(() => {
    const list = rows ?? [];
    if (!sort) return list;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return list;
    const get = col.sortValue;
    return [...list].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-label={t('common.loading')}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (!sorted.length) {
    return <>{typeof empty === 'string' || empty == null ? <EmptyState title={empty ?? t('common.noResults')} /> : empty}</>;
  }

  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  const activate = (row: T) => onRowClick?.(row);

  return (
    <div className={className}>
      {/* Tablet / desktop */}
      <div className="hidden overflow-x-auto rounded-panel border border-line bg-surface md:block">
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line text-ink-muted">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('px-4 py-3 font-medium', align(c.align), c.className)}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => activate(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' && e.target === e.currentTarget) activate(row);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  'border-b border-line last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-primary-soft/50',
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle text-ink', align(c.align), c.className)}>
                    {cell(c, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: cards */}
      <ul className="space-y-3 md:hidden">
        {sorted.map((row) => (
          <li key={rowKey(row)}>
            <div
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => activate(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) activate(row);
                    }
                  : undefined
              }
              className={cn('rounded-panel border border-line bg-surface p-4', rowClassName?.(row))}
            >
              <dl className="space-y-2">
                {columns
                  .filter((c) => !c.hideOnMobile)
                  .map((c) => (
                    <div key={c.key} className="flex items-start justify-between gap-4 text-sm">
                      <dt className="shrink-0 text-ink-muted">{c.header}</dt>
                      <dd className="min-w-0 text-right text-ink">{cell(c, row)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
