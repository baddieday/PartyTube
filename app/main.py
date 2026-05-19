from __future__ import annotations

import asyncio
import json
import secrets
import time
from collections import defaultdict, deque
from contextlib import suppress
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import ROOT_DIR, Settings, _normalized_party_code, load_settings
from .qr import make_qr_data_uri, make_wifi_qr_payload
from .security import ADMIN_COOKIE_NAME, build_admin_cookie, is_admin_request
from .storage import (
    AddSongInput,
    AlreadyVotedError,
    DuplicateSongError,
    NotFoundError,
    PartyStore,
    QueueLimitError,
)
from .youtube import InvalidYouTubeUrl, parse_video


settings = load_settings()
store = PartyStore(settings.db_path, history_limit=settings.history_limit, max_queue_items=settings.max_queue_items)

app = FastAPI(title=settings.app_name)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.mount("/static", StaticFiles(directory=ROOT_DIR / "app" / "static"), name="static")
templates = Jinja2Templates(directory=str(ROOT_DIR / "app" / "templates"))


class ConnectionHub:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self.lock:
            self.connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self.lock:
            self.connections.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        message = json.dumps(payload)
        async with self.lock:
            sockets = list(self.connections)
        stale: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_text(message)
            except RuntimeError:
                stale.append(socket)
        if stale:
            async with self.lock:
                for socket in stale:
                    self.connections.discard(socket)


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
                raise HTTPException(status_code=429, detail="Zu viele Aktionen in kurzer Zeit. Bitte kurz warten.")
            bucket.append(now)


hub = ConnectionHub()
rate_limiter = RateLimiter()


def _sanitize_guest_name(value: str | None) -> str:
    if not value:
        return ""
    cleaned = "".join(char for char in value.strip() if char.isprintable())
    cleaned = cleaned.replace("<", "").replace(">", "")
    return cleaned[: settings.max_guest_name_length]


def _device_id(request: Request, payload: dict[str, Any]) -> str:
    candidate = str(payload.get("deviceId", "")).strip()
    if candidate:
        return candidate[:80]
    return request.client.host if request.client else secrets.token_hex(8)


def _runtime_flag(value: Any, default: bool) -> bool:
    if value is None or value == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


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


def _resolved_settings(request: Request) -> dict[str, Any]:
    runtime_settings = store.get_runtime_settings()
    party_name = runtime_settings.get("partyName", settings.party_name).strip() or settings.party_name
    party_code = _normalized_party_code(runtime_settings.get("partyCode", settings.party_code))
    base_url = _resolved_base_url(request, runtime_settings)
    parsed = urlparse(base_url)
    wifi_ssid = runtime_settings.get("wifiSsid", settings.wifi_ssid).strip()
    wifi_password = runtime_settings.get("wifiPassword", settings.wifi_password).strip()
    wifi_security = runtime_settings.get("wifiSecurity", settings.wifi_security).strip().upper() or settings.wifi_security
    wifi_hidden = _runtime_flag(runtime_settings.get("wifiHidden"), settings.wifi_hidden)

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
        "wifi_ssid": wifi_ssid,
        "wifi_password": wifi_password,
        "wifi_security": wifi_security,
        "wifi_hidden": wifi_hidden,
        "wifi_configured": bool(wifi_ssid and (wifi_password or wifi_security == "NOPASS")),
        "base_url_override": runtime_settings.get("baseUrl", "").strip(),
        "autoplay_enabled": _runtime_flag(runtime_settings.get("autoplayEnabled"), settings.autoplay_enabled),
    }


def _runtime_public_state() -> dict[str, Any]:
    runtime_settings = store.get_runtime_settings()
    return {
        "autoplayEnabled": _runtime_flag(runtime_settings.get("autoplayEnabled"), settings.autoplay_enabled),
    }


def _state_payload(request: Request) -> dict[str, Any]:
    state = store.get_state()
    resolved_settings = _resolved_settings(request)
    state["meta"] = {
        "partyName": resolved_settings["party_name"],
        "partyCode": resolved_settings["party_code"],
        "baseUrl": resolved_settings["base_url"],
        "joinUrl": resolved_settings["join_url"],
        "hostIp": resolved_settings["host_ip"],
        "port": resolved_settings["public_port"],
        "displayAddress": resolved_settings["display_address"],
        "adminAuthenticated": is_admin_request(request, settings),
    }
    state["runtime"] = _runtime_public_state()
    return state


