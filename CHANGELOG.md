# Changelog

## Unreleased

### Added

- installierbarer Gast-PWA-Flow mit Android Share Target und iPhone-Zwischenablage-Fallback

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

- Admin-Oberflaeche klarer strukturiert und sicherer verdrahtet
- Guest-Ansicht mit Chat, Queue-Meta und besseren Fehlermeldungen
- Start- und Player-Flows kommunizieren sichere Host-Links klarer
- Startseite, Guest UI, Admin, Player, QR-Poster, Verlauf, Best-of und Party-Screen auf ein konsistentes Premium Rot/Schwarz-Designsystem umgestellt
- Mobile Touch-Targets, TV-Typografie, QR-Praesentation, Empty States, Fokuszustaende und Live-Verbindungsanzeigen visuell ueberarbeitet
- README und Testreport aktualisiert
- entfernte und uebersprungene Songs bleiben jetzt als Verlaufseintraege erhalten statt hart geloescht zu werden

### Fixed

- Player-Token-Leak ueber oeffentliche Seiten verhindert
- zu lange Chat-Nachrichten werden sauber abgewiesen
- Invite-only-Fehlpfade liefern jetzt verstaendliche Seiten statt nur rohe Fehler
