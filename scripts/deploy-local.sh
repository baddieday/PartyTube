#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Fehler: Dieser Ordner ist kein Git-Repository."
  echo "Bitte PartyTube einmal sauber klonen und das Skript dort ausfuehren."
  exit 1
fi

PORT="${PORT:-8088}"
HEALTH_URL="${HEALTH_URL:-http://localhost:${PORT}/health}"

echo "Hole aktuellen Git-Stand..."
git pull --ff-only

echo "Baue und starte Docker-Container..."
docker compose up -d --build

echo "Containerstatus:"
docker compose ps

echo "Pruefe Healthcheck: ${HEALTH_URL}"
for attempt in {1..30}; do
  if curl -fsS "${HEALTH_URL}" >/dev/null; then
    echo "PartyTube ist bereit."
    exit 0
  fi
  sleep 1
done

echo "Healthcheck fehlgeschlagen. Letzte Logs:"
docker compose logs --tail=80 app || true
exit 1
