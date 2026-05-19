# Contributing

## Setup

Python:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Node:

```bash
npm install
```

App lokal starten:

```bash
PORT=8088 uvicorn app.main:app --host 0.0.0.0 --port 8088
```

## Tests

Alle Tests:

```bash
npm run test
```

Wichtige Teilmengen:

```bash
npm run test:security
npm run test:accessibility
npm run test:load
```

## Coding Style

- FastAPI, SQLite und Vanilla JS bewusst einfach halten
- keine unnötige Framework-Komplexitaet
- Eingaben immer defensiv behandeln
- neue Admin-Schreibaktionen immer mit Session- und CSRF-Schutz denken
- Guest-Seiten duerfen keine Host- oder Player-Secrets ausliefern

## Branches und Pull Requests

- kleine, thematisch klare Aenderungen bevorzugen
- Tests fuer neue Security- oder Produktlogik mitliefern
- README oder `.env.example` aktualisieren, wenn sich Konfiguration aendert
- PR-Beschreibung sollte enthalten:
  - was geaendert wurde
  - warum die Aenderung noetig ist
  - wie sie getestet wurde

## Security

- keine echten Secrets committen
- keine Produktiv-PINs committen
- bei CSP-/Session-/CSRF-/Player-Token-Aenderungen immer auch Tests aktualisieren
