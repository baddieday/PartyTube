# Implementation Notes

## Annahmen

- PartyTube bleibt primaer eine LAN-/Heimnetz-App und kein Internet-SaaS.
- FastAPI, SQLite, Vanilla JS und die bisherige Single-Service-Architektur bleiben erhalten.
- Ein Player-Token darf nur fuer Host-/Player-/Audio-Flows sichtbar sein, nicht fuer oeffentliche Guest-Seiten.
- Invite-only ist ein UX- und Zugangs-Feature, aber keine starke Authentisierung.
- YouTube-Metadaten ohne API-Key bleiben best effort.
- Skip-Voting zaehlt aktive Guests ueber WebSocket/API-Aktivitaet, nicht ueber harte Benutzerkonten.
- WLAN-Passwort und WLAN-QR auf dem Party-Screen sind bewusst opt-in.
- Der Audio-Übergang nutzt feste Werte und die vom YouTube-Player gemeldete Restlaufzeit. Der IFrame stellt keine PCM-/Pegel-Daten für echte Stilleerkennung bereit.

## Sicherheitsentscheidungen

- Admin-Auth wurde auf serverseitige Session-Eintraege mit SessionMiddleware umgestellt.
- CSRF wird per serverseitigem Token im Admin-Session-Datensatz und `X-PartyTube-CSRF` abgesichert.
- `/api/player/ended` nutzt einen HMAC-Token aus Secret + Party-Code.
- Standardwarnungen fuer Default-PIN, Platzhalter-Secrets und nicht erzwungenes HTTPS werden aktiv an die Host-UI gemeldet.
- Fuer `share_target` im Heimnetz gibt es jetzt einen offiziellen HTTPS-Betriebsmodus mit Caddy, interner CA und Export-Skripten fuer das Root-Zertifikat.

## UX-Entscheidungen

- `/start` bleibt als Host-Setup-Seite sichtbar, startet Audio/TV aber nur sicher nach Admin-Login.
- Das Audio-Deck bleibt das primaere Mittel gegen Tonabbrueche und Echo.
- Das Audio-Deck verwendet genau zwei Player: einen aktiven und einen stumm vorgeladenen. Ihre Lautstärken ergeben während des Übergangs zusammen 100 Prozent, damit kein Lautstärke-Peak entsteht.
- TV-, Audio- und Party-Screen-Clients erhalten höchstens drei kommende Songs; Chat wird für diese Rollen nicht übertragen.
- Kleine QR-Karten wurden auf den wichtigsten Seiten integriert, die grossformatige Poster-Seite bleibt `/qr`.
- `/party-screen` blendet die normale Navigation aus, damit TV/Beamer keine Admin-Links oder Textwuesten zeigen.
- `/history` ist standardmaessig oeffentlich, kann aber per `HISTORY_PUBLIC=false` auf Admin-only gesetzt werden.
- Das Redesign ist ein zentralisiertes CSS-Designsystem statt Seiten-Kosmetik. Bestehende Klassen/IDs bleiben erhalten, damit WebSocket-Rendering und Playwright-Flows stabil bleiben.
- Hauptfarben: `#050505` fuer den tiefen Hintergrund, `#d71d2a` als gedämpftes Premium-Rot, `#f0444d` fuer aktive Akzente und `#f7f3f4` fuer Text.
- Start, Guest, Admin, Player, Party-Screen, QR, Verlauf und Best-of nutzen dieselben Tokens fuer Cards, Buttons, Badges, Forms, Fokuszustaende, Empty States und Breakpoints.
- Das Branding wurde auf eine saubere SVG-Wortmarke und ein reduziertes Play-Icon im Rot/Schwarz-Stil umgestellt; PNG-PWA-Icons werden lokal aus dem SVG generiert.

## Datenmodell-Aenderungen

- `songs` wurde um `skipped_at`, `removed_at`, `completed_reason`, `readded_from_song_id`, `readded_by_device_id` und `readded_by_guest_name` erweitert.
- `skip_votes` speichert genau einen Skip-Vote pro `song_id` und `device_id`.
- `guest_activity` speichert aktive Geraete mit Rolle, damit Admin/Player/Audio/Screen nicht als Gaeste zaehlen.
- Entfernen, Queue-Leeren und Device-Clear setzen Songs jetzt auf `removed`, statt sie aus der Historie zu loeschen.
- Admin-Skip setzt `skipped`, demokratischer Skip setzt `skipped_by_vote`.

## Migrationsverhalten

- Die Migration laeuft beim Start ueber additive SQLite-Spalten und `CREATE TABLE IF NOT EXISTS`.
- Bestehende aktive Queue-Eintraege bleiben erhalten.
- Alte `played`-Historie bleibt sichtbar; neue Abschlussgruende werden ueber `completed_reason` differenziert.

## Teststrategie

- Security wird sowohl per API-/Session-Test als auch ueber E2E-Flows geprueft.
- Accessibility wird mit lokal vendortem `axe-core` gegen Guest/Admin/Start/Player geprueft.
- Last-/Fehlerfaelle laufen bewusst pragmatisch ueber Playwright-Request-Bursts statt ueber ein komplexes Benchmark-Setup.
- Neue Feature-Tests:
  - `tests/skip-voting.spec.ts`
  - `tests/history.spec.ts`
  - `tests/party-screen.spec.ts`
- Redesign-Schutz:
  - `tests/redesign.spec.ts` prueft Design-Tokens, Mobile Guest, Admin-Dashboard und TV-/Party-Screen-Screenshots.

## Offene bewusste Grenzen

- Kein externer OAuth-/User-Account-Layer, weil das den LAN-Use-Case unnötig verkompliziert.
- Kein Cloud- oder API-Key-Zwang.
- Keine kryptographisch starke Trennung zwischen Invite-Link und Host-Rechten; Host-Rechte laufen separat ueber Session und Player-Token.
- Device-IDs sind fuer den LAN-MVP ausreichend, aber kein starker Identitaetsnachweis gegen absichtliche Manipulation.
- YouTube-Fortschritt auf dem Party-Screen ist nur soweit sichtbar, wie der bestehende Player-State es hergibt; kein globales exaktes Playback-Telemetrie-System.
- Crossfade ist ein Laufzeit-Fade und keine Stilleanalyse. Browser-Autoplay-Regeln oder ungenaue YouTube-Dauern können den normalen, harten Wechsel auslösen.
- Das Redesign nutzt Systemschriften statt externer Premium-Fonts, damit LAN-/Offline-Betrieb und Performance stabil bleiben.
- Visual Regression ist bewusst leichtgewichtig ueber Playwright-Screenshots als Artefakte geloest, nicht als pixelgenaue CI-Blockade.
