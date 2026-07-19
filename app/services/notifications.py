import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import get_settings


def send_email(
    to_email: str,
    subject: str,
    body: str,
    *,
    html_body: str | None = None,
    reply_to: str | None = None,
) -> dict:
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_username or not settings.smtp_password:
        return {"sent": False, "reason": "SMTP not configured"}

    msg = EmailMessage()
    msg["From"] = formataddr((settings.smtp_sender_name, settings.smtp_sender))
    msg["To"] = to_email
    msg["Subject"] = subject
    if reply_to or settings.smtp_reply_to:
        msg["Reply-To"] = reply_to or settings.smtp_reply_to
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        server.starttls()
        server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)
    return {"sent": True}
