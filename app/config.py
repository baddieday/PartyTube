from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent

DEFAULT_ADMIN_PIN = "2468"
DEFAULT_SECRET_MARKERS = ("change-me", "changeme", "replace-me", "default", "insecure")
ALLOWED_CROSSFADE_SECONDS = (0, 1, 2, 3, 5, 10)


def _load_env_file() -> None:
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip().strip('"').strip("'")
        os.environ[key] = value


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value is not None else default


def _float_env(name: str, default: float) -> float:
    value = os.getenv(name)
    return float(value) if value is not None else default


def _choice_int_env(name: str, default: int, choices: tuple[int, ...]) -> int:
    value = _int_env(name, default)
    return value if value in choices else default


def _csv_env(name: str) -> tuple[str, ...]:
    value = os.getenv(name, "")
    parts = [item.strip() for item in value.split(",")]
    cleaned = [item for item in parts if item]
    return tuple(cleaned)


def _normalized_party_code(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9-]+", "-", value.strip().lower())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned or "party"


def _looks_like_default_secret(value: str) -> bool:
    normalized = value.strip().lower()
    return not normalized or any(marker in normalized for marker in DEFAULT_SECRET_MARKERS)


@dataclass(frozen=True)
class Settings:
    app_name: str
    party_name: str
    party_code: str
    host_ip: str
    public_port: int
    base_url: str
    join_url: str
    admin_pin: str
    session_secret: str
    player_token_secret: str
    session_cookie_secure: bool
    session_max_age_seconds: int
    trusted_hosts: tuple[str, ...]
    enforce_https: bool
    data_dir: Path
    db_path: Path
    wifi_ssid: str
    wifi_password: str
    wifi_security: str
    wifi_hidden: bool
    autoplay_enabled: bool
    crossfade_seconds: int
    invite_only_mode: bool
    chat_enabled: bool
    voting_enabled: bool
    skip_voting_enabled: bool
    skip_vote_threshold_percent: int
    active_guest_window_seconds: int
    history_public: bool
    readd_enabled: bool
    party_screen_enabled: bool
    wifi_qr_enabled: bool
    show_wifi_password_on_screen: bool
    party_screen_show_active_guests: bool
    party_screen_show_skip_status: bool
    max_queue_items: int
    max_songs_per_device: int
    max_guest_name_length: int
    max_url_length: int
    max_message_length: int
    chat_history_limit: int
    max_adds_per_window: int
    max_votes_per_window: int
    max_messages_per_window: int
    rate_limit_window_seconds: int
    history_limit: int
    default_mute_minutes: int
    title_lookup_timeout: float
    test_mode: bool
    enable_title_lookup: bool
    enable_metrics: bool
    admin_pin_is_default: bool
    session_secret_is_default: bool
    session_secret_is_ephemeral: bool


