from __future__ import annotations

import hashlib
import hmac
import json
import re
import socket
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from redis import Redis
from redis.exceptions import ResponseError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import ProductEventOutbox


_FORBIDDEN_PROPERTY_FRAGMENTS = {
    "access_key",
    "answer",
    "candidate",
    "content",
    "email",
    "invitation",
    "ip_address",
    "name",
    "password",
    "recording",
    "response",
    "submitted_data",
    "text",
    "token",
    "url",
    "user_agent",
}
_SAFE_SQL_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _safe_scalar(value: Any) -> str | int | float | bool | None:
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, str):
        return value[:160]
    return None


def sanitize_product_event_properties(properties: dict[str, Any] | None) -> dict[str, Any]:
    """Allow bounded analytics dimensions while dropping identifying/content fields."""
    clean: dict[str, Any] = {}
    for raw_key, raw_value in (properties or {}).items():
        key = str(raw_key or "").strip().lower()[:80]
        if not key or any(fragment in key for fragment in _FORBIDDEN_PROPERTY_FRAGMENTS):
            continue
        if isinstance(raw_value, (list, tuple, set)):
            values = [_safe_scalar(item) for item in list(raw_value)[:20]]
            clean[key] = [item for item in values if item is not None]
            continue
        safe_value = _safe_scalar(raw_value)
        if safe_value is not None:
            clean[key] = safe_value
    return clean


def emit_product_event(
    db: Session,
    *,
    event_type: str,
    organization_id: int | None,
    aggregate_type: str,
    aggregate_id: int | str,
    properties: dict[str, Any] | None = None,
    occurred_at: datetime | None = None,
) -> ProductEventOutbox | None:
    """Stage an event in the caller's existing database transaction."""
    if not get_settings().product_event_capture_enabled:
        return None
    event = ProductEventOutbox(
        event_type=str(event_type or "unknown")[:120],
        organization_id=int(organization_id) if organization_id is not None else None,
        aggregate_type=str(aggregate_type or "unknown")[:80],
        aggregate_id=str(aggregate_id)[:120],
        properties_json=sanitize_product_event_properties(properties),
        occurred_at=occurred_at or datetime.now(timezone.utc),
    )
    db.add(event)
    return event


def _event_stream_fields(event: ProductEventOutbox) -> dict[str, str]:
    occurred_at = event.occurred_at
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    return {
        "event_id": event.event_id,
        "event_type": event.event_type,
        "organization_id": "" if event.organization_id is None else str(event.organization_id),
        "aggregate_type": event.aggregate_type,
        "aggregate_id": event.aggregate_id,
        "properties_json": json.dumps(event.properties_json or {}, separators=(",", ":")),
        "schema_version": str(event.schema_version or 1),
        "occurred_at": occurred_at.astimezone(timezone.utc).isoformat(timespec="milliseconds"),
    }


def relay_outbox_batch(db: Session, redis_client: Redis, *, stream: str, batch_size: int, max_length: int) -> int:
    now = datetime.now(timezone.utc)
    query = (
        select(ProductEventOutbox)
        .where(
            ProductEventOutbox.published_at.is_(None),
            or_(ProductEventOutbox.next_attempt_at.is_(None), ProductEventOutbox.next_attempt_at <= now),
        )
        .order_by(ProductEventOutbox.id.asc())
        .limit(max(1, int(batch_size)))
    )
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        query = query.with_for_update(skip_locked=True)
    events = list(db.scalars(query).all())
    published = 0
    for event in events:
        try:
            redis_client.xadd(
                stream,
                _event_stream_fields(event),
                maxlen=max(1_000, int(max_length)),
                approximate=True,
            )
            event.published_at = now
            event.publish_attempts = int(event.publish_attempts or 0) + 1
            event.last_error = None
            published += 1
        except Exception as exc:
            attempts = int(event.publish_attempts or 0) + 1
            event.publish_attempts = attempts
            event.last_error = type(exc).__name__[:160]
            event.next_attempt_at = now + timedelta(seconds=min(300, 2 ** min(attempts, 8)))
            break
    db.commit()
    return published


def _analytics_key(secret: str, namespace: str, raw_value: str) -> str:
    key = secret.encode("utf-8")
    message = f"{namespace}:{raw_value}".encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class StreamProductEvent:
    stream_id: str
    event_id: str
    event_type: str
    occurred_at: str
    organization_key: str
    aggregate_type: str
    aggregate_key: str
    properties_json: str
    schema_version: int
    deployment_region: str


