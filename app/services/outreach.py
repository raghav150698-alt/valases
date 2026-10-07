from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.models.entities import OutreachLead


def _escape(value: str) -> str:
    return html.escape(value or "", quote=True)


def build_first_email(lead: OutreachLead) -> tuple[str, str, str]:
    settings = get_settings()
    first = _escape((lead.contact_name or "there").split(" ")[0])
    company = _escape(lead.company)
    requirement = _escape(str((lead.personalization_json or {}).get("requirement") or ""))
    is_tax = lead.campaign == "cpa-tax"
    subject = "Your next tax hire. See the skills behind the résumé." if is_tax else "A practical signal for your next hire"
    capability = "practical tax, accounting, and spreadsheet assessments" if is_tax else "practical skills assessments"
    mention = f" I saw {requirement} in the role requirements." if requirement else ""
    sender = _escape(settings.smtp_sender_name or "Valases")
    address = _escape(settings.outreach_mailing_address or "")
    booking = _escape(settings.outreach_booking_url or "")
    cta = f'<a href="{booking}" style="display:inline-block;background:#80ed98;color:#123425;text-decoration:none;padding:14px 18px;font:700 14px Arial">Book a 15-minute walkthrough ↗</a>' if booking else "Reply with the role you are hiring for and I’ll share a relevant example."
    unsubscribe = f"{settings.app_base_url.rstrip('/')}/outreach/unsubscribe?email={quote(lead.email)}"
    text = f"Hi {(lead.contact_name or 'there').split(' ')[0]},\n\nI noticed {lead.company}.{(' I saw ' + str((lead.personalization_json or {}).get('requirement')) + ' in the role requirements.') if requirement else ''}\n\nValases helps teams use {capability} before moving candidates forward.\n\nWould a 15-minute walkthrough relevant to your next hire be useful?\n\nBest,\n{settings.smtp_sender_name or 'Valases'}\n\n{settings.outreach_mailing_address}\nReply no thanks to stop future messages."
    html_body = f'''<!doctype html><html><body style="margin:0;background:#edf1eb;padding:24px 8px"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="640" style="max-width:640px;width:100%;background:#fffefb" cellspacing="0" cellpadding="0"><tr><td style="padding:27px 38px"><img src="https://valases-website.vercel.app/public/valases-logo-cropped.png" width="112" alt="Valases" style="display:block;border:0"></td></tr><tr><td style="background:#123425;color:#fff;padding:36px 38px"><div style="font:700 10px Arial;letter-spacing:2px;color:#b4ddb0">FOR TEAMS THAT HIRE WITH INTENT</div><h1 style="font:600 38px/1.08 Arial;margin:18px 0">A strong résumé.<br><span style="color:#80ed98">Now see the work.</span></h1><p style="font:15px/1.7 Arial;color:#d7e5d9;margin:0">Valases brings hiring, practical assessment, and clear decision evidence into one controlled flow.</p></td></tr><tr><td style="background:#dfe9d8"><img src="https://valases-website.vercel.app/public/assessment-overview.webp" width="640" alt="Valases assessment workspace" style="display:block;width:100%;border:0"></td></tr><tr><td style="padding:34px 38px;color:#455648;font:15px/1.8 Arial"><p style="color:#153b28">Hi {first},</p><p>I noticed <strong>{company}</strong>.{mention}</p><p>Valases helps teams use <strong>{capability}</strong> before moving candidates forward.</p><div style="border-top:1px solid #e1e8dc;margin-top:25px;padding-top:24px"><h2 style="color:#173b29;font:600 22px Arial">Let’s start with one role.</h2><p>Would a 15-minute walkthrough relevant to your next hire be useful?</p>{cta}<p style="font:13px/1.8 Arial">Best,<br><strong>{sender}</strong></p></div></td></tr><tr><td style="padding:22px 38px;text-align:center;background:#e6eedf;color:#74816f;font:11px/1.7 Arial">{address}<br><a href="{unsubscribe}" style="color:#587154">Unsubscribe</a> or reply “no thanks”.</td></tr></table></td></tr></table></body></html>'''
    return subject, html_body, text


def build_followup_email(lead: OutreachLead, sequence_number: int) -> tuple[str, str, str]:
    settings = get_settings()
    first = _escape((lead.contact_name or "there").split(" ")[0])
    capability = "practical tax, accounting, and spreadsheet assessments" if lead.campaign == "cpa-tax" else "practical skills assessments"
    subject = "Quick follow-up — a clearer signal for your next hire"
    text = f"Hi {(lead.contact_name or 'there').split(' ')[0]},\n\nFollowing up on my note about Valases. We help teams use {capability} before moving candidates forward.\n\nIf hiring is not a priority right now, reply no thanks and I will close the loop. Otherwise, would a 15-minute walkthrough be useful?\n\nBest,\n{settings.smtp_sender_name or 'Valases'}\n\n{settings.outreach_mailing_address}"
    html_body = f'''<!doctype html><html><body style="margin:0;background:#edf1eb;padding:24px;font:15px/1.7 Arial;color:#455648"><table role="presentation" width="600" align="center" style="max-width:100%;background:#fffefb"><tr><td style="padding:32px"><img src="https://valases-website.vercel.app/public/valases-logo-cropped.png" width="104" alt="Valases"><p>Hi {first},</p><p>Following up on my note about Valases. We help teams use <strong>{capability}</strong> before moving candidates forward.</p><p>Would a 15-minute walkthrough be useful?</p><p>Best,<br><strong>{_escape(settings.smtp_sender_name or 'Valases')}</strong></p><hr style="border:0;border-top:1px solid #e1e8dc"><small>{_escape(settings.outreach_mailing_address or '')}<br>Reply “no thanks” to stop future messages.</small></td></tr></table></body></html>'''
    return subject, html_body, text


async def research_campaign(campaign: str) -> list[dict]:
    settings = get_settings()
    if not settings.outreach_openai_api_key:
        raise RuntimeError("OUTREACH_OPENAI_API_KEY is not configured")
    focus = {"cpa-tax": "small US CPA, tax preparation, and accounting firms with 10–100 staff", "coding": "small US software companies with 10–100 staff", "mcq": "small US businesses hiring knowledge-based roles"}.get(campaign, "small US CPA and tax firms")
    prompt = f"Find up to 8 prospects: {focus}. Return only JSON with key leads. Each lead must include company, website, contact_name, contact_title, email, evidence, source_url, requirement. Require a current public hiring signal and a public business email from the company site. Never guess emails and do not include enterprises."
    fields = ["company", "website", "contact_name", "contact_title", "email", "evidence", "source_url", "requirement"]
    schema = {
        "type": "object", "additionalProperties": False, "required": ["leads"],
        "properties": {"leads": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": fields,
            "properties": {key: {"type": "string"} for key in fields},
        }}},
    }
    body = {"model": settings.outreach_openai_model, "input": prompt, "tools": [{"type": "web_search"}], "text": {"format": {"type": "json_schema", "name": "leads", "strict": True, "schema": schema}}}
    async with httpx.AsyncClient(timeout=50) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {settings.outreach_openai_api_key}"}, json=body)
        response.raise_for_status()
    return list(json.loads(response.json().get("output_text") or "{}").get("leads") or [])


def classify_reply(body: str) -> tuple[str, bool]:
    text = (body or "").lower()
    if any(term in text for term in ["unsubscribe", "remove me", "no thanks", "not interested"]): return "suppressed", False
    if any(term in text for term in ["price", "pricing", "contract", "security", "dpa", "proposal", "meeting", "calendar", "available"]): return "needs_owner", True
    return "reply", False
