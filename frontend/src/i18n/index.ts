import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

const LANG_KEY = 'ix.lang'; // language choice only — not personal data

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'bn') return saved;
  } catch {
    /* ignore */
  }
  return 'en';
}

// Feature areas keep their own files: src/i18n/extra/<area>.en.json and <area>.bn.json.
// Each file is one object whose top-level key is the area name, e.g. { "teams": { "leave": "Leave team" } }.
// English (the fallback) is part of the app; Bangla is a separate file that is only downloaded when it is chosen,
// so English users don't download every Bangla text on their first visit.
type Bundle = Record<string, unknown>;
const englishExtras = import.meta.glob<{ default: Bundle }>('./extra/*.en.json', { eager: true });
const banglaExtras = import.meta.glob<{ default: Bundle }>('./extra/*.bn.json');

function english(): Bundle {
  const out: Bundle = { ...en };
  for (const mod of Object.values(englishExtras)) Object.assign(out, mod.default);
  return out;
}

let banglaLoading: Promise<void> | null = null;
function loadBangla(): Promise<void> {
  banglaLoading ??= (async () => {
    const [base, ...parts] = await Promise.all([import('./bn.json'), ...Object.values(banglaExtras).map((load) => load())]);
    const out: Bundle = { ...(base.default as Bundle) };
    for (const mod of parts) Object.assign(out, mod.default);
    i18n.addResourceBundle('bn', 'translation', out, true, true);
  })();
  return banglaLoading;
}

const wanted = initialLanguage();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: english() } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Resolves once the saved language is ready, so the first screen is already in the right language. */
export const i18nReady: Promise<void> =
  wanted === 'bn'
    ? loadBangla()
        .then(() => i18n.changeLanguage('bn'))
        .then(() => undefined)
        .catch(() => undefined) // offline or blocked: stay in English
    : Promise.resolve();

function applyLang(lng: string) {
  document.documentElement.lang = lng;
}
applyLang(i18n.language);
i18n.on('languageChanged', (lng) => {
  applyLang(lng);
  try {
    localStorage.setItem(LANG_KEY, lng);
  } catch {
    /* ignore */
  }
});

export async function setLanguage(lng: string) {
  if (lng !== 'en' && lng !== 'bn') return;
  if (lng === 'bn') await loadBangla();
  await i18n.changeLanguage(lng);
}

export default i18n;
