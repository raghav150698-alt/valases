import unittest

from app.services.analytics import ClickHouseAnalytics, normalized_analytics_route


class AnalyticsPrivacyTest(unittest.TestCase):
    def test_prefers_fastapi_route_template(self) -> None:
        route = normalized_analytics_route(
            "/exams/issued/key/{invitation_key}/login",
            "/exams/issued/key/a-secret-invitation-key/login",
        )
        self.assertEqual(route, "/exams/issued/key/{invitation_key}/login")
        self.assertNotIn("a-secret", route)

    def test_redacts_opaque_segments_when_no_template_exists(self) -> None:
        route = normalized_analytics_route(None, "/download/550e8400-e29b-41d4-a716-446655440000/42")
        self.assertEqual(route, "/download/:id/:id")

    def test_disabled_exporter_does_not_queue_events(self) -> None:
        analytics = ClickHouseAnalytics(
            enabled=False,
            url="http://localhost:8123",
            user="default",
            password="",
            database="valases_analytics",
            retention_days=90,
            batch_size=100,
            flush_interval_seconds=1,
            queue_size=100,
        )
        analytics.record_request(
            method="GET",
            route="/health",
            status_code=200,
            duration_ms=1.2,
            deployment_region="mumbai",
        )
        self.assertEqual(analytics.status()["queued_events"], 0)
        self.assertEqual(analytics.status()["status"], "disabled")

    def test_clickhouse_timestamp_uses_utc_millisecond_format(self) -> None:
        analytics = ClickHouseAnalytics(
            enabled=True,
            url="http://localhost:8123",
            user="default",
            password="",
            database="valases_analytics",
            retention_days=90,
            batch_size=100,
            flush_interval_seconds=1,
            queue_size=100,
        )
        analytics.record_request(
            method="GET",
            route="/health",
            status_code=200,
            duration_ms=1.2,
            deployment_region="mumbai",
        )
        event = analytics._queue.get_nowait()
        self.assertRegex(event.occurred_at, r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$")


if __name__ == "__main__":
    unittest.main()
