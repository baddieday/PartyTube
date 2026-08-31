# PartyTube

PartyTube ist eine lokale Party-Jukebox für YouTube im Heimnetz. Gäste öffnen eine Webseite im Browser, fügen Songs zur Queue hinzu, voten live mit und sehen auf TV oder Beamer, was gerade läuft.

## Installation mit Docker

Voraussetzung: Docker und Docker Compose sind installiert.

```bash
git clone https://github.com/baddieday/PartyTube.git
cd PartyTube
cp .env.example .env
docker compose up -d --build
```

Danach ist PartyTube standardmäßig unter Port `8088` erreichbar.

```text
http://<SERVER-IP>:8088/
```

## Installation mit Portainer

Für Portainer auf **Docker Standalone** ist `docker-compose.portainer.yml` vorgesehen. Der normale Compose-Stack bleibt absichtlich unverändert.

1. In Portainer `Stacks > Add stack > Git repository` öffnen.
2. Repository-URL `https://github.com/baddieday/PartyTube.git` eintragen.
3. Als Compose-Pfad `docker-compose.portainer.yml` wählen.
4. Die Werte aus `.env.example` unter `Environment variables` importieren und mindestens `ADMIN_PIN`, `SESSION_SECRET`, `PLAYER_TOKEN_SECRET`, `HOST_IP` und `BASE_URL` anpassen.
5. Stack deployen und warten, bis der Healthcheck `healthy` meldet.

Portainer stellt diese Werte dem Container über `stack.env` bereit. Das gilt für Docker Standalone, nicht für Docker Swarm.

Die SQLite-Datei wird beim ersten Start automatisch im Named Volume `<STACKNAME>_partytube_data` angelegt. Es muss keine leere Datenbank hochgeladen werden. Beim Aktualisieren oder Neuerstellen des Containers bleibt das Volume erhalten.

Wichtig beim Wechsel einer bestehenden Installation: `docker-compose.yml` nutzt weiterhin `./data`. Vor einem Wechsel zum Portainer-Stack muss `data/party.db` gesichert und bewusst in das neue Volume übertragen werden; PartyTube migriert Bind-Mount-Daten nicht automatisch.

## HTTPS im Heimnetz

Wenn du PartyTube lokal unter `https://party.lokal` nutzen willst, ist der passende Stack im Repo enthalten:

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

- Wenn auf dem Host bereits ein Reverse Proxy auf Port `80` läuft, `HTTP_PUBLIC_PORT` in `.env` auf einen freien Port setzen, z. B. `8089`.
- Für die eigentliche PWA-Installation und das Teilen-Menü ist `HTTPS_PUBLIC_PORT=443` die wichtige Einstellung.

6. Root-CA aus Caddy exportieren:

Linux/macOS:

```bash
./scripts/export-caddy-root-cert.sh
```

Windows PowerShell:

```powershell
./scripts/export-caddy-root-cert.ps1
```

7. Die exportierte Datei `artifacts/certs/partytube-local-root.crt` auf Android-Geräten als vertrauenswürdige CA installieren.
8. Danach `https://party.lokal` im Browser neu öffnen.

### Gast-App und YouTube-Teilen

- Android/Chrome: PartyTube öffnen, `App installieren` wählen und danach einen YouTube-Link direkt an PartyTube teilen. Der Song wird nach der serverseitigen Linkprüfung eingereicht.
- iPhone/Safari: `Teilen` und `Zum Home-Bildschirm` wählen. Da iOS Web-Apps nicht als Web Share Target registriert, in YouTube `Link kopieren` und in PartyTube `Link einfügen` tippen.
- Installation und Android Share Target benötigen eine vom Gerät als vertrauenswürdig erkannte HTTPS-Verbindung.

### Warum dieser Weg?

- Für lokale Hostnamen ist ein echter HTTPS-Kontext nötig.
- Caddy erzeugt dafür lokal eine eigene CA und signiert automatisch das Zertifikat für `party.lokal`.
- Damit andere Geräte im WLAN diese Verbindung vertrauen, müssen sie das Root-Zertifikat kennen.

Status prüfen:

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

Das Skript zieht den aktuellen Git-Stand, baut den Container neu, startet ihn und prüft `/health`.
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

1. `.env` öffnen.
2. `HOST_IP` auf die IP des Rechners setzen, auf dem PartyTube läuft.
3. `BASE_URL` passend setzen, z. B. `http://192.168.178.77:8088`.
4. `ADMIN_PIN` ändern.
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
| `/` | Gäste-Ansicht zum Hinzufügen, Voten und Chatten |
| `/start` | Host-Startseite mit QR-Codes und Startlinks |
| `/admin` | Admin-Bereich für Queue, Moderation und Einstellungen |
| `/player` | TV-/Beamer-Ansicht mit Video |
| `/audio` | separates Audio-Fenster für stabile Wiedergabe |
| `/party-screen` | QR- und Info-Screen für Gäste |
| `/history` | Verlauf der gespielten Songs |
| `/qr` | druckbare QR-Posteransicht |
| `/health` | Healthcheck |

## Nutzung auf einer Party

