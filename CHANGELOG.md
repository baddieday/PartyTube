# Changelog

## Unreleased

## 1.1.1 - 2026-08-31

### Fixed

- Ein verspäteter HTTP-Initialzustand überschreibt keinen neueren WebSocket-Zustand mehr.

## 1.1.0 - 2026-08-31

### Added

- installierbarer Gast-PWA-Flow mit Android Share Target und iPhone-Zwischenablage-Fallback
- eigener Portainer-Compose-Stack mit automatisch persistentem SQLite-Volume
- konfigurierbarer Audio-Crossfade mit festen Werten von 1, 2, 3, 5 oder 10 Sekunden
- Playwright-Abdeckung für Crossfade und begrenzte TV-/Audio-Zustände

- serverseitige Admin-Sessions mit CSRF-Schutz
- geschuetzter Player-Token fuer `/api/player/ended`
- Invite-only Join-Gate mit `/join/{party_code}`
- Chat mit Live-Updates und Admin-Moderation
- Device-Muting und Song-/Chat-Moderation
- Queue-Metadaten wie ETA und Gesamtdauer
- Host-Setup-Verbesserungen auf `/start`
- Accessibility-Tests mit vendortem `axe-core`
- CI, Dependabot und CodeQL
- PWA-PNG-Icons und Apple Touch Icon
- `IMPLEMENTATION_NOTES.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`
- demokratisches Skip-Voting fuer den aktuellen Song
- Party-Verlauf unter `/history`
- Re-Add aus dem Verlauf mit Duplicate-Schutz
- Best-of-Abend unter `/admin/best-of` inklusive JSON/CSV/Text-Export
- QR-Party-Screen unter `/party-screen` fuer TV/Beamer
- neue Playwright-Specs fuer Skip-Voting, History und Party-Screen
- Premium Red/Black Branding mit neuer SVG-Wortmarke, App-Icon und aktualisierten PWA-Assets
- Redesign-Regressionstests fuer Start, Mobile Guest, Admin-Dashboard und TV-Screens

### Changed

- `/health` meldet zusätzlich die laufende PartyTube-Version
- Player, Audio und Party-Screen erhalten nur noch die drei nächsten Songs; der Audio-Host hält höchstens zwei YouTube-Player
- WebSocket-Reconnect nutzt begrenztes Backoff und räumt Verbindungen beim Verlassen der Seite auf
- Admin-Oberflaeche klarer strukturiert und sicherer verdrahtet
- Guest-Ansicht mit Chat, Queue-Meta und besseren Fehlermeldungen
- Start- und Player-Flows kommunizieren sichere Host-Links klarer
- Startseite, Guest UI, Admin, Player, QR-Poster, Verlauf, Best-of und Party-Screen auf ein konsistentes Premium Rot/Schwarz-Designsystem umgestellt
- Mobile Touch-Targets, TV-Typografie, QR-Praesentation, Empty States, Fokuszustaende und Live-Verbindungsanzeigen visuell ueberarbeitet
- README und Testreport aktualisiert
- entfernte und uebersprungene Songs bleiben jetzt als Verlaufseintraege erhalten statt hart geloescht zu werden

### Fixed

- neue Songs erscheinen auf dem sendenden Gerät sofort, auch wenn dessen WebSocket gerade erst verbindet
- Player-Token-Leak ueber oeffentliche Seiten verhindert
- zu lange Chat-Nachrichten werden sauber abgewiesen
- Invite-only-Fehlpfade liefern jetzt verstaendliche Seiten statt nur rohe Fehler
