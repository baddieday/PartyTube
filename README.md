# PartyTube

PartyTube ist eine lokale Party-Jukebox fuer YouTube im Heimnetz. Gaeste oeffnen einfach den Browser, werfen Songs in die Queue, voten live und sehen sofort, was gerade laeuft. Der Host bekommt dazu eine sichere Admin-Konsole, eine Startseite fuer den Abend und getrennte TV-/Audio-Modi.

## Highlights

- FastAPI + SQLite + Vanilla JS, bewusst einfach und lokal betreibbar
- Live-Queue und Chat per WebSocket
- robuste YouTube-Linkerkennung fuer `watch`, `youtu.be`, `shorts`, `embed` und direkte IDs
- Duplicate-Erkennung, Vote-Limits, Rate-Limits und Moderationsfunktionen
- Invite-only-Modus mit `/join/{party_code}`
- echte Admin-Session statt statischem Cookie
- CSRF-Schutz fuer Admin-Schreibaktionen
- geschuetzter Player-Token fuer `/api/player/ended`
- Startseite fuer Hosts mit QR, Links, Warnungen und Audio+TV-Launch
- separates Audio-Deck gegen Tonabbrueche beim Tabwechsel
- TV-Modus mit Video, Audio-Modus mit Ton
- optionales Autoplay aus dem lokalen Party-Verlauf
- PWA-/Homescreen-Basis mit Manifest, Icons und Service Worker
- Playwright-E2E, Accessibility-Checks, Load-/Persistence-Tests

## Architektur

- Backend: FastAPI + Uvicorn
- Datenhaltung: SQLite mit WAL
- Frontend: serverseitige Jinja-Templates + Vanilla JS + CSS
- Realtime: WebSocket-Broadcast fuer Queue-, Chat- und Runtime-Updates
- QR-Codes: lokal generierte SVGs
- Observability: optionaler `/metrics`-Endpoint im Prometheus-Format

Warum diese Architektur:

- Ein einzelner Service ist fuer LAN-Partys leichter zu starten, zu debuggen und zu sichern.
- SQLite reicht fuer den lokalen Mehrbenutzerfall aus und ueberlebt Neustarts sauber.
- Kein Build-heavy Frontend senkt die Ausfallflaeche vor einer Party.

## Projektstruktur

```text
.
├─ app/
│  ├─ config.py
│  ├─ main.py
│  ├─ metrics.py
│  ├─ qr.py
│  ├─ security.py
│  ├─ storage.py
│  ├─ youtube.py
│  ├─ static/
│  │  ├─ css/styles.css
│  │  ├─ img/
│  │  ├─ js/
│  │  ├─ vendor/axe.min.js
│  │  └─ sw.js
│  └─ templates/
├─ deploy/Caddyfile.example
├─ scripts/
│  ├─ generate-icons.mjs
│  └─ start-test-server.mjs
├─ tests/
│  ├─ accessibility.spec.ts
│  ├─ admin.spec.ts
│  ├─ audio.spec.ts
│  ├─ autoplay.spec.ts
│  ├─ chat.spec.ts
│  ├─ guest.spec.ts
│  ├─ load.spec.ts
│  ├─ multiuser.spec.ts
│  ├─ persistence.spec.ts
│  ├─ player.spec.ts
│  ├─ qr.spec.ts
│  ├─ security.spec.ts
│  ├─ start.spec.ts
│  └─ voting.spec.ts
├─ .github/
│  ├─ dependabot.yml
│  └─ workflows/
├─ Dockerfile
├─ Dockerfile.tests
├─ docker-compose.yml
├─ IMPLEMENTATION_NOTES.md
├─ SECURITY.md
├─ CONTRIBUTING.md
├─ CHANGELOG.md
└─ TEST_REPORT.md
```

## Quickstart mit Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Danach:

- Gastmodus: `http://192.168.178.77:8088/`
- Join-Link: `http://192.168.178.77:8088/join/party`
- Host-Startseite: `http://192.168.178.77:8088/start`
- Admin: `http://192.168.178.77:8088/admin`
- TV: `http://192.168.178.77:8088/player`
- Audio-Deck: `http://192.168.178.77:8088/audio`
- QR-Poster: `http://192.168.178.77:8088/qr`
- Health: `http://192.168.178.77:8088/health`

