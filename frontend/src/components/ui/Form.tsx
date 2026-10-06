import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Extra text on the right of the label row, e.g. a character counter. */
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** Label above, help text, error text, required mark. Wires ids/aria onto a single child control. */
export function Field({ label, help, error, required, hint, htmlFor, className, children }: FieldProps) {
  const { t } = useTranslation();
  const auto = useId();
  const id = htmlFor ?? auto;
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined;

  let control = children;
  if (isValidElement(children) && typeof children.type !== 'symbol') {
    const el = children as ReactElement<Record<string, unknown>>;
    control = cloneElement(el, {
      id: (el.props.id as string | undefined) ?? id,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
      'aria-required': required || undefined,
    });
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
          {required && (
            <>
              <span className="ml-0.5 text-danger" aria-hidden>
                *
              </span>
              <span className="sr-only"> ({t('common.required')})</span>
            </>
          )}
        </label>
        {hint && <span className="tabular text-xs text-ink-muted">{hint}</span>}
      </div>
      {control}
      {help && (
        <p id={helpId} className="text-sm text-ink-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errId} className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn('control', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn('control resize-y', className)} {...rest} />;
});

export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: SelectOption[];
  placeholder?: string;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, placeholder, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn('control pr-8', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input
        ref={ref}
        id={cid}
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--primary))]"
        {...rest}
      />
      <label htmlFor={cid} className="text-sm text-ink">
        {label}
        {description && <span className="mt-0.5 block text-ink-muted">{description}</span>}
      </label>
    </div>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <span id={id} className="text-sm text-ink">
        {label}
        {description && <span className="mt-0.5 block text-ink-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-line',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}
