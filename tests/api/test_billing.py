import base64
import hashlib
import hmac
import json
import time
import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes.billing import _activate_paid_order, _validate_provider_order
from app.core.config import Settings
from app.models.entities import Base, BillingOrder, Organization, OrganizationBillingAccount, User, UserRole
from app.services.billing_gateway import billing_plan_catalog, verify_cashfree_webhook_signature


class BillingGatewayTest(unittest.TestCase):
    def test_plan_prices_are_loaded_as_minor_units(self) -> None:
        settings = Settings(
            _env_file=None,
            billing_plan_catalog_json=json.dumps(
                {
                    "launch": {
                        "name": "Launch",
                        "monthly_amount_minor": 99900,
                        "currency": "INR",
                        "description": "Launch plan",
                    },
                },
            ),
        )
        plan = billing_plan_catalog(settings)["launch"]
        self.assertEqual(plan.monthly_amount_minor, 99900)
        self.assertEqual(plan.currency, "INR")

    def test_cashfree_webhook_signature_uses_raw_payload(self) -> None:
        settings = Settings(_env_file=None, cashfree_secret_key="cashfree-secret")
        body = b'{"data":{"order":{"order_amount":999.00}}}'
        timestamp = str(int(time.time() * 1000))
        signature = base64.b64encode(
            hmac.new(b"cashfree-secret", timestamp.encode() + body, hashlib.sha256).digest(),
        ).decode()
        self.assertTrue(verify_cashfree_webhook_signature(settings, body, timestamp, signature))
        self.assertFalse(verify_cashfree_webhook_signature(settings, body + b" ", timestamp, signature))
        old_timestamp = str(int(timestamp) - 301_000)
        old_signature = base64.b64encode(
            hmac.new(b"cashfree-secret", old_timestamp.encode() + body, hashlib.sha256).digest(),
        ).decode()
        self.assertFalse(verify_cashfree_webhook_signature(settings, body, old_timestamp, old_signature))


class BillingReconciliationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(
            email="owner@example.com",
            full_name="Owner",
            password_hash="supabase",
            role=UserRole.PROVIDER,
            is_active=True,
        )
        self.db.add(self.user)
        self.db.flush()
        self.organization = Organization(name="Example", slug="example", created_by_user_id=self.user.id)
        self.db.add(self.organization)
        self.db.flush()
        self.order = BillingOrder(
            id="val_1_test_order",
            organization_id=self.organization.id,
            created_by_user_id=self.user.id,
            plan_code="launch",
            description="Launch monthly plan",
            amount_minor=99900,
            currency="INR",
        )
        self.db.add(self.order)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_verified_payment_activates_once(self) -> None:
        first = _activate_paid_order(
            self.db,
            self.order,
            provider_payment_id="cf_payment_1",
            provider_status="PAID",
        )
        self.db.commit()
        account = self.db.query(OrganizationBillingAccount).filter_by(organization_id=self.organization.id).one()
        original_end = account.current_period_end

        second = _activate_paid_order(
            self.db,
            self.order,
            provider_payment_id="cf_payment_1",
            provider_status="PAID",
        )
        self.db.commit()
        self.db.refresh(account)

        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(account.status, "active")
        self.assertEqual(account.plan_code, "launch")
        self.assertEqual(account.current_period_end, original_end)
        self.assertIsNotNone(self.order.receipt_number)

    def test_provider_amount_must_match_local_order(self) -> None:
        _validate_provider_order(self.order, {"order_amount": 999.00, "order_currency": "INR"})
        with self.assertRaises(Exception):
            _validate_provider_order(self.order, {"order_amount": 998.00, "order_currency": "INR"})

    def test_paid_timestamp_is_timezone_aware(self) -> None:
        _activate_paid_order(self.db, self.order, provider_payment_id=None, provider_status="PAID")
        self.assertIsInstance(self.order.paid_at, datetime)
        self.assertEqual(self.order.paid_at.tzinfo, timezone.utc)


if __name__ == "__main__":
    unittest.main()
