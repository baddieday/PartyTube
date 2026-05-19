# PartyTube

Lokale Party-Jukebox fuer YouTube im Heimnetz: Gaeste werfen per Browser Songs rein, voten live, sehen die Queue und der Host steuert alles ueber Admin- und TV-Modus.

## Highlights

- Smartphone-first Web-App ohne Extra-Installation
- Lokale SQLite-Persistenz ueber Neustarts hinweg
- Live-Updates per WebSocket auf allen Geraeten
- Gastmodus, Host/Admin, TV-/Player-Modus und QR-Poster
- dedizierte Startseite fuer den Host mit Audio+TV-Start-Flow
- separates Audio-Fenster fuer unterbrechungsfreies Playback beim Seitenwechsel
- TV-/Player-Modus bleibt auf Wunsch rein visuell, sobald das Audio-Fenster aktiv ist
- optionaler Autoplay-Fallback aus dem Party-Verlauf, wenn die Queue leer wird
- kompakte QR-Karten auf Start-, Queue-, Host- und TV-Seite
- Duplicate-Erkennung fuer aktive Songs
- Upvotes mit Vote-Limit pro Geraet
- Admin-PIN und Rate-Limits gegen WLAN-Spam
- Druckbare QR-Seite fuer WLAN und Party-Link
- Party-, Join- und WLAN-Daten live im Admin pflegbar
- Docker Compose, `.env.example`, Playwright-E2E und Persistenztests

## Architektur

- Backend: FastAPI + Uvicorn
- Datenhaltung: SQLite (`/app/data/party.db`)
- Frontend: serverseitig ausgelieferte HTML-Templates + Vanilla JS + CSS
- Realtime: WebSocket-Broadcast bei Queue-Aenderungen
- QR-Codes: lokal generierte SVGs
- YouTube: URL-Normalisierung fuer `watch`, `youtu.be`, `shorts`, `embed`, direkte IDs

Warum diese Architektur:

- Ein einzelner Service ist fuer Heimnetz-Partys robuster und leichter zu betreiben als Frontend-/Backend-Split.
- SQLite ist fuer lokale Sessions schnell, ausfallsicher genug und restart-freundlich.
- Kein Build-Step fuer die UI senkt die Fehlerflaeche bei lokaler Nutzung.

## Projektstruktur

```text
.
├─ app/
│  ├─ config.py
│  ├─ main.py
│  ├─ qr.py
│  ├─ security.py
│  ├─ storage.py
│  ├─ youtube.py
│  ├─ static/
│  │  ├─ css/styles.css
│  │  ├─ img/icon.svg
│  │  ├─ js/
│  │  │  ├─ admin.js
│  │  │  ├─ audio.js
│  │  │  ├─ guest.js
│  │  │  ├─ player.js
│  │  │  ├─ qr.js
│  │  │  ├─ start.js
│  │  │  └─ shared.js
│  │  └─ sw.js
│  └─ templates/
│     ├─ admin.html
│     ├─ audio.html
│     ├─ base.html
│     ├─ guest.html
│     ├─ player.html
│     ├─ qr.html
│     └─ start.html
├─ deploy/Caddyfile.example
├─ tests/
│  ├─ admin.spec.ts
│  ├─ audio.spec.ts
│  ├─ autoplay.spec.ts
│  ├─ guest.spec.ts
│  ├─ load.spec.ts
│  ├─ multiuser.spec.ts
│  ├─ persistence.spec.ts
│  ├─ player.spec.ts
│  ├─ qr.spec.ts
│  ├─ start.spec.ts
│  └─ voting.spec.ts
├─ Dockerfile
├─ Dockerfile.tests
├─ docker-compose.yml
├─ package.json
├─ playwright.config.ts
├─ requirements.txt
└─ TEST_REPORT.md
```

## Schnellstart mit Docker Compose

1. Datei vorbereiten:

```bash
cp .env.example .env
```

2. Werte in `.env` anpassen:

