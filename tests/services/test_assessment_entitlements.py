import unittest
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models.entities import Base, Organization, OrganizationBillingAccount, HiringApplication, AssessmentIssue
from app.services.assessment_entitlements import require_issue_allowance, public_usage
from app.services.assessment_entitlements import reserve_resent_invitation
from types import SimpleNamespace


class AssessmentAllowanceTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.now = datetime(2026, 10, 7, tzinfo=timezone.utc)
        self.org = Organization(name='Test', slug='test', settings_json={})
        self.db.add(self.org); self.db.flush()
        self.application = HiringApplication(organization_id=self.org.id, job_id=1, candidate_id=1)
        self.db.add(self.application); self.db.flush()
        self.sequence = 0

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def invite(self, email, kind='mcq', **kwargs):
        self.sequence += 1
        row = AssessmentIssue(exam_id=1, issuer_user_id=1, hiring_application_id=self.application.id,
            candidate_name='Test', candidate_email=email, candidate_password_hash='unused', access_key=str(self.sequence),
            issued_at=self.now, result_json={'_allowance_assessment_type':kind}, **kwargs)
        self.db.add(row); self.db.flush()
        return row

    def allow(self, email, kind='mcq'):
        return require_issue_allowance(self.db, self.org.id, kind, email, self.now)

    def test_candidates_are_unique_but_attempts_count_separately(self):
        for i in range(5): self.invite(f'person{i}@test.com')
        self.allow('PERSON0@test.com')
        with self.assertRaises(HTTPException) as error: self.allow('sixth@test.com')
        self.assertEqual(error.exception.status_code, 402)
        for i in range(5): self.invite('person0@test.com')
        with self.assertRaises(HTTPException): self.allow('person0@test.com')
        usage = public_usage(self.db, self.org.id, self.now)
        self.assertEqual(usage['used'], {'candidates':5, 'english_language':0, 'mcq':10})
        self.assertNotIn('_candidate_emails', usage)

    def test_english_limit_independent_of_mcq(self):
        for i in range(5): self.invite('same@test.com', 'english_language')
        with self.assertRaises(HTTPException): self.allow('same@test.com', 'english_language')
        self.allow('same@test.com', 'mcq')

    def test_paid_tools_require_active_paid_assess_and_expiry_is_checked(self):
        for kind in ['tax_simulator', 'tax_1120', 'accounting', 'coding', 'spreadsheet']:
            with self.assertRaises(HTTPException): self.allow('same@test.com', kind)
        account = OrganizationBillingAccount(organization_id=self.org.id, status='active', plan_code='hire-core',
            monthly_amount_minor=14900, current_period_end=self.now+timedelta(days=20))
        self.db.add(account); self.db.flush()
        with self.assertRaises(HTTPException): self.allow('same@test.com', 'coding')
        self.org.settings_json = {'assess_enabled':True}
        self.allow('same@test.com', 'coding')
        account.current_period_end = self.now-timedelta(seconds=1)
        with self.assertRaises(HTTPException): self.allow('same@test.com', 'coding')

    def test_unstarted_revoked_and_expired_release_only_their_reservations(self):
        self.invite('revoked@test.com', status='revoked')
        self.invite('expired@test.com', access_expires_at=self.now-timedelta(days=1))
        self.invite('started@test.com', status='revoked', started_at=self.now)
        self.assertEqual(public_usage(self.db,self.org.id,self.now)['used']['mcq'], 1)

    def test_next_utc_month_resets_and_other_organizations_are_isolated(self):
        self.invite('same@test.com')
        self.assertEqual(public_usage(self.db,self.org.id,datetime(2026,11,1,tzinfo=timezone.utc))['used']['mcq'], 0)
        other=Organization(name='Other',slug='other',settings_json={})
        self.db.add(other); self.db.flush()
        self.assertEqual(public_usage(self.db,other.id,self.now)['used']['mcq'],0)

    def test_resends_keep_live_reservation_and_released_invites_cannot_bypass_cap(self):
        live = self.invite('same@test.com', status='issued', access_expires_at=self.now+timedelta(days=1))
        for i in range(9): self.invite('same@test.com')
        exam = SimpleNamespace(assessment_type='mcq')
        reserve_resent_invitation(self.db,self.org.id,exam,live,self.now)
        released = self.invite('same@test.com',status='revoked')
        with self.assertRaises(HTTPException): reserve_resent_invitation(self.db,self.org.id,exam,released,self.now)
        live.started_at = self.now
        with self.assertRaises(HTTPException): reserve_resent_invitation(self.db,self.org.id,exam,live,self.now)


if __name__ == '__main__': unittest.main()
