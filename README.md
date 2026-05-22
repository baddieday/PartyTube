# PartyTube

PartyTube ist eine lokale Party-Jukebox fuer YouTube im Heimnetz. Gaeste oeffnen eine Webseite im Browser, fuegen Songs zur Queue hinzu, voten live mit und sehen auf TV oder Beamer, was gerade laeuft.

## Installation mit Docker

Voraussetzung: Docker und Docker Compose sind installiert.

```bash
git clone https://github.com/baddieday/PartyTube.git
cd PartyTube
cp .env.example .env
docker compose up -d --build
```

Danach ist PartyTube standardmaessig unter Port `8088` erreichbar.

```text
http://<SERVER-IP>:8088/
```

## HTTPS fuer PWA-Share-Target im Heimnetz

Wenn PartyTube im Android-Teilen-Menue erscheinen soll, ist der saubere Weg eine installierte PWA ueber `https://party.lokal`.

Der Stack dafuer ist im Repo enthalten:

- `docker-compose.https.yml`
- `deploy/Caddyfile.local-https`
- `scripts/export-caddy-root-cert.sh`
- `scripts/export-caddy-root-cert.ps1`

### Schnellstart

1. `cp .env.example .env`
2. Optional `cp .env.https.example .env.https-notes` als Referenz ansehen.
3. In `.env` diese Werte setzen:

```dotenv
PARTYTUBE_DOMAIN=party.lokal
BASE_URL=https://party.lokal
TRUSTED_HOSTS=party.lokal,192.168.178.77,localhost,127.0.0.1
ENFORCE_HTTPS=true
SESSION_COOKIE_SECURE=true
HTTP_PUBLIC_PORT=80
HTTPS_PUBLIC_PORT=443
```

4. Lokales DNS so setzen, dass `party.lokal` auf deinen PartyTube-Host zeigt.
5. Stack starten:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

Hinweis:

- Wenn auf dem Host bereits ein Reverse Proxy auf Port `80` laeuft, `HTTP_PUBLIC_PORT` in `.env` auf einen freien Port setzen, z. B. `8089`.
- Fuer die eigentliche PWA-Installation und das Teilen-Menue ist `HTTPS_PUBLIC_PORT=443` die wichtige Einstellung.

6. Root-CA aus Caddy exportieren:

Linux/macOS:

```bash
./scripts/export-caddy-root-cert.sh
```

Windows PowerShell:

```powershell
./scripts/export-caddy-root-cert.ps1
```

7. Die exportierte Datei `artifacts/certs/partytube-local-root.crt` auf Android-Geraeten als vertrauenswuerdige CA installieren.
8. Alte PartyTube-Installation auf dem Handy loeschen, dann `https://party.lokal` in Chrome oeffnen und neu als App installieren.
9. Danach erneut aus YouTube an PartyTube teilen.

### Warum dieser Weg?

- `share_target` wird vom Betriebssystem erst bei einer installierten PWA registriert.
- Fuer lokale Hostnamen ist ein echter HTTPS-Kontext noetig.
- Caddy erzeugt dafuer lokal eine eigene CA und signiert automatisch das Zertifikat fuer `party.lokal`.
- Damit andere Geraete im WLAN diese Verbindung vertrauen, muessen sie das Root-Zertifikat kennen.

Status pruefen:

```bash
docker compose ps
curl http://localhost:8088/health
```

Logs anzeigen:

```bash
docker compose logs -f app
```

Update auf einem Docker-Server:

```bash
./scripts/deploy-local.sh
```

Das Skript zieht den aktuellen Git-Stand, baut den Container neu, startet ihn und prueft `/health`.
Wenn der Serverordner noch kein Git-Repo ist, PartyTube dort einmal sauber klonen. Nach UI-Updates hilft im Browser ggf. `Strg+F5`.

Stoppen:

```bash
docker compose down
```

## Installation ohne Docker

Voraussetzung: Python 3.11+ ist installiert.

### Windows PowerShell

