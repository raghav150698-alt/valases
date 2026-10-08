"""Organization SMTP tests must prove the selected channel, not platform fallback."""
import smtplib
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from fastapi import HTTPException
from app.api.routes import hiring


class OrganizationEmailDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.organization = SimpleNamespace(id=1, name='Example business')
        self.user = SimpleNamespace(id=7, email='admin@example.com')
        self.db = Mock()
        self.payload = hiring.EmailTestRequest(purpose='candidate_updates')
        self.config = {'smtp_host': 'smtp.invalid', 'smtp_port': 587,
                       'smtp_username': 'user', 'smtp_password': 'private',
                       'sender': 'jobs@example.com'}

    def call_test(self, config, sender):
        with patch.object(hiring, '_organization_context', return_value=(self.organization, None)), \
             patch.object(hiring, '_require_permission'), \
             patch.object(hiring, '_email_channel_smtp_config', return_value=config), \
             patch.object(hiring, 'send_email', sender), \
             patch.object(hiring, '_write_audit'):
            return hiring.send_email_test(self.payload, organization_id=1,
                                         db=self.db, current_user=self.user)

    def test_missing_or_unreadable_channel_never_uses_platform_sender(self):
        sender = Mock()
        with self.assertRaises(HTTPException) as error:
            self.call_test(None, sender)
        self.assertEqual(error.exception.status_code, 422)
        sender.assert_not_called()
        self.db.commit.assert_not_called()

    def test_provider_failures_are_actionable_and_do_not_leak_credentials(self):
        for failure in (smtplib.SMTPAuthenticationError(535, b'private-provider-response'),
                        OSError('private-network-response')):
            with self.subTest(failure=type(failure).__name__):
                with self.assertRaises(HTTPException) as error:
                    self.call_test(self.config, Mock(side_effect=failure))
                self.assertEqual(error.exception.status_code, 502)
                self.assertNotIn('private', error.exception.detail)
        self.db.commit.assert_not_called()

    def test_success_uses_exact_channel_and_records_test_timestamp(self):
        channel = SimpleNamespace(last_tested_at=None)
        self.db.scalar.return_value = channel
        sender = Mock(return_value={'sent': True})
        result = self.call_test(self.config, sender)
        self.assertEqual(result, {'status': 'sent', 'recipient': self.user.email})
        self.assertEqual(sender.call_args.kwargs['smtp_config'], self.config)
        self.assertIsNotNone(channel.last_tested_at)
        self.db.commit.assert_called_once()

    def test_reconfigure_invalidates_old_test(self):
        channel = SimpleNamespace(id=3, purpose='candidate_updates', last_tested_at='old-test', smtp_password_encrypted='encrypted')
        self.db.scalar.return_value = channel
        payload = hiring.EmailChannelUpdate(purpose='candidate_updates', smtp_host='smtp.invalid',
            smtp_username='user', sender='jobs@example.com')
        with patch.object(hiring, '_organization_context', return_value=(self.organization, None)), \
             patch.object(hiring, '_require_permission'), patch.object(hiring, '_write_audit'):
            hiring.configure_email_channel(payload, organization_id=1, db=self.db, current_user=self.user)
        self.assertIsNone(channel.last_tested_at)


if __name__ == '__main__':
    unittest.main()
