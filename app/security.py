from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

from fastapi import HTTPException, Request

from .config import DEFAULT_ADMIN_PIN, Settings


SESSION_COOKIE_NAME = "partytube_session"
PLAYER_ACCESS_COOKIE_NAME = "partytube_player"
ADMIN_SESSION_KEY = "admin_session_id"
CSRF_HEADER_NAME = "X-PartyTube-CSRF"
PLAYER_TOKEN_HEADER_NAME = "X-PartyTube-Player-Token"


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def get_admin_session_id(request: Request) -> str | None:
    session = getattr(request, "session", None) or {}
    candidate = session.get(ADMIN_SESSION_KEY)
    return str(candidate) if candidate else None


def is_admin_request(request: Request, store) -> bool:
    session_id = get_admin_session_id(request)
    if not session_id:
        return False
    return store.get_admin_session(session_id) is not None


def get_admin_session(request: Request, store) -> dict[str, Any] | None:
    session_id = get_admin_session_id(request)
    if not session_id:
        return None
    return store.get_admin_session(session_id)


def require_admin(request: Request, store) -> dict[str, Any]:
    session = get_admin_session(request, store)
    if not session:
        raise HTTPException(status_code=401, detail="Admin-Login erforderlich.")
    return session


def require_admin_csrf(request: Request, store) -> dict[str, Any]:
    session = require_admin(request, store)
    candidate = request.headers.get(CSRF_HEADER_NAME, "").strip()
    if not candidate:
        raise HTTPException(status_code=403, detail="CSRF-Token fehlt.")
    if not hmac.compare_digest(candidate, str(session["csrfToken"])):
        raise HTTPException(status_code=403, detail="CSRF-Token ungueltig.")
    return session


def start_admin_session(request: Request, store, settings: Settings) -> dict[str, str]:
    session_id = new_session_id()
    csrf_token = new_csrf_token()
    store.create_admin_session(session_id, csrf_token, settings.session_max_age_seconds)
    request.session.clear()
    request.session[ADMIN_SESSION_KEY] = session_id
    return {"sessionId": session_id, "csrfToken": csrf_token}


def end_admin_session(request: Request, store) -> None:
    session_id = get_admin_session_id(request)
    if session_id:
        store.delete_admin_session(session_id)
    request.session.clear()


def build_player_token(settings: Settings, party_code: str) -> str:
    payload = f"player:{party_code}".encode("utf-8")
    secret = settings.player_token_secret.encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def validate_player_token(candidate: str | None, settings: Settings, party_code: str) -> bool:
    if not candidate:
        return False
    expected = build_player_token(settings, party_code)
    return hmac.compare_digest(candidate.strip(), expected)


def is_player_authorized(request: Request, settings: Settings, party_code: str, store) -> bool:
    if is_admin_request(request, store):
        return True
    query_token = request.query_params.get("player_key")
    cookie_token = request.cookies.get(PLAYER_ACCESS_COOKIE_NAME)
    return validate_player_token(query_token, settings, party_code) or validate_player_token(
        cookie_token, settings, party_code
    )


def security_warnings(settings: Settings, resolved_base_url: str, base_url_override: str) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []

    if settings.admin_pin_is_default or settings.admin_pin == DEFAULT_ADMIN_PIN:
        warnings.append(
            {
                "level": "critical",
                "title": "Standard-PIN aktiv",
                "detail": "Die Admin-PIN steht noch auf dem Default-Wert. Bitte direkt im .env auf einen eigenen PIN wechseln.",
            }
        )

    if settings.session_secret_is_default:
        warnings.append(
            {
                "level": "critical",
                "title": "Unsicheres Secret aktiv",
                "detail": "Session- oder Player-Secret sieht nach Platzhalter aus. Setze SESSION_SECRET oder ADMIN_COOKIE_SECRET auf einen langen Zufallswert.",
            }
        )
    elif settings.session_secret_is_ephemeral:
        warnings.append(
            {
                "level": "warning",
                "title": "Ephemeres Secret aktiv",
                "detail": "Es wurde kein festes Secret gesetzt. Nach jedem Neustart werden Sessions und Player-Zugriffe ungültig.",
            }
        )

    if not settings.enforce_https:
        warnings.append(
            {
                "level": "info",
                "title": "HTTPS ist deaktiviert",
                "detail": "Für das LAN ist das okay. Für Internet- oder Reverse-Proxy-Betrieb aktiviere ENFORCE_HTTPS und SESSION_COOKIE_SECURE.",
            }
        )

    if not base_url_override and "localhost" in resolved_base_url:
        warnings.append(
            {
                "level": "warning",
                "title": "Base-URL zeigt noch auf localhost",
                "detail": "Gäste im WLAN können localhost nicht erreichen. Setze BASE_URL oder öffne die App über die echte LAN-Adresse.",
            }
        )

    if not base_url_override and resolved_base_url.startswith("http://127.0.0.1"):
        warnings.append(
            {
                "level": "warning",
                "title": "Base-URL zeigt auf 127.0.0.1",
                "detail": "Für QR-Codes und Gastlinks sollte die App über die LAN-IP oder einen lokalen Hostnamen geöffnet werden.",
            }
        )

    return warnings
