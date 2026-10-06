const KEY = 'ix.theme'; // display preference only

export type Theme = 'light' | 'dark';

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'InnovateX Hub';
