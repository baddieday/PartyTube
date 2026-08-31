from __future__ import annotations

import asyncio
import csv
import io
import json
import secrets
import time
from collections import defaultdict, deque
from contextlib import suppress
from typing import Any
from urllib.parse import urlencode, urlparse

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import ALLOWED_CROSSFADE_SECONDS, ROOT_DIR, Settings, _normalized_party_code, load_settings
from .metrics import MetricsTracker
from .qr import make_qr_data_uri, make_wifi_qr_payload
from .security import (
    CSRF_HEADER_NAME,
    PLAYER_ACCESS_COOKIE_NAME,
    PLAYER_TOKEN_HEADER_NAME,
    SESSION_COOKIE_NAME,
    build_player_token,
    end_admin_session,
    is_admin_request,
    is_player_authorized,
    require_admin,
    require_admin_csrf,
    security_warnings,
    start_admin_session,
    validate_player_token,
)
from .storage import (
    AddSongInput,
    AlreadySkipVotedError,
    AlreadyVotedError,
    ChatMessageInput,
    DuplicateSongError,
    NotFoundError,
    PartyStore,
    QueueLimitError,
)
from .youtube import InvalidYouTubeUrl, extract_first_youtube_url, parse_video
from .version import APP_VERSION


settings = load_settings()
CLIENT_ROLES = frozenset({"guest", "admin", "player", "audio", "screen", "start"})
store = PartyStore(
    settings.db_path,
    history_limit=settings.history_limit,
    max_queue_items=settings.max_queue_items,
    chat_history_limit=settings.chat_history_limit,
)
templates = Jinja2Templates(directory=str(ROOT_DIR / "app" / "templates"))
metrics = MetricsTracker()
_state_revision = 0


class SelectiveHTTPSRedirectMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        forwarded_proto = next(
            (
                value.decode("latin-1").split(",", 1)[0].strip().lower()
                for key, value in scope.get("headers", [])
                if key == b"x-forwarded-proto"
            ),
            "",
        )

        if scope.get("scheme") == "https" or forwarded_proto == "https" or scope.get("path") == "/health":
            await self.app(scope, receive, send)
            return

        host = next((value.decode("latin-1") for key, value in scope.get("headers", []) if key == b"host"), "")
        path = scope.get("raw_path", b"").decode("latin-1") or scope.get("path", "/")
        query = scope.get("query_string", b"").decode("latin-1")
        destination = f"https://{host}{path}"
        if query:
            destination = f"{destination}?{query}"
        response = RedirectResponse(destination, status_code=307)
        await response(scope, receive, send)


class ConnectionHub:
    def __init__(self, tracker: MetricsTracker) -> None:
        self.connections: set[WebSocket] = set()
        self.meta: dict[WebSocket, dict[str, str]] = {}
        self.lock = asyncio.Lock()
        self.tracker = tracker

    async def connect(self, websocket: WebSocket, meta: dict[str, str] | None = None) -> None:
        await websocket.accept()
        async with self.lock:
            self.connections.add(websocket)
            self.meta[websocket] = meta or {}
            self.tracker.set_gauge("active_websocket_connections", len(self.connections))

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self.lock:
            self.connections.discard(websocket)
            self.meta.pop(websocket, None)
            self.tracker.set_gauge("active_websocket_connections", len(self.connections))

    async def snapshot(self) -> list[tuple[WebSocket, dict[str, str]]]:
        async with self.lock:
            return [(socket, dict(self.meta.get(socket, {}))) for socket in self.connections]

    async def broadcast(self, payload: dict[str, Any]) -> None:
        message = json.dumps(payload)
        sockets = await self.snapshot()
        stale: list[WebSocket] = []
        for socket, _meta in sockets:
            try:
                await socket.send_text(message)
            except RuntimeError:
                stale.append(socket)
        if stale:
            async with self.lock:
                for socket in stale:
                    self.connections.discard(socket)
                    self.meta.pop(socket, None)
                self.tracker.set_gauge("active_websocket_connections", len(self.connections))


class RateLimitExceeded(Exception):
    def __init__(self, message: str, retry_after_seconds: int) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after_seconds = retry_after_seconds


class RateLimiter:
    def __init__(self) -> None:
        self.events: dict[str, deque[float]] = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        async with self.lock:
            bucket = self.events[key]
            while bucket and bucket[0] < now - window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                wait_seconds = max(1, int(window_seconds - (now - bucket[0])))
                raise RateLimitExceeded(
                    "Zu viele Aktionen in kurzer Zeit. Bitte kurz warten.",
                    wait_seconds,
                )
            bucket.append(now)


hub = ConnectionHub(metrics)
rate_limiter = RateLimiter()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _sanitize_guest_name(value: str | None) -> str:
    if not value:
        return ""
    cleaned = "".join(char for char in value.strip() if char.isprintable())
    cleaned = cleaned.replace("<", "").replace(">", "")
    return cleaned[: settings.max_guest_name_length]


def _sanitize_message(value: str | None) -> str:
    if not value:
        return ""
    cleaned = "".join(char for char in value.strip() if char.isprintable())
    return cleaned


def _device_id(request: Request, payload: dict[str, Any]) -> str:
    candidate = str(payload.get("deviceId", "")).strip()
    if candidate:
        return candidate[:80]
    return request.cookies.get("partytube-device-id") or _client_ip(request) or secrets.token_hex(8)


