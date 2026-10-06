import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { getServerOffsetMs } from '@/api/client';
import i18n from '@/i18n';

export function useDebounce<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Saves `value` after it stops changing for `delayMs` (spec §14.2).
 * Pass `undefined` as value (or enabled=false) to pause. The first value is treated as already saved.
 */
export function useAutosave<T>(
  value: T | undefined,
  save: (v: T) => Promise<unknown>,
  delayMs = 5000,
  enabled = true,
): AutosaveStatus {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const debounced = useDebounce(value, delayMs);
  const saveRef = useRef(save);
  saveRef.current = save;
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || debounced === undefined) return;
    const snapshot = JSON.stringify(debounced);
    if (lastSaved.current === null) {
      lastSaved.current = snapshot; // initial load, nothing to save
      return;
    }
    if (snapshot === lastSaved.current) return;
    let cancelled = false;
    setStatus('saving');
    saveRef
      .current(debounced)
      .then(() => {
        lastSaved.current = snapshot;
        if (!cancelled) setStatus('saved');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, enabled]);

  return status; // shown as "Saving…", "Saved ✓", "Couldn't save — retrying"
}

/** Current time corrected by the server clock; re-renders every `tickMs`. */
export function useServerTime(tickMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date(Date.now() + getServerOffsetMs()));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date(Date.now() + getServerOffsetMs())), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

/** Warns before leaving (route change or tab close) while `dirty` is true. Needs the data router. */
export function useUnsavedChangesGuard(dirty: boolean, message?: string): void {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const ok = window.confirm(message ?? i18n.t('common.unsavedChanges'));
    if (ok) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
