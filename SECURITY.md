# Security Policy

## Scope

PartyTube ist primaer fuer den lokalen LAN-/Heimnetz-Betrieb gedacht. Ein oeffentlicher Internetbetrieb braucht zusaetzliche Schutzmassnahmen.

## Supported versions

Es wird nur der aktuelle `main`-Stand aktiv gepflegt.

## Security report

Bitte keine Sicherheitsluecken oeffentlich als Issue posten.

Stattdessen:

- beschreibe das Problem reproduzierbar
- nenne betroffene Endpunkte, Version oder Commit
- haenge wenn moeglich Logs, Request-Beispiele oder Screenshots an

Empfohlener Weg:

- privater Kontakt ueber GitHub
- alternativ eine private Mailadresse des Maintainers, falls gepflegt

## Hardening-Hinweise

Fuer Heimnetz-Betrieb mindestens:

- `ADMIN_PIN` aendern
- `SESSION_SECRET` setzen
- `PLAYER_TOKEN_SECRET` optional getrennt setzen

Fuer Reverse Proxy / Internetbetrieb zusaetzlich:

- HTTPS erzwingen
- `SESSION_COOKIE_SECURE=true`
- `ENFORCE_HTTPS=true`
- `TRUSTED_HOSTS` setzen
- keine Default-Secrets oder Default-PIN verwenden

## Bekannte Grenzen

- Invite-only ist kein vollwertiger Auth-Mechanismus.
- YouTube-Embeds und Browser-Autoplay bleiben browserabhaengig.
- PartyTube minimiert Missbrauch im LAN, ersetzt aber keine vollwertige Zero-Trust-Architektur.
