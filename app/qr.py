from __future__ import annotations

import base64
import io

import qrcode
from qrcode.image.svg import SvgPathImage


def _escape_wifi(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", r"\;")
        .replace(",", r"\,")
        .replace(":", r"\:")
        .replace('"', r"\"")
    )


def make_qr_data_uri(value: str) -> str:
    buffer = io.BytesIO()
    image = qrcode.make(value, image_factory=SvgPathImage, box_size=8, border=3)
    image.save(buffer)
    svg = buffer.getvalue()
    encoded = base64.b64encode(svg).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def make_wifi_qr_payload(ssid: str, password: str, security: str, hidden: bool) -> str:
    hidden_flag = "true" if hidden else "false"
    return (
        f"WIFI:T:{_escape_wifi(security)};"
        f"S:{_escape_wifi(ssid)};"
        f"P:{_escape_wifi(password)};"
        f"H:{hidden_flag};;"
    )

