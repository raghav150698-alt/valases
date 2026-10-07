from __future__ import annotations

import asyncio
import json
import re
from contextlib import suppress
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

import httpx


_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_OPAQUE_PATH_SEGMENT = re.compile(r"^(?:\d+|[0-9a-fA-F-]{16,}|[A-Za-z0-9_-]{24,})$")


def normalized_analytics_route(route_template: str | None, raw_path: str) -> str:
    """Return a bounded route without invitation keys, IDs, or opaque tokens."""
    candidate = str(route_template or "").strip()
    if candidate and "{" in candidate:
        return candidate[:300]
    safe_segments = []
    for segment in str(raw_path or "/").split("/"):
        safe_segments.append(":id" if _OPAQUE_PATH_SEGMENT.fullmatch(segment) else segment)
    return "/".join(safe_segments)[:300] or "/"


@dataclass(frozen=True)
class RequestAnalyticsEvent:
    occurred_at: str
    method: str
    route: str
    status_code: int
    duration_ms: float
    deployment_region: str


class ClickHouseAnalytics:
    """Non-blocking, bounded request analytics exporter for ClickHouse."""

    def __init__(
        self,
        *,
        enabled: bool,
        url: str,
        user: str,
        password: str,
        database: str,
        retention_days: int,
        batch_size: int,
        flush_interval_seconds: float,
        queue_size: int,
    ) -> None:
        if not _SAFE_IDENTIFIER.fullmatch(database):
            raise ValueError("CLICKHOUSE_DATABASE must be a simple SQL identifier")
        self.enabled = bool(enabled)
        self._url = url.rstrip("/")
        self._auth = (user, password)
        self._database = database
        self._retention_days = max(1, int(retention_days))
        self._batch_size = max(1, int(batch_size))
        self._flush_interval = max(0.1, float(flush_interval_seconds))
        self._queue: asyncio.Queue[RequestAnalyticsEvent] = asyncio.Queue(maxsize=max(100, int(queue_size)))
        self._task: asyncio.Task | None = None
        self._client: httpx.AsyncClient | None = None
        self._status = "disabled" if not self.enabled else "not_started"
        self._dropped = 0
        self._written = 0
        self._last_error: str | None = None

    def start(self) -> None:
        if not self.enabled or (self._task and not self._task.done()):
            return
        self._client = httpx.AsyncClient(base_url=self._url, auth=self._auth, timeout=5.0)
        self._status = "connecting"
        self._task = asyncio.create_task(self._run(), name="clickhouse-analytics")

    def record_request(
        self,
        *,
        method: str,
        route: str,
        status_code: int,
        duration_ms: float,
        deployment_region: str,
    ) -> None:
        if not self.enabled:
            return
        event = RequestAnalyticsEvent(
            occurred_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            method=str(method or "UNKNOWN")[:12],
            route=str(route or "/")[:300],
            status_code=int(status_code),
            duration_ms=round(max(0.0, float(duration_ms)), 3),
            deployment_region=str(deployment_region or "unknown")[:32],
        )
        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            self._dropped += 1

    async def _query(self, query: str, *, content: bytes = b"") -> None:
        assert self._client is not None
        response = await self._client.post("/", params={"query": query}, content=content)
        response.raise_for_status()

    async def _ensure_schema(self) -> None:
        await self._query(f"CREATE DATABASE IF NOT EXISTS {self._database}")
        await self._query(
            f"""
CREATE TABLE IF NOT EXISTS {self._database}.request_events
(
    occurred_at DateTime64(3, 'UTC'),
    method LowCardinality(String),
    route LowCardinality(String),
    status_code UInt16,
    duration_ms Float32,
    deployment_region LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (route, occurred_at)
TTL occurred_at + INTERVAL {self._retention_days} DAY DELETE
""".strip(),
        )

    async def _flush(self, events: list[RequestAnalyticsEvent]) -> None:
        if not events:
            return
        payload = b"\n".join(
            json.dumps(asdict(event), separators=(",", ":")).encode("utf-8")
            for event in events
        )
        await self._query(
            f"INSERT INTO {self._database}.request_events FORMAT JSONEachRow",
            content=payload,
        )
        self._written += len(events)

    async def _run(self) -> None:
        schema_ready = False
        batch: list[RequestAnalyticsEvent] = []
        while True:
            try:
                if not schema_ready:
                    await self._ensure_schema()
                    schema_ready = True
                    self._status = "ready"
                    self._last_error = None
                try:
                    event = await asyncio.wait_for(self._queue.get(), timeout=self._flush_interval)
                    batch.append(event)
                except asyncio.TimeoutError:
                    pass
                if batch and (len(batch) >= self._batch_size or self._queue.empty()):
                    await self._flush(batch)
                    batch.clear()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                # Keep the bounded queue and retry in the background. The API
                # path that produced the event remains completely independent.
                self._status = "unavailable"
                self._last_error = type(exc).__name__
                schema_ready = False
                await asyncio.sleep(2.0)
        if batch and schema_ready:
            with suppress(Exception):
                await self._flush(batch)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._client:
            await self._client.aclose()
            self._client = None

    def status(self) -> dict:
        return {
            "status": self._status,
            "queued_events": self._queue.qsize(),
            "written_events": self._written,
            "dropped_events": self._dropped,
            "last_error": self._last_error,
        }


def create_clickhouse_analytics(settings) -> ClickHouseAnalytics:
    return ClickHouseAnalytics(
        enabled=settings.clickhouse_analytics_enabled,
        url=settings.clickhouse_url,
        user=settings.clickhouse_user,
        password=settings.clickhouse_password,
        database=settings.clickhouse_database,
        retention_days=settings.clickhouse_retention_days,
        batch_size=settings.clickhouse_batch_size,
        flush_interval_seconds=settings.clickhouse_flush_interval_seconds,
        queue_size=settings.clickhouse_queue_size,
    )
