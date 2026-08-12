# Produktions-Backend: PostgreSQL, Passwort-Hashes, LDAP/OAuth2

Konkretisierung der README-Aufgabe „echte Nutzer-DB + Passwort-Hashes,
WebAuthn für L3+/L5“. Das Backend liegt in `server/` (REST :5000, Terminal :8765, Discovery :8766, Status :8767). Für Produktion zusätzlich:
hier das vollständige Integrations-Blueprint inkl. `deploy/.env.example`.

Bisheriger Stand (README): SQLite (`data.db`) für Geräte/Clients/Pairings/
Audit, In-Memory-Nutzer, WebAuthn-Challenge ohne Credential-DB.

---

## 1. PostgreSQL via SQLAlchemy

```bash
pip install "sqlalchemy>=2.0" psycopg[binary] alembic
```

```python
# server/db.py — Drop-in für die bestehende Persistenzschicht
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Mapped, mapped_column

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "sqlite:///data.db",  # Dev-Fallback bleibt SQLite
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    password_hash: Mapped[str]          # argon2id, NIEMALS Klartext
    role: Mapped[str]                   # guest|operator|service|developer|expert|emergency
    enabled: Mapped[bool] = True

class WebAuthnCredential(Base):
    __tablename__ = "webauthn_credentials"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(index=True)
    credential_id: Mapped[bytes] = mapped_column(unique=True)   # rawId
    public_key: Mapped[bytes]               # COSE
    sign_count: Mapped[int] = 0             # Replay-/Clone-Schutz
```

```bash
# Migration (ersetzt manuelles Schema-Werk)
alembic init migrations && alembic revision --autogenerate -m "init" && alembic upgrade head
```

**Migration SQLite → PostgreSQL** (Bestandsinstallation):

```bash
pgloader sqlite://data.db postgresql://nexus:***@db:5432/nexus
# danach DATABASE_URL umschalten, App neu starten, data.db als Backup behalten
```

## 2. Passwort-Hashes (Login)

```bash
pip install "passlib[argon2]"
```

```python
from passlib.hash import argon2
# beim Anlegen:   user.password_hash = argon2.hash(plain)
# beim Login:     argon2.verify(plain, user.password_hash)
```

- Login-Limiter (`rate_limiter.py`, `RATE_MAX_HITS`/`RATE_WINDOW`) bleibt davor.
- JWT-Secret: `SECRET_KEY` per ENV (nie im Repo), Rotation überlappt ausrollen.

## 3. WebAuthn vollständig (L3+/L5-Pflicht)

```bash
pip install fido2
```

1. Registrierung: Attestation prüfen, `credential_id` + `public_key` +
   `sign_count` in `webauthn_credentials` speichern.
2. Kritische Aktion (`device.delete`, `pairing.delete`, `client.server`,
   `client.kick`): `POST /api/webauthn/challenge` → Assertion → Server prüft
   Signatur `sign_count` strikt ansteigend → einmaliges `X-WebAuthn-Token`.
3. Alles in den Audit-Trail (`trace_id`-Kette), Tokens einmalig (Replay-Schutz
   ist laut README bereits vorhanden — Credential-DB schließt die Lücke).

## 4. LDAP (Unternehmensverzeichnis)

```bash
pip install python-ldap
```

```python
import ldap
def authenticate_ldap(email: str, password: str) -> str | None:
    conn = ldap.initialize(os.environ["LDAP_URI"])           # ldaps://...:636
    conn.set_option(ldap.OPT_X_TLS_REQUIRE_CERT, ldap.OPT_X_TLS_DEMAND)
    dn = f"uid={email.split('@')[0]},ou=people,{os.environ['LDAP_BASE_DN']}"
    try:
        conn.simple_bind_s(dn, password)                     # Bind = Passwortcheck
    except ldap.INVALID_CREDENTIALS:
        return None
    groups = [g.decode() for g in
              conn.search_s(os.environ["LDAP_GROUP_DN"], ldap.SCOPE_SUBTREE,
                            f"(member={dn})", ["cn"])[0][1]["cn"]]
    return map_groups_to_role(groups)                        # → RBAC-Rolle
```

Rollenmapping (Beispiel): `cn=nexus-developers` → `developer`,
`cn=nexus-service` → `service`. Fallback-Rolle `guest`, nie andersherum.

## 5. OAuth2 / OIDC (SSO)

```bash
pip install authlib
```

```python
from authlib.integrations.flask_client import OAuth
oauth = OAuth(app)
oauth.register(
    "sso",
    client_id=os.environ["OAUTH_CLIENT_ID"],
    client_secret=os.environ["OAUTH_CLIENT_SECRET"],
    server_metadata_url=os.environ["OAUTH_ISSUER"] + "/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile groups"},
)
# Callback: id_token-Claims -> E-Mail + Gruppen -> map_groups_to_role() -> eigenes JWT
```

Die App bleibt Session-Anbieter (eigenes JWT); OIDC liefert nur Identität +
Gruppen. Anbieter-Beispiele: Keycloak, Entra ID, Authentik.

## 6. Übergabepunkte (was sich NICHT ändert)

| Vertrag | bleibt |
|---|---|
| REST-Fläche | `docs/openapi.yaml` (unverändert) |
| WS-Fläche | `docs/api-websockets.md` (unverändert) |
| RBAC-Matrix | `guest < operator < service < developer < expert < emergency`, serverseitig |
| Clients | Web-App, APK, Desktop-Konsole – keine Client-Änderungen nötig |

Alle Umgebungsvariablen: **[`deploy/.env.example`](../deploy/.env.example)**.