1. PartyTube starten.
2. `/admin` öffnen und mit der Host-PIN anmelden.
3. `/start` öffnen.
4. QR-Code oder Link mit den Gästen teilen.
5. `Audio + TV starten` verwenden.
6. Das Audio-Fenster offen lassen, damit die Wiedergabe stabil bleibt.

Hinweise:

- Gäste brauchen keine App, nur einen Browser im gleichen Netzwerk.
- YouTube-Autoplay kann je nach Browser blockiert werden. Dann einmal manuell `Playback starten` oder `Audio starten` klicken.
- Der Host kann unter `Admin > Einstellungen > Übergang zwischen Songs` einen festen Übergang von 1, 2, 3, 5 oder 10 Sekunden wählen.
- Der Party-Code ist eine einfache Einladung, kein starkes Passwort.

### TV, Audio und Übergänge

- `/player` zeigt das Video, `/audio` liefert den Ton und `/party-screen` zeigt den Beitritts-Screen.
- Player, Audio und Party-Screen erhalten nur die drei nächsten Songs. Das hält den Speicherverbrauch auf langen Partys begrenzt.
- Für einen Übergang hält das Audio-Fenster genau zwei YouTube-Player bereit und blendet anhand der von YouTube gemeldeten Laufzeit über.
- Echte Stilleerkennung ist im Browser nicht möglich, weil der YouTube-IFrame keine Audiodaten bereitstellt. Bei ungenauer Laufzeit fällt PartyTube auf den normalen Songwechsel zurück.
- Übergänge und automatisches Weiterschalten benötigen den sicheren Audio-Link von `/start`.

## Funktionen

- YouTube-Queue für Partys im lokalen Netzwerk
- Unterstützung für `watch`, `youtu.be`, `shorts`, `embed` und direkte YouTube-IDs
- Live-Updates per WebSocket
- Voting und demokratisches Skip-Voting
- Chat mit Moderationsfunktionen
- Admin-Bereich mit Queue-Kontrolle
- TV-/Beamer-Modus
- separates Audio-Deck
- Invite-only-Modus über `/join/{party_code}`
- Verlauf, Re-Add und Best-of-Abend
- QR-Codes für Join-Link und optional WLAN
- Rate-Limits, Duplicate-Schutz, Admin-Session, CSRF-Schutz und Player-Token
- SQLite-Datenhaltung mit persistenter Datenbank im `data`-Ordner

## Wichtige Konfiguration

Die Konfiguration liegt in `.env`. Vorlage: `.env.example`.

| Variable | Bedeutung |
|---|---|
| `PORT` | externer Port, Standard `8088` |
| `PARTYTUBE_DOMAIN` | lokaler HTTPS-Hostname, z. B. `party.lokal` |
| `HTTP_PUBLIC_PORT` | HTTP-Port für den Reverse Proxy, Standard `80` |
| `HTTPS_PUBLIC_PORT` | HTTPS-Port für den Reverse Proxy, Standard `443` |
| `HOST_IP` | IP-Adresse des PartyTube-Hosts |
| `BASE_URL` | Basis-URL für Links und QR-Codes |
| `PARTY_NAME` | angezeigter Name der Party |
| `PARTY_CODE` | Code für Invite-only-Links |
| `INVITE_ONLY_MODE` | aktiviert die Join-Code-Seite |
| `ADMIN_PIN` | PIN für den Admin-Bereich |
| `SESSION_SECRET` | Wert für Admin-Sessions |
| `PLAYER_TOKEN_SECRET` | Wert für Player-Events |
| `WIFI_SSID` | WLAN-Name für optionale Anzeige |
| `WIFI_QR_ENABLED` | aktiviert WLAN-QR-Code |
| `SHOW_WIFI_PASSWORD_ON_SCREEN` | steuert, ob der WLAN-Schlüssel angezeigt wird |
| `CROSSFADE_SECONDS` | fester Audio-Übergang: `0`, `1`, `2`, `3`, `5` oder `10` Sekunden |
| `SKIP_VOTE_THRESHOLD_PERCENT` | Schwelle für demokratisches Skippen |
| `MAX_QUEUE_ITEMS` | maximale Queue-Länge |
| `ENABLE_METRICS` | aktiviert `/metrics` |

`/health` liefert neben `status` auch die laufende Release-Version.

Empfehlung für Partys:

- `ADMIN_PIN` vor der Nutzung ändern.
- `SESSION_SECRET` und `PLAYER_TOKEN_SECRET` setzen.
- `SHOW_WIFI_PASSWORD_ON_SCREEN=false` lassen, wenn der Screen für viele sichtbar ist.
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

Compose-Konfiguration für HTTPS prüfen:

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
app/static/          CSS, JavaScript, Bilder
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

- PartyTube ist primär für das lokale Netzwerk gedacht.
- YouTube kann Autoplay je nach Browser oder Gerät blockieren.
- Crossfade ist laufzeitbasiert; YouTube stellt der App keine Roh-Audiodaten für Stilleerkennung bereit.
- Titel- und Dauerermittlung ohne API-Key ist best effort.
- Invite-only ersetzt keine vollständige Internet-Absicherung.
- WLAN-Zugangsdaten sollten nicht unüberlegt auf einem Beamer angezeigt werden.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
