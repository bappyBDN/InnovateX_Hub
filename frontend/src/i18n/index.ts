import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import bn from './bn.json';
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
type Bundle = Record<string, unknown>;
const extras = import.meta.glob<{ default: Bundle }>('./extra/*.json', { eager: true });
function withExtras(base: Bundle, lang: 'en' | 'bn'): Bundle {
  const out: Bundle = { ...base };
  for (const [file, mod] of Object.entries(extras)) {
    if (file.endsWith(`.${lang}.json`)) Object.assign(out, mod.default);
  }
  return out;
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: withExtras(en, 'en') }, bn: { translation: withExtras(bn, 'bn') } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

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

export function setLanguage(lng: 'en' | 'bn') {
  void i18n.changeLanguage(lng);
}

export default i18n;
