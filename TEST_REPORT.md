# TEST_REPORT

## Architektur

- Single-service Web-App mit FastAPI, SQLite und WebSocket-Liveupdates
- HTML-Templates und Vanilla JS statt Build-Heavy Frontend
- SQLite-WAL fuer robuste lokale Persistenz
- Host-Steuerung ueber PIN-Cookie
- QR-Codes lokal als SVG generiert
- dedizierte Startseite als Launch-Hub fuer Audio, TV und QR
- optionaler Autoplay-Fallback aus dem Party-Verlauf bei leerer Queue
- YouTube-Linkparser fuer `watch`, `youtu.be`, `shorts`, `embed` und direkte IDs

## Testergebnisse

### Automatische Browser-E2E

Ausgefuehrt mit Playwright.

```text
12 passed (27.1s)
```

Abgedeckte Dateien:

- [tests/guest.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/guest.spec.ts)
- [tests/voting.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/voting.spec.ts)
- [tests/admin.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/admin.spec.ts)
- [tests/audio.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/audio.spec.ts)
- [tests/autoplay.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/autoplay.spec.ts)
- [tests/qr.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/qr.spec.ts)
- [tests/start.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/start.spec.ts)
- [tests/persistence.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/persistence.spec.ts)
- [tests/multiuser.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/multiuser.spec.ts)
- [tests/load.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/load.spec.ts)
- [tests/player.spec.ts](/C:/Users/USER/Documents/YT_Site/tests/player.spec.ts)

### Manuelle Laufzeitchecks auf der echten 8088-Instanz

Statuscodes:

- `/` -> `200`
- `/admin` -> `200`
- `/player` -> `200`
- `/qr` -> `200`
- `/health` -> `200`

API-Smoke auf `127.0.0.1:8088`:

- 4 gueltige YouTube-Linktypen erfolgreich hinzugefuegt
- ungueltige URL korrekt mit `400` und Fehlermeldung abgewiesen
- Duplicate korrekt mit `409` und vorhandener Song-Referenz abgewiesen
- Vote erhoeht Queue-Song von `1` auf `2`
- Admin-Skip zieht den naechsten Song nach
- Admin-Clear leert aktuelle Queue sauber

Persistenzcheck auf `127.0.0.1:8088`:

- Song hinzugefuegt
- Prozess beendet
- Prozess neu gestartet
- derselbe Song nach Neustart wieder als aktueller Song vorhanden

## Fehler + Fixes

1. Frontend-Skripte kollidierten global mit mehrfach deklarierten `const`-Bindings.
   Fix: Page-Skripte in IIFEs gekapselt.

2. Guest-E2E war zu schnell gegen das asynchrone Formular.
   Fix: Testhelper wartet jetzt auf den wieder aktivierten Submit-Button.

3. Multiuser-Test nahm eine feste Insert-Reihenfolge an.
   Fix: Test liest zuerst den tatsaechlich gequeueten Song und stimmt dann mit dem jeweils anderen Geraet ab.

4. QR-Test verwendete eine mehrdeutige Text-Lokation.
   Fix: gezielter Locator auf die QR-Link-Zeile.

5. HTML-Seiten wurden vom Service Worker gecacht und konnten dadurch bei Runtime-Settings oder nach Deploys stale wirken.
   Fix: Service Worker cached jetzt nur noch statische Assets, nicht mehr die dynamischen HTML-Seiten.

6. TV-Reloads konnten am Browser-Autoplay und am fehlenden Resume-Offset haengen bleiben.
   Fix: Der Player berechnet jetzt die aktuelle Songposition aus `currentStartedAt` und dockt nach Reload moeglichst an die laufende Wiedergabe an.

7. Ton brach beim Wechsel zwischen Queue-, Host- und QR-Seite ab, weil der Audio-Player im selben Browser-Tab lebte.
   Fix: Separates `Audio Deck` als eigenes Browser-Fenster eingefuehrt; der TV-Tab folgt nur noch visuell, waehrend das Audio-Fenster den Ton haelt.

