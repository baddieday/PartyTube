# TEST_REPORT

## Architektur

- Single-Service-App mit FastAPI, SQLite und WebSocket-Liveupdates
- serverseitige Templates + Vanilla JS fuer einen robusten LAN-Stack ohne Build-Zwang
- serverseitige Admin-Sessions mit CSRF-Schutz
- HMAC-basierter Player-Token fuer `/api/player/ended`
- Invite-only Join-Gate optional ueber Runtime-Settings
- Chat, Moderation und Queue-Metadaten direkt im selben Prozess
- optionaler `/metrics`-Endpoint fuer Prometheus-kompatible Kennzahlen

## Testergebnisse

### Automatische Browser-E2E

Ausgefuehrt mit Playwright:

```text
16 passed (21.2s)
```

Abgedeckt:

- Guest-Flow inkl. URL-Varianten, Invalids, Duplicate und Chat
- Voting, Sortierung und Refresh-Verhalten
- Admin-Login, Logout und Runtime-Settings
- Audio-/TV-/Start-Flow
- Invite-only-Join
- Security fuer Session, CSRF und Player-Token
- QR-Poster
- Multiuser-Synchronisation
- Persistenz ueber Neustart
- Load-/Fehlerfaelle
- Accessibility mit vendortem `axe-core`

### Manuelle Laufzeitchecks

Lokal gegen eine echte Testinstanz auf `127.0.0.1:8092` verifiziert:

- `/health` -> `200`
- `/` -> `200`
- `/start` -> `200`
- `/admin` -> `200`
- `/player` -> `200`
- `/join/test-rave` -> `200`
- Invite-only-Root zeigt Join-Gate korrekt
- falscher Join-Code liefert verstaendliche Fehlerseite
- oeffentlicher `/api/admin/status` leakt keine signierten Player-Links

### Sicherheitschecks

Manuell und automatisiert verifiziert:

- `/api/player/ended` ohne Token -> `401`
- `/api/player/ended` mit falschem Token -> `403`
- `/api/player/ended` mit gueltigem Token -> `200`
- Admin-Login mit falscher PIN -> `401`
- Admin-Schreibaktion ohne Session -> blockiert
- Admin-Schreibaktion ohne CSRF -> `403`
- Admin-Schreibaktion mit falschem CSRF -> `403`
- Admin-Schreibaktion mit gueltigem CSRF -> erfolgreich
- Logout invalidiert die Admin-Session sauber

## Fehler + Fixes

1. Player-Links konnten im neuen Sicherheitsumbau versehentlich ueber oeffentliche Seiten sichtbar werden.
   Fix: signierte Player-/Audio-Links werden jetzt nur noch in authentifizierten Host-Kontexten ausgegeben.

2. Frontend und Backend hatten nach der Session-/CSRF-Einfuehrung noch unterschiedliche Annahmen ueber Admin-Status und Secure-Links.
   Fix: Admin-, Guest- und Start-JS wurden auf die neuen API-Vertraege gehoben.

3. Invite-only benoetigte einen klaren Root-/Join-Flow statt roher 404-Antworten.
   Fix: neue `join_gate.html` mit Join-Code-Eingabe und verstaendlicher Fehlerseite.

4. Zu lange Chat-Nachrichten wurden zuerst still gekuerzt statt sauber abgelehnt.
   Fix: Chat-Validierung trennt jetzt Sanitizing und Laengenfehler.

5. Accessibility-Testinjektion wurde von der CSP blockiert.
   Fix: `axe-core` wird lokal als statisches Asset ausgeliefert und aus derselben Origin geladen.

## Performance

Pragmatischer Lastcheck bestanden:

- 50 Songs parallel angelegt
- 20 parallele Votes auf denselben Song
- Queue blieb konsistent
- keine offensichtliche UI-Degradation in der Teststrecke

Zielwerte fuer den LAN-Betrieb:

- API p95 < 300 ms
- WebSocket-State-Update p95 < 500 ms
- keine Fehler bei 20 gleichzeitigen Gaesten

Hinweis:

- Die aktuelle Lastpruefung ist bewusst leichtgewichtig ueber Playwright-Request-Bursts umgesetzt, nicht ueber ein separates Benchmark-System.

## Screenshots

- Gastansicht: [guest-home.png](/C:/Users/USER/Documents/YT_Site/artifacts/screenshots/guest-home.png)
- Admin-Konsole: [admin-console.png](/C:/Users/USER/Documents/YT_Site/artifacts/screenshots/admin-console.png)
- QR-Poster: [qr-poster.png](/C:/Users/USER/Documents/YT_Site/artifacts/screenshots/qr-poster.png)
- Player: [player-live.png](/C:/Users/USER/Documents/YT_Site/artifacts/screenshots/player-live.png)

## Bekannte Grenzen

- Invite-only ist kein Ersatz fuer echte Internet-Authentisierung.
- YouTube-Autoplay bleibt browserabhaengig.
- Metadaten und Dauer ohne API-Key sind best effort.
- `party.local` kann mit mDNS kollidieren; `party.home.arpa` ist meist robuster.
- Vollstaendig nahtloser Ton ueber harte Browser-Reloads ist mit YouTube nicht garantiert, wird aber durch Audio-Deck + Resume-Offset deutlich verbessert.

## Produktionsstatus

Produktionsnah fuer den lokalen Heimnetz-Betrieb:

- Sicherheitskritische Endpunkte abgesichert
- Session/CSRF vorhanden
- Tests gruen
- CI/CodeQL/Dependabot vorbereitet
- README, Security-, Contribution- und Changelog-Doku vorhanden

Einschraenkung dieses Durchlaufs:

- Die Anwendung wurde lokal und per Playwright real verifiziert.
- Docker-Artefakte sind vorbereitet, aber in dieser Umgebung muss der finale `docker compose up --build`-Check noch auf einem Host mit Docker/Compose laufen, falls Docker hier nicht verfuegbar ist.
