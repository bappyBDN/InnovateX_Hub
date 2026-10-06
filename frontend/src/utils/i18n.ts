import i18n from '@/i18n';

export type I18nText = Record<string, string | null | undefined> | string | null | undefined;

/** Picks the current language from a backend `_i18n` object, falling back to English. */
export function tr(obj: I18nText, fallback = ''): string {
  if (obj == null) return fallback;
  if (typeof obj === 'string') return obj || fallback;
  const lang = (i18n.language || 'en').slice(0, 2);
  return obj[lang] || obj.en || Object.values(obj).find((v): v is string => !!v) || fallback;
}

/** True when the value is shown in English because no translation exists for the current language. */
export function isFallbackLanguage(obj: I18nText): boolean {
  if (obj == null || typeof obj === 'string') return false;
  const lang = (i18n.language || 'en').slice(0, 2);
  return lang !== 'en' && !obj[lang] && !!obj.en;
}
