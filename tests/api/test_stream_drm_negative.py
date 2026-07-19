import os
import sqlite3
import unittest
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from jose import jwt

os.environ.setdefault("AUTH_MODE", "dummy")
os.environ.setdefault("DATABASE_URL", "sqlite:///./certora.db")
os.environ.setdefault("BUNNY_STREAM_LIBRARY_ID", "1")
os.environ.setdefault("BUNNY_STREAM_PULL_ZONE", "https://example.com")
os.environ.setdefault("STREAM_DRM_ENFORCE_HEARTBEAT", "true")
os.environ.setdefault("STREAM_DRM_LICENSE_SECRET", "unit_test_stream_drm_secret")

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()

from app.main import app  # noqa: E402
from app.services.stream_drm import issue_stream_license  # noqa: E402


class StreamDrmNegativeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.provider_headers = {
            "X-Dummy-User-Id": "811",
            "X-Dummy-Role": "provider",
            "X-Dummy-Email": "provider811@local.test",
            "X-Dummy-Name": "Provider 811",
        }
        self.student_headers = {
            "X-Dummy-User-Id": "821",
            "X-Dummy-Role": "student",
            "X-Dummy-Email": "student821@local.test",
            "X-Dummy-Name": "Student 821",
        }

    def _bootstrap_stream_session(self) -> tuple[int, int, int]:
        profile = self.client.post(
            "/provider/profile",
            headers=self.provider_headers,
            json={
                "provider_type": "individual_instructor",
                "display_name": "Provider 811",
                "description": "QA profile",
            },
        )
        self.assertIn(profile.status_code, {200, 201}, profile.text)

        suffix = uuid.uuid4().hex[:8]
        created = self.client.post(
            "/stream/courses",
            headers=self.provider_headers,
            json={
                "title": f"DRM Negative Course {suffix}",
                "description": "QA",
                "category": "QA",
                "fair_usage_multiplier": 2.5,
            },
        )
        self.assertEqual(created.status_code, 200, created.text)
        course_id = int(created.json()["course_id"])

        lesson = self.client.post(
            f"/stream/courses/{course_id}/lessons",
            headers=self.provider_headers,
            json={"title": "Lesson 1", "position": 1},
        )
        self.assertEqual(lesson.status_code, 200, lesson.text)
        lesson_id = int(lesson.json()["lesson_id"])

        conn = sqlite3.connect(r"D:\certora\certora.db")
        cur = conn.cursor()
        creator_row = cur.execute("SELECT id FROM creators WHERE user_id = ?", (811,)).fetchone()
        creator_id = int(creator_row[0]) if creator_row else 1
        video_uid = f"neg-{uuid.uuid4().hex}"
        cur.execute(
            """
            INSERT INTO lesson_videos(
              course_id, lesson_id, creator_id, internal_id, cloudflare_video_uid, upload_status, ready_status,
              duration_seconds, thumbnail_url, playback_hls_url, direct_upload_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                course_id,
                lesson_id,
                creator_id,
                uuid.uuid4().hex,
                video_uid,
                "ready",
                1,
                500,
                "https://example.com/t.jpg",
                None,
                None,
            ),
        )
        video_id = int(cur.lastrowid)
        cur.execute("UPDATE courses SET is_published = 1 WHERE id = ?", (course_id,))
        conn.commit()
        conn.close()

        purchase = self.client.post(
            "/stream/purchases",
            headers=self.student_headers,
            json={"course_id": course_id, "price_amount": 0, "currency": "INR"},
        )
        self.assertEqual(purchase.status_code, 200, purchase.text)

        token = self.client.post(
            "/stream/playback/token",
            headers=self.student_headers,
            json={"lesson_video_id": video_id, "client_app": "web"},
        )
        self.assertEqual(token.status_code, 200, token.text)
        session_id = int(token.json()["session_id"])
        return session_id, course_id, video_id

    def test_malformed_license_token_is_rejected(self) -> None:
        session_id, _course_id, video_id = self._bootstrap_stream_session()
        out = self.client.post(
            "/stream/watch/heartbeat",
            headers=self.student_headers,
            json={
                "session_id": session_id,
                "lesson_video_id": video_id,
                "watched_seconds_delta": 10,
                "position_seconds": 10,
                "player_state": "playing",
                "drm_license_token": "malformed-license-token-12345",
                "drm_heartbeat_nonce": f"n-{uuid.uuid4().hex[:8]}",
                "ended": False,
            },
        )
        self.assertEqual(out.status_code, 401, out.text)

    def test_expired_license_token_is_rejected(self) -> None:
        session_id, course_id, video_id = self._bootstrap_stream_session()
        s = get_settings()
        now = datetime.now(timezone.utc)
        expired_token = jwt.encode(
            {
                "typ": "stream_license",
                "sub": "821",
                "sid": int(session_id),
                "cid": int(course_id),
                "lvid": int(video_id),
                "app": "web",
                "iat": int((now - timedelta(minutes=5)).timestamp()),
                "nbf": int((now - timedelta(minutes=5)).timestamp()),
                "exp": int((now - timedelta(minutes=1)).timestamp()),
                "jti": uuid.uuid4().hex,
            },
            str(s.stream_drm_license_secret or s.jwt_secret_key),
            algorithm=str(s.jwt_algorithm or "HS256"),
        )
        out = self.client.post(
            "/stream/watch/heartbeat",
            headers=self.student_headers,
            json={
                "session_id": session_id,
                "lesson_video_id": video_id,
                "watched_seconds_delta": 10,
                "position_seconds": 10,
                "player_state": "playing",
                "drm_license_token": expired_token,
                "drm_heartbeat_nonce": f"n-{uuid.uuid4().hex[:8]}",
                "ended": False,
            },
        )
        self.assertEqual(out.status_code, 401, out.text)

    def test_mismatched_client_app_token_is_rejected(self) -> None:
        session_id, course_id, video_id = self._bootstrap_stream_session()
        mobile_token, _ = issue_stream_license(
            user_id=821,
            course_id=course_id,
            lesson_video_id=video_id,
            session_id=session_id,
            client_app="mobile",
            ttl_seconds=180,
        )
        out = self.client.post(
            "/stream/watch/heartbeat",
            headers=self.student_headers,
            json={
                "session_id": session_id,
                "lesson_video_id": video_id,
                "watched_seconds_delta": 10,
                "position_seconds": 10,
                "player_state": "playing",
                "drm_license_token": mobile_token,
                "drm_heartbeat_nonce": f"n-{uuid.uuid4().hex[:8]}",
                "ended": False,
            },
        )
        self.assertEqual(out.status_code, 401, out.text)


if __name__ == "__main__":
    unittest.main()
