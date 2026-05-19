from __future__ import annotations

import hashlib
import hmac
from fastapi import Request

from .config import Settings


ADMIN_COOKIE_NAME = "party_admin"


def build_admin_cookie(settings: Settings) -> str:
    payload = f"{settings.party_code}:{settings.admin_pin}".encode("utf-8")
    secret = settings.admin_cookie_secret.encode("utf-8")
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def is_admin_request(request: Request, settings: Settings) -> bool:
    candidate = request.cookies.get(ADMIN_COOKIE_NAME)
    if not candidate:
        return False
    expected = build_admin_cookie(settings)
    return hmac.compare_digest(candidate, expected)