def _runtime_flag(value: Any, default: bool) -> bool:
    if value is None or value == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _runtime_int(value: Any, default: int, minimum: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return max(minimum, int(str(value).strip()))
    except ValueError:
        return default


def _runtime_crossfade(value: Any, default: int) -> int:
    candidate = _runtime_int(value, default)
    return candidate if candidate in ALLOWED_CROSSFADE_SECONDS else default


def _client_role(value: Any) -> str:
    role = str(value or "guest").strip().lower()
    return role if role in CLIENT_ROLES else "guest"


def _clean_text(value: Any, limit: int) -> str:
    cleaned = "".join(char for char in str(value or "").strip() if char.isprintable())
    return cleaned[:limit]


def _resolved_base_url(request: Request, runtime_settings: dict[str, str]) -> str:
    override = str(runtime_settings.get("baseUrl", "")).strip().rstrip("/")
    if override:
        parsed = urlparse(override)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return override

    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{scheme}://{host}".rstrip("/")


def _display_address(parsed_url) -> str:
    host = parsed_url.hostname or settings.host_ip
    port = parsed_url.port
    if port and not (
        (parsed_url.scheme == "http" and port == 80)
        or (parsed_url.scheme == "https" and port == 443)
    ):
        return f"{host}:{port}"
    return host


def _apply_runtime_limits(runtime_settings: dict[str, str]) -> None:
    store.max_queue_items = _runtime_int(runtime_settings.get("maxQueueItems"), settings.max_queue_items, minimum=1)


def _player_urls(party_code: str) -> dict[str, str]:
    token = build_player_token(settings, party_code)
    return {
        "token": token,
        "playerUrl": f"/player?player_key={token}",
        "audioUrl": f"/audio?player_key={token}",
    }


def _resolved_settings(request: Request) -> dict[str, Any]:
    runtime_settings = store.get_runtime_settings()
    _apply_runtime_limits(runtime_settings)

    party_name = runtime_settings.get("partyName", settings.party_name).strip() or settings.party_name
    party_code = _normalized_party_code(runtime_settings.get("partyCode", settings.party_code))
    base_url = _resolved_base_url(request, runtime_settings)
    parsed = urlparse(base_url)

    wifi_ssid = runtime_settings.get("wifiSsid", settings.wifi_ssid).strip()
    wifi_password = runtime_settings.get("wifiPassword", settings.wifi_password).strip()
    wifi_security = runtime_settings.get("wifiSecurity", settings.wifi_security).strip().upper() or settings.wifi_security
    wifi_hidden = _runtime_flag(runtime_settings.get("wifiHidden"), settings.wifi_hidden)

    chat_enabled = _runtime_flag(runtime_settings.get("chatEnabled"), settings.chat_enabled)
    voting_enabled = _runtime_flag(runtime_settings.get("votingEnabled"), settings.voting_enabled)
    invite_only_mode = _runtime_flag(runtime_settings.get("inviteOnlyMode"), settings.invite_only_mode)
    autoplay_enabled = _runtime_flag(runtime_settings.get("autoplayEnabled"), settings.autoplay_enabled)
    crossfade_seconds = _runtime_crossfade(runtime_settings.get("crossfadeSeconds"), settings.crossfade_seconds)
    skip_voting_enabled = _runtime_flag(runtime_settings.get("skipVotingEnabled"), settings.skip_voting_enabled)
    skip_vote_threshold_percent = min(
        100,
        max(10, _runtime_int(runtime_settings.get("skipVoteThresholdPercent"), settings.skip_vote_threshold_percent, minimum=10)),
    )
    history_public = _runtime_flag(runtime_settings.get("historyPublic"), settings.history_public)
    readd_enabled = _runtime_flag(runtime_settings.get("readdEnabled"), settings.readd_enabled)
    party_screen_enabled = _runtime_flag(runtime_settings.get("partyScreenEnabled"), settings.party_screen_enabled)
    wifi_qr_enabled = _runtime_flag(runtime_settings.get("wifiQrEnabled"), settings.wifi_qr_enabled)
    show_wifi_password_on_screen = _runtime_flag(
        runtime_settings.get("showWifiPasswordOnScreen"),
        settings.show_wifi_password_on_screen,
    )
    party_screen_show_active_guests = _runtime_flag(
        runtime_settings.get("partyScreenShowActiveGuests"),
        settings.party_screen_show_active_guests,
    )
    party_screen_show_skip_status = _runtime_flag(
        runtime_settings.get("partyScreenShowSkipStatus"),
        settings.party_screen_show_skip_status,
    )
    max_songs_per_device = min(
        100,
        _runtime_int(
            runtime_settings.get("maxSongsPerDevice"),
            settings.max_songs_per_device,
            minimum=1,
        ),
    )
    max_queue_items = _runtime_int(
        runtime_settings.get("maxQueueItems"),
        settings.max_queue_items,
        minimum=1,
    )

    warnings = security_warnings(settings, base_url, runtime_settings.get("baseUrl", "").strip())

    return {
        "app_name": settings.app_name,
        "party_name": party_name,
        "party_code": party_code,
        "host_ip": parsed.hostname or settings.host_ip,
        "public_port": parsed.port
        or (443 if parsed.scheme == "https" else 80 if parsed.scheme == "http" else settings.public_port),
        "display_address": _display_address(parsed),
        "base_url": base_url,
        "join_url": f"{base_url}/join/{party_code}",
        "admin_url": f"{base_url}/admin",
        "start_url": f"{base_url}/start",
        "player_url": f"{base_url}/player",
        "audio_url": f"{base_url}/audio",
        "wifi_ssid": wifi_ssid,
        "wifi_password": wifi_password,
        "wifi_security": wifi_security,
        "wifi_hidden": wifi_hidden,
        "wifi_configured": bool(wifi_ssid and (wifi_password or wifi_security == "NOPASS")),
        "base_url_override": runtime_settings.get("baseUrl", "").strip(),
        "autoplay_enabled": autoplay_enabled,
        "crossfade_seconds": crossfade_seconds,
        "chat_enabled": chat_enabled,
        "voting_enabled": voting_enabled,
        "invite_only_mode": invite_only_mode,
        "skip_voting_enabled": skip_voting_enabled,
        "skip_vote_threshold_percent": skip_vote_threshold_percent,
        "active_guest_window_seconds": settings.active_guest_window_seconds,
        "history_public": history_public,
        "readd_enabled": readd_enabled,
        "party_screen_enabled": party_screen_enabled,
        "wifi_qr_enabled": wifi_qr_enabled,
        "show_wifi_password_on_screen": show_wifi_password_on_screen,
        "party_screen_show_active_guests": party_screen_show_active_guests,
        "party_screen_show_skip_status": party_screen_show_skip_status,
        "max_songs_per_device": max_songs_per_device,
        "max_queue_items": max_queue_items,
        "warnings": warnings,
        "session_cookie_secure": settings.session_cookie_secure,
        "trusted_hosts_enabled": bool(settings.trusted_hosts),
        "https_enforced": settings.enforce_https,
    }


def _runtime_public_state(request: Request | None = None) -> dict[str, Any]:
    runtime_settings = store.get_runtime_settings()
    resolved = _resolved_settings(request) if request else None
    return {
        "autoplayEnabled": resolved["autoplay_enabled"] if resolved else _runtime_flag(runtime_settings.get("autoplayEnabled"), settings.autoplay_enabled),
        "crossfadeSeconds": resolved["crossfade_seconds"] if resolved else _runtime_crossfade(runtime_settings.get("crossfadeSeconds"), settings.crossfade_seconds),
        "chatEnabled": resolved["chat_enabled"] if resolved else _runtime_flag(runtime_settings.get("chatEnabled"), settings.chat_enabled),
        "votingEnabled": resolved["voting_enabled"] if resolved else _runtime_flag(runtime_settings.get("votingEnabled"), settings.voting_enabled),
        "inviteOnlyMode": resolved["invite_only_mode"] if resolved else _runtime_flag(runtime_settings.get("inviteOnlyMode"), settings.invite_only_mode),
        "skipVotingEnabled": resolved["skip_voting_enabled"] if resolved else _runtime_flag(runtime_settings.get("skipVotingEnabled"), settings.skip_voting_enabled),
        "skipThresholdPercent": resolved["skip_vote_threshold_percent"] if resolved else min(100, max(10, _runtime_int(runtime_settings.get("skipVoteThresholdPercent"), settings.skip_vote_threshold_percent, minimum=10))),
        "activeGuestWindowSeconds": resolved["active_guest_window_seconds"] if resolved else settings.active_guest_window_seconds,
        "historyPublic": resolved["history_public"] if resolved else _runtime_flag(runtime_settings.get("historyPublic"), settings.history_public),
        "readdEnabled": resolved["readd_enabled"] if resolved else _runtime_flag(runtime_settings.get("readdEnabled"), settings.readd_enabled),
        "partyScreenEnabled": resolved["party_screen_enabled"] if resolved else _runtime_flag(runtime_settings.get("partyScreenEnabled"), settings.party_screen_enabled),
        "wifiQrEnabled": resolved["wifi_qr_enabled"] if resolved else _runtime_flag(runtime_settings.get("wifiQrEnabled"), settings.wifi_qr_enabled),
        "showWifiPasswordOnScreen": resolved["show_wifi_password_on_screen"] if resolved else _runtime_flag(runtime_settings.get("showWifiPasswordOnScreen"), settings.show_wifi_password_on_screen),
        "partyScreenShowActiveGuests": resolved["party_screen_show_active_guests"] if resolved else _runtime_flag(runtime_settings.get("partyScreenShowActiveGuests"), settings.party_screen_show_active_guests),
        "partyScreenShowSkipStatus": resolved["party_screen_show_skip_status"] if resolved else _runtime_flag(runtime_settings.get("partyScreenShowSkipStatus"), settings.party_screen_show_skip_status),
        "maxSongsPerDevice": resolved["max_songs_per_device"] if resolved else _runtime_int(runtime_settings.get("maxSongsPerDevice"), settings.max_songs_per_device, minimum=1),
        "maxQueueItems": resolved["max_queue_items"] if resolved else _runtime_int(runtime_settings.get("maxQueueItems"), settings.max_queue_items, minimum=1),
    }


def _bounded_state_for_role(state: dict[str, Any], role: str) -> dict[str, Any]:
    if role not in {"player", "audio", "screen"}:
        return state

    state["queue"] = state.get("queue", [])[:3]
    state["messages"] = []
    state["history"] = [] if role == "screen" else state.get("history", [])[:12]
    return state


def _state_payload(request: Request, device_id: str | None = None, role: str = "guest") -> dict[str, Any]:
    state = store.get_state()
    resolved_settings = _resolved_settings(request)
    player_authorized = is_player_authorized(request, settings, resolved_settings["party_code"], store)
    skip_status = store.get_skip_status(
        device_id=device_id,
        active_window_seconds=resolved_settings["active_guest_window_seconds"],
        threshold_percent=resolved_settings["skip_vote_threshold_percent"],
        enabled=resolved_settings["skip_voting_enabled"],
    )
    state["meta"] = {
        "partyName": resolved_settings["party_name"],
        "partyCode": resolved_settings["party_code"],
        "baseUrl": resolved_settings["base_url"],
        "joinUrl": resolved_settings["join_url"],
        "hostIp": resolved_settings["host_ip"],
        "port": resolved_settings["public_port"],
        "displayAddress": resolved_settings["display_address"],
        "adminAuthenticated": is_admin_request(request, store),
        "playerAuthorized": player_authorized,
    }
    state["runtime"] = _runtime_public_state(request)
    state["skipVoting"] = skip_status
    state["revision"] = _state_revision
    state.update(skip_status)
    return _bounded_state_for_role(state, role)


def _state_payload_without_request(
    device_id: str | None = None,
    role: str = "guest",
    revision: int | None = None,
) -> dict[str, Any]:
    state = store.get_state()
    runtime = _runtime_public_state()
    skip_status = store.get_skip_status(
        device_id=device_id,
        active_window_seconds=settings.active_guest_window_seconds,
        threshold_percent=runtime["skipThresholdPercent"],
        enabled=runtime["skipVotingEnabled"],
    )
    state["type"] = "state"
    state["runtime"] = runtime
    state["skipVoting"] = skip_status
    state["revision"] = _state_revision if revision is None else revision
    state.update(skip_status)
    return _bounded_state_for_role(state, role)


async def _broadcast_state() -> None:
    global _state_revision
    _state_revision += 1
    revision = _state_revision
    stale: list[WebSocket] = []
    for socket, meta in await hub.snapshot():
        try:
            await socket.send_text(
                json.dumps(
                    _state_payload_without_request(
                        meta.get("deviceId"),
                        meta.get("role", "guest"),
                        revision,
                    )
                )
            )
        except RuntimeError:
            stale.append(socket)
    for socket in stale:
        await hub.disconnect(socket)


def _template_context(request: Request, page: str, *, join_error: str = "", invite_gate: bool = False) -> dict[str, Any]:
    resolved_settings = _resolved_settings(request)
    player_links = _player_urls(resolved_settings["party_code"])
    admin_authenticated = is_admin_request(request, store)
    player_authorized = is_player_authorized(request, settings, resolved_settings["party_code"], store)
    admin_session = require_admin(request, store) if admin_authenticated else None

    wifi_qr = None
    if resolved_settings["wifi_configured"]:
        wifi_qr = make_qr_data_uri(
            make_wifi_qr_payload(
                resolved_settings["wifi_ssid"],
                resolved_settings["wifi_password"],
                resolved_settings["wifi_security"],
                resolved_settings["wifi_hidden"],
            )
        )

    secure_player_url = player_links["playerUrl"] if admin_authenticated else "/player"
    secure_audio_url = player_links["audioUrl"] if admin_authenticated else "/audio"

    app_config = {
        "page": page,
        "partyName": resolved_settings["party_name"],
        "partyCode": resolved_settings["party_code"],
        "baseUrl": resolved_settings["base_url"],
        "joinUrl": resolved_settings["join_url"],
        "hostIp": resolved_settings["host_ip"],
        "port": resolved_settings["public_port"],
        "displayAddress": resolved_settings["display_address"],
        "adminAuthenticated": admin_authenticated,
        "wifiConfigured": resolved_settings["wifi_configured"],
        "autoplayEnabled": resolved_settings["autoplay_enabled"],
        "crossfadeSeconds": resolved_settings["crossfade_seconds"],
        "chatEnabled": resolved_settings["chat_enabled"],
        "votingEnabled": resolved_settings["voting_enabled"],
        "inviteOnlyMode": resolved_settings["invite_only_mode"],
        "skipVotingEnabled": resolved_settings["skip_voting_enabled"],
        "skipThresholdPercent": resolved_settings["skip_vote_threshold_percent"],
        "activeGuestWindowSeconds": resolved_settings["active_guest_window_seconds"],
        "historyPublic": resolved_settings["history_public"],
        "readdEnabled": resolved_settings["readd_enabled"],
        "partyScreenEnabled": resolved_settings["party_screen_enabled"],
        "wifiQrEnabled": resolved_settings["wifi_qr_enabled"],
        "showWifiPasswordOnScreen": resolved_settings["show_wifi_password_on_screen"],
        "partyScreenShowActiveGuests": resolved_settings["party_screen_show_active_guests"],
        "partyScreenShowSkipStatus": resolved_settings["party_screen_show_skip_status"],
        "maxSongsPerDevice": resolved_settings["max_songs_per_device"],
        "clientRole": {
            "admin": "admin",
            "player": "player",
            "audio": "audio",
            "party-screen": "screen",
            "start": "start",
        }.get(page, "guest"),
        "csrfToken": admin_session["csrfToken"] if admin_session else "",
        "playerAuthorized": player_authorized,
        "playerControlToken": player_links["token"] if player_authorized else "",
        "playerUrl": secure_player_url,
        "audioUrl": secure_audio_url,
        "securePlayerUrl": secure_player_url,
        "secureAudioUrl": secure_audio_url,
        "warnings": resolved_settings["warnings"],
    }

    return {
        "request": request,
        "page": page,
        "settings": resolved_settings,
        "wifi_qr_data_uri": wifi_qr,
        "screen_wifi_qr_data_uri": wifi_qr if resolved_settings["wifi_qr_enabled"] else None,
        "link_qr_data_uri": make_qr_data_uri(resolved_settings["join_url"]),
        "app_config": app_config,
        "join_error": join_error,
        "invite_gate": invite_gate,
        "player_links": player_links,
        "muted_devices": store.list_muted_devices() if admin_authenticated else [],
    }


def _set_player_cookie_if_authorized(request: Request, response: HTMLResponse, party_code: str) -> None:
    token = build_player_token(settings, party_code)
    if is_player_authorized(request, settings, party_code, store):
        response.set_cookie(
            PLAYER_ACCESS_COOKIE_NAME,
            token,
            httponly=True,
            samesite="lax",
            secure=settings.session_cookie_secure,
            max_age=settings.session_max_age_seconds,
        )
    elif request.cookies.get(PLAYER_ACCESS_COOKIE_NAME):
        response.delete_cookie(PLAYER_ACCESS_COOKIE_NAME)


def _admin_status_payload(request: Request) -> dict[str, Any]:
    resolved_settings = _resolved_settings(request)
    authenticated = is_admin_request(request, store)
    session = require_admin(request, store) if authenticated else None
    player_links = _player_urls(resolved_settings["party_code"])
    player_url = player_links["playerUrl"] if authenticated else "/player"
    audio_url = player_links["audioUrl"] if authenticated else "/audio"
    return {
        "authenticated": authenticated,
        "csrfToken": session["csrfToken"] if session else "",
        "warnings": resolved_settings["warnings"],
        "playerUrl": player_url,
        "audioUrl": audio_url,
        "playerTokenAvailable": authenticated,
    }


def _ensure_device_not_muted(device_id: str) -> None:
    muted = store.is_device_muted(device_id)
    if not muted:
        return
    detail = "Dieses Gerät wurde vorübergehend gesperrt."
    if muted.get("expiresAt"):
        detail = "Dieses Gerät wurde vorübergehend gesperrt. Bitte später erneut versuchen."
    raise HTTPException(status_code=403, detail=detail)


def _record_activity_from_payload(request: Request, payload: dict[str, Any], role: str = "guest") -> str:
    device_id = _device_id(request, payload)
    guest_name = _sanitize_guest_name(payload.get("guestName"))
    store.record_guest_activity(device_id, guest_name, role=role)
    return device_id


def _history_export_payload(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "videoId": row["videoId"],
            "title": row["title"],
            "guestName": row.get("guestName") or "",
            "votes": row.get("votes") or 0,
            "status": row.get("status"),
            "statusLabel": row.get("statusLabel"),
            "addedAt": row.get("addedAt"),
            "completedAt": row.get("completedAt"),
            "completedReason": row.get("completedReason"),
            "canonicalUrl": row.get("canonicalUrl"),
            "readdCount": row.get("readdCount") or 0,
            "bestScore": row.get("bestScore"),
        }
        for row in rows
    ]


