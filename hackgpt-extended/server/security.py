"""
NEXUS-BUILDER v2.2 — Sicherheitskonfiguration (SECRET_KEY-Handling)
====================================================================
Produktionsreife:
  - In Produktion (APP_ENV=production) MUSS SECRET_KEY als Umgebungsvariable
    gesetzt sein (min. 32 Zeichen, nicht der Default). Fehlt er, startet der
    Dienst NICHT (fail-fast) — es gibt keinen unsicheren Fallback.
  - In Entwicklung/Test wird bei fehlendem Key ein zufälliger Sitzungs-Key
    erzeugt (Warnung im Log). Ein Neustart invalidiert dann alle Tokens.
"""
import logging
import os
import secrets

log = logging.getLogger("security")

LEGACY_DEFAULT = "ChangeMe-In-Production"
MIN_SECRET_LEN = 32

# Cache je (Env-Wert, Modus): ein einmal erzeugter Sitzungs-Key bleibt pro
# Prozess stabil (sonst würde jede get_secret_key()-Antwort in Dev ohne Env
# einen NEUEN Key erzeugen und JWT/Grants wären sofort ungültig).
_CACHE: tuple[tuple[str, str], str] | None = None  # ((env_key, mode), key)


def app_env() -> str:
    return os.getenv("APP_ENV", "development").strip().lower() or "development"


def is_production() -> bool:
    return app_env() == "production"


def get_secret_key() -> str:
    """Liefert den SECRET_KEY für JWT-Signierung (single source of truth)."""
    global _CACHE
    env_key = os.getenv("SECRET_KEY", "").strip()
    mode = app_env()
    if _CACHE is not None and _CACHE[0] == (env_key, mode):
        return _CACHE[1]
    if env_key and env_key != LEGACY_DEFAULT and len(env_key) >= MIN_SECRET_LEN:
        key = env_key
    elif is_production():
        raise RuntimeError(
            "SECRET_KEY muss in Produktion (APP_ENV=production) gesetzt sein "
            f"(min. {MIN_SECRET_LEN} Zeichen, nicht der Default). "
            "Abbruch — kein unsicherer Default im Produktivbetrieb."
        )
    elif env_key and env_key != LEGACY_DEFAULT:
        # Entwicklung/Test: kürzere Keys (z. B. Test-Suite) sind ok.
        key = env_key
    elif not env_key:
        key = secrets.token_urlsafe(48)
        log.warning("SECRET_KEY nicht gesetzt — zufälliger Sitzungs-Key erzeugt (nur Entwicklung/Test!)")
    else:
        key = env_key
        log.warning("SECRET_KEY ist der unsichere Default — bitte vor Produktion setzen!")
    _CACHE = ((env_key, mode), key)
    return key
