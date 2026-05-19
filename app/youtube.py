from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen


VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
LENGTH_SECONDS_PATTERN = re.compile(r'"lengthSeconds":"(?P<seconds>\d+)"')


class InvalidYouTubeUrl(ValueError):
    pass


@dataclass(frozen=True)
class ParsedVideo:
    video_id: str
    canonical_url: str
    thumbnail_url: str
    title: str
    metadata_source: str
    duration_seconds: int | None


def _strip_angle_brackets(value: str) -> str:
    return value.strip().strip("<>").strip()


def _normalize_input(value: str) -> str:
    candidate = _strip_angle_brackets(value)
    if VIDEO_ID_PATTERN.fullmatch(candidate):
        return f"https://www.youtube.com/watch?v={candidate}"
    if not re.match(r"^[a-z]+://", candidate, re.IGNORECASE):
        candidate = f"https://{candidate}"
    return candidate


def _extract_from_path(path: str, prefix: str) -> Optional[str]:
    if not path.startswith(prefix):
        return None
    remainder = path[len(prefix) :].strip("/")
    if not remainder:
        return None
    video_id = remainder.split("/", 1)[0]
    return video_id if VIDEO_ID_PATTERN.fullmatch(video_id) else None


def extract_video_id(value: str) -> str:
    parsed = urlparse(_normalize_input(value))
    host = parsed.netloc.lower()
    path = parsed.path.strip()

    if host in {"youtu.be", "www.youtu.be"}:
        video_id = path.lstrip("/").split("/", 1)[0]
        if VIDEO_ID_PATTERN.fullmatch(video_id):
            return video_id

    if host in {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    }:
        if path in {"/watch", "watch"}:
            video_id = parse_qs(parsed.query).get("v", [""])[0]
            if VIDEO_ID_PATTERN.fullmatch(video_id):
                return video_id

        for prefix in ("/shorts/", "/embed/", "/live/", "/v/"):
            video_id = _extract_from_path(path, prefix)
            if video_id:
                return video_id

    raise InvalidYouTubeUrl("Bitte gib einen gueltigen YouTube-Link ein.")


def canonical_watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def thumbnail_url(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def _request(url: str, timeout: float) -> bytes | None:
    request = Request(
        url,
        headers={
            "User-Agent": "PartyTube/1.0 (+https://local.party)",
            "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read()
    except (HTTPError, URLError, TimeoutError):
        return None


def fetch_title_and_duration(video_id: str, timeout: float = 3.0) -> tuple[str, str, int | None]:
    title = f"YouTube Video {video_id}"
    metadata_source = "fallback"
    duration_seconds: int | None = None

    oembed_bytes = _request(
        f"https://www.youtube.com/oembed?url={canonical_watch_url(video_id)}&format=json",
        timeout=timeout,
    )
    if oembed_bytes:
        try:
            payload = json.loads(oembed_bytes.decode("utf-8"))
            candidate = str(payload.get("title", "")).strip()
            if candidate:
                title = candidate
                metadata_source = "youtube-oembed"
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass

    watch_page_bytes = _request(canonical_watch_url(video_id), timeout=timeout)
    if watch_page_bytes:
        try:
            watch_page = watch_page_bytes.decode("utf-8", errors="ignore")
            match = LENGTH_SECONDS_PATTERN.search(watch_page)
            if match:
                duration_seconds = int(match.group("seconds"))
                metadata_source = (
                    "youtube-oembed+watch"
                    if metadata_source == "youtube-oembed"
                    else "youtube-watch"
                )
        except ValueError:
            pass

    return title, metadata_source, duration_seconds


def parse_video(value: str, timeout: float = 3.0, enable_lookup: bool = True) -> ParsedVideo:
    video_id = extract_video_id(value)
    if enable_lookup:
        title, metadata_source, duration_seconds = fetch_title_and_duration(video_id, timeout=timeout)
    else:
        title, metadata_source, duration_seconds = f"YouTube Video {video_id}", "fallback", None
    return ParsedVideo(
        video_id=video_id,
        canonical_url=canonical_watch_url(video_id),
        thumbnail_url=thumbnail_url(video_id),
        title=title,
        metadata_source=metadata_source,
        duration_seconds=duration_seconds,
    )
