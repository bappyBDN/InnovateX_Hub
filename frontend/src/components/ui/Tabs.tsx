import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
}

/** Controlled tab bar (arrow-key navigation). Render the active panel yourself below it. */
export function Tabs({ tabs, value, onChange, ariaLabel, className }: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    let j = i;
    for (let n = 0; n < tabs.length; n++) {
      j = (j + dir + tabs.length) % tabs.length;
      if (!tabs[j].disabled) break;
    }
    onChange(tabs[j].value);
    refs.current[j]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
    >
      {tabs.map((tab, i) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              '-mb-px inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors duration-150 disabled:opacity-50',
              active ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="tabular rounded-full bg-neutral-soft px-2 py-0.5 text-xs text-ink-muted">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
