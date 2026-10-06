import { formatDistanceStrict } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { getServerOffsetMs } from '@/api/client';

export const DISPLAY_TZ = import.meta.env.VITE_DISPLAY_TIMEZONE || 'Asia/Dhaka';

export type DateInput = string | number | Date | null | undefined;

/** Server datetimes are ISO UTC strings ending in "Z"; date-only values are "YYYY-MM-DD". */
export function parseServerDate(v: DateInput): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return new Date(v);
  let s = v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  else if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "20 Nov 2026, 5:00 PM" in the display timezone (Asia/Dhaka by default). */
export function formatDateTime(v: DateInput, fallback = '—'): string {
  const d = parseServerDate(v);
  return d ? formatInTimeZone(d, DISPLAY_TZ, 'd MMM yyyy, h:mm a') : fallback;
}

/** "20 Nov 2026" */
export function formatDate(v: DateInput, fallback = '—'): string {
  const d = parseServerDate(v);
  return d ? formatInTimeZone(d, DISPLAY_TZ, 'd MMM yyyy') : fallback;
}

/** "20 Nov" — short form for rails and cards. */
export function formatDayMonth(v: DateInput, fallback = ''): string {
  const d = parseServerDate(v);
  return d ? formatInTimeZone(d, DISPLAY_TZ, 'd MMM') : fallback;
}

/** "2026-11-20" in the display timezone, e.g. to group items by day. */
export function dayKey(v: DateInput): string {
  const d = parseServerDate(v);
  return d ? formatInTimeZone(d, DISPLAY_TZ, 'yyyy-MM-dd') : '';
}

/** Current time corrected by the server clock offset. */
export function serverNow(): Date {
  return new Date(Date.now() + getServerOffsetMs());
}

/** "in 2 days" / "3 hours ago" */
export function relativeFromNow(v: DateInput, fallback = ''): string {
  const d = parseServerDate(v);
  if (!d) return fallback;
  const now = serverNow();
  const dist = formatDistanceStrict(d, now);
  return d.getTime() >= now.getTime() ? `in ${dist}` : `${dist} ago`;
}

/** "2d 4h", "5h 12m", "8m" — for countdowns. Returns null once the time has passed. */
export function countdownParts(v: DateInput, now: Date = serverNow()): { text: string; msLeft: number } | null {
  const d = parseServerDate(v);
  if (!d) return null;
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const text = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${m}m` : `${Math.max(m, 1)}m`;
  return { text, msLeft: ms };
}

/** Value for <input type="datetime-local"> in the browser's local time. */
export function toLocalInputValue(v: DateInput): string {
  const d = parseServerDate(v);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts a datetime-local input value back to an ISO UTC string for the API. */
export function fromLocalInputValue(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