def _csv_response(filename: str, rows: list[dict[str, Any]]) -> PlainTextResponse:
    output = io.StringIO()
    fieldnames = list(rows[0].keys()) if rows else [
        "id",
        "videoId",
        "title",
        "guestName",
        "votes",
        "status",
        "statusLabel",
        "addedAt",
        "completedAt",
        "completedReason",
        "canonicalUrl",
        "readdCount",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return PlainTextResponse(
        output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _txt_response(filename: str, rows: list[dict[str, Any]]) -> PlainTextResponse:
    lines = [f"{row.get('title', '')} - {row.get('canonicalUrl', '')}" for row in rows]
    return PlainTextResponse(
        "\n".join(lines) + ("\n" if lines else ""),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


app = FastAPI(title=settings.app_name)

if settings.trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.trusted_hosts))

if settings.enforce_https:
    app.add_middleware(SelectiveHTTPSRedirectMiddleware)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    session_cookie=SESSION_COOKIE_NAME,
    same_site="lax",
    https_only=settings.session_cookie_secure,
    max_age=settings.session_max_age_seconds,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.mount("/static", StaticFiles(directory=ROOT_DIR / "app" / "static"), name="static")


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exception_handler(_: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(exc.retry_after_seconds)},
        content={
            "detail": exc.message,
            "retryAfterSeconds": exc.retry_after_seconds,
        },
    )


