from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class StoreError(Exception):
    pass


class DuplicateSongError(StoreError):
    def __init__(self, message: str, existing_song: Optional[dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.existing_song = existing_song


class AlreadyVotedError(StoreError):
    pass


class NotFoundError(StoreError):
    pass


class QueueLimitError(StoreError):
    pass


@dataclass(frozen=True)
class AddSongInput:
    video_id: str
    canonical_url: str
    source_url: str
    title: str
    thumbnail_url: str
    guest_name: str
    added_by_device: str
    metadata_source: str


class PartyStore:
    def __init__(self, db_path: Path, history_limit: int = 30, max_queue_items: int = 100) -> None:
        self.db_path = Path(db_path)
        self.history_limit = history_limit
        self.max_queue_items = max_queue_items
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(self.db_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        with self.connection:
            self.connection.execute("PRAGMA journal_mode=WAL;")
            self.connection.execute("PRAGMA foreign_keys=ON;")
        self._init_schema()

    def _init_schema(self) -> None:
        with self.lock, self.connection:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS songs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    video_id TEXT NOT NULL,
                    canonical_url TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    title TEXT NOT NULL,
                    thumbnail_url TEXT NOT NULL,
                    guest_name TEXT NOT NULL DEFAULT '',
                    added_by_device TEXT NOT NULL,
                    metadata_source TEXT NOT NULL DEFAULT 'fallback',
                    votes INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL DEFAULT 'queued',
                    added_at TEXT NOT NULL,
                    current_started_at TEXT,
                    played_at TEXT,
                    played_reason TEXT
                );

                CREATE TABLE IF NOT EXISTS votes (
                    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                    device_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(song_id, device_id)
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_active_video
                ON songs(video_id)
                WHERE status IN ('queued', 'current');

                CREATE INDEX IF NOT EXISTS idx_songs_status_votes_added
                ON songs(status, votes DESC, added_at ASC, id ASC);

                CREATE INDEX IF NOT EXISTS idx_songs_played_at
                ON songs(status, played_at DESC, id DESC);

                CREATE TABLE IF NOT EXISTS runtime_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

    def _row_to_song(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "videoId": row["video_id"],
            "canonicalUrl": row["canonical_url"],
            "sourceUrl": row["source_url"],
            "title": row["title"],
            "thumbnailUrl": row["thumbnail_url"],
            "guestName": row["guest_name"],
            "votes": row["votes"],
            "status": row["status"],
            "addedAt": row["added_at"],
            "currentStartedAt": row["current_started_at"],
            "playedAt": row["played_at"],
            "playedReason": row["played_reason"],
            "metadataSource": row["metadata_source"],
        }

    def _query_song(self, query: str, params: tuple[Any, ...] = ()) -> Optional[dict[str, Any]]:
        row = self.connection.execute(query, params).fetchone()
        return self._row_to_song(row) if row else None

    def _ensure_current_locked(self) -> None:
        current = self.connection.execute(
            "SELECT id FROM songs WHERE status = 'current' LIMIT 1"
        ).fetchone()
        if current:
            return

        next_row = self.connection.execute(
            """
            SELECT id
            FROM songs
            WHERE status = 'queued'
            ORDER BY votes DESC, added_at ASC, id ASC
            LIMIT 1
            """
        ).fetchone()
        if not next_row:
            return

        self.connection.execute(
            """
            UPDATE songs
            SET status = 'current', current_started_at = ?
            WHERE id = ?
            """,
            (utc_now(), next_row["id"]),
        )

    def get_state(self) -> dict[str, Any]:
        with self.lock:
            with self.connection:
                self._ensure_current_locked()

            current = self._query_song("SELECT * FROM songs WHERE status = 'current' LIMIT 1")
            queue_rows = self.connection.execute(
                """
                SELECT *
                FROM songs
                WHERE status = 'queued'
                ORDER BY votes DESC, added_at ASC, id ASC
                """
            ).fetchall()
            history_rows = self.connection.execute(
                """
                SELECT *
                FROM songs
                WHERE status = 'played'
                ORDER BY played_at DESC, id DESC
                LIMIT ?
                """,
                (self.history_limit,),
            ).fetchall()

            active_count = self.connection.execute(
                "SELECT COUNT(*) AS count FROM songs WHERE status IN ('queued', 'current')"
            ).fetchone()["count"]

        return {
            "current": current,
            "queue": [self._row_to_song(row) for row in queue_rows],
            "history": [self._row_to_song(row) for row in history_rows],
            "stats": {
                "activeCount": active_count,
                "historyCount": len(history_rows),
            },
        }

    def add_song(self, payload: AddSongInput) -> dict[str, Any]:
        now = utc_now()
        with self.lock, self.connection:
            active_count = self.connection.execute(
                "SELECT COUNT(*) AS count FROM songs WHERE status IN ('queued', 'current')"
            ).fetchone()["count"]
            if active_count >= self.max_queue_items:
                raise QueueLimitError("Die Queue ist voll. Bitte spiele erst ein paar Songs ab.")

            try:
                cursor = self.connection.execute(
                    """
                    INSERT INTO songs (
                        video_id,
                        canonical_url,
                        source_url,
                        title,
                        thumbnail_url,
                        guest_name,
                        added_by_device,
                        metadata_source,
                        votes,
                        status,
                        added_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'queued', ?)
                    """,
                    (
                        payload.video_id,
                        payload.canonical_url,
                        payload.source_url,
                        payload.title,
                        payload.thumbnail_url,
                        payload.guest_name,
                        payload.added_by_device,
                        payload.metadata_source,
                        now,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                existing = self._query_song(
                    "SELECT * FROM songs WHERE video_id = ? AND status IN ('queued', 'current') LIMIT 1",
                    (payload.video_id,),
                )
                if existing:
                    raise DuplicateSongError(
                        "Der Song ist schon in der laufenden Queue.", existing_song=existing
                    ) from exc
                raise

            song_id = cursor.lastrowid
            self.connection.execute(
                "INSERT INTO votes (song_id, device_id, created_at) VALUES (?, ?, ?)",
                (song_id, payload.added_by_device, now),
            )
            self._ensure_current_locked()
            return self._query_song("SELECT * FROM songs WHERE id = ?", (song_id,)) or {}

    def vote_song(self, song_id: int, device_id: str) -> dict[str, Any]:
        now = utc_now()
        with self.lock, self.connection:
            song = self.connection.execute(
                "SELECT id FROM songs WHERE id = ? AND status IN ('queued', 'current')",
                (song_id,),
            ).fetchone()
            if not song:
                raise NotFoundError("Der Song wurde nicht gefunden.")

            try:
                self.connection.execute(
                    "INSERT INTO votes (song_id, device_id, created_at) VALUES (?, ?, ?)",
                    (song_id, device_id, now),
                )
            except sqlite3.IntegrityError as exc:
                raise AlreadyVotedError("Dieses Geraet hat fuer den Song schon gevotet.") from exc

            self.connection.execute("UPDATE songs SET votes = votes + 1 WHERE id = ?", (song_id,))
            return self._query_song("SELECT * FROM songs WHERE id = ?", (song_id,)) or {}

    def remove_song(self, song_id: int) -> None:
        with self.lock, self.connection:
            song = self.connection.execute(
                "SELECT status FROM songs WHERE id = ? AND status IN ('queued', 'current')",
                (song_id,),
            ).fetchone()
            if not song:
                raise NotFoundError("Der Song wurde nicht gefunden.")

            self.connection.execute("DELETE FROM votes WHERE song_id = ?", (song_id,))
            self.connection.execute("DELETE FROM songs WHERE id = ?", (song_id,))
            if song["status"] == "current":
                self._ensure_current_locked()

    def mark_current_played(self, reason: str) -> Optional[dict[str, Any]]:
        now = utc_now()
        with self.lock, self.connection:
            current = self.connection.execute(
                "SELECT id FROM songs WHERE status = 'current' LIMIT 1"
            ).fetchone()
            if not current:
                return None

            self.connection.execute(
                """
                UPDATE songs
                SET status = 'played', played_at = ?, played_reason = ?
                WHERE id = ?
                """,
                (now, reason, current["id"]),
            )
            self._ensure_current_locked()
            return self._query_song("SELECT * FROM songs WHERE id = ?", (current["id"],))

    def clear_active_queue(self) -> None:
        with self.lock, self.connection:
            self.connection.execute(
                "DELETE FROM votes WHERE song_id IN (SELECT id FROM songs WHERE status IN ('queued', 'current'))"
            )
            self.connection.execute("DELETE FROM songs WHERE status IN ('queued', 'current')")

    def reset_party(self) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM votes")
            self.connection.execute("DELETE FROM songs")

    def clear_runtime_settings(self) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM runtime_settings")

    def export_snapshot(self) -> dict[str, Any]:
        state = self.get_state()
        rows = self.connection.execute("SELECT * FROM songs ORDER BY id ASC").fetchall()
        state["allSongs"] = [self._row_to_song(row) for row in rows]
        return state

    def get_runtime_settings(self) -> dict[str, str]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT key, value FROM runtime_settings ORDER BY key ASC"
            ).fetchall()
        return {str(row["key"]): str(row["value"]) for row in rows}

    def set_runtime_settings(self, payload: dict[str, Any]) -> dict[str, str]:
        now = utc_now()
        with self.lock, self.connection:
            for key, value in payload.items():
                if value is None:
                    self.connection.execute("DELETE FROM runtime_settings WHERE key = ?", (key,))
                    continue

                if isinstance(value, bool):
                    stored_value = "1" if value else "0"
                else:
                    stored_value = str(value).strip()

                if not stored_value:
                    self.connection.execute("DELETE FROM runtime_settings WHERE key = ?", (key,))
                    continue

                self.connection.execute(
                    """
                    INSERT INTO runtime_settings (key, value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                    """,
                    (key, stored_value, now),
                )

        return self.get_runtime_settings()
