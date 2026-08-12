import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Dezentes App-Chrome-Overlay (unten rechts):
// - Offline-Anzeige (nur sichtbar, wenn die Verbindung weg ist)
// - Sprachumschalter DE/EN (i18n-Gerüst, siehe docs/i18n.md)
// Bewusst als Overlay umgesetzt, damit keine bestehende Komponente
// (NetworkDashboard & Co.) angefasst werden muss.
function AppChrome() {
  const { t, i18n } = useTranslation();
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return (
    <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 text-xs">
      {!online && (
        <span className="rounded-full bg-amber-600 px-3 py-1 font-medium text-white shadow-lg">
          📶 {t('app.offline')}
        </span>
      )}
      <span className="flex overflow-hidden rounded-full bg-slate-700/80 text-white shadow-lg backdrop-blur">
        {(['de', 'en'] as const).map((lng) => (
          <button
            key={lng}
            type="button"
            aria-label={`${t('app.language')}: ${lng.toUpperCase()}`}
            onClick={() => void i18n.changeLanguage(lng)}
            className={`px-2.5 py-1 uppercase tracking-wide transition-colors ${
              i18n.language === lng ? 'bg-blue-600 font-semibold' : 'hover:bg-slate-600'
            }`}
          >
            {lng}
          </button>
        ))}
      </span>
    </div>
  );
}

export default AppChrome;