@app.middleware("http")
async def request_metrics(request: Request, call_next):
    path = request.url.path
    with metrics.track_request(request.method, path) as labels:
        response = await call_next(request)
        labels["status"] = str(response.status_code)
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "base-uri 'self'; "
        "object-src 'none'; "
        "form-action 'self'; "
        "img-src 'self' data: https://i.ytimg.com https://img.youtube.com; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' https://www.youtube.com https://s.ytimg.com; "
        "frame-src https://www.youtube.com https://www.youtube-nocookie.com; "
        "connect-src 'self' ws: wss:; "
        "font-src 'self' data:;"
    )
    return response


@app.api_route("/health", methods=["GET", "HEAD"])
async def health() -> dict[str, str]:
    return {"status": "ok", "version": APP_VERSION}


@app.get("/metrics")
async def metrics_endpoint() -> PlainTextResponse:
    if not settings.enable_metrics:
        raise HTTPException(status_code=404, detail="Nicht verfügbar.")
    state = store.get_state()
    metrics.set_gauge("songs_active", state["stats"]["activeCount"])
    metrics.set_gauge("messages_visible", state["stats"]["messageCount"])
    metrics.set_gauge("muted_devices", state["stats"]["mutedDeviceCount"])
    skip_status = store.get_skip_status(
        active_window_seconds=settings.active_guest_window_seconds,
        threshold_percent=_runtime_public_state()["skipThresholdPercent"],
        enabled=_runtime_public_state()["skipVotingEnabled"],
    )
    metrics.set_gauge("active_guests", skip_status["activeGuestCount"])
    metrics.set_gauge("current_skip_votes", skip_status["currentSkipVoteCount"])
    return PlainTextResponse(metrics.render_prometheus(), media_type="text/plain; version=0.0.4")


@app.get("/", response_class=HTMLResponse)
async def guest_home(request: Request) -> HTMLResponse:
    resolved_settings = _resolved_settings(request)
    if resolved_settings["invite_only_mode"]:
        return templates.TemplateResponse(
            "join_gate.html",
            _template_context(request, "join", invite_gate=True),
        )
    return templates.TemplateResponse("guest.html", _template_context(request, "guest"))