async def _broadcast_state() -> None:
    payload = store.get_state()
    payload["type"] = "state"
    payload["runtime"] = _runtime_public_state()
    await hub.broadcast(payload)


def _template_context(request: Request, page: str) -> dict[str, Any]:
    resolved_settings = _resolved_settings(request)
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

    return {
        "request": request,
        "page": page,
        "settings": resolved_settings,
        "wifi_qr_data_uri": wifi_qr,
        "link_qr_data_uri": make_qr_data_uri(resolved_settings["join_url"]),
        "app_config": {
            "page": page,
            "partyName": resolved_settings["party_name"],
            "partyCode": resolved_settings["party_code"],
            "baseUrl": resolved_settings["base_url"],
            "joinUrl": resolved_settings["join_url"],
            "hostIp": resolved_settings["host_ip"],
            "port": resolved_settings["public_port"],
            "displayAddress": resolved_settings["display_address"],
            "adminAuthenticated": is_admin_request(request, settings),
            "wifiConfigured": resolved_settings["wifi_configured"],
            "autoplayEnabled": resolved_settings["autoplay_enabled"],
        },
    }


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
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
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def guest_home(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("guest.html", _template_context(request, "guest"))


@app.get("/start", response_class=HTMLResponse)
async def start_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("start.html", _template_context(request, "start"))


@app.get("/join/{party_code}", response_class=HTMLResponse)
async def guest_join(request: Request, party_code: str) -> HTMLResponse:
    if party_code != _resolved_settings(request)["party_code"]:
        raise HTTPException(status_code=404, detail="Falscher Party-Code.")
    return templates.TemplateResponse("guest.html", _template_context(request, "guest"))


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("admin.html", _template_context(request, "admin"))


@app.get("/player", response_class=HTMLResponse)
async def player_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("player.html", _template_context(request, "player"))


@app.get("/audio", response_class=HTMLResponse)
async def audio_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("audio.html", _template_context(request, "audio"))


@app.get("/qr", response_class=HTMLResponse)
async def qr_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("qr.html", _template_context(request, "qr"))


@app.get("/manifest.webmanifest")
async def manifest(request: Request) -> JSONResponse:
    resolved_settings = _resolved_settings(request)
    return JSONResponse(
        {
            "name": resolved_settings["party_name"],
            "short_name": settings.app_name,
            "display": "standalone",
            "background_color": "#070b17",
            "theme_color": "#0b1020",
            "start_url": "/",
            "icons": [
                {
                    "src": "/static/img/icon.svg",
                    "sizes": "512x512",
                    "type": "image/svg+xml",
                    "purpose": "any maskable",
                }
            ],
        }
    )


@app.get("/sw.js")
async def service_worker() -> FileResponse:
    return FileResponse(ROOT_DIR / "app" / "static" / "sw.js", media_type="application/javascript")


@app.get("/api/state")
async def api_state(request: Request) -> JSONResponse:
    return JSONResponse(_state_payload(request))


@app.get("/api/admin/status")
async def api_admin_status(request: Request) -> dict[str, bool]:
    return {"authenticated": is_admin_request(request, settings)}


@app.get("/api/admin/settings")
async def api_admin_settings(request: Request) -> JSONResponse:
    _require_admin(request)
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
        }
    )


@app.put("/api/admin/settings")
async def api_admin_update_settings(request: Request) -> JSONResponse:
    _require_admin(request)
    payload = await request.json()

    party_name = _clean_text(payload.get("partyName"), 80)
    party_code_raw = _clean_text(payload.get("partyCode"), 40)
    base_url = _clean_text(payload.get("baseUrl"), 240).rstrip("/")
    wifi_ssid = _clean_text(payload.get("wifiSsid"), 64)
    wifi_password = _clean_text(payload.get("wifiPassword"), 128)
    wifi_security = _clean_text(payload.get("wifiSecurity"), 16).upper() or settings.wifi_security
    wifi_hidden = bool(payload.get("wifiHidden"))
    autoplay_enabled = bool(payload.get("autoplayEnabled"))

    if base_url:
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise HTTPException(
                status_code=400,
                detail="Die Basis-URL muss mit http:// oder https:// beginnen.",
            )

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
    }
    store.set_runtime_settings(update_payload)
    await _broadcast_state()
    return await api_admin_settings(request)


