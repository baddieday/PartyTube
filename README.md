# PartyTube

PartyTube ist eine lokale Party-Jukebox fuer YouTube im Heimnetz. Gaeste oeffnen einfach den Browser, werfen Songs in die Queue, voten live und sehen sofort, was gerade laeuft. Der Host bekommt dazu eine sichere Admin-Konsole, eine Startseite fuer den Abend und getrennte TV-/Audio-Modi.

## Highlights

- FastAPI + SQLite + Vanilla JS, bewusst einfach und lokal betreibbar
- Live-Queue und Chat per WebSocket
- robuste YouTube-Linkerkennung fuer `watch`, `youtu.be`, `shorts`, `embed` und direkte IDs
- Duplicate-Erkennung, Vote-Limits, Rate-Limits und Moderationsfunktionen
- demokratisches Song-Veto mit konfigurierbarer Skip-Schwelle
- Party-Verlauf mit Re-Add, JSON/CSV/Text-Export und Best-of-Abend
- QR-Party-Screen fuer TV/Beamer mit Join-Link, aktuellem Song und Queue-Vorschau
- Invite-only-Modus mit `/join/{party_code}`
- echte Admin-Session statt statischem Cookie
- CSRF-Schutz fuer Admin-Schreibaktionen
- geschuetzter Player-Token fuer `/api/player/ended`
- Startseite fuer Hosts mit QR, Links, Warnungen und Audio+TV-Launch
- separates Audio-Deck gegen Tonabbrueche beim Tabwechsel
- TV-Modus mit Video, Audio-Modus mit Ton
- optionales Autoplay aus dem lokalen Party-Verlauf
- PWA-/Homescreen-Basis mit Manifest, Icons und Service Worker
- Premium Red/Black UI mit Mobile-Guest-Deck, Admin-Dashboard und praesentationsreifem TV-/Party-Screen
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

## Premium Red/Black Design

PartyTube nutzt ein zentrales CSS-Designsystem in [styles.css](/C:/Users/USER/Documents/YT_Site/app/static/css/styles.css) mit Tokens fuer dunkle Surfaces, gedämpftes Rot, grosse Radien, Glass-Cards, Fokuszustaende und TV-taugliche Breakpoints. Ziel ist eine hochwertige Mischung aus Event-App, Musik-Plattform und Host-Dashboard, ohne die einfache Vanilla-JS-Architektur zu verlassen.

Wichtige Screens:

- `/start`: Host Launch Control mit Audio+TV-Start, QR-Codes, Links und Setup-Warnungen.
- `/`: Mobile-first Guest Music Deck mit Song-Eingabe, Queue, Skip-Voting, Chat und kleinen QR-Codes.
- `/admin`: Control Room mit Status-Kacheln, Wiedergabe, Moderation, Verlauf, Best-of und Settings.
- `/player`: TV-Buehne fuer Video, optimiert fuer grosses 16:9.
- `/party-screen`: praesentationsreifer QR-Party-Screen fuer TV/Beamer.
- `/history` und `/admin/best-of`: Musik-History und Ranking als Song-Cards statt Log-Datei.

Die PWA-Metadaten, SVG-Wortmarke, App-Icons und der Service-Worker-Cache wurden auf das Rot/Schwarz-Branding abgestimmt.

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
│  ├─ history.spec.ts
│  ├─ load.spec.ts
│  ├─ multiuser.spec.ts
│  ├─ party-screen.spec.ts
│  ├─ persistence.spec.ts
│  ├─ player.spec.ts
│  ├─ qr.spec.ts
│  ├─ security.spec.ts
│  ├─ skip-voting.spec.ts
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
- Party-Screen: `http://192.168.178.77:8088/party-screen`
- Verlauf: `http://192.168.178.77:8088/history`
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
- `SKIP_VOTING_ENABLED`, `SKIP_VOTE_THRESHOLD_PERCENT`, `ACTIVE_GUEST_WINDOW_SECONDS`
- `HISTORY_PUBLIC`, `READD_ENABLED`
- `PARTY_SCREEN_ENABLED`, `WIFI_QR_ENABLED`, `SHOW_WIFI_PASSWORD_ON_SCREEN`
- `PARTY_SCREEN_SHOW_ACTIVE_GUESTS`, `PARTY_SCREEN_SHOW_SKIP_STATUS`
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
- nutzt das dunkle Premium-TV-Layout mit grossem Current-Song und QR-Join-Hinweis
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

## Demokratisches Skip-Voting

Gaeste sehen beim aktuellen Song den Button `Song ueberspringen`. Jedes Geraet darf pro aktuellem Song einmal voten. PartyTube zaehlt nur aktive Guest-Geraete aus dem konfigurierten Zeitfenster, standardmaessig `ACTIVE_GUEST_WINDOW_SECONDS=300`.

Defaults:

- `SKIP_VOTING_ENABLED=true`
- `SKIP_VOTE_THRESHOLD_PERCENT=40`
- Admin kann Skip-Voting in `/admin` deaktivieren oder die Schwelle zwischen 10 und 100 Prozent setzen.
- Admin-Skip bleibt immer sofort moeglich und unabhaengig vom demokratischen Voting.

Wenn die Schwelle erreicht ist, wird der Song als `skipped_by_vote` historisiert und der naechste Song startet. Der Live-State enthaelt Skip-Votes, aktive Gaeste, Prozentwert und benoetigte Stimmen.

## Verlauf, Re-Add und Best of Abend

`/history` zeigt abgeschlossene Songs mit Status:

- `played`
- `skipped`
- `skipped_by_vote`
- `removed`

Wenn `READD_ENABLED=true`, koennen Gaeste Songs aus dem Verlauf erneut in die Queue setzen. Der Duplicate-Schutz bleibt aktiv: Songs, die bereits `queued` oder `current` sind, werden nicht doppelt eingetragen.

Admin-Exports:

- `/api/admin/history/export.json`
- `/api/admin/history/export.csv`
- `/api/admin/history/export.txt`

`/admin/best-of` berechnet eine einfache, nachvollziehbare Liste:

```text
best_score = votes + played_bonus + readd_bonus - skipped_penalty - removed_penalty
```

Aktuelle Defaults: `+2` fuer gespielt, `+1` pro Re-Add, `-2` fuer Skip, `-5` fuer entfernt.

## QR-Party-Screen

`/party-screen` ist fuer TV oder Beamer gedacht und zeigt:

- grossen QR-Code zum Join-Link `BASE_URL + /join/{PARTY_CODE}`
- Party-Code und Join-Link als Text-Fallback
- WLAN-SSID, falls konfiguriert
- WLAN-Passwort niemals standardmaessig
- aktuellen Song, Votes und Skip-Status
- naechste 3 Songs
- einfache Schritte fuer Gaeste

Sicherheitsrelevant:

- `SHOW_WIFI_PASSWORD_ON_SCREEN=false` bleibt der sichere Default.
- `WIFI_QR_ENABLED=false` bleibt der sichere Default.
- Beides kann bewusst im Admin-Bereich oder per ENV aktiviert werden.

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
- demokratisches Skip-Voting
- Admin-Flow
- Invite-only
- Chat
- History/Re-Add/Best-of
- Party-Screen
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