@app.get("/join", response_class=HTMLResponse)
async def guest_join_gate(request: Request, code: str = ""):
    normalized = _normalized_party_code(code) if code else ""
    if normalized:
        return RedirectResponse(url=f"/join/{normalized}", status_code=303)
    return templates.TemplateResponse("join_gate.html", _template_context(request, "join", invite_gate=True))


@app.get("/share-target")
async def share_target(request: Request, title: str = "", text: str = "", url: str = "") -> RedirectResponse:
    shared_url = None
    max_scan_length = max(settings.max_url_length * 4, 1200)
    for candidate in (url, text, title):
        shared_url = extract_first_youtube_url(
            candidate,
            max_input_length=max_scan_length,
            max_url_length=settings.max_url_length,
        )
        if shared_url:
            break

    if not shared_url:
        return RedirectResponse(url="/?share_error=invalid", status_code=303)

    share_flow_id = secrets.token_urlsafe(8)
    return RedirectResponse(
        url=f"/?{urlencode({'shared_url': shared_url, 'shared_submit': '1', 'share_flow_id': share_flow_id})}",
        status_code=303,
    )


@app.get("/start", response_class=HTMLResponse)
async def start_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("start.html", _template_context(request, "start"))


@app.get("/join/{party_code}", response_class=HTMLResponse)
async def guest_join(request: Request, party_code: str) -> HTMLResponse:
    resolved_settings = _resolved_settings(request)
    if party_code != resolved_settings["party_code"]:
        if resolved_settings["invite_only_mode"]:
            return templates.TemplateResponse(
                "join_gate.html",
                _template_context(
                    request,
                    "join",
                    join_error="Der Party-Code passt nicht zu dieser Session. Bitte scanne den QR-Code erneut oder frage den Host nach dem richtigen Link.",
                    invite_gate=True,
                ),
                status_code=404,
            )
        raise HTTPException(status_code=404, detail="Falscher Party-Code.")
    return templates.TemplateResponse("guest.html", _template_context(request, "guest"))


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("admin.html", _template_context(request, "admin"))


@app.get("/player", response_class=HTMLResponse)
async def player_page(request: Request) -> HTMLResponse:
    context = _template_context(request, "player")
    response = templates.TemplateResponse("player.html", context)
    _set_player_cookie_if_authorized(request, response, context["settings"]["party_code"])
    return response


@app.get("/audio", response_class=HTMLResponse)
async def audio_page(request: Request) -> HTMLResponse:
    context = _template_context(request, "audio")
    response = templates.TemplateResponse("audio.html", context)
    _set_player_cookie_if_authorized(request, response, context["settings"]["party_code"])
    return response


@app.get("/qr", response_class=HTMLResponse)
async def qr_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("qr.html", _template_context(request, "qr"))


@app.get("/history", response_class=HTMLResponse)
async def history_page(request: Request) -> HTMLResponse:
    resolved_settings = _resolved_settings(request)
    if not resolved_settings["history_public"] and not is_admin_request(request, store):
        raise HTTPException(status_code=403, detail="Der Verlauf ist aktuell nur für den Host sichtbar.")
    return templates.TemplateResponse("history.html", _template_context(request, "history"))


@app.get("/admin/best-of", response_class=HTMLResponse)
async def best_of_page(request: Request) -> HTMLResponse:
    require_admin(request, store)
    return templates.TemplateResponse("best_of.html", _template_context(request, "best-of"))


@app.get("/party-screen", response_class=HTMLResponse)
async def party_screen_page(request: Request) -> HTMLResponse:
    resolved_settings = _resolved_settings(request)
    if not resolved_settings["party_screen_enabled"]:
        raise HTTPException(status_code=404, detail="Party-Screen ist aktuell deaktiviert.")
    return templates.TemplateResponse("party_screen.html", _template_context(request, "party-screen"))


@app.get("/screen", response_class=HTMLResponse)
@app.get("/tv", response_class=HTMLResponse)
async def party_screen_alias(request: Request) -> HTMLResponse:
    return await party_screen_page(request)


@app.api_route("/manifest.webmanifest", methods=["GET", "HEAD"])
async def manifest(request: Request) -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    return JSONResponse(
        {
            "name": f"{settings.app_name} - {resolved_settings['party_name']}",
            "short_name": settings.app_name,
            "id": "/",
            "description": "Lokale Party-Jukebox für YouTube-Links, Voting und TV-Screen im Heimnetz.",
            "start_url": "/",
            "scope": "/",
            "display": "standalone",
            "background_color": "#050505",
            "theme_color": "#050505",
            "icons": [
                {
                    "src": "/static/img/icon.svg",
                    "sizes": "any",
                    "type": "image/svg+xml",
                    "purpose": "any maskable",
                },
                {
                    "src": "/static/img/icon-128.png",
                    "sizes": "128x128",
                    "type": "image/png",
                },
                {
                    "src": "/static/img/icon-192.png",
                    "sizes": "192x192",
                    "type": "image/png",
                    "purpose": "any maskable",
                },
                {
                    "src": "/static/img/icon-512.png",
                    "sizes": "512x512",
                    "type": "image/png",
                    "purpose": "any maskable",
                },
            ],
            "share_target": {
                "action": "/share-target",
                "method": "GET",
                "params": {
                    "title": "title",
                    "text": "text",
                    "url": "url",
                },
            },
        }
        ,
        media_type="application/manifest+json",
    )


@app.api_route("/sw.js", methods=["GET", "HEAD"])
async def service_worker() -> FileResponse:
    return FileResponse(
        ROOT_DIR / "app" / "static" / "sw.js",
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Service-Worker-Allowed": "/",
        },
    )


@app.get("/api/state")
async def api_state(request: Request) -> JSONResponse:
    device_id = request.query_params.get("deviceId", "").strip()[:80] or None
    role = _client_role(request.query_params.get("role"))
    if device_id and role == "guest":
        store.record_guest_activity(device_id, request.query_params.get("guestName", "").strip()[:80], role="guest")
    return JSONResponse(_state_payload(request, device_id=device_id, role=role))


@app.get("/api/admin/status")
async def api_admin_status(request: Request) -> JSONResponse:
    return JSONResponse(_admin_status_payload(request))


