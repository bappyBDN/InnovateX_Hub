import i18n from '@/i18n';

const locale = () => ((i18n.language || 'en').startsWith('bn') ? 'bn-BD' : 'en-GB');

/** "BDT 150,000" */
export function money(amount: number | null | undefined, currency = 'BDT'): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  const n = new Intl.NumberFormat(locale(), { maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  return `${currency} ${n}`;
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** pct(64) → "64%"; pct(0.64, true) → "64%" */
export function pct(value: number | null | undefined, isRatio = false, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${num(isRatio ? value * 100 : value, digits)}%`;
}

/** "METHODOLOGY_SUBMITTED" → "Methodology submitted" (translated when a key exists). */
export function statusLabel(code: string | null | undefined): string {
  if (!code) return '';
  const key = `status.${code}`;
  if (i18n.exists(key)) return i18n.t(key);
  const s = code.replace(/[_-]+/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

export function fileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
