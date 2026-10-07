import smtplib
import ssl
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
    inline_images: dict[str, tuple[bytes, str, str]] | None = None,
    attachments: list[tuple[str, bytes, str, str]] | None = None,
    smtp_config: dict | None = None,
) -> dict:
    settings = get_settings()
    config = smtp_config or {}
    smtp_host = str(config.get("smtp_host") or settings.smtp_host or "")
    smtp_port = int(config.get("smtp_port") or settings.smtp_port)
    smtp_username = str(config.get("smtp_username") or settings.smtp_username or "")
    smtp_password = str(config.get("smtp_password") or settings.smtp_password or "")
    sender = str(config.get("sender") or settings.smtp_sender or "")
    sender_name = str(config.get("sender_name") or settings.smtp_sender_name or "")
    configured_reply_to = str(config.get("reply_to") or settings.smtp_reply_to or "")
    if not smtp_host or not smtp_username or not smtp_password or not sender:
        return {"sent": False, "reason": "SMTP not configured"}

    msg = EmailMessage()
    msg["From"] = formataddr((sender_name, sender))
    msg["To"] = to_email
    msg["Subject"] = subject
    if reply_to or configured_reply_to:
        msg["Reply-To"] = reply_to or configured_reply_to
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
        html_part = msg.get_payload()[-1]
        for content_id, (content, maintype, subtype) in (inline_images or {}).items():
            html_part.add_related(
                content,
                maintype=maintype,
                subtype=subtype,
                cid=f"<{content_id}>",
                disposition="inline",
            )
    for filename, content, maintype, subtype in attachments or []:
        msg.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)

    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
        server.starttls(context=ssl.create_default_context())
        server.login(smtp_username, smtp_password)
        server.send_message(msg)
    return {"sent": True}
