from __future__ import annotations

import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from typing import Iterator


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


class MetricsTracker:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.request_totals: dict[tuple[str, str, str], int] = defaultdict(int)
        self.request_duration_sum: dict[tuple[str, str], float] = defaultdict(float)
        self.request_duration_count: dict[tuple[str, str], int] = defaultdict(int)
        self.counters: dict[str, int] = defaultdict(int)
        self.gauges: dict[str, float] = defaultdict(float)

    @contextmanager
    def track_request(self, method: str, path: str) -> Iterator[dict[str, str]]:
        started = time.perf_counter()
        labels = {"method": method, "path": path, "status": "500"}
        try:
            yield labels
        finally:
            duration = max(0.0, time.perf_counter() - started)
            with self.lock:
                key = (labels["method"], labels["path"], labels["status"])
                self.request_totals[key] += 1
                duration_key = (labels["method"], labels["path"])
                self.request_duration_sum[duration_key] += duration
                self.request_duration_count[duration_key] += 1

    def increment(self, name: str, value: int = 1) -> None:
        with self.lock:
            self.counters[name] += value

    def set_gauge(self, name: str, value: float) -> None:
        with self.lock:
            self.gauges[name] = value

    def render_prometheus(self) -> str:
        lines: list[str] = []
        with self.lock:
            for (method, path, status), value in sorted(self.request_totals.items()):
                labels = (
                    f'method="{_escape_label(method)}",'
                    f'path="{_escape_label(path)}",'
                    f'status="{_escape_label(status)}"'
                )
                lines.append(f"partytube_http_requests_total{{{labels}}} {value}")

            for (method, path), value in sorted(self.request_duration_sum.items()):
                labels = f'method="{_escape_label(method)}",path="{_escape_label(path)}"'
                lines.append(f"partytube_http_request_duration_seconds_sum{{{labels}}} {value}")
                lines.append(
                    f"partytube_http_request_duration_seconds_count{{{labels}}} "
                    f"{self.request_duration_count[(method, path)]}"
                )

            for name, value in sorted(self.counters.items()):
                lines.append(f"partytube_{name}_total {value}")

            for name, value in sorted(self.gauges.items()):
                lines.append(f"partytube_{name} {value}")

        return "\n".join(lines) + "\n"
