from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.config import get_settings
from app.db.session import get_db
from app.models.entities import OutreachEmail, OutreachInboundMessage, OutreachLead, User, UserRole
from app.services.notifications import send_email
from app.services.outreach import build_first_email, build_followup_email, classify_reply, research_campaign

router = APIRouter(prefix="/admin/outreach", tags=["outreach-agents"])


def _lead_item(lead: OutreachLead) -> dict:
    return {"id": lead.id, "company": lead.company, "contact_name": lead.contact_name, "contact_title": lead.contact_title, "email": lead.email, "campaign": lead.campaign, "evidence": lead.evidence, "source_url": lead.source_url, "status": lead.status, "created_at": lead.created_at}


def _email_item(email: OutreachEmail, lead: OutreachLead | None) -> dict:
    return {"id": email.id, "lead_id": email.lead_id, "company": lead.company if lead else "Unknown lead", "recipient": lead.email if lead else "", "sequence_number": email.sequence_number, "subject": email.subject, "status": email.status, "scheduled_for": email.scheduled_for, "sent_at": email.sent_at, "created_at": email.created_at}


def _inbound_item(message: OutreachInboundMessage, lead: OutreachLead | None) -> dict:
    return {"id": message.id, "lead_id": lead.id if lead else None, "company": lead.company if lead else message.from_email, "from_email": message.from_email, "subject": message.subject, "body": message.body, "classification": message.classification, "reply_draft": message.reply_draft, "needs_owner": message.needs_owner, "created_at": message.created_at}


@router.get("/leads")
def list_leads(db: Session = Depends(get_db), current_user: User = Depends(require_role(UserRole.ADMIN))):
    return {"items": [_lead_item(lead) for lead in db.scalars(select(OutreachLead).order_by(OutreachLead.created_at.desc()).limit(100)).all()]}


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), current_user: User = Depends(require_role(UserRole.ADMIN))):
    leads = db.scalars(select(OutreachLead).order_by(OutreachLead.created_at.desc()).limit(200)).all()
    lead_by_id = {lead.id: lead for lead in leads}
    lead_by_email = {lead.email: lead for lead in leads}
    emails = db.scalars(select(OutreachEmail).order_by(OutreachEmail.created_at.desc()).limit(200)).all()
    inbound = db.scalars(select(OutreachInboundMessage).order_by(OutreachInboundMessage.created_at.desc()).limit(100)).all()
    return {
        "summary": {
            "leads": len(leads),
            "review": sum(lead.status == "research" for lead in leads),
            "queued": sum(email.status == "queued" for email in emails),
            "sent": sum(email.status == "sent" for email in emails),
            "replies": len(inbound),
            "action_required": sum(message.needs_owner for message in inbound),
        },
        "leads": [_lead_item(lead) for lead in leads],
        "emails": [_email_item(email, lead_by_id.get(email.lead_id)) for email in emails],
        "inbound": [_inbound_item(message, lead_by_email.get(message.from_email)) for message in inbound],
    }


@router.post("/research/{campaign}")
async def research(campaign: str, db: Session = Depends(get_db), current_user: User = Depends(require_role(UserRole.ADMIN))):
    if campaign not in {"cpa-tax", "coding", "mcq"}: raise HTTPException(status_code=400, detail="Unknown campaign")
    found = await research_campaign(campaign); added = 0
    for item in found:
        email = str(item.get("email") or "").strip().lower(); source_url = str(item.get("source_url") or "").strip()
        if not email or "@" not in email or not source_url.startswith(("https://", "http://")) or db.scalar(select(OutreachLead.id).where(OutreachLead.email == email)): continue
        db.add(OutreachLead(company=str(item.get("company") or "").strip(), website=str(item.get("website") or ""), contact_name=str(item.get("contact_name") or ""), contact_title=str(item.get("contact_title") or ""), email=email, campaign=campaign, evidence=str(item.get("evidence") or ""), source_url=source_url, personalization_json={"requirement": str(item.get("requirement") or "")})); added += 1
    db.commit(); return {"found": len(found), "added": added}


@router.post("/leads/{lead_id}/approve")
def approve(lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_role(UserRole.ADMIN))):
    lead = db.get(OutreachLead, lead_id)
    if not lead or lead.status != "research": raise HTTPException(status_code=404, detail="Lead awaiting review not found")
    subject, html_body, text_body = build_first_email(lead); lead.status = "approved"; db.add(OutreachEmail(lead_id=lead.id, sequence_number=1, subject=subject, html_body=html_body, text_body=text_body, status="queued")); db.commit()
    return {"ok": True, "subject": subject, "text": text_body}


@router.get("/cron/send")
@router.post("/cron/send")
def send_queue(request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    expected_secret = settings.outreach_cron_secret or os.getenv("CRON_SECRET", "")
    if not expected_secret or request.headers.get("authorization") != f"Bearer {expected_secret}": raise HTTPException(status_code=401, detail="Unauthorized")
    if not settings.outreach_enabled or not settings.outreach_mailing_address: return {"sent": 0, "reason": "Outbound email is disabled or incomplete"}
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0); sent_today = db.scalar(select(func.count()).select_from(OutreachEmail).where(OutreachEmail.sent_at >= start)) or 0; capacity = max(0, settings.outreach_daily_send_limit - int(sent_today)); sent = 0
    for email in db.scalars(select(OutreachEmail).where(OutreachEmail.status == "queued").order_by(OutreachEmail.scheduled_for).limit(capacity)).all():
        lead = db.get(OutreachLead, email.lead_id)
        if not lead or lead.status in {"suppressed", "replied"}: continue
        result = send_email(lead.email, email.subject, email.text_body, html_body=email.html_body)
        if result.get("sent"):
            now = datetime.now(timezone.utc); email.status = "sent"; email.sent_at = now; lead.status = "contacted"; lead.last_contacted_at = now; sent += 1
            if email.sequence_number == 1:
                subject, html_body, text_body = build_followup_email(lead, 2)
                db.add(OutreachEmail(lead_id=lead.id, sequence_number=2, subject=subject, html_body=html_body, text_body=text_body, status="queued", scheduled_for=now + timedelta(days=4)))
        else: email.status = "error"
    db.commit(); return {"sent": sent}


@router.post("/inbound")
async def inbound(request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    if request.headers.get("authorization") != f"Bearer {settings.outreach_webhook_secret}": raise HTTPException(status_code=401, detail="Unauthorized")
    data = await request.json(); sender = str(data.get("from") or "").lower(); body = str(data.get("text") or data.get("body") or ""); classification, needs_owner = classify_reply(body)
    if not sender: raise HTTPException(status_code=400, detail="Missing sender")
    db.add(OutreachInboundMessage(provider_message_id=str(data.get("id")) if data.get("id") else None, from_email=sender, subject=str(data.get("subject") or ""), body=body, classification=classification, needs_owner=needs_owner))
    lead = db.scalar(select(OutreachLead).where(OutreachLead.email == sender));
    if lead and classification == "suppressed": lead.status = "suppressed"
    elif lead: lead.status = "replied"
    db.commit()
    if needs_owner and settings.outreach_alert_email: send_email(settings.outreach_alert_email, f"Valases action needed: reply from {sender}", f"Subject: {data.get('subject') or ''}\n\n{body}")
    return {"ok": True, "classification": classification}
