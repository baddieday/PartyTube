from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent


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


def _normalized_party_code(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9-]+", "-", value.strip().lower())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned or "party"


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
    admin_cookie_secret: str
    data_dir: Path
    db_path: Path
    wifi_ssid: str
    wifi_password: str
    wifi_security: str
    wifi_hidden: bool
    autoplay_enabled: bool
    max_queue_items: int
    max_guest_name_length: int
    max_url_length: int
    max_adds_per_window: int
    max_votes_per_window: int
    rate_limit_window_seconds: int
    history_limit: int
    title_lookup_timeout: float
    test_mode: bool
    enable_title_lookup: bool


def load_settings() -> Settings:
    _load_env_file()

    data_dir = Path(os.getenv("DATA_DIR", str(ROOT_DIR / "data"))).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    host_ip = os.getenv("HOST_IP", "192.168.178.77").strip()
    public_port = _int_env("PORT", 8088)
    base_url = os.getenv("BASE_URL", f"http://{host_ip}:{public_port}").strip().rstrip("/")
    party_code = _normalized_party_code(os.getenv("PARTY_CODE", "party"))

    return Settings(
        app_name="PartyTube",
        party_name=os.getenv("PARTY_NAME", "Wohnzimmer Rave").strip() or "Wohnzimmer Rave",
        party_code=party_code,
        host_ip=host_ip,
        public_port=public_port,
        base_url=base_url,
        join_url=f"{base_url}/join/{party_code}",
        admin_pin=os.getenv("ADMIN_PIN", "2468").strip() or "2468",
        admin_cookie_secret=os.getenv("ADMIN_COOKIE_SECRET", secrets.token_hex(24)).strip(),
        data_dir=data_dir,
        db_path=Path(os.getenv("DATABASE_PATH", str(data_dir / "party.db"))).resolve(),
        wifi_ssid=os.getenv("WIFI_SSID", "").strip(),
        wifi_password=os.getenv("WIFI_PASSWORD", "").strip(),
        wifi_security=os.getenv("WIFI_SECURITY", "WPA").strip().upper() or "WPA",
        wifi_hidden=_bool_env("WIFI_HIDDEN", False),
        autoplay_enabled=_bool_env("AUTOPLAY_ENABLED", False),
        max_queue_items=_int_env("MAX_QUEUE_ITEMS", 100),
        max_guest_name_length=_int_env("MAX_GUEST_NAME_LENGTH", 32),
        max_url_length=_int_env("MAX_URL_LENGTH", 500),
        max_adds_per_window=_int_env("MAX_ADDS_PER_WINDOW", 6),
        max_votes_per_window=_int_env("MAX_VOTES_PER_WINDOW", 60),
        rate_limit_window_seconds=_int_env("RATE_LIMIT_WINDOW_SECONDS", 300),
        history_limit=_int_env("HISTORY_LIMIT", 30),
        title_lookup_timeout=_float_env("TITLE_LOOKUP_TIMEOUT_SECONDS", 3.0),
        test_mode=_bool_env("TEST_MODE", False),
        enable_title_lookup=_bool_env("ENABLE_TITLE_LOOKUP", True),
    )
