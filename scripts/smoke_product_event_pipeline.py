"""One-shot end-to-end smoke test for Postgres-outbox semantics, Redis, and ClickHouse."""

from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from redis import Redis
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import ProductEventOutbox
from app.services.product_events import ClickHouseProductEventSink, consume_product_event_batch, emit_product_event, relay_outbox_batch


def main() -> int:
    settings = get_settings()
    stream = f"valases:product-events:smoke:{uuid4()}"
    group = "clickhouse-smoke"
    engine = create_engine("sqlite://")
    ProductEventOutbox.__table__.create(engine)
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    sink = ClickHouseProductEventSink(settings)
    event_id = ""
    try:
        with Session(engine) as db:
            event = emit_product_event(
                db,
                event_type="system.pipeline_smoke",
                organization_id=1,
                aggregate_type="smoke_test",
                aggregate_id=1,
                properties={"source": "automated_smoke"},
            )
            db.commit()
            db.refresh(event)
            event_id = event.event_id
            if relay_outbox_batch(db, redis_client, stream=stream, batch_size=10, max_length=1000) != 1:
                raise RuntimeError("Outbox event was not relayed")
            published = db.scalar(select(ProductEventOutbox).where(ProductEventOutbox.event_id == event_id))
            if not published or not published.published_at:
                raise RuntimeError("Outbox event was not marked published")
        if consume_product_event_batch(redis_client, sink, stream=stream, group=group, batch_size=10) != 1:
            raise RuntimeError("Redis event was not consumed")
        response = httpx.post(
            settings.clickhouse_url.rstrip("/") + "/",
            params={
                "query": f"SELECT count() FROM {settings.clickhouse_database}.product_events WHERE event_id = {{event_id:UUID}}",
                "param_event_id": event_id,
            },
            auth=(settings.clickhouse_user, settings.clickhouse_password),
            timeout=10.0,
        )
        response.raise_for_status()
        if int(response.text.strip() or "0") != 1:
            raise RuntimeError("ClickHouse event verification failed")
        print("Product event pipeline smoke test passed.")
        return 0
    finally:
        redis_client.delete(stream)
        if event_id:
            with httpx.Client(
                base_url=settings.clickhouse_url.rstrip("/"),
                auth=(settings.clickhouse_user, settings.clickhouse_password),
                timeout=10.0,
            ) as client:
                try:
                    client.post(
                        "/",
                        params={
                            "query": (
                                f"DELETE FROM {settings.clickhouse_database}.product_events "
                                "WHERE event_id = {event_id:UUID} SETTINGS mutations_sync = 1"
                            ),
                            "param_event_id": event_id,
                        },
                    ).raise_for_status()
                except Exception:
                    pass
        sink.close()
        redis_client.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
