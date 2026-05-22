$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

$outputDir = if ($args.Length -gt 0) { $args[0] } else { ".\artifacts\certs" }
$outputFile = Join-Path $outputDir "partytube-local-root.crt"

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

docker compose -f docker-compose.yml -f docker-compose.https.yml cp `
  caddy:/data/caddy/pki/authorities/local/root.crt `
  $outputFile | Out-Null

Write-Output "Caddy Root-CA exportiert nach: $outputFile"
Write-Output "Dieses Zertifikat muss auf Android/Chrome-Geraeten als vertrauenswuerdige CA installiert werden."
