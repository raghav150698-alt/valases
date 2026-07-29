import base64
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes.exams import _safe_send_assessment_issue_email
from app.services.notifications import send_email


class CandidateInvitationEmailTest(unittest.TestCase):
    def test_assessment_email_uses_company_logo_and_valases_footer(self) -> None:
        logo_bytes = b"\x89PNG\r\n\x1a\ncompany-logo"
        logo_url = f"data:image/png;base64,{base64.b64encode(logo_bytes).decode()}"

        with patch("app.api.routes.exams.send_email", return_value={"sent": True}) as mocked_send:
            result = _safe_send_assessment_issue_email(
                to_email="candidate@example.com",
                candidate_name="Alex Rivera",
                assessment_title="Accounting controls",
                login_link="https://candidate.example.com/?issued_key=secret",
                temporary_password="temporary-password",
                expires_at=None,
                company_name="Example Company",
                company_logo_url=logo_url,
                privacy_url="https://candidate.example.com/legal/privacy-policy",
                retention_url="https://candidate.example.com/legal/data-retention-and-deletion",
            )

        self.assertTrue(result["sent"])
        _, subject, _ = mocked_send.call_args.args
        kwargs = mocked_send.call_args.kwargs
        self.assertEqual(subject, "Invitation: Accounting controls | Example Company")
        self.assertEqual(kwargs["inline_images"]["company-logo"][0], logo_bytes)
        self.assertIn('src="cid:company-logo"', kwargs["html_body"])
        self.assertIn("Assessment delivery powered by Valases", kwargs["html_body"])
        self.assertIn(
            "https://candidate.example.com/assets/brand/valases-logo.png",
            kwargs["html_body"],
        )

    def test_send_email_embeds_related_images(self) -> None:
        settings = SimpleNamespace(
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_username="mailer",
            smtp_password="secret",
            smtp_sender_name="Valases",
            smtp_sender="mail@example.com",
            smtp_reply_to="",
        )
        smtp = MagicMock()
        smtp.__enter__.return_value = smtp
        smtp.__exit__.return_value = False

        with (
            patch("app.services.notifications.get_settings", return_value=settings),
            patch("app.services.notifications.smtplib.SMTP", return_value=smtp),
        ):
            result = send_email(
                "candidate@example.com",
                "Invitation",
                "Open your assessment.",
                html_body='<html><body><img src="cid:company-logo"></body></html>',
                inline_images={"company-logo": (b"logo-content", "image", "png")},
                attachments=[("offer.pdf", b"%PDF-test", "application", "pdf")],
            )

        self.assertTrue(result["sent"])
        message = smtp.send_message.call_args.args[0]
        related_image = next(part for part in message.walk() if part.get_content_type() == "image/png")
        self.assertEqual(related_image["Content-ID"], "<company-logo>")
        self.assertEqual(related_image.get_payload(decode=True), b"logo-content")
        attachment = next(part for part in message.walk() if part.get_content_disposition() == "attachment")
        self.assertEqual(attachment.get_filename(), "offer.pdf")
        self.assertEqual(attachment.get_payload(decode=True), b"%PDF-test")


if __name__ == "__main__":
    unittest.main()
