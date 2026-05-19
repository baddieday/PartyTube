# Implementation Notes

## Annahmen

- PartyTube bleibt primaer eine LAN-/Heimnetz-App und kein Internet-SaaS.
- FastAPI, SQLite, Vanilla JS und die bisherige Single-Service-Architektur bleiben erhalten.
- Ein Player-Token darf nur fuer Host-/Player-/Audio-Flows sichtbar sein, nicht fuer oeffentliche Guest-Seiten.
- Invite-only ist ein UX- und Zugangs-Feature, aber keine starke Authentisierung.
- YouTube-Metadaten ohne API-Key bleiben best effort.

## Sicherheitsentscheidungen

- Admin-Auth wurde auf serverseitige Session-Eintraege mit SessionMiddleware umgestellt.
- CSRF wird per serverseitigem Token im Admin-Session-Datensatz und `X-PartyTube-CSRF` abgesichert.
- `/api/player/ended` nutzt einen HMAC-Token aus Secret + Party-Code.
- Standardwarnungen fuer Default-PIN, Platzhalter-Secrets und nicht erzwungenes HTTPS werden aktiv an die Host-UI gemeldet.

## UX-Entscheidungen

- `/start` bleibt als Host-Setup-Seite sichtbar, startet Audio/TV aber nur sicher nach Admin-Login.
- Das Audio-Deck bleibt das primaere Mittel gegen Tonabbrueche und Echo.
- Kleine QR-Karten wurden auf den wichtigsten Seiten integriert, die grossformatige Poster-Seite bleibt `/qr`.

## Teststrategie

- Security wird sowohl per API-/Session-Test als auch ueber E2E-Flows geprueft.
- Accessibility wird mit lokal vendortem `axe-core` gegen Guest/Admin/Start/Player geprueft.
- Last-/Fehlerfaelle laufen bewusst pragmatisch ueber Playwright-Request-Bursts statt ueber ein komplexes Benchmark-Setup.

## Offene bewusste Grenzen

- Kein externer OAuth-/User-Account-Layer, weil das den LAN-Use-Case unnötig verkompliziert.
- Kein Cloud- oder API-Key-Zwang.
- Keine kryptographisch starke Trennung zwischen Invite-Link und Host-Rechten; Host-Rechte laufen separat ueber Session und Player-Token.