@app.get("/api/admin/settings")
async def api_admin_settings(request: Request) -> JSONResponse:
    require_admin(request, store)
    runtime_settings = store.get_runtime_settings()
    resolved_settings = _resolved_settings(request)
    return JSONResponse(
        {
            "partyName": resolved_settings["party_name"],
            "partyCode": resolved_settings["party_code"],
            "baseUrl": runtime_settings.get("baseUrl", "").strip(),
            "resolvedBaseUrl": resolved_settings["base_url"],
            "resolvedJoinUrl": resolved_settings["join_url"],
            "displayAddress": resolved_settings["display_address"],
            "wifiSsid": runtime_settings.get("wifiSsid", settings.wifi_ssid).strip(),
            "wifiPassword": runtime_settings.get("wifiPassword", settings.wifi_password).strip(),
            "wifiSecurity": runtime_settings.get("wifiSecurity", settings.wifi_security).strip().upper() or settings.wifi_security,
            "wifiHidden": _runtime_flag(runtime_settings.get("wifiHidden"), settings.wifi_hidden),
            "wifiConfigured": resolved_settings["wifi_configured"],
            "autoplayEnabled": resolved_settings["autoplay_enabled"],
            "crossfadeSeconds": resolved_settings["crossfade_seconds"],
            "chatEnabled": resolved_settings["chat_enabled"],
            "votingEnabled": resolved_settings["voting_enabled"],
            "inviteOnlyMode": resolved_settings["invite_only_mode"],
            "skipVotingEnabled": resolved_settings["skip_voting_enabled"],
            "skipVoteThresholdPercent": resolved_settings["skip_vote_threshold_percent"],
            "activeGuestWindowSeconds": resolved_settings["active_guest_window_seconds"],
            "historyPublic": resolved_settings["history_public"],
            "readdEnabled": resolved_settings["readd_enabled"],
            "partyScreenEnabled": resolved_settings["party_screen_enabled"],
            "wifiQrEnabled": resolved_settings["wifi_qr_enabled"],
            "showWifiPasswordOnScreen": resolved_settings["show_wifi_password_on_screen"],
            "partyScreenShowActiveGuests": resolved_settings["party_screen_show_active_guests"],
            "partyScreenShowSkipStatus": resolved_settings["party_screen_show_skip_status"],
            "maxSongsPerDevice": resolved_settings["max_songs_per_device"],
            "maxQueueItems": resolved_settings["max_queue_items"],
            "warnings": resolved_settings["warnings"],
            "mutedDevices": store.list_muted_devices(),
            "sessionCookieSecure": settings.session_cookie_secure,
            "csrfHeaderName": CSRF_HEADER_NAME,
            "playerHeaderName": PLAYER_TOKEN_HEADER_NAME,
        }
    )