```powershell
git clone https://github.com/baddieday/PartyTube.git
cd PartyTube
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PORT='8088'
uvicorn app.main:app --host 0.0.0.0 --port 8088
```

### Linux/macOS

```bash
git clone https://github.com/baddieday/PartyTube.git
cd PartyTube
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PORT=8088 uvicorn app.main:app --host 0.0.0.0 --port 8088
```

## Erste Einrichtung

1. `.env` oeffnen.
2. `HOST_IP` auf die IP des Rechners setzen, auf dem PartyTube laeuft.
3. `BASE_URL` passend setzen, z. B. `http://192.168.178.77:8088`.
4. `ADMIN_PIN` aendern.
5. `SESSION_SECRET` und `PLAYER_TOKEN_SECRET` durch eigene lange Zufallswerte ersetzen.
6. Optional WLAN-Daten setzen, wenn ein WLAN-QR-Code angezeigt werden soll.
7. App neu starten.

Docker-Neustart:

```bash
docker compose restart app
```

## Wichtige Seiten

| Seite | Zweck |
|---|---|
| `/` | Gaeste-Ansicht zum Hinzufuegen, Voten und Chatten |
| `/start` | Host-Startseite mit QR-Codes und Startlinks |
| `/admin` | Admin-Bereich fuer Queue, Moderation und Einstellungen |
| `/player` | TV-/Beamer-Ansicht mit Video |
| `/audio` | separates Audio-Fenster fuer stabile Wiedergabe |
| `/party-screen` | QR- und Info-Screen fuer Gaeste |
| `/history` | Verlauf der gespielten Songs |
| `/qr` | druckbare QR-Posteransicht |
| `/health` | Healthcheck |

## Nutzung auf einer Party

1. PartyTube starten.
2. `/admin` oeffnen und mit der Host-PIN anmelden.
3. `/start` oeffnen.
4. QR-Code oder Link mit den Gaesten teilen.
5. `Audio + TV starten` verwenden.
6. Das Audio-Fenster offen lassen, damit die Wiedergabe stabil bleibt.

Hinweise:

- Gaeste brauchen keine App, nur einen Browser im gleichen Netzwerk.
- YouTube-Autoplay kann je nach Browser blockiert werden. Dann einmal manuell `Playback starten` oder `Audio starten` klicken.
- Der Party-Code ist eine einfache Einladung, kein starkes Passwort.

## Als App installieren

Auf unterstuetzten Browsern kann PartyTube ueber das Browser-Menue als App installiert werden. Danach startet PartyTube im eigenstaendigen PWA-Fenster.

YouTube an PartyTube teilen:

- Auf unterstuetzten Android-/Chrome-Browsern erscheint PartyTube im Teilen-Menue.
- Fuer das Teilen-Menue ist `https://party.lokal` mit installierter PWA die empfohlene Variante.
- Einen YouTube-Link an PartyTube teilen.
- PartyTube prueft den Link und reicht ihn direkt ein.
- Beim normalen Kopieren und Einfuegen bleibt die manuelle Bestaetigung erhalten.

Fallback:

- Wenn `Teilen an PartyTube` nicht angeboten wird, bleibt normales Kopieren und Einfuegen.

## Funktionen

- YouTube-Queue fuer Partys im lokalen Netzwerk
- Unterstuetzung fuer `watch`, `youtu.be`, `shorts`, `embed` und direkte YouTube-IDs
- Live-Updates per WebSocket
- Voting und demokratisches Skip-Voting
- Chat mit Moderationsfunktionen
- Admin-Bereich mit Queue-Kontrolle
- TV-/Beamer-Modus
- separates Audio-Deck
- Invite-only-Modus ueber `/join/{party_code}`
- Verlauf, Re-Add und Best-of-Abend
- QR-Codes fuer Join-Link und optional WLAN
- Rate-Limits, Duplicate-Schutz, Admin-Session, CSRF-Schutz und Player-Token
- SQLite-Datenhaltung mit persistenter Datenbank im `data`-Ordner

