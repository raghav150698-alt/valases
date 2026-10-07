"""Work-mailbox control for employer self setup; does not verify a legal entity."""
from uuid import uuid4
from urllib.parse import urlsplit
from pydantic import BaseModel, Field, ConfigDict, field_validator, ValidationError
from fastapi import HTTPException
from sqlalchemy import select
from app.models.entities import Organization, OrganizationMembership


class BusinessProfileInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    legal_name: str = Field(min_length=2, max_length=240)
    brand_name: str = Field(min_length=2, max_length=200)
    country: str = Field(min_length=2, max_length=80)
    website: str = Field(default='', max_length=500)

    @field_validator('website')
    @classmethod
    def website_url(cls, value):
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in {'https', 'http'} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError('Enter a website URL beginning with https:// or http://.')
        return value


def bootstrap_business_profile(db, user, payload):
    """Copy declared details once; editable names never establish registry proof."""
    metadata = payload.get('user_metadata') or {}
    if not metadata.get('business_profile'):
        return  # Older accounts and OAuth users can complete Company profile.
    try:
        profile = BusinessProfileInput.model_validate(metadata['business_profile'])
    except ValidationError:
        raise HTTPException(status_code=422, detail='Provide legal business name, brand name, country and a valid optional website.')
    if db.scalar(select(OrganizationMembership.id).where(OrganizationMembership.user_id == user.id)):
        return
    organization = Organization(name=profile.brand_name, legal_name=profile.legal_name,
        slug=f'business-{user.id}-{uuid4().hex[:8]}', plan_code='free', created_by_user_id=user.id,
        settings_json={'business_profile': {'country':profile.country, 'website':profile.website,
            'admin_email':user.email, 'email_domain':user.email.rsplit('@',1)[-1],
            'work_email_status':'confirmed' if payload.get('_server_verified_email') is True else 'not_confirmed', 'registry_status':'not_checked'}})
    db.add(organization)
    db.flush()
    db.add(OrganizationMembership(organization_id=organization.id,user_id=user.id,role='owner',status='active'))
PERSONAL_EMAIL_DOMAINS = frozenset({'gmail.com','googlemail.com','yahoo.com','yahoo.co.in','outlook.com','hotmail.com','live.com','icloud.com','aol.com','proton.me','protonmail.com','mail.com'})


def verified_business_email(payload, settings):
    email = str(payload.get('email') or '').strip().lower()
    parts = email.rsplit('@', 1)
    return bool(settings.auth_mode.lower() == 'supabase'
                and settings.allow_employer_self_service_signup
                and payload.get('_server_verified_email') is True
                and len(parts) == 2 and '.' in parts[1]
                and parts[1] not in PERSONAL_EMAIL_DOMAINS)


def employer_signup_rejection(payload, settings):
    if settings.auth_mode.lower() == 'supabase' and settings.allow_employer_self_service_signup:
        if payload.get('_server_verified_email') is not True:
            return 'Confirm your work email before creating your free workspace. If already confirmed, try signing in again or contact support.'
        return 'Use your company-domain email for free self setup. Contact support if your business uses a personal email.'
    return 'This account has not been provisioned. Contact your Valases administrator.'
