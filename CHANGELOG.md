# Changelog

## Unreleased

### Added

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

### Changed

- Admin-Oberflaeche klarer strukturiert und sicherer verdrahtet
- Guest-Ansicht mit Chat, Queue-Meta und besseren Fehlermeldungen
- Start- und Player-Flows kommunizieren sichere Host-Links klarer
- README und Testreport aktualisiert

### Fixed

- Player-Token-Leak ueber oeffentliche Seiten verhindert
- zu lange Chat-Nachrichten werden sauber abgewiesen
- Invite-only-Fehlpfade liefern jetzt verstaendliche Seiten statt nur rohe Fehler
