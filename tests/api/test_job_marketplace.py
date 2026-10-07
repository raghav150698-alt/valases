from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.routes.job_marketplace import PublicationRequest, bridge_access, publish_job, published_jobs
from app.models.entities import Base, JobRequisition, Organization, OrganizationMembership, User, UserRole


class MarketplaceBridgeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="owner@example.com", full_name="Owner", password_hash="unused", role=UserRole.PROVIDER)
        self.db.add(self.user)
        self.db.flush()
        self.org = Organization(name="Employer", slug="employer", created_by_user_id=self.user.id)
        self.other = Organization(name="Other", slug="other")
        self.db.add_all([self.org, self.other])
        self.db.flush()
        self.membership = OrganizationMembership(organization_id=self.org.id, user_id=self.user.id, role="owner")
        self.job = JobRequisition(organization_id=self.org.id, created_by_user_id=self.user.id,
                                 job_code="PY-1", title="Python Engineer", status="open", skills_json=["Python"])
        self.db.add_all([self.membership, self.job])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def publish(self, **kwargs):
        return publish_job(self.job.id, PublicationRequest(published=True, **kwargs), self.org.id, self.db, self.user)

    def feed(self):
        return published_jobs(after=0, limit=100, db=self.db)["items"]

    def test_requires_publication_and_hides_closed_and_inactive_jobs(self):
        self.assertEqual(self.feed(), [])
        self.publish()
        self.assertEqual(len(self.feed()), 1)
        self.assertNotIn("created_by_user_id", self.feed()[0])
        self.job.status = "closed"
        self.db.commit()
        self.assertEqual(self.feed(), [])
        self.job.status = "open"
        self.org.status = "inactive"
        self.db.commit()
        self.assertEqual(self.feed(), [])

    def test_expired_and_unpublished_jobs_disappear(self):
        self.publish(expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
        self.assertEqual(len(self.feed()), 1)
        from app.models.job_marketplace import JobMarketplacePublication
        publication = self.db.get(JobMarketplacePublication, self.job.id)
        publication.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        self.db.commit()
        self.assertEqual(self.feed(), [])
        publish_job(self.job.id, PublicationRequest(published=False), self.org.id, self.db, self.user)
        self.assertEqual(self.feed(), [])

    def test_other_tenants_and_viewers_cannot_publish(self):
        with self.assertRaises(HTTPException) as error:
            publish_job(self.job.id, PublicationRequest(published=True), self.other.id, self.db, self.user)
        self.assertEqual(error.exception.status_code, 403)
        self.membership.role = "viewer"
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            self.publish()
        self.assertEqual(error.exception.status_code, 403)

    def test_bridge_credentials_fail_closed(self):
        with patch.dict("os.environ", {"JOBS_BRIDGE_KEY": ""}):
            with self.assertRaises(HTTPException) as error:
                bridge_access("Bearer anything")
            self.assertEqual(error.exception.status_code, 503)
        with patch.dict("os.environ", {"JOBS_BRIDGE_KEY": "x" * 32}):
            bridge_access("Bearer " + "x" * 32)
            with self.assertRaises(HTTPException) as error:
                bridge_access("Bearer wrong")
            self.assertEqual(error.exception.status_code, 401)