class ClickHouseProductEventSink:
    def __init__(self, settings) -> None:
        self._database = settings.clickhouse_database
        if not _SAFE_SQL_IDENTIFIER.fullmatch(self._database):
            raise RuntimeError("CLICKHOUSE_DATABASE must be a simple SQL identifier")
        self._retention_days = max(1, int(settings.clickhouse_retention_days))
        self._region = settings.resolved_deployment_region
        self._hash_secret = str(settings.analytics_id_hash_key or settings.jwt_secret_key)
        if len(self._hash_secret) < 32:
            raise RuntimeError("ANALYTICS_ID_HASH_KEY or JWT_SECRET_KEY must contain at least 32 characters")
        self._client = httpx.Client(
            base_url=settings.clickhouse_url.rstrip("/"),
            auth=(settings.clickhouse_user, settings.clickhouse_password),
            timeout=10.0,
        )
        self._schema_ready = False

    def close(self) -> None:
        self._client.close()

    def _query(self, query: str, content: bytes = b"") -> None:
        response = self._client.post("/", params={"query": query}, content=content)
        if response.is_error:
            raise RuntimeError(f"ClickHouse query failed ({response.status_code}): {response.text[:500]}")

    def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        self._query(f"CREATE DATABASE IF NOT EXISTS {self._database}")
        self._query(
            f"""
CREATE TABLE IF NOT EXISTS {self._database}.product_events
(
    event_id UUID,
    occurred_at DateTime64(3, 'UTC'),
    event_type LowCardinality(String),
    organization_key FixedString(64),
    aggregate_type LowCardinality(String),
    aggregate_key FixedString(64),
    properties_json String,
    schema_version UInt16,
    deployment_region LowCardinality(String),
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (event_id)
TTL occurred_at + INTERVAL {self._retention_days} DAY DELETE
""".strip(),
        )
        self._schema_ready = True

    def from_stream(self, stream_id: str, fields: dict[str, str]) -> StreamProductEvent:
        organization_id = fields.get("organization_id") or "anonymous"
        aggregate_id = fields.get("aggregate_id") or "unknown"
        raw_properties = json.loads(fields.get("properties_json") or "{}")
        properties = sanitize_product_event_properties(raw_properties if isinstance(raw_properties, dict) else {})
        occurred_at = datetime.fromisoformat(str(fields["occurred_at"]).replace("Z", "+00:00"))
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=timezone.utc)
        return StreamProductEvent(
            stream_id=stream_id,
            event_id=fields["event_id"],
            event_type=str(fields.get("event_type") or "unknown")[:120],
            occurred_at=occurred_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            organization_key=_analytics_key(self._hash_secret, "organization", organization_id),
            aggregate_type=str(fields.get("aggregate_type") or "unknown")[:80],
            aggregate_key=_analytics_key(self._hash_secret, "aggregate", f"{fields.get('aggregate_type')}:{aggregate_id}"),
            properties_json=json.dumps(properties, separators=(",", ":")),
            schema_version=max(1, int(fields.get("schema_version") or 1)),
            deployment_region=self._region,
        )

    def insert(self, events: list[StreamProductEvent]) -> None:
        if not events:
            return
        self.ensure_schema()
        rows = []
        for event in events:
            rows.append(
                json.dumps(
                    {
                        "event_id": event.event_id,
                        "occurred_at": event.occurred_at,
                        "event_type": event.event_type,
                        "organization_key": event.organization_key,
                        "aggregate_type": event.aggregate_type,
                        "aggregate_key": event.aggregate_key,
                        "properties_json": event.properties_json,
                        "schema_version": event.schema_version,
                        "deployment_region": event.deployment_region,
                    },
                    separators=(",", ":"),
                ),
            )
        self._query(
            f"INSERT INTO {self._database}.product_events FORMAT JSONEachRow",
            "\n".join(rows).encode("utf-8"),
        )


def ensure_consumer_group(redis_client: Redis, *, stream: str, group: str) -> None:
    try:
        redis_client.xgroup_create(stream, group, id="0-0", mkstream=True)
    except ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


def consume_product_event_batch(
    redis_client: Redis,
    sink: ClickHouseProductEventSink,
    *,
    stream: str,
    group: str,
    batch_size: int,
) -> int:
    ensure_consumer_group(redis_client, stream=stream, group=group)
    consumer = f"clickhouse-{socket.gethostname()}"
    messages: list[tuple[str, dict[str, str]]] = []
    try:
        claimed = redis_client.xautoclaim(
            stream,
            group,
            consumer,
            min_idle_time=60_000,
            start_id="0-0",
            count=max(1, int(batch_size)),
        )
        if len(claimed) >= 2:
            messages.extend(claimed[1] or [])
    except ResponseError:
        pass
    remaining = max(0, int(batch_size) - len(messages))
    if remaining:
        response = redis_client.xreadgroup(
            group,
            consumer,
            streams={stream: ">"},
            count=remaining,
            block=100,
        )
        if response:
            messages.extend(response[0][1])
    if not messages:
        return 0
    events = [sink.from_stream(stream_id, fields) for stream_id, fields in messages]
    sink.insert(events)
    redis_client.xack(stream, group, *[event.stream_id for event in events])
    return len(events)