8. Der TV-Tab konnte beim gleichzeitigen Start kurz selbst Ton uebernehmen, bevor das Audio-Fenster komplett aktiv war.
   Fix: Ein kurzer Anti-Echo-Intent im Start-Flow haelt den TV-Tab vorsichtshalber stumm, bis das Audio-Deck uebernommen hat.

9. Wichtige Aktionen und QR-Wege wirkten in der Oberflaeche zu verteilt und zu gross.
   Fix: Neue `/start`-Seite als Launch-Hub, Erklaerungen weiter unten und kompaktere QR-Karten auf Start-, Queue-, Host- und TV-Seite.

10. Nach dem Leerwerden der Queue fiel der Abend abrupt auf Stille zurueck.
    Fix: Optionaler Autoplay-Fallback spielt lokal aus bereits gespielten Tracks weiter und wechselt sofort wieder zur echten Queue, sobald neue Songs reinkommen.

## Performance

Automatischer Lastcheck bestanden:

- 50 Songs parallel angelegt
- 20 parallele Votes auf denselben Song erfolgreich
- Queue blieb konsistent
- UI blieb in der Teststrecke reaktionsfaehig

## Screenshots

- Gastansicht: [guest-home.png](/C:/Users/USER/Documents/YT_Site/artifacts/screenshots/guest-home.png)
- Admin-Konsole: [admin-console.png](/C:/Users/USER/Documents/YT_Site/artifacts/screenshots/admin-console.png)
- QR-Poster: [qr-poster.png](/C:/Users/USER/Documents/YT_Site/artifacts/screenshots/qr-poster.png)
- Player: [player-live.png](/C:/Users/USER/Documents/YT_Site/artifacts/screenshots/player-live.png)

## Bekannte Grenzen

- YouTube-Autoplay haengt vom jeweiligen TV-/Browser-Verhalten ab; ein einmaliger Tap auf `Playback starten` kann noetig sein.
- Titelabruf ueber YouTube-oEmbed ist optional und faellt bei Netzproblemen auf einen stabilen Fallback-Titel zurueck.
- Der Player-Endpunkt ist absichtlich simpel fuer das Heimnetz; fuer haertere Host-Abschottung waere ein separater Player-Key sinnvoll.
- `party.local` kann mit mDNS kollidieren; `party.home.arpa` ist meist sauberer.
- In Dual-Stack-Heimnetzen kann eine FRITZ!Box ihren eigenen IPv6-DNS vor dem lokalen DNS bekanntgeben; fuer `party.lokal` sollte der lokale DNS deshalb auch ueber ULA-IPv6 erreichbar sein.
- Vollstaendig unterbrechungsfreie Wiedergabe ueber einen echten harten Seiten-Reload ist browserseitig mit YouTube nicht garantiert; die App kann aber an die aktuelle Position wieder andocken und den Ton in einem separaten Audio-Fenster stabil halten.
- Echo wird innerhalb desselben Browsers aktiv verhindert, indem der TV-Tab bei laufendem Audio-Deck oder waehrend des Start-Flows stumm bleibt; getrennte physische Geraete muessen trotzdem sinnvoll verteilt werden.
- Der Autoplay-Fallback nutzt bewusst den bereits gespielten Party-Verlauf und nicht YouTubes externe Empfehlungslogik; dadurch bleibt er lokal, deterministisch und ohne zusaetzliche externe Abhaengigkeit steuerbar.

## Produktionsstatus

Fachlich produktionsreif fuer einen lokalen Heimnetz-Einsatz:

- App laeuft lokal stabil
- Queue bleibt ueber Neustarts erhalten
- Multiuser-, Voting-, Admin-, QR- und Player-Flows sind abgedeckt
- Missbrauchsschutz und Eingabehaertung sind implementiert

Wichtige Umgebungseinschraenkung dieses Durchlaufs:

- Docker, Docker Compose und WSL waren in der aktuellen Ausfuehrungsumgebung nicht installiert oder nicht verfuegbar.
- Deshalb konnten `docker compose config`, `docker compose build` und `docker compose up -d` hier nicht real ausgefuehrt werden.
- Die Compose-, Dockerfile- und Test-Assets sind aber im Repo vorbereitet und die Anwendung wurde direkt lokal inkl. E2E verifiziert.