## Wichtige Konfiguration

Die Konfiguration liegt in `.env`. Vorlage: `.env.example`.

| Variable | Bedeutung |
|---|---|
| `PORT` | externer Port, Standard `8088` |
| `PARTYTUBE_DOMAIN` | lokaler HTTPS-Hostname, z. B. `party.lokal` |
| `HTTP_PUBLIC_PORT` | HTTP-Port fuer den Reverse Proxy, Standard `80` |
| `HTTPS_PUBLIC_PORT` | HTTPS-Port fuer den Reverse Proxy, Standard `443` |
| `HOST_IP` | IP-Adresse des PartyTube-Hosts |
| `BASE_URL` | Basis-URL fuer Links und QR-Codes |
| `PARTY_NAME` | angezeigter Name der Party |
| `PARTY_CODE` | Code fuer Invite-only-Links |
| `INVITE_ONLY_MODE` | aktiviert die Join-Code-Seite |
| `ADMIN_PIN` | PIN fuer den Admin-Bereich |
| `SESSION_SECRET` | Wert fuer Admin-Sessions |
| `PLAYER_TOKEN_SECRET` | Wert fuer Player-Events |
| `WIFI_SSID` | WLAN-Name fuer optionale Anzeige |
| `WIFI_QR_ENABLED` | aktiviert WLAN-QR-Code |
| `SHOW_WIFI_PASSWORD_ON_SCREEN` | steuert, ob der WLAN-Schluessel angezeigt wird |
| `SKIP_VOTE_THRESHOLD_PERCENT` | Schwelle fuer demokratisches Skippen |
| `MAX_QUEUE_ITEMS` | maximale Queue-Laenge |
| `ENABLE_METRICS` | aktiviert `/metrics` |

Empfehlung fuer Partys:

- `ADMIN_PIN` vor der Nutzung aendern.
- `SESSION_SECRET` und `PLAYER_TOKEN_SECRET` setzen.
- `SHOW_WIFI_PASSWORD_ON_SCREEN=false` lassen, wenn der Screen fuer viele sichtbar ist.
- `WIFI_QR_ENABLED` nur bewusst aktivieren.

## Tests

Docker-Testcontainer:

```bash
docker compose --profile tests run --rm tests
```

Lokale Playwright-Tests:

```bash
npm install
npm run test
```

Einzelne Tests:

```bash
npm run test:security
npm run test:accessibility
npm run test:load
```

Compose-Konfiguration fuer HTTPS pruefen:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml config
```

## Backup und Restore

Backup der SQLite-Datenbank:

```bash
mkdir -p backups
cp data/party.db backups/party-$(date +%F-%H%M).db
```

Restore:

```bash
cp backups/party-YYYY-MM-DD-HHMM.db data/party.db
```

Vor einem Restore sollte PartyTube kurz gestoppt werden.

## Projektstruktur

```text
app/                 FastAPI-App, Templates, Static Files, Storage
app/static/          CSS, JavaScript, Bilder, Service Worker
app/templates/       HTML-Templates
data/                lokale SQLite-Datenbank
deploy/              optionale Deployment-Beispiele
scripts/             Hilfsskripte
tests/               Playwright-E2E-Tests
Dockerfile           App-Container
docker-compose.yml   lokaler Docker-Start
.env.example         Beispielkonfiguration
```

## Bekannte Grenzen

- PartyTube ist primaer fuer das lokale Netzwerk gedacht.
- YouTube kann Autoplay je nach Browser oder Geraet blockieren.
- Titel- und Dauerermittlung ohne API-Key ist best effort.
- Invite-only ersetzt keine vollstaendige Internet-Absicherung.
- WLAN-Zugangsdaten sollten nicht unueberlegt auf einem Beamer angezeigt werden.
- Das Teilen-Menue fuer PartyTube erscheint auf Android/Chrome erst verlaesslich mit installierter PWA und vertrauenswuerdigem HTTPS.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
