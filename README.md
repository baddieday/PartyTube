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

Status pruefen:

```bash
docker compose ps
curl http://localhost:8088/health
```

Logs anzeigen:

```bash
docker compose logs -f app
```

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

## Lizenz

MIT, siehe [LICENSE](LICENSE).