def load_settings() -> Settings:
    _load_env_file()

    data_dir = Path(os.getenv("DATA_DIR", str(ROOT_DIR / "data"))).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    host_ip = os.getenv("HOST_IP", "192.168.178.77").strip()
    public_port = _int_env("PORT", 8088)
    base_url = os.getenv("BASE_URL", f"http://{host_ip}:{public_port}").strip().rstrip("/")
    party_code = _normalized_party_code(os.getenv("PARTY_CODE", "party"))

    session_secret_env = os.getenv("SESSION_SECRET")
    legacy_secret_env = os.getenv("ADMIN_COOKIE_SECRET")
    raw_session_secret = (session_secret_env or legacy_secret_env or "").strip()
    session_secret_is_ephemeral = False
    if not raw_session_secret:
        raw_session_secret = secrets.token_hex(32)
        session_secret_is_ephemeral = True

    session_secret = raw_session_secret
    player_token_secret = (os.getenv("PLAYER_TOKEN_SECRET", "").strip() or session_secret)
    trusted_hosts = _csv_env("TRUSTED_HOSTS")

    return Settings(
        app_name="PartyTube",
        party_name=os.getenv("PARTY_NAME", "Wohnzimmer Rave").strip() or "Wohnzimmer Rave",
        party_code=party_code,
        host_ip=host_ip,
        public_port=public_port,
        base_url=base_url,
        join_url=f"{base_url}/join/{party_code}",
        admin_pin=os.getenv("ADMIN_PIN", DEFAULT_ADMIN_PIN).strip() or DEFAULT_ADMIN_PIN,
        session_secret=session_secret,
        player_token_secret=player_token_secret,
        session_cookie_secure=_bool_env("SESSION_COOKIE_SECURE", False),
        session_max_age_seconds=_int_env("SESSION_MAX_AGE_SECONDS", 60 * 60 * 12),
        trusted_hosts=trusted_hosts,
        enforce_https=_bool_env("ENFORCE_HTTPS", False),
        data_dir=data_dir,
        db_path=Path(os.getenv("DATABASE_PATH", str(data_dir / "party.db"))).resolve(),
        wifi_ssid=os.getenv("WIFI_SSID", "").strip(),
        wifi_password=os.getenv("WIFI_PASSWORD", "").strip(),
        wifi_security=os.getenv("WIFI_SECURITY", "WPA").strip().upper() or "WPA",
        wifi_hidden=_bool_env("WIFI_HIDDEN", False),
        autoplay_enabled=_bool_env("AUTOPLAY_ENABLED", False),
        crossfade_seconds=_choice_int_env("CROSSFADE_SECONDS", 0, ALLOWED_CROSSFADE_SECONDS),
        invite_only_mode=_bool_env("INVITE_ONLY_MODE", False),
        chat_enabled=_bool_env("CHAT_ENABLED", True),
        voting_enabled=_bool_env("VOTING_ENABLED", True),
        skip_voting_enabled=_bool_env("SKIP_VOTING_ENABLED", True),
        skip_vote_threshold_percent=_int_env("SKIP_VOTE_THRESHOLD_PERCENT", 40),
        active_guest_window_seconds=_int_env("ACTIVE_GUEST_WINDOW_SECONDS", 300),
        history_public=_bool_env("HISTORY_PUBLIC", True),
        readd_enabled=_bool_env("READD_ENABLED", True),
        party_screen_enabled=_bool_env("PARTY_SCREEN_ENABLED", True),
        wifi_qr_enabled=_bool_env("WIFI_QR_ENABLED", False),
        show_wifi_password_on_screen=_bool_env("SHOW_WIFI_PASSWORD_ON_SCREEN", False),
        party_screen_show_active_guests=_bool_env("PARTY_SCREEN_SHOW_ACTIVE_GUESTS", True),
        party_screen_show_skip_status=_bool_env("PARTY_SCREEN_SHOW_SKIP_STATUS", True),
        max_queue_items=_int_env("MAX_QUEUE_ITEMS", 100),
        max_songs_per_device=min(100, _int_env("MAX_SONGS_PER_DEVICE", 100)),
        max_guest_name_length=_int_env("MAX_GUEST_NAME_LENGTH", 32),
        max_url_length=_int_env("MAX_URL_LENGTH", 500),
        max_message_length=_int_env("MAX_MESSAGE_LENGTH", 240),
        chat_history_limit=_int_env("CHAT_HISTORY_LIMIT", 40),
        max_adds_per_window=_int_env("MAX_ADDS_PER_WINDOW", 20),
        max_votes_per_window=_int_env("MAX_VOTES_PER_WINDOW", 120),
        max_messages_per_window=_int_env("MAX_MESSAGES_PER_WINDOW", 30),
        rate_limit_window_seconds=_int_env("RATE_LIMIT_WINDOW_SECONDS", 300),
        history_limit=_int_env("HISTORY_LIMIT", 30),
        default_mute_minutes=_int_env("DEFAULT_MUTE_MINUTES", 180),
        title_lookup_timeout=_float_env("TITLE_LOOKUP_TIMEOUT_SECONDS", 3.0),
        test_mode=_bool_env("TEST_MODE", False),
        enable_title_lookup=_bool_env("ENABLE_TITLE_LOOKUP", True),
        enable_metrics=_bool_env("ENABLE_METRICS", False),
        admin_pin_is_default=(os.getenv("ADMIN_PIN", DEFAULT_ADMIN_PIN).strip() or DEFAULT_ADMIN_PIN) == DEFAULT_ADMIN_PIN,
        session_secret_is_default=_looks_like_default_secret(session_secret),
        session_secret_is_ephemeral=session_secret_is_ephemeral,
    )