- `HOST_IP=192.168.178.77`
- `BASE_URL=http://192.168.178.77:8088` nur wenn du die URL fest verdrahten willst
- `WIFI_SSID`, `WIFI_PASSWORD`
- `ADMIN_PIN`
- optional `PARTY_NAME`, `PARTY_CODE`

3. Container starten:

```bash
docker compose up -d --build
```

4. Im Heimnetz aufrufen:

- Gastmodus: `http://192.168.178.77:8088/`
- Host-Startseite: `http://192.168.178.77:8088/start`
- QR-Seite: `http://192.168.178.77:8088/qr`
- Admin: `http://192.168.178.77:8088/admin`
- TV/Player: `http://192.168.178.77:8088/player`
- Audio-Fenster: `http://192.168.178.77:8088/audio`

## Direkter Start ohne Docker

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8088
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:PORT='8088'
uvicorn app.main:app --host 0.0.0.0 --port 8088
```

## Konfiguration

Wichtige Variablen aus `.env.example`:

- `PORT`: externer Port, Default `8088`
- `HOST_IP`: sichtbare Heimnetz-IP fuer QR-Link, Default `192.168.178.77`
- `BASE_URL`: fuer QR und UI-Links
- leer lassen = URL automatisch aus dem aktuellen Host ableiten
- `PARTY_NAME`: sichtbarer Event-Name
- `PARTY_CODE`: Session-Code fuer `/join/<code>`
- `ADMIN_PIN`: Host-Login
- `ADMIN_COOKIE_SECRET`: Signatur fuer Admin-Session-Cookie
- `WIFI_SSID`, `WIFI_PASSWORD`, `WIFI_SECURITY`: fuer den WLAN-QR
- `AUTOPLAY_ENABLED`: optionaler Default fuer den Verlauf-Fallback bei leerer Queue
- `MAX_ADDS_PER_WINDOW`, `MAX_VOTES_PER_WINDOW`, `RATE_LIMIT_WINDOW_SECONDS`: Missbrauchsschutz
- `MAX_QUEUE_ITEMS`: harte Queue-Grenze
- `ENABLE_TITLE_LOOKUP`: optionaler YouTube-oEmbed-Titelabruf

## Bedienung

### Gastmodus

- YouTube-Link einfuegen
- optional Namen angeben
- Song wird mit Erststimme hinzugefuegt
- pro Song genau ein Upvote pro Geraet
- kleine QR-Karten fuer Party-Link und WLAN direkt in der Queue-Ansicht

### Startseite

- priorisiert Audio-Deck, TV-Tab und Host-Aktionen
- startet Audio + TV mit einem Klick
- zeigt kleine QR-Karten fuer Join und WLAN
- legt Erklaerungen bewusst weiter nach unten, damit die Oberflaeche ruhiger bleibt

### Host/Admin

- PIN-Login
- Party-Name, Party-Code, Join-URL und WLAN-Daten direkt im Browser pflegen
- Autoplay-Fallback aus dem Verlauf bei leerer Queue per Checkbox steuerbar
- aktuellen Song skippen
- aktuellen Song als gespielt markieren
- Songs entfernen
- Queue leeren
- kompletten Abend resetten
- Queue als JSON exportieren

### TV-/Player-Modus

- zeigt den aktuellen Song gross an
- nutzt YouTube IFrame API
- schaltet beim Songende automatisch auf den naechsten Queue-Eintrag
- zeigt leere Queue sauber an
- dockt nach Reload moeglichst an die aktuelle Songposition an
- bleibt stumm, sobald das Audio-Fenster aktiv ist oder der Start-Flow gerade das Audio-Deck hochzieht
- kann je nach Browser eine einmalige Nutzerinteraktion fuer Autoplay brauchen
- zeigt kleine QR-Karten fuer Party-Beitritt und WLAN direkt im Sidebar-Bereich
- kann bei leerer Queue automatisch in einen lokalen Verlauf-Fallback wechseln

### Audio-Fenster

- oeffnet sich einmalig per Browser als separates Audio-Deck
- bleibt offen, waehrend du im Haupt-Tab zwischen Queue, Host und QR wechselst
- vermeidet dadurch Tonunterbrechungen durch Seitenwechsel im Haupt-Tab
- der TV-Tab bleibt fuer das sichtbare Video gedacht
- kann bei leerer Queue automatisch weiter aus bereits gespielten Tracks spielen

## Tests

Node/Playwright:

```bash
npm install
npm run test
```

Alternativ im Container:

```bash
docker compose --profile tests run --rm tests
```

Abgedeckte Themen:

- Gast-Flow inkl. URL-Varianten, Invalids und Duplicates
- Voting, Sortierung, Refresh-Verhalten
- Admin-PIN und Host-Aktionen
- QR-Seite
- TV-/Player-Modus
- separates Audio-Fenster fuer dauerhafte Wiedergabe
- dedizierte Startseite mit Audio+TV-Launch
- Autoplay-Fallback aus dem Party-Verlauf
- Admin-Settings fuer Party-/WLAN-Daten
- Multiuser mit Gast A / Gast B / Host
- Persistenz ueber Neustart
- Last- und Fehlerfaelle

## Missbrauchsschutz

- Rate-Limits pro Geraet/IP fuer Add und Vote
- Admin-Aktionen per PIN-geschuetztem Cookie
- Duplicate-Erkennung per DB-Constraint
- Eingabegrenzen fuer URL- und Namensfelder
- Autoescaping im Frontend plus serverseitige Bereinigung des optionalen Gastnamens

## Heimnetz-Tipps

### QR-Poster

- Hange `/qr` auf einem Tablet oder drucke die Seite direkt aus.
- Wenn du keinen WLAN-QR willst, lass `WIFI_SSID` und `WIFI_PASSWORD` leer.

### Eigener Hostname

Falls du statt IP lieber einen Namen willst:

- empfehlenswert: `party.home.arpa`
- moeglich mit lokalem DNS: `party.lokal`
- moeglich, aber oft konfliktanfaellig: `party.local`

Mit Pi-hole oder lokalem DNS:

- `party.home.arpa -> 192.168.178.77`
- `party.lokal -> 192.168.178.77`

Mit Reverse Proxy:

- siehe [deploy/Caddyfile.example](/C:/Users/USER/Documents/YT_Site/deploy/Caddyfile.example)

### FRITZ!Box und DNSv6

Wenn `party.lokal` trotz eingetragenem lokalem DNS-Server nicht aufloest, ist meist IPv6 der Grund:

- Viele Clients bevorzugen den per Router Advertisement gelernten IPv6-DNS der FRITZ!Box vor dem eigenen LAN-DNS.
- Dein lokaler DNS sollte deshalb auf `53/tcp` und `53/udp` sowohl per IPv4 als auch per ULA-IPv6 lauschen.
- In FRITZ!OS hilft oft, unter `Internet > Zugangsdaten > IPv6` die Option `DNS-Server auch ueber Router Advertisement bekanntgeben (RFC 5005)` zu pruefen, wenn Clients weiter zuerst die FRITZ!Box als IPv6-DNS verwenden.
- Fuer saubere Heimnetz-Namen ist `party.home.arpa` meist standardnaeher; `party.lokal` funktioniert gut, wenn dein lokaler DNS auf IPv4 und IPv6 wirklich bevorzugt verteilt wird.

## Annahmen

- YouTube ist aus dem Heimnetz erreichbar.
- Die Party findet in einem vertrauenswuerdigen lokalen WLAN statt.
- Der TV-/Player-Browser darf YouTube-Embeds laden.
- Ein einzelner lokaler Prozess reicht fuer den Einsatzzweck aus.

## Sinnvolle naechste Ausbaustufen

- Queue-Import aus JSON im Admin
- Song-Dauer, ETA und Restzeit
- dedizierter Host-Only Player-Key statt offenem `/api/player/ended`
- Nachtmodus fuers QR-Poster mit groesserem WLAN-Teil
- mehrsprachige UI
