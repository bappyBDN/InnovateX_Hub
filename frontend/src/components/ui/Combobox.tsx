import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/utils/cn';

export interface ComboOption {
  value: string;
  label: string;
  /** Second line in the list, e.g. job title. */
  hint?: string | null;
  /** Indent level (sub-units). */
  depth?: number;
}

export interface ComboboxProps {
  options: ComboOption[];
  /** The chosen option's value, or '' when nothing (or a typed value) is chosen. */
  value: string;
  /** Text typed for a new value (only with `allowCreate`). */
  typed?: string;
  onChange: (value: string, typed: string) => void;
  placeholder?: string;
  /** Let the person keep a value that is not in the list. */
  allowCreate?: boolean;
  createLabel?: (text: string) => string;
  /** Extra action at the end of the list (e.g. "+ Add new user"). */
  extraAction?: { label: string; onSelect: () => void };
  /** Called while typing (for searching on the server). */
  onSearch?: (text: string) => void;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** A text box with a filtered list under it: type to search, arrows + Enter to choose, Escape to close. */
export function Combobox({
  options,
  value,
  typed = '',
  onChange,
  placeholder,
  allowCreate,
  createLabel = (s) => `+ "${s}"`,
  extraAction,
  onSearch,
  emptyText,
  disabled,
  loading,
  id,
  ...aria
}: ComboboxProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const listId = `${inputId}-list`;
  const chosen = options.find((o) => o.value === value) ?? null;
  const [text, setText] = useState(chosen?.label ?? typed);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  // Keep the box in step when the value changes from outside (e.g. a new SBU clears the department).
  useEffect(() => {
    if (chosen) setText(chosen.label);
    else if (allowCreate) setText((cur) => (cur.trim() === typed ? cur : typed));
    else setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.label, typed]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const q = text.trim().toLowerCase();
  const filtered = useMemo(
    () => (onSearch || !q || chosen?.label.toLowerCase() === q ? options : options.filter((o) => o.label.toLowerCase().includes(q))),
    [options, q, onSearch, chosen?.label],
  );
  const exact = options.some((o) => o.label.toLowerCase() === q);
  type Item = { kind: 'option'; option: ComboOption } | { kind: 'create' } | { kind: 'extra' };
  const items: Item[] = [
    ...filtered.slice(0, 50).map((option) => ({ kind: 'option' as const, option })),
    ...(allowCreate && q && !exact ? [{ kind: 'create' as const }] : []),
    ...(extraAction ? [{ kind: 'extra' as const }] : []),
  ];

  const pick = (item: Item) => {
    if (item.kind === 'option') {
      onChange(item.option.value, '');
      setText(item.option.label);
    } else if (item.kind === 'create') {
      onChange('', text.trim());
    } else {
      extraAction?.onSelect();
    }
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && items[active]) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const clear = () => {
    setText('');
    onChange('', '');
    onSearch?.('');
  };

  return (
    <div ref={wrap} className="relative">
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className="control pr-16"
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          // Without "new value", leaving the box without picking puts the chosen option back.
          if (!allowCreate) setText(chosen?.label ?? '');
        }}
        onKeyDown={onKey}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          onSearch?.(e.target.value);
          // With "new value" the typed text is the value until an option is picked.
          if (allowCreate) onChange('', e.target.value.trim());
        }}
        {...aria}
      />
      <span className="absolute inset-y-0 right-2 flex items-center gap-1 text-ink-muted">
        {text && !disabled && (
          <button type="button" onClick={clear} className="rounded p-1 hover:bg-neutral-soft" aria-label="Clear" tabIndex={-1}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </span>
      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-lg"
        >
          {loading && <li className="px-3 py-2 text-sm text-ink-muted">…</li>}
          {!loading && items.length === 0 && emptyText && <li className="px-3 py-2 text-sm text-ink-muted">{emptyText}</li>}
          {items.map((item, i) => (
            <li
              key={item.kind === 'option' ? item.option.value : item.kind}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={item.kind === 'option' && item.option.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              className={cn(
                'flex cursor-pointer items-start gap-2 px-3 py-2 text-sm',
                i === active ? 'bg-primary-soft' : '',
                item.kind !== 'option' && 'border-t border-line font-medium text-primary',
              )}
              style={item.kind === 'option' && item.option.depth ? { paddingLeft: `${12 + item.option.depth * 16}px` } : undefined}
            >
              {item.kind === 'option' ? (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{item.option.label}</span>
                    {item.option.hint && <span className="block truncate text-xs text-ink-muted">{item.option.hint}</span>}
                  </span>
                  {item.option.value === value && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />}
                </>
              ) : (
                <>
                  <Plus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{item.kind === 'create' ? createLabel(text.trim()) : extraAction?.label}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
