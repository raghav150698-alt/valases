import json
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.models.entities import ProductEventOutbox
from app.services.product_events import (
    ClickHouseProductEventSink,
    emit_product_event,
    relay_outbox_batch,
    sanitize_product_event_properties,
)


class _FakeRedis:
    def __init__(self) -> None:
        self.events = []

    def xadd(self, stream, fields, **kwargs):
        self.events.append((stream, fields, kwargs))
        return "1-0"


class ProductEventTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        ProductEventOutbox.__table__.create(self.engine)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_privacy_filter_drops_identity_content_and_answers(self) -> None:
        clean = sanitize_product_event_properties(
            {
                "assessment_type": "english",
                "candidate_email": "person@example.com",
                "answers": {"1": "secret"},
                "recording_url": "https://private.example/video",
                "duration_bucket": "5_to_15m",
            },
        )
        self.assertEqual(clean, {"assessment_type": "english", "duration_bucket": "5_to_15m"})

    def test_event_is_transactional_and_relayed_once(self) -> None:
        with Session(self.engine) as db:
            emit_product_event(
                db,
                event_type="assessment.started",
                organization_id=9,
                aggregate_type="assessment_issue",
                aggregate_id=42,
                properties={"assessment_type": "mcq"},
            )
            db.rollback()
            self.assertEqual(list(db.scalars(select(ProductEventOutbox)).all()), [])

            emit_product_event(
                db,
                event_type="assessment.started",
                organization_id=9,
                aggregate_type="assessment_issue",
                aggregate_id=42,
                properties={"assessment_type": "mcq"},
            )
            db.commit()
            fake = _FakeRedis()
            self.assertEqual(
                relay_outbox_batch(db, fake, stream="events", batch_size=10, max_length=1000),
                1,
            )
            self.assertEqual(len(fake.events), 1)
            row = db.scalar(select(ProductEventOutbox))
            self.assertIsNotNone(row.published_at)
            self.assertEqual(relay_outbox_batch(db, fake, stream="events", batch_size=10, max_length=1000), 0)

    def test_clickhouse_projection_pseudonymizes_identifiers(self) -> None:
        settings = Settings(
            _env_file=None,
            jwt_secret_key="a-secure-analytics-hash-key-with-32-chars",
            clickhouse_url="http://localhost:8123",
            clickhouse_user="valases",
            clickhouse_password="test",
            clickhouse_database="valases_analytics",
        )
        sink = ClickHouseProductEventSink(settings)
        try:
            event = sink.from_stream(
                "1-0",
                {
                    "event_id": "2e5ddf5c-fac7-4f3e-b84b-82bf06f4af25",
                    "event_type": "assessment.submitted",
                    "occurred_at": "2026-09-01T12:00:00.000+00:00",
                    "organization_id": "9",
                    "aggregate_type": "assessment_issue",
                    "aggregate_id": "42",
                    "properties_json": json.dumps({"assessment_type": "mcq", "candidate_name": "Private"}),
                    "schema_version": "1",
                },
            )
        finally:
            sink.close()
        self.assertEqual(len(event.organization_key), 64)
        self.assertEqual(len(event.aggregate_key), 64)
        self.assertNotIn("42", event.aggregate_key)
        self.assertNotIn("Private", event.properties_json)


if __name__ == "__main__":
    unittest.main()