Testcontainer:

```bash
docker compose --profile tests run --rm tests
```

## Quickstart lokal

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PORT='8088'
uvicorn app.main:app --host 0.0.0.0 --port 8088
```

Linux/macOS:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PORT=8088 uvicorn app.main:app --host 0.0.0.0 --port 8088
```

## Host-Setup in unter 2 Minuten

1. `/admin` oeffnen und mit der Host-PIN einloggen.
2. Optional Party-Name, Party-Code, WLAN-Daten und Basis-URL pflegen.
3. `/start` oeffnen.
4. QR-Code oder Join-Link an die Gaeste geben.
5. `Audio + TV starten` benutzen.

Wichtig:

- Das Audio-Deck sollte auf dem Steuergeraet offen bleiben.
- Der TV-Tab zeigt im Regelfall nur das Video.
- Ohne Host-Login starten TV/Audio bewusst nur als oeffentliche Ansichten, nicht als steuerberechtigte Player.

## Admin-Login und Security-Hardening

Neu im geharteten Stand:

- echte serverseitige Admin-Session statt deterministischem Cookie
- Session-Cookie per `HttpOnly`, `SameSite=Lax`, `SESSION_COOKIE_SECURE` optional fuer HTTPS
- CSRF-Schutz fuer alle Admin-Schreibaktionen
- dedizierter Player-Token fuer `/api/player/ended`
- Warnungen bei Default-PIN und schwachem Secret
- optional `TRUSTED_HOSTS`
- optional `ENFORCE_HTTPS`

Empfohlene Mindesthaertung:

- `ADMIN_PIN` auf einen eigenen Wert setzen
- `SESSION_SECRET` auf einen langen Zufallswert setzen
- fuer Reverse Proxy / HTTPS:
  - `SESSION_COOKIE_SECURE=true`
  - `ENFORCE_HTTPS=true`
  - `TRUSTED_HOSTS=party.lokal,192.168.178.77`

## Wichtige ENV-Variablen

Siehe [\.env.example](/C:/Users/USER/Documents/YT_Site/.env.example). Die wichtigsten:

- `PORT`, `HOST_IP`, `BASE_URL`
- `PARTY_NAME`, `PARTY_CODE`
- `INVITE_ONLY_MODE`
- `ADMIN_PIN`
- `SESSION_SECRET`, `PLAYER_TOKEN_SECRET`
- `SESSION_COOKIE_SECURE`, `SESSION_MAX_AGE_SECONDS`
- `TRUSTED_HOSTS`, `ENFORCE_HTTPS`
- `WIFI_SSID`, `WIFI_PASSWORD`, `WIFI_SECURITY`, `WIFI_HIDDEN`
- `AUTOPLAY_ENABLED`
- `CHAT_ENABLED`, `VOTING_ENABLED`
- `MAX_QUEUE_ITEMS`, `MAX_SONGS_PER_DEVICE`
- `MAX_MESSAGE_LENGTH`, `CHAT_HISTORY_LIMIT`
- `MAX_ADDS_PER_WINDOW`, `MAX_VOTES_PER_WINDOW`, `MAX_MESSAGES_PER_WINDOW`
- `ENABLE_TITLE_LOOKUP`, `TITLE_LOOKUP_TIMEOUT_SECONDS`
- `ENABLE_METRICS`

## Invite-only-Modus

Wenn `INVITE_ONLY_MODE=true`:

- `/` zeigt die Join-Code-Seite statt direkt die Queue
- `/join/{party_code}` ist der echte Einstieg
- falsche Codes bekommen eine eigene, verstaendliche Fehlerseite

Wichtig fuer die Kommunikation:

- Der Party-Code ist ein Einladungslink, kein starkes Passwort.
- Fuer echte Internet-Freigabe reicht Invite-only allein nicht. Dann brauchst du HTTPS, sichere Secrets und einen Reverse Proxy.

## Player/TV-Modus und Audio-Fenster

### TV

- zeigt das Video gross an
- kann nach Reload wieder an die aktuelle Songposition andocken
- bleibt stumm, wenn das Audio-Deck aktiv ist

### Audio

- haelt den Ton in einem separaten Fenster stabil
- vermeidet Unterbrechungen beim Wechsel zwischen Queue, QR und Host
- meldet Song-Ende nur mit gueltigem Player-Token

