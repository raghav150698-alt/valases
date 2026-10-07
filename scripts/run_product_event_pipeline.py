"""Relay transactional product events through Redis Streams into ClickHouse."""

from __future__ import annotations

import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from redis import Redis

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services.product_events import ClickHouseProductEventSink, consume_product_event_batch, relay_outbox_batch


running = True


def _stop(*_args) -> None:
    global running
    running = False


def main() -> int:
    settings = get_settings()
    if not settings.product_event_pipeline_enabled:
        print("Product event pipeline is disabled.")
        return 0
    if not settings.redis_url:
        print("REDIS_URL is required for the product event pipeline.", file=sys.stderr)
        return 2
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    sink = ClickHouseProductEventSink(settings)
    try:
        while running:
            activity = 0
            db = SessionLocal()
            try:
                activity += relay_outbox_batch(
                    db,
                    redis_client,
                    stream=settings.product_event_stream,
                    batch_size=settings.product_event_batch_size,
                    max_length=settings.product_event_stream_max_length,
                )
            except Exception as exc:
                db.rollback()
                print(f"Product event relay retrying after {type(exc).__name__}", file=sys.stderr)
            finally:
                db.close()
            try:
                activity += consume_product_event_batch(
                    redis_client,
                    sink,
                    stream=settings.product_event_stream,
                    group=settings.product_event_consumer_group,
                    batch_size=settings.product_event_batch_size,
                )
            except Exception as exc:
                print(f"Product event ClickHouse consumer retrying after {type(exc).__name__}", file=sys.stderr)
            if activity == 0:
                time.sleep(max(0.1, float(settings.product_event_poll_seconds)))
        return 0
    finally:
        sink.close()
        redis_client.close()


if __name__ == "__main__":
    raise SystemExit(main())
