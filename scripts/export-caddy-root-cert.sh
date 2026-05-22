#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

OUTPUT_DIR="${1:-./artifacts/certs}"
OUTPUT_FILE="${OUTPUT_DIR%/}/partytube-local-root.crt"

mkdir -p "$OUTPUT_DIR"

docker compose -f docker-compose.yml -f docker-compose.https.yml cp \
  caddy:/data/caddy/pki/authorities/local/root.crt \
  "$OUTPUT_FILE"

echo "Caddy Root-CA exportiert nach: $OUTPUT_FILE"
echo "Dieses Zertifikat muss auf Android/Chrome-Geraeten als vertrauenswuerdige CA installiert werden."
