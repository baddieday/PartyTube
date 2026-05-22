from __future__ import annotations

import hashlib
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def utc_after_minutes(minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


def utc_after_seconds(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).replace(microsecond=0).isoformat()


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


class StoreError(Exception):
    pass


class DuplicateSongError(StoreError):
    def __init__(self, message: str, existing_song: Optional[dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.existing_song = existing_song


class AlreadyVotedError(StoreError):
    pass


class AlreadySkipVotedError(StoreError):
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
    duration_seconds: int | None = None
    readded_from_song_id: int | None = None
    readded_by_device_id: str = ""
    readded_by_guest_name: str = ""


@dataclass(frozen=True)
class ChatMessageInput:
    guest_name: str
    message: str
    device_id: str


class PartyStore:
    song_order_clause = "ORDER BY pinned DESC, votes DESC, added_at ASC, id ASC"

    def __init__(
        self,
        db_path: Path,
        history_limit: int = 30,
        max_queue_items: int = 100,
        chat_history_limit: int = 40,
    ) -> None:
        self.db_path = Path(db_path)
        self.history_limit = history_limit
        self.chat_history_limit = chat_history_limit
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
                    played_reason TEXT,
                    skipped_at TEXT,
                    removed_at TEXT,
                    completed_reason TEXT,
                    readded_from_song_id INTEGER,
                    readded_by_device_id TEXT NOT NULL DEFAULT '',
                    readded_by_guest_name TEXT NOT NULL DEFAULT '',
                    duration_seconds INTEGER,
                    pinned INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS votes (
                    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                    device_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(song_id, device_id)
                );

                CREATE TABLE IF NOT EXISTS skip_votes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                    device_id TEXT NOT NULL,
                    guest_name TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    UNIQUE(song_id, device_id)
                );

                CREATE TABLE IF NOT EXISTS guest_activity (
                    device_id TEXT PRIMARY KEY,
                    guest_name TEXT NOT NULL DEFAULT '',
                    role TEXT NOT NULL DEFAULT 'guest',
                    last_seen_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runtime_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guest_name TEXT NOT NULL DEFAULT '',
                    message TEXT NOT NULL,
                    device_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    deleted_at TEXT
                );

                CREATE TABLE IF NOT EXISTS muted_devices (
                    device_id TEXT PRIMARY KEY,
                    guest_name TEXT NOT NULL DEFAULT '',
                    reason TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    expires_at TEXT
                );

                CREATE TABLE IF NOT EXISTS admin_sessions (
                    session_id TEXT PRIMARY KEY,
                    csrf_token TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                """
            )

            self._ensure_column("songs", "duration_seconds", "INTEGER")
            self._ensure_column("songs", "pinned", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column("songs", "skipped_at", "TEXT")
            self._ensure_column("songs", "removed_at", "TEXT")
            self._ensure_column("songs", "completed_reason", "TEXT")
            self._ensure_column("songs", "readded_from_song_id", "INTEGER")
            self._ensure_column("songs", "readded_by_device_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column("songs", "readded_by_guest_name", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column("messages", "device_id", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column("messages", "deleted_at", "TEXT")

            self.connection.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_active_video
                ON songs(video_id)
                WHERE status IN ('queued', 'current')
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_songs_status_votes_added
                ON songs(status, pinned DESC, votes DESC, added_at ASC, id ASC)
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_songs_played_at
                ON songs(status, played_at DESC, id DESC)
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_songs_completed
                ON songs(status, played_at DESC, skipped_at DESC, removed_at DESC, id DESC)
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_skip_votes_song
                ON skip_votes(song_id, created_at DESC)
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_guest_activity_seen
                ON guest_activity(role, last_seen_at DESC)
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_messages_created
                ON messages(created_at DESC, id DESC)
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_muted_devices_expiry
                ON muted_devices(expires_at)
                """
            )

    def _ensure_column(self, table_name: str, column_name: str, definition: str) -> None:
        columns = {
            row["name"]
            for row in self.connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        }
        if column_name not in columns:
            self.connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")

    def _device_label(self, device_id: str | None) -> str:
        if not device_id:
            return "anon"
        digest = hashlib.sha256(device_id.encode("utf-8")).hexdigest()
        return digest[:8]

    def _status_label(self, status: str, completed_reason: str | None = None) -> str:
        if status == "current":
            return "Läuft gerade"
        if status == "queued":
            return "In der Queue"
        if status == "played":
            return "Gespielt"
        if status == "skipped_by_vote":
            return "Demokratisch übersprungen"
        if status == "skipped":
            return "Übersprungen"
        if status == "removed":
            return "Entfernt" if completed_reason != "cleared" else "Aus Queue geleert"
        return status

    def _row_to_song(self, row: sqlite3.Row) -> dict[str, Any]:
        completed_reason = row["completed_reason"] or row["played_reason"]
        completed_at = row["played_at"] or row["skipped_at"] or row["removed_at"]
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
            "skippedAt": row["skipped_at"],
            "removedAt": row["removed_at"],
            "completedAt": completed_at,
            "completedReason": completed_reason,
            "statusLabel": self._status_label(str(row["status"]), completed_reason),
            "metadataSource": row["metadata_source"],
            "durationSeconds": row["duration_seconds"],
            "pinned": bool(row["pinned"]),
            "submitterLabel": self._device_label(row["added_by_device"]),
            "readdedFromSongId": row["readded_from_song_id"],
            "readdedByGuestName": row["readded_by_guest_name"],
            "readdedByDeviceLabel": self._device_label(row["readded_by_device_id"]),
        }

    def _row_to_message(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "guestName": row["guest_name"],
            "message": row["message"],
            "createdAt": row["created_at"],
            "deviceLabel": self._device_label(row["device_id"]),
        }

    def _row_to_session(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "sessionId": row["session_id"],
            "csrfToken": row["csrf_token"],
            "createdAt": row["created_at"],
            "expiresAt": row["expires_at"],
        }

    def _query_song(self, query: str, params: tuple[Any, ...] = ()) -> Optional[dict[str, Any]]:
        row = self.connection.execute(query, params).fetchone()
        return self._row_to_song(row) if row else None

    def _query_message(self, query: str, params: tuple[Any, ...] = ()) -> Optional[dict[str, Any]]:
        row = self.connection.execute(query, params).fetchone()
        return self._row_to_message(row) if row else None

    def _attach_readd_counts_locked(self, songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not songs:
            return songs
        song_ids = [int(song["id"]) for song in songs]
        placeholders = ",".join("?" for _ in song_ids)
        rows = self.connection.execute(
            f"""
            SELECT readded_from_song_id AS song_id, COUNT(*) AS count
            FROM songs
            WHERE readded_from_song_id IN ({placeholders})
            GROUP BY readded_from_song_id
            """,
            tuple(song_ids),
        ).fetchall()
        counts = {int(row["song_id"]): int(row["count"]) for row in rows}
        for song in songs:
            song["readdCount"] = counts.get(int(song["id"]), 0)
        return songs

    def _cleanup_expired_sessions_locked(self) -> None:
        self.connection.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (utc_now(),))

    def _cleanup_expired_mutes_locked(self) -> None:
        self.connection.execute(
            "DELETE FROM muted_devices WHERE expires_at IS NOT NULL AND expires_at <= ?",
            (utc_now(),),
        )

    def _ensure_current_locked(self) -> None:
        current = self.connection.execute(
            "SELECT id FROM songs WHERE status = 'current' LIMIT 1"
        ).fetchone()
        if current:
            return

        next_row = self.connection.execute(
            f"""
            SELECT id
            FROM songs
            WHERE status = 'queued'
            {self.song_order_clause}
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

    def _enrich_queue_metrics(
        self,
        current: dict[str, Any] | None,
        queue: list[dict[str, Any]],
    ) -> dict[str, Any]:
        total_duration_seconds = 0
        duration_known = True
        current_remaining_seconds: int | None = None

        if current:
            duration = current.get("durationSeconds")
            if duration is not None and current.get("currentStartedAt"):
                started_at = parse_utc(current["currentStartedAt"])
                if started_at:
                    elapsed_seconds = max(
                        0,
                        int((datetime.now(timezone.utc) - started_at).total_seconds()),
                    )
                    current_remaining_seconds = max(0, int(duration) - elapsed_seconds)
                    current["remainingSeconds"] = current_remaining_seconds
                else:
                    current["remainingSeconds"] = duration
                    current_remaining_seconds = int(duration)
            else:
                current["remainingSeconds"] = duration
                current_remaining_seconds = int(duration) if duration is not None else None

            if current_remaining_seconds is None:
                duration_known = False
            else:
                total_duration_seconds += current_remaining_seconds

        wait_cursor = current_remaining_seconds if current else 0
        if current and current_remaining_seconds is None:
            wait_cursor = None

        for song in queue:
            song["estimatedWaitSeconds"] = wait_cursor
            if wait_cursor is not None and song.get("durationSeconds") is not None:
                wait_cursor += int(song["durationSeconds"])
                total_duration_seconds += int(song["durationSeconds"])
            else:
                duration_known = False
                wait_cursor = None

        next_song = queue[0] if queue else None
        return {
            "totalDurationSeconds": total_duration_seconds if duration_known else None,
            "currentRemainingSeconds": current_remaining_seconds,
            "nextSong": next_song,
        }

    def get_state(self) -> dict[str, Any]:
        with self.lock:
            with self.connection:
                self._cleanup_expired_mutes_locked()
                self._cleanup_expired_sessions_locked()
                self._ensure_current_locked()

            current = self._query_song("SELECT * FROM songs WHERE status = 'current' LIMIT 1")
            queue_rows = self.connection.execute(
                f"""
                SELECT *
                FROM songs
                WHERE status = 'queued'
                {self.song_order_clause}
                """
            ).fetchall()
            history_rows = self.connection.execute(
                """
                SELECT *
                FROM songs
                WHERE status IN ('played', 'skipped', 'skipped_by_vote', 'removed')
                ORDER BY COALESCE(removed_at, skipped_at, played_at, added_at) DESC, id DESC
                LIMIT ?
                """,
                (self.history_limit,),
            ).fetchall()
            message_rows = self.connection.execute(
                """
                SELECT *
                FROM messages
                WHERE deleted_at IS NULL
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (self.chat_history_limit,),
            ).fetchall()
            active_count = self.connection.execute(
                "SELECT COUNT(*) AS count FROM songs WHERE status IN ('queued', 'current')"
            ).fetchone()["count"]
            muted_count = self.connection.execute(
                "SELECT COUNT(*) AS count FROM muted_devices"
            ).fetchone()["count"]

        queue = [self._row_to_song(row) for row in queue_rows]
        history = self._attach_readd_counts_locked([self._row_to_song(row) for row in history_rows])
        messages = [self._row_to_message(row) for row in reversed(message_rows)]
        queue_meta = self._enrich_queue_metrics(current, queue)

        return {
            "current": current,
            "queue": queue,
            "history": history,
            "messages": messages,
            "queueMeta": queue_meta,
            "stats": {
                "activeCount": active_count,
                "historyCount": len(history),
                "messageCount": len(messages),
                "mutedDeviceCount": muted_count,
            },
        }

    def count_active_songs_for_device(self, device_id: str) -> int:
        with self.lock:
            row = self.connection.execute(
                """
                SELECT COUNT(*) AS count
                FROM songs
                WHERE added_by_device = ? AND status IN ('queued', 'current')
                """,
                (device_id,),
            ).fetchone()
        return int(row["count"])

    def record_guest_activity(self, device_id: str, guest_name: str = "", role: str = "guest") -> None:
        if not device_id:
            return
        cleaned_role = role if role in {"guest", "admin", "player", "audio", "screen", "start"} else "guest"
        now = utc_now()
        with self.lock, self.connection:
            self.connection.execute(
                """
                INSERT INTO guest_activity (device_id, guest_name, role, last_seen_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                    guest_name = CASE
                        WHEN excluded.guest_name != '' THEN excluded.guest_name
                        ELSE guest_activity.guest_name
                    END,
                    role = excluded.role,
                    last_seen_at = excluded.last_seen_at
                """,
                (device_id[:80], guest_name[:80], cleaned_role, now),
            )

    def active_guest_count(self, window_seconds: int) -> int:
        cutoff = utc_after_seconds(-max(1, window_seconds))
        with self.lock:
            row = self.connection.execute(
                """
                SELECT COUNT(*) AS count
                FROM guest_activity
                WHERE role = 'guest' AND last_seen_at >= ?
                """,
                (cutoff,),
            ).fetchone()
        return int(row["count"] or 0)

    def get_skip_status(
        self,
        *,
        device_id: str | None = None,
        active_window_seconds: int = 300,
        threshold_percent: int = 40,
        enabled: bool = True,
    ) -> dict[str, Any]:
        threshold = min(100, max(10, int(threshold_percent or 40)))
        with self.lock:
            current = self.connection.execute(
                "SELECT id FROM songs WHERE status = 'current' LIMIT 1"
            ).fetchone()
            active_count = self.active_guest_count(active_window_seconds)
            if not current:
                return {
                    "skipVotingEnabled": bool(enabled),
                    "skipThresholdPercent": threshold,
                    "activeGuestCount": active_count,
                    "currentSkipVoteCount": 0,
                    "currentSkipVotePercent": 0,
                    "skipVotesNeeded": None,
                    "hasCurrentDeviceSkipVoted": False,
                    "currentSongId": None,
                }

            vote_count = self.connection.execute(
                "SELECT COUNT(*) AS count FROM skip_votes WHERE song_id = ?",
                (current["id"],),
            ).fetchone()["count"]
            has_voted = False
            if device_id:
                has_voted = (
                    self.connection.execute(
                        "SELECT 1 FROM skip_votes WHERE song_id = ? AND device_id = ?",
                        (current["id"], device_id[:80]),
                    ).fetchone()
                    is not None
                )
            votes_needed = None
            percent = 0
            if active_count > 0:
                votes_needed = max(1, int((active_count * threshold + 99) // 100))
                percent = min(100, int(round((int(vote_count) / active_count) * 100)))

            return {
                "skipVotingEnabled": bool(enabled),
                "skipThresholdPercent": threshold,
                "activeGuestCount": active_count,
                "currentSkipVoteCount": int(vote_count),
                "currentSkipVotePercent": percent,
                "skipVotesNeeded": votes_needed,
                "hasCurrentDeviceSkipVoted": has_voted,
                "currentSongId": int(current["id"]),
            }

    def add_skip_vote_current(
        self,
        device_id: str,
        guest_name: str,
        *,
        active_window_seconds: int,
        threshold_percent: int,
    ) -> dict[str, Any]:
        now = utc_now()
        with self.lock, self.connection:
            current = self.connection.execute(
                "SELECT id FROM songs WHERE status = 'current' LIMIT 1"
            ).fetchone()
            if not current:
                raise NotFoundError("Aktuell läuft kein Song.")

            try:
                self.connection.execute(
                    """
                    INSERT INTO skip_votes (song_id, device_id, guest_name, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (current["id"], device_id[:80], guest_name[:80], now),
                )
            except sqlite3.IntegrityError as exc:
                raise AlreadySkipVotedError("Dieses Gerät hat für den aktuellen Song bereits Skip gevotet.") from exc

            status = self.get_skip_status(
                device_id=device_id,
                active_window_seconds=active_window_seconds,
                threshold_percent=threshold_percent,
                enabled=True,
            )
            triggered = False
            if (
                status["activeGuestCount"] > 0
                and status["skipVotesNeeded"] is not None
                and status["currentSkipVoteCount"] >= status["skipVotesNeeded"]
            ):
                self._complete_current_locked("skipped_by_vote")
                self._ensure_current_locked()
                triggered = True

            return {
                "skipStatus": status,
                "triggered": triggered,
                "current": self._query_song("SELECT * FROM songs WHERE status = 'current' LIMIT 1"),
            }

    def remove_skip_vote_current(
        self,
        device_id: str,
        *,
        active_window_seconds: int,
        threshold_percent: int,
    ) -> dict[str, Any]:
        with self.lock, self.connection:
            current = self.connection.execute(
                "SELECT id FROM songs WHERE status = 'current' LIMIT 1"
            ).fetchone()
            if not current:
                raise NotFoundError("Aktuell läuft kein Song.")
            self.connection.execute(
                "DELETE FROM skip_votes WHERE song_id = ? AND device_id = ?",
                (current["id"], device_id[:80]),
            )
            return self.get_skip_status(
                device_id=device_id,
                active_window_seconds=active_window_seconds,
                threshold_percent=threshold_percent,
                enabled=True,
            )

    def reset_current_skip_votes(self) -> None:
        with self.lock, self.connection:
            current = self.connection.execute(
                "SELECT id FROM songs WHERE status = 'current' LIMIT 1"
            ).fetchone()
            if not current:
                return
            self.connection.execute("DELETE FROM skip_votes WHERE song_id = ?", (current["id"],))

    def get_song_device(self, song_id: int) -> tuple[str, str]:
        with self.lock:
            row = self.connection.execute(
                "SELECT added_by_device, guest_name FROM songs WHERE id = ?",
                (song_id,),
            ).fetchone()
        if not row:
            raise NotFoundError("Der Song wurde nicht gefunden.")
        return str(row["added_by_device"]), str(row["guest_name"] or "")

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
                        added_at,
                        readded_from_song_id,
                        readded_by_device_id,
                        readded_by_guest_name,
                        duration_seconds,
                        pinned
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'queued', ?, ?, ?, ?, ?, 0)
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
                        payload.readded_from_song_id,
                        payload.readded_by_device_id,
                        payload.readded_by_guest_name,
                        payload.duration_seconds,
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
                raise AlreadyVotedError("Dieses Gerät hat für den Song schon gevotet.") from exc

            self.connection.execute("UPDATE songs SET votes = votes + 1 WHERE id = ?", (song_id,))
            return self._query_song("SELECT * FROM songs WHERE id = ?", (song_id,)) or {}

    def _complete_current_locked(self, reason: str) -> Optional[int]:
        now = utc_now()
        current = self.connection.execute(
            "SELECT id FROM songs WHERE status = 'current' LIMIT 1"
        ).fetchone()
        if not current:
            return None

        if reason == "skipped_by_vote":
            status = "skipped_by_vote"
            played_at = None
            skipped_at = now
        elif reason in {"skipped", "skip"}:
            status = "skipped"
            played_at = None
            skipped_at = now
        else:
            status = "played"
            played_at = now
            skipped_at = None

        self.connection.execute(
            """
            UPDATE songs
            SET status = ?,
                played_at = ?,
                skipped_at = ?,
                completed_reason = ?,
                played_reason = ?,
                current_started_at = NULL,
                pinned = 0
            WHERE id = ?
            """,
            (status, played_at, skipped_at, reason, reason, current["id"]),
        )
        self.connection.execute("DELETE FROM skip_votes WHERE song_id = ?", (current["id"],))
        return int(current["id"])

    def remove_song(self, song_id: int) -> None:
        now = utc_now()
        with self.lock, self.connection:
            song = self.connection.execute(
                "SELECT status FROM songs WHERE id = ? AND status IN ('queued', 'current')",
                (song_id,),
            ).fetchone()
            if not song:
                raise NotFoundError("Der Song wurde nicht gefunden.")

            self.connection.execute("DELETE FROM skip_votes WHERE song_id = ?", (song_id,))
            self.connection.execute(
                """
                UPDATE songs
                SET status = 'removed',
                    removed_at = ?,
                    completed_reason = 'removed',
                    current_started_at = NULL,
                    pinned = 0
                WHERE id = ?
                """,
                (now, song_id),
            )
            if song["status"] == "current":
                self._ensure_current_locked()

    def mark_current_played(self, reason: str) -> Optional[dict[str, Any]]:
        with self.lock, self.connection:
            song_id = self._complete_current_locked(reason)
            if not song_id:
                return None
            self._ensure_current_locked()
            return self._query_song("SELECT * FROM songs WHERE id = ?", (song_id,))

    def clear_active_queue(self) -> None:
        now = utc_now()
        with self.lock, self.connection:
            self.connection.execute(
                "DELETE FROM skip_votes WHERE song_id IN (SELECT id FROM songs WHERE status IN ('queued', 'current'))"
            )
            self.connection.execute(
                """
                UPDATE songs
                SET status = 'removed',
                    removed_at = ?,
                    completed_reason = 'cleared',
                    current_started_at = NULL,
                    pinned = 0
                WHERE status IN ('queued', 'current')
                """,
                (now,),
            )

    def reset_party(self) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM skip_votes")
            self.connection.execute("DELETE FROM votes")
            self.connection.execute("DELETE FROM songs")
            self.connection.execute("DELETE FROM messages")
            self.connection.execute("DELETE FROM muted_devices")
            self.connection.execute("DELETE FROM guest_activity")

    def set_song_pinned(self, song_id: int, pinned: bool) -> dict[str, Any]:
        with self.lock, self.connection:
            song = self.connection.execute(
                "SELECT id FROM songs WHERE id = ? AND status IN ('queued', 'current')",
                (song_id,),
            ).fetchone()
            if not song:
                raise NotFoundError("Der Song wurde nicht gefunden.")
            self.connection.execute(
                "UPDATE songs SET pinned = ? WHERE id = ?",
                (1 if pinned else 0, song_id),
            )
            return self._query_song("SELECT * FROM songs WHERE id = ?", (song_id,)) or {}

    def remove_device_active_songs(self, device_id: str) -> int:
        now = utc_now()
        with self.lock, self.connection:
            rows = self.connection.execute(
                "SELECT id, status FROM songs WHERE added_by_device = ? AND status IN ('queued', 'current')",
                (device_id,),
            ).fetchall()
            if not rows:
                return 0
            song_ids = [row["id"] for row in rows]
            placeholders = ",".join("?" for _ in song_ids)
            self.connection.execute(
                f"DELETE FROM skip_votes WHERE song_id IN ({placeholders})",
                tuple(song_ids),
            )
            self.connection.execute(
                f"""
                UPDATE songs
                SET status = 'removed',
                    removed_at = ?,
                    completed_reason = 'device_cleared',
                    current_started_at = NULL,
                    pinned = 0
                WHERE id IN ({placeholders})
                """,
                (now, *song_ids),
            )
            self._ensure_current_locked()
            return len(song_ids)

    def add_message(self, payload: ChatMessageInput) -> dict[str, Any]:
        now = utc_now()
        with self.lock, self.connection:
            cursor = self.connection.execute(
                """
                INSERT INTO messages (guest_name, message, device_id, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (payload.guest_name, payload.message, payload.device_id, now),
            )
            return self._query_message("SELECT * FROM messages WHERE id = ?", (cursor.lastrowid,)) or {}

    def delete_message(self, message_id: int) -> None:
        with self.lock, self.connection:
            row = self.connection.execute(
                "SELECT id FROM messages WHERE id = ? AND deleted_at IS NULL",
                (message_id,),
            ).fetchone()
            if not row:
                raise NotFoundError("Die Nachricht wurde nicht gefunden.")
            self.connection.execute(
                "UPDATE messages SET deleted_at = ? WHERE id = ?",
                (utc_now(), message_id),
            )

    def get_message_device(self, message_id: int) -> tuple[str, str]:
        with self.lock:
            row = self.connection.execute(
                "SELECT device_id, guest_name FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()
        if not row:
            raise NotFoundError("Die Nachricht wurde nicht gefunden.")
        return str(row["device_id"]), str(row["guest_name"] or "")

    def mute_device(self, device_id: str, guest_name: str, reason: str, duration_minutes: int) -> dict[str, Any]:
        now = utc_now()
        expires_at = utc_after_minutes(duration_minutes) if duration_minutes > 0 else None
        with self.lock, self.connection:
            self.connection.execute(
                """
                INSERT INTO muted_devices (device_id, guest_name, reason, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                    guest_name = excluded.guest_name,
                    reason = excluded.reason,
                    created_at = excluded.created_at,
                    expires_at = excluded.expires_at
                """,
                (device_id, guest_name, reason, now, expires_at),
            )
            row = self.connection.execute(
                "SELECT * FROM muted_devices WHERE device_id = ?",
                (device_id,),
            ).fetchone()
        return {
            "deviceId": str(row["device_id"]),
            "guestName": str(row["guest_name"]),
            "reason": str(row["reason"]),
            "createdAt": str(row["created_at"]),
            "expiresAt": str(row["expires_at"]) if row["expires_at"] else None,
        }

    def unmute_device(self, device_id: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM muted_devices WHERE device_id = ?", (device_id,))

    def is_device_muted(self, device_id: str) -> dict[str, Any] | None:
        with self.lock, self.connection:
            self._cleanup_expired_mutes_locked()
            row = self.connection.execute(
                "SELECT * FROM muted_devices WHERE device_id = ?",
                (device_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "deviceId": str(row["device_id"]),
            "guestName": str(row["guest_name"]),
            "reason": str(row["reason"]),
            "createdAt": str(row["created_at"]),
            "expiresAt": str(row["expires_at"]) if row["expires_at"] else None,
        }

    def list_muted_devices(self) -> list[dict[str, Any]]:
        with self.lock, self.connection:
            self._cleanup_expired_mutes_locked()
            rows = self.connection.execute(
                "SELECT * FROM muted_devices ORDER BY created_at DESC, device_id ASC"
            ).fetchall()
        return [
            {
                "deviceId": str(row["device_id"]),
                "deviceLabel": self._device_label(row["device_id"]),
                "guestName": str(row["guest_name"]),
                "reason": str(row["reason"]),
                "createdAt": str(row["created_at"]),
                "expiresAt": str(row["expires_at"]) if row["expires_at"] else None,
            }
            for row in rows
        ]

    def create_admin_session(self, session_id: str, csrf_token: str, max_age_seconds: int) -> None:
        with self.lock, self.connection:
            self._cleanup_expired_sessions_locked()
            self.connection.execute(
                """
                INSERT INTO admin_sessions (session_id, csrf_token, created_at, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (session_id, csrf_token, utc_now(), utc_after_seconds(max_age_seconds)),
            )

    def get_admin_session(self, session_id: str) -> dict[str, Any] | None:
        with self.lock, self.connection:
            self._cleanup_expired_sessions_locked()
            row = self.connection.execute(
                "SELECT * FROM admin_sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        return self._row_to_session(row) if row else None

    def delete_admin_session(self, session_id: str) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM admin_sessions WHERE session_id = ?", (session_id,))

    def clear_admin_sessions(self) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM admin_sessions")

    def clear_runtime_settings(self) -> None:
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM runtime_settings")

    def export_snapshot(self) -> dict[str, Any]:
        state = self.get_state()
        with self.lock:
            song_rows = self.connection.execute("SELECT * FROM songs ORDER BY id ASC").fetchall()
            message_rows = self.connection.execute("SELECT * FROM messages ORDER BY id ASC").fetchall()
        state["allSongs"] = [self._row_to_song(row) for row in song_rows]
        state["allMessages"] = [self._row_to_message(row) for row in message_rows if row["deleted_at"] is None]
        state["runtimeSettings"] = self.get_runtime_settings()
        return state

    def get_history(
        self,
        *,
        status_filter: str = "all",
        search: str = "",
        limit: int = 250,
    ) -> list[dict[str, Any]]:
        statuses = {
            "played": ("played",),
            "skipped": ("skipped", "skipped_by_vote"),
            "skipped_by_vote": ("skipped_by_vote",),
            "removed": ("removed",),
        }.get(status_filter, ("played", "skipped", "skipped_by_vote", "removed"))
        placeholders = ",".join("?" for _ in statuses)
        params: list[Any] = list(statuses)
        search_clause = ""
        cleaned_search = search.strip()
        if cleaned_search:
            search_clause = "AND (LOWER(title) LIKE ? OR LOWER(guest_name) LIKE ?)"
            needle = f"%{cleaned_search.lower()}%"
            params.extend([needle, needle])
        params.append(max(1, min(limit, 1000)))

        with self.lock:
            rows = self.connection.execute(
                f"""
                SELECT *
                FROM songs
                WHERE status IN ({placeholders})
                {search_clause}
                ORDER BY COALESCE(removed_at, skipped_at, played_at, added_at) DESC, id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
            return self._attach_readd_counts_locked([self._row_to_song(row) for row in rows])

    def readd_from_history(self, song_id: int, device_id: str, guest_name: str) -> dict[str, Any]:
        with self.lock:
            row = self.connection.execute(
                """
                SELECT *
                FROM songs
                WHERE id = ? AND status IN ('played', 'skipped', 'skipped_by_vote', 'removed')
                """,
                (song_id,),
            ).fetchone()
        if not row:
            raise NotFoundError("Der Song wurde im Verlauf nicht gefunden.")

        return self.add_song(
            AddSongInput(
                video_id=row["video_id"],
                canonical_url=row["canonical_url"],
                source_url=row["canonical_url"],
                title=row["title"],
                thumbnail_url=row["thumbnail_url"],
                guest_name=guest_name,
                added_by_device=device_id,
                metadata_source=row["metadata_source"],
                duration_seconds=row["duration_seconds"],
                readded_from_song_id=int(song_id),
                readded_by_device_id=device_id,
                readded_by_guest_name=guest_name,
            )
        )

    def get_best_of(self, limit: int = 50) -> list[dict[str, Any]]:
        history = self.get_history(limit=1000)
        best: list[dict[str, Any]] = []
        for song in history:
            status = str(song.get("status") or "")
            played_bonus = 2 if status == "played" else 0
            readd_bonus = int(song.get("readdCount") or 0)
            skipped_penalty = 2 if status in {"skipped", "skipped_by_vote"} else 0
            removed_penalty = 5 if status == "removed" else 0
            score = int(song.get("votes") or 0) + played_bonus + readd_bonus - skipped_penalty - removed_penalty
            best.append(
                {
                    **song,
                    "bestScore": score,
                    "bestScoreBreakdown": {
                        "votes": int(song.get("votes") or 0),
                        "playedBonus": played_bonus,
                        "readdBonus": readd_bonus,
                        "skippedPenalty": skipped_penalty,
                        "removedPenalty": removed_penalty,
                    },
                }
            )
        best.sort(
            key=lambda song: (
                int(song.get("bestScore") or 0),
                int(song.get("votes") or 0),
                -datetime.fromisoformat(song.get("completedAt") or song.get("addedAt")).timestamp(),
            ),
            reverse=True,
        )
        return best[: max(1, min(limit, 100))]

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

                if stored_value == "":
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