@app.post("/api/admin/login")
async def admin_login(request: Request) -> JSONResponse:
    payload = await request.json()
    pin = str(payload.get("pin", "")).strip()
    if pin != settings.admin_pin:
        raise HTTPException(status_code=401, detail="PIN falsch.")
    response = JSONResponse({"ok": True})
    response.set_cookie(
        ADMIN_COOKIE_NAME,
        build_admin_cookie(settings),
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 12,
    )
    return response


@app.post("/api/admin/logout")
async def admin_logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(ADMIN_COOKIE_NAME)
    return response


def _require_admin(request: Request) -> None:
    if not is_admin_request(request, settings):
        raise HTTPException(status_code=401, detail="Admin-Login erforderlich.")


@app.post("/api/songs")
async def add_song(request: Request) -> JSONResponse:
    payload = await request.json()
    url = str(payload.get("url", "")).strip()
    if not url:
        raise HTTPException(status_code=400, detail="Bitte fuege einen YouTube-Link ein.")
    if len(url) > settings.max_url_length:
        raise HTTPException(status_code=400, detail="Der Link ist zu lang.")

    device_id = _device_id(request, payload)
    client_ip = request.client.host if request.client else "unknown"
    await rate_limiter.check(f"add:{client_ip}:{device_id}", settings.max_adds_per_window, settings.rate_limit_window_seconds)

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
                guest_name=_sanitize_guest_name(payload.get("guestName")),
                added_by_device=device_id,
                metadata_source=parsed_video.metadata_source,
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

    await _broadcast_state()
    return JSONResponse({"ok": True, "song": song})


@app.post("/api/songs/{song_id}/vote")
async def vote_song(song_id: int, request: Request) -> JSONResponse:
    payload = await request.json()
    device_id = _device_id(request, payload)
    client_ip = request.client.host if request.client else "unknown"
    await rate_limiter.check(f"vote:{client_ip}:{device_id}", settings.max_votes_per_window, settings.rate_limit_window_seconds)

    try:
        song = store.vote_song(song_id, device_id)
    except AlreadyVotedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    await _broadcast_state()
    return JSONResponse({"ok": True, "song": song})


@app.delete("/api/admin/songs/{song_id}")
async def admin_remove_song(song_id: int, request: Request) -> JSONResponse:
    _require_admin(request)
    try:
        store.remove_song(song_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/skip")
async def admin_skip(request: Request) -> JSONResponse:
    _require_admin(request)
    store.mark_current_played("skipped")
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/mark-played")
async def admin_mark_played(request: Request) -> JSONResponse:
    _require_admin(request)
    store.mark_current_played("played")
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/clear")
async def admin_clear_queue(request: Request) -> JSONResponse:
    _require_admin(request)
    store.clear_active_queue()
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/admin/reset")
async def admin_reset_party(request: Request) -> JSONResponse:
    _require_admin(request)
    store.reset_party()
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.get("/api/admin/export")
async def admin_export(request: Request) -> JSONResponse:
    _require_admin(request)
    return JSONResponse(store.export_snapshot())


@app.post("/api/player/ended")
async def player_ended() -> JSONResponse:
    store.mark_current_played("ended")
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.post("/api/test/reset")
async def test_reset() -> JSONResponse:
    if not settings.test_mode:
        raise HTTPException(status_code=404, detail="Nicht verfuegbar.")
    store.reset_party()
    store.clear_runtime_settings()
    await _broadcast_state()
    return JSONResponse({"ok": True})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await hub.connect(websocket)
    await websocket.send_text(json.dumps({"type": "state", **store.get_state()}))
    try:
        while True:
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            await websocket.send_text(json.dumps({"type": "ping"}))
    except (WebSocketDisconnect, RuntimeError):
        await hub.disconnect(websocket)
