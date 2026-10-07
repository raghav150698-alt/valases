from __future__ import annotations

import time
from hashlib import sha256
from collections import deque
from dataclasses import dataclass
from threading import Lock

from redis.asyncio import Redis


@dataclass
class LimitRule:
    max_requests: int
    window_seconds: int = 60


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str, rule: LimitRule) -> tuple[bool, int]:
        now = time.time()
        cutoff = now - max(1, int(rule.window_seconds))
        with self._lock:
            bucket = self._events.get(key)
            if bucket is None:
                bucket = deque()
                self._events[key] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= max(1, int(rule.max_requests)):
                retry_after = int(max(1, round(bucket[0] + rule.window_seconds - now)))
                return False, retry_after
            bucket.append(now)
            return True, 0


class ResilientRateLimiter:
    """Distributed Redis limiter with a short-circuiting in-process fallback."""

    _INCREMENT_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
"""

    def __init__(self, *, redis_url: str = "", enabled: bool = False, key_prefix: str = "valases") -> None:
        self._fallback = InMemoryRateLimiter()
        self._enabled = bool(enabled and redis_url)
        self._prefix = (key_prefix or "valases").strip(":")
        self._redis: Redis | None = (
            Redis.from_url(redis_url, encoding="utf-8", decode_responses=True)
            if self._enabled
            else None
        )
        self._retry_at = 0.0
        self._status = "not_configured" if not self._enabled else "connecting"

    async def allow(self, key: str, rule: LimitRule) -> tuple[bool, int]:
        if self._redis is None or time.monotonic() < self._retry_at:
            return self._fallback.allow(key, rule)
        try:
            # Do not expose an IP address or user-derived limiter key in Redis
            # dashboards, logs, or backups.
            key_digest = sha256(key.encode("utf-8")).hexdigest()
            redis_key = f"{self._prefix}:rate-limit:{key_digest}"
            current, ttl = await self._redis.eval(
                self._INCREMENT_SCRIPT,
                1,
                redis_key,
                max(1, int(rule.window_seconds)),
            )
            self._status = "ready"
            current_count = int(current)
            retry_after = max(1, int(ttl)) if current_count > max(1, int(rule.max_requests)) else 0
            return current_count <= max(1, int(rule.max_requests)), retry_after
        except Exception:
            # Rate limiting must not take the application down. Retry Redis
            # after a short circuit-breaker interval and limit this process locally.
            self._status = "fallback"
            self._retry_at = time.monotonic() + 5.0
            return self._fallback.allow(key, rule)

    async def ping(self) -> bool:
        if self._redis is None:
            return False
        try:
            ready = bool(await self._redis.ping())
            self._status = "ready" if ready else "fallback"
            return ready
        except Exception:
            self._status = "fallback"
            return False

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()

    def status(self) -> str:
        return self._status
