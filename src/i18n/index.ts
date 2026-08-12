import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './locales/de.json';
import en from './locales/en.json';

// i18n-Gerüst (Punkt 5 der Produktiv-Roadmap):
// Ressourcen liegen gebündelt als JSON im Source (resolveJsonModule).
// Rollout-Anleitung für weitere Komponenten: docs/i18n.md
const STORAGE_KEY = 'dingelschwing.lang';

function initialLanguage(): string {
  if (typeof localStorage === 'undefined') return 'de';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'de' ? stored : 'de';
}

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
  },
  lng: initialLanguage(),
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* privater Modus o. ä. – Sprache bleibt flüchtig */
  }
});

export default i18n;