@app.put("/api/admin/settings")
async def api_admin_update_settings(request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    payload = await request.json()

    party_name = _clean_text(payload.get("partyName"), 80)
    party_code_raw = _clean_text(payload.get("partyCode"), 40)
    base_url = _clean_text(payload.get("baseUrl"), 240).rstrip("/")
    wifi_ssid = _clean_text(payload.get("wifiSsid"), 64)
    wifi_password = _clean_text(payload.get("wifiPassword"), 128)
    wifi_security = _clean_text(payload.get("wifiSecurity"), 16).upper() or settings.wifi_security
    wifi_hidden = bool(payload.get("wifiHidden"))
    autoplay_enabled = bool(payload.get("autoplayEnabled"))
    crossfade_seconds = _runtime_crossfade(payload.get("crossfadeSeconds"), settings.crossfade_seconds)
    chat_enabled = bool(payload.get("chatEnabled", settings.chat_enabled))
    voting_enabled = bool(payload.get("votingEnabled", settings.voting_enabled))
    invite_only_mode = bool(payload.get("inviteOnlyMode", settings.invite_only_mode))
    skip_voting_enabled = bool(payload.get("skipVotingEnabled", settings.skip_voting_enabled))
    skip_vote_threshold_percent = min(
        100,
        max(10, _runtime_int(payload.get("skipVoteThresholdPercent"), settings.skip_vote_threshold_percent, minimum=10)),
    )
    history_public = bool(payload.get("historyPublic", settings.history_public))
    readd_enabled = bool(payload.get("readdEnabled", settings.readd_enabled))
    party_screen_enabled = bool(payload.get("partyScreenEnabled", settings.party_screen_enabled))
    wifi_qr_enabled = bool(payload.get("wifiQrEnabled", settings.wifi_qr_enabled))
    show_wifi_password_on_screen = bool(payload.get("showWifiPasswordOnScreen", settings.show_wifi_password_on_screen))
    party_screen_show_active_guests = bool(
        payload.get("partyScreenShowActiveGuests", settings.party_screen_show_active_guests)
    )
    party_screen_show_skip_status = bool(
        payload.get("partyScreenShowSkipStatus", settings.party_screen_show_skip_status)
    )
    max_songs_per_device = min(
        100,
        _runtime_int(payload.get("maxSongsPerDevice"), settings.max_songs_per_device, minimum=1),
    )
    max_queue_items = _runtime_int(payload.get("maxQueueItems"), settings.max_queue_items, minimum=1)

    if base_url:
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise HTTPException(status_code=400, detail="Die Basis-URL muss mit http:// oder https:// beginnen.")

    if wifi_security not in {"WPA", "WEP", "NOPASS"}:
        raise HTTPException(status_code=400, detail="WLAN-Sicherheit muss WPA, WEP oder NOPASS sein.")

    update_payload: dict[str, Any] = {
        "partyName": party_name or None,
        "partyCode": _normalized_party_code(party_code_raw) if party_code_raw else None,
        "baseUrl": base_url or None,
        "wifiSsid": wifi_ssid or None,
        "wifiPassword": wifi_password or None,
        "wifiSecurity": wifi_security if wifi_ssid else None,
        "wifiHidden": wifi_hidden if wifi_ssid else None,
        "autoplayEnabled": autoplay_enabled,
        "crossfadeSeconds": crossfade_seconds,
        "chatEnabled": chat_enabled,
        "votingEnabled": voting_enabled,
        "inviteOnlyMode": invite_only_mode,
        "skipVotingEnabled": skip_voting_enabled,
        "skipVoteThresholdPercent": skip_vote_threshold_percent,
        "historyPublic": history_public,
        "readdEnabled": readd_enabled,
        "partyScreenEnabled": party_screen_enabled,
        "wifiQrEnabled": wifi_qr_enabled,
        "showWifiPasswordOnScreen": show_wifi_password_on_screen,
        "partyScreenShowActiveGuests": party_screen_show_active_guests,
        "partyScreenShowSkipStatus": party_screen_show_skip_status,
        "maxSongsPerDevice": max_songs_per_device,
        "maxQueueItems": max_queue_items,
    }
    store.set_runtime_settings(update_payload)
    _apply_runtime_limits(store.get_runtime_settings())
    await _broadcast_state()
    return await api_admin_settings(request)


@app.post("/api/admin/settings/skip-voting")
async def api_admin_update_skip_voting(request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    payload = await request.json()
    threshold = min(100, max(10, _runtime_int(payload.get("skipVoteThresholdPercent"), settings.skip_vote_threshold_percent, minimum=10)))
    store.set_runtime_settings(
        {
            "skipVotingEnabled": bool(payload.get("skipVotingEnabled", settings.skip_voting_enabled)),
            "skipVoteThresholdPercent": threshold,
        }
    )
    await _broadcast_state()
    return await api_admin_settings(request)


@app.post("/api/admin/login")
async def admin_login(request: Request) -> JSONResponse:
    payload = await request.json()
    pin = str(payload.get("pin", "")).strip()
    if pin != settings.admin_pin:
        raise HTTPException(status_code=401, detail="PIN falsch.")
    session = start_admin_session(request, store, settings)
    response = JSONResponse({"ok": True, "csrfToken": session["csrfToken"], "warnings": _resolved_settings(request)["warnings"]})
    return response


@app.post("/api/admin/logout")
async def admin_logout(request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    end_admin_session(request, store)
    response = JSONResponse({"ok": True})
    response.delete_cookie(PLAYER_ACCESS_COOKIE_NAME)
    return response


@app.post("/api/songs")
async def add_song(request: Request) -> JSONResponse:
    payload = await request.json()
    resolved_settings = _resolved_settings(request)
    url = str(payload.get("url", "")).strip()
    if not url:
        raise HTTPException(status_code=400, detail="Bitte füge einen YouTube-Link ein.")
    if len(url) > settings.max_url_length:
        raise HTTPException(status_code=400, detail="Der Link ist zu lang.")

    guest_name = _sanitize_guest_name(payload.get("guestName"))
    device_id = _record_activity_from_payload(request, payload, role="guest")
    _ensure_device_not_muted(device_id)
    if store.count_active_songs_for_device(device_id) >= resolved_settings["max_songs_per_device"]:
        raise HTTPException(
            status_code=409,
            detail=f"Dieses Gerät hat bereits {resolved_settings['max_songs_per_device']} aktive Songs in der Queue.",
        )

    await rate_limiter.check(
        f"add:{_client_ip(request)}:{device_id}",
        settings.max_adds_per_window,
        settings.rate_limit_window_seconds,
    )

    try:
        parsed_video = parse_video(
            url,
            timeout=settings.title_lookup_timeout,
            enable_lookup=settings.enable_title_lookup,
        )
        song = store.add_song(
            AddSongInput(
                video_id=parsed_video.video_id,
                canonical_url=parsed_video.canonical_url,
                source_url=url,
                title=parsed_video.title,
                thumbnail_url=parsed_video.thumbnail_url,
                guest_name=guest_name,
                added_by_device=device_id,
                metadata_source=parsed_video.metadata_source,
                duration_seconds=parsed_video.duration_seconds,
            )
        )
    except InvalidYouTubeUrl as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DuplicateSongError as exc:
        return JSONResponse(
            {"ok": False, "detail": str(exc), "duplicate": exc.existing_song},
            status_code=409,
        )
    except QueueLimitError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    metrics.increment("songs_added")
    await _broadcast_state()
    return JSONResponse(
        {
            "ok": True,
            "song": song,
            "state": _state_payload(request, device_id=device_id, role="guest"),
        }
    )


@app.post("/api/songs/{song_id}/vote")
async def vote_song(song_id: int, request: Request) -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    if not resolved_settings["voting_enabled"]:
        raise HTTPException(status_code=403, detail="Voting ist für diese Party aktuell deaktiviert.")

    payload = await request.json()
    device_id = _record_activity_from_payload(request, payload, role="guest")
    _ensure_device_not_muted(device_id)
    await rate_limiter.check(
        f"vote:{_client_ip(request)}:{device_id}",
        settings.max_votes_per_window,
        settings.rate_limit_window_seconds,
    )

    try:
        song = store.vote_song(song_id, device_id)
    except AlreadyVotedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    metrics.increment("votes_recorded")
    await _broadcast_state()
    return JSONResponse({"ok": True, "song": song})


@app.post("/api/songs/current/skip-vote")
async def skip_vote_current(request: Request) -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    if not resolved_settings["skip_voting_enabled"]:
        raise HTTPException(status_code=403, detail="Skip-Voting ist für diese Party aktuell deaktiviert.")

    payload = await request.json()
    guest_name = _sanitize_guest_name(payload.get("guestName"))
    device_id = _record_activity_from_payload(request, payload, role="guest")
    if not device_id or len(device_id) < 8:
        raise HTTPException(status_code=400, detail="Ungültiges Gerät. Bitte lade die Seite neu.")
    _ensure_device_not_muted(device_id)
    await rate_limiter.check(
        f"skip:{_client_ip(request)}:{device_id}",
        settings.max_votes_per_window,
        settings.rate_limit_window_seconds,
    )

    try:
        result = store.add_skip_vote_current(
            device_id,
            guest_name,
            active_window_seconds=resolved_settings["active_guest_window_seconds"],
            threshold_percent=resolved_settings["skip_vote_threshold_percent"],
        )
    except AlreadySkipVotedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if result["triggered"]:
        metrics.increment("skip_vote_skips")
    await _broadcast_state()
    return JSONResponse({"ok": True, **result})


@app.delete("/api/songs/current/skip-vote")
async def delete_skip_vote_current(request: Request) -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    if not resolved_settings["skip_voting_enabled"]:
        raise HTTPException(status_code=403, detail="Skip-Voting ist für diese Party aktuell deaktiviert.")
    payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    device_id = _record_activity_from_payload(request, payload, role="guest")
    try:
        skip_status = store.remove_skip_vote_current(
            device_id,
            active_window_seconds=resolved_settings["active_guest_window_seconds"],
            threshold_percent=resolved_settings["skip_vote_threshold_percent"],
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _broadcast_state()
    return JSONResponse({"ok": True, "skipStatus": skip_status})


@app.post("/api/messages")
async def add_message(request: Request) -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    if not resolved_settings["chat_enabled"]:
        raise HTTPException(status_code=403, detail="Der Chat ist für diese Party aktuell deaktiviert.")

    payload = await request.json()
    device_id = _record_activity_from_payload(request, payload, role="guest")
    _ensure_device_not_muted(device_id)
    await rate_limiter.check(
        f"chat:{_client_ip(request)}:{device_id}",
        settings.max_messages_per_window,
        settings.rate_limit_window_seconds,
    )

    message_text = _sanitize_message(payload.get("message"))
    if not message_text:
        raise HTTPException(status_code=400, detail="Bitte schreibe eine kurze Nachricht.")
    if len(message_text) > settings.max_message_length:
        raise HTTPException(status_code=400, detail="Die Nachricht ist zu lang.")

    message = store.add_message(
        ChatMessageInput(
            guest_name=_sanitize_guest_name(payload.get("guestName")),
            message=message_text,
            device_id=device_id,
        )
    )
    metrics.increment("chat_messages")
    await _broadcast_state()
    return JSONResponse({"ok": True, "message": message})


@app.delete("/api/admin/messages/{message_id}")
async def admin_delete_message(message_id: int, request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    try:
        store.delete_message(message_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/mute/song/{song_id}")
async def admin_mute_song_device(song_id: int, request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    reason = _clean_text(payload.get("reason"), 120) or "Host-Moderation"
    try:
        device_id, guest_name = store.get_song_device(song_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    muted = store.mute_device(device_id, guest_name, reason, settings.default_mute_minutes)
    removed = store.remove_device_active_songs(device_id)
    await _broadcast_state()
    return JSONResponse({"ok": True, "muted": muted, "removedSongs": removed})


@app.post("/api/admin/mute/message/{message_id}")
async def admin_mute_message_device(message_id: int, request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    reason = _clean_text(payload.get("reason"), 120) or "Host-Moderation"
    try:
        device_id, guest_name = store.get_message_device(message_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    muted = store.mute_device(device_id, guest_name, reason, settings.default_mute_minutes)
    await _broadcast_state()
    return JSONResponse({"ok": True, "muted": muted})


@app.post("/api/admin/unmute/{device_id}")
async def admin_unmute_device(device_id: str, request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    store.unmute_device(device_id)
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.delete("/api/admin/songs/{song_id}")
async def admin_remove_song(song_id: int, request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    try:
        store.remove_song(song_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/songs/{song_id}/pin")
async def admin_pin_song(song_id: int, request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    pinned = bool(payload.get("pinned", True))
    try:
        song = store.set_song_pinned(song_id, pinned)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _broadcast_state()
    return JSONResponse({"ok": True, "song": song})


@app.post("/api/admin/songs/{song_id}/clear-device")
async def admin_clear_device_songs(song_id: int, request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    try:
        device_id, _guest_name = store.get_song_device(song_id)
        removed = store.remove_device_active_songs(device_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _broadcast_state()
    return JSONResponse({"ok": True, "removedSongs": removed})


@app.post("/api/admin/skip")
async def admin_skip(request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    store.mark_current_played("skipped")
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/current/reset-skip-votes")
async def admin_reset_current_skip_votes(request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    store.reset_current_skip_votes()
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/mark-played")
async def admin_mark_played(request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    store.mark_current_played("played")
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/clear")
async def admin_clear_queue(request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    store.clear_active_queue()
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/reset")
async def admin_reset_party(request: Request) -> JSONResponse:
    require_admin_csrf(request, store)
    store.reset_party()
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.get("/api/admin/export")
async def admin_export(request: Request) -> JSONResponse:
    require_admin(request, store)
    return JSONResponse(store.export_snapshot())


@app.get("/api/history")
async def api_history(request: Request, status: str = "all", q: str = "") -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    if not resolved_settings["history_public"] and not is_admin_request(request, store):
        raise HTTPException(status_code=403, detail="Der Verlauf ist aktuell nur für den Host sichtbar.")
    return JSONResponse({"ok": True, "history": store.get_history(status_filter=status, search=q)})


@app.post("/api/history/{song_id}/readd")
async def api_readd_history_song(song_id: int, request: Request) -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    if not resolved_settings["readd_enabled"] and not is_admin_request(request, store):
        raise HTTPException(status_code=403, detail="Re-Add ist für diese Party aktuell deaktiviert.")
    payload = await request.json()
    guest_name = _sanitize_guest_name(payload.get("guestName"))
    device_id = _record_activity_from_payload(request, payload, role="guest")
    _ensure_device_not_muted(device_id)
    if store.count_active_songs_for_device(device_id) >= resolved_settings["max_songs_per_device"]:
        raise HTTPException(
            status_code=409,
            detail=f"Dieses Gerät hat bereits {resolved_settings['max_songs_per_device']} aktive Songs in der Queue.",
        )
    await rate_limiter.check(
        f"readd:{_client_ip(request)}:{device_id}",
        settings.max_adds_per_window,
        settings.rate_limit_window_seconds,
    )
    try:
        song = store.readd_from_history(song_id, device_id, guest_name)
    except DuplicateSongError as exc:
        return JSONResponse(
            {"ok": False, "detail": "Song ist bereits in der Warteschlange.", "duplicate": exc.existing_song},
            status_code=409,
        )
    except (NotFoundError, QueueLimitError) as exc:
        raise HTTPException(status_code=404 if isinstance(exc, NotFoundError) else 409, detail=str(exc)) from exc
    await _broadcast_state()
    return JSONResponse({"ok": True, "song": song})


@app.get("/api/admin/history/export.json")
async def admin_history_export_json(request: Request) -> JSONResponse:
    require_admin(request, store)
    rows = _history_export_payload(store.get_history(limit=1000))
    return JSONResponse({"history": rows})


@app.get("/api/admin/history/export.csv")
async def admin_history_export_csv(request: Request) -> PlainTextResponse:
    require_admin(request, store)
    return _csv_response("partytube-history.csv", _history_export_payload(store.get_history(limit=1000)))


@app.get("/api/admin/history/export.txt")
async def admin_history_export_txt(request: Request) -> PlainTextResponse:
    require_admin(request, store)
    return _txt_response("partytube-history.txt", _history_export_payload(store.get_history(limit=1000)))


@app.get("/api/admin/best-of")
async def admin_best_of(request: Request) -> JSONResponse:
    require_admin(request, store)
    return JSONResponse({"bestOf": store.get_best_of()})


@app.get("/api/admin/best-of/export.json")
async def admin_best_of_export_json(request: Request) -> JSONResponse:
    require_admin(request, store)
    return JSONResponse({"bestOf": _history_export_payload(store.get_best_of())})


@app.get("/api/admin/best-of/export.csv")
async def admin_best_of_export_csv(request: Request) -> PlainTextResponse:
    require_admin(request, store)
    return _csv_response("partytube-best-of.csv", _history_export_payload(store.get_best_of()))


@app.get("/api/admin/best-of/export.txt")
async def admin_best_of_export_txt(request: Request) -> PlainTextResponse:
    require_admin(request, store)
    return _txt_response("partytube-best-of.txt", _history_export_payload(store.get_best_of()))


@app.post("/api/player/ended")
async def player_ended(request: Request) -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    candidate = request.headers.get(PLAYER_TOKEN_HEADER_NAME, "").strip()
    if not candidate:
        raise HTTPException(status_code=401, detail="Player-Token fehlt.")
    if not validate_player_token(candidate, settings, resolved_settings["party_code"]):
        raise HTTPException(status_code=403, detail="Player-Token ungültig.")
    store.mark_current_played("ended")
    metrics.increment("player_ended_events")
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/test/reset")
async def test_reset(request: Request) -> JSONResponse:
    if not settings.test_mode:
        raise HTTPException(status_code=404, detail="Nicht verfügbar.")
    store.reset_party()
    store.clear_runtime_settings()
    store.clear_admin_sessions()
    end_admin_session(request, store)
    response = JSONResponse({"ok": True})
    response.delete_cookie(PLAYER_ACCESS_COOKIE_NAME)
    await _broadcast_state()
    return response


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    device_id = websocket.query_params.get("device_id", "").strip()[:80]
    role = _client_role(websocket.query_params.get("role"))
    guest_name = websocket.query_params.get("guest_name", "").strip()[:80]
    if device_id:
        store.record_guest_activity(device_id, guest_name, role=role)
    await hub.connect(websocket, {"deviceId": device_id, "role": role, "guestName": guest_name})
    await websocket.send_text(json.dumps(_state_payload_without_request(device_id, role)))
    try:
        while True:
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            if device_id:
                store.record_guest_activity(device_id, guest_name, role=role)
            await websocket.send_text(json.dumps({"type": "ping"}))
    except (WebSocketDisconnect, RuntimeError):
        await hub.disconnect(websocket)