### Autoplay-Hinweis

Browser und YouTube koennen Autoplay blockieren. In diesem Fall zeigt PartyTube klare Hinweise wie `Playback starten` oder `Audio starten`.

## Chat und Moderation

- Gaeste koennen kurze Nachrichten senden
- Nachrichten laufen live per WebSocket auf allen Geraeten
- Admin kann Nachrichten loeschen
- Admin kann Geraete ueber Song- oder Chat-Aktionen temporaer muten
- pro Geraet gelten Rate-Limits
- XSS wird durch serverseitige Bereinigung plus HTML-Escaping abgefangen

## QR-Code und WLAN

- `/qr` liefert eine druckbare Posteransicht
- auf Start-, Guest-, Admin- und TV-Seite erscheinen zusaetzlich kleine QR-Karten
- WLAN-QR wird automatisch erzeugt, sobald `WIFI_SSID` und passende WLAN-Daten gesetzt sind

## Metrics und Observability

Wenn `ENABLE_METRICS=true`, liefert `/metrics` Prometheus-kompatible Kennzahlen:

- aktive Songs
- sichtbare Chat-Nachrichten
- aktive WebSocket-Verbindungen
- Vote-/Song-/Chat-Zaehler
- Player-ended-Events
- API-Request-Metriken

Standardmaessig bleibt `/metrics` aus, damit die LAN-Oberflaeche klein und ruhig bleibt.

## Reverse Proxy mit Caddy

Ein Beispiel liegt in [deploy/Caddyfile.example](/C:/Users/USER/Documents/YT_Site/deploy/Caddyfile.example).

Typischer Betrieb:

- Caddy terminiert HTTPS
- PartyTube laeuft intern weiter auf `http://app:8088`
- `BASE_URL` und `TRUSTED_HOSTS` werden passend gesetzt
- `SESSION_COOKIE_SECURE=true`
- `ENFORCE_HTTPS=true`

## Lokale DNS-Namen

Empfehlung:

- `party.home.arpa` fuer standardnaehe lokale DNS-Namen
- `party.lokal` wenn du es bewusst im Heimnetz so verteilst

Moeglich mit:

- Pi-hole
- eigener DNS-Forwarder
- FRITZ!Box + lokaler DNS

Wichtig bei FRITZ!Box / IPv6:

- Clients bevorzugen haeufig den per Router Advertisement gelernten IPv6-DNS
- dein lokaler DNS sollte deshalb idealerweise auch ueber IPv6 erreichbar sein

## Backup und Restore

SQLite-Backup:

```bash
cp data/party.db backups/party-$(date +%F-%H%M).db
```

Restore:

```bash
cp backups/party-2026-05-19-2230.db data/party.db
```

Vor dem Restore am besten den Container bzw. Prozess kurz stoppen.

## Tests lokal

```bash
npm install
npm run test
```

Einzelne Suiten:

```bash
npm run test:security
npm run test:accessibility
npm run test:load
```

Abgedeckt sind:

- Guest-Flow
- Voting
- Admin-Flow
- Invite-only
- Chat
- Security fuer Session/CSRF/Player-Token
- Audio/TV/Start
- Persistenz
- Multiuser
- Load-/Fehlerfaelle
- Accessibility

## CI

- [\.github/workflows/ci.yml](/C:/Users/USER/Documents/YT_Site/.github/workflows/ci.yml)
- [\.github/workflows/codeql.yml](/C:/Users/USER/Documents/YT_Site/.github/workflows/codeql.yml)
- [\.github/dependabot.yml](/C:/Users/USER/Documents/YT_Site/.github/dependabot.yml)

CI macht:

- Python-Dependencies installieren
- Node/Playwright installieren
- App starten
- `/health` pruefen
- gesamte Playwright-Suite laufen lassen
- Report als Artifact hochladen

## Bekannte Grenzen

- YouTube-Autoplay bleibt browserabhaengig.
- Invite-only ist kein Ersatz fuer echtes Internet-Hardening.
- Titel- und Dauerermittlung ohne API-Key bleibt best effort.
- `party.local` kann in manchen Netzen mit mDNS kollidieren.

## Lizenz

MIT, siehe [LICENSE](/C:/Users/USER/Documents/YT_Site/LICENSE).
