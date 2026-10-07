"""Narrow, read-only bridge for the separately deployed Valases Jobs product."""
import hmac
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routes.hiring import _job_or_404, _organization_context, _require_permission, _write_audit
from app.db.session import get_db
from app.models.entities import JobRequisition, Organization, User, UserRole
from app.models.job_marketplace import JobMarketplacePublication

router = APIRouter(prefix="/job-marketplace", tags=["valases-jobs-bridge"])


class PublicationRequest(BaseModel):
    published: bool
    expires_at: datetime | None = None
    minimum_experience_years: float | None = Field(default=None, ge=0, le=80)


def bridge_access(authorization: str | None = Header(default=None)):
    key = os.environ.get("JOBS_BRIDGE_KEY", "")
    if len(key) < 32:
        raise HTTPException(503, "Valases Jobs bridge is not configured")
    if not hmac.compare_digest(authorization or "", "Bearer " + key):
        raise HTTPException(401, "Invalid bridge credentials")


@router.put("/publications/{job_id}")
def publish_job(job_id: int, payload: PublicationRequest, organization_id: int = Query(gt=0),
                db: Session = Depends(get_db),
                current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN))):
    organization, membership = _organization_context(db, current_user, organization_id)
    _require_permission(current_user, membership, "jobs.manage")
    job = _job_or_404(db, organization.id, job_id)
    if payload.published and job.status != "open":
        raise HTTPException(409, "Only open vacancies can be published")
    expiry = payload.expires_at
    if expiry and expiry.tzinfo is None:
        raise HTTPException(422, "Expiry must include a timezone")
    if payload.published and expiry and expiry <= datetime.now(timezone.utc):
        raise HTTPException(422, "Publication expiry must be in the future")
    item = db.get(JobMarketplacePublication, job.id)
    if item is None:
        item = JobMarketplacePublication(job_id=job.id)
        db.add(item)
    item.published = payload.published
    item.expires_at = expiry
    item.minimum_experience_years = payload.minimum_experience_years
    item.updated_by_user_id = current_user.id
    _write_audit(db, organization.id, current_user.id, "marketplace_publication_updated", "job", job.id,
                 {"published": payload.published})
    db.commit()
    return {"job_id": job.id, "published": item.published}

@router.get('/publications/{job_id}')
def publication(job_id: int, organization_id: int = Query(gt=0), db: Session = Depends(get_db),
                current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN))):
    organization, membership = _organization_context(db,current_user,organization_id)
    _require_permission(current_user,membership,'jobs.manage')
    _job_or_404(db,organization.id,job_id)
    item=db.get(JobMarketplacePublication,job_id)
    return {'published':bool(item and item.published),'expires_at':item.expires_at if item else None,
            'minimum_experience_years':item.minimum_experience_years if item else None}

@router.get('/publications/{job_id}')
def publication(job_id: int, organization_id: int = Query(gt=0), db: Session = Depends(get_db),
                current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN))):
    organization, membership = _organization_context(db,current_user,organization_id)
    _require_permission(current_user,membership,'jobs.manage')
    _job_or_404(db,organization.id,job_id)
    item=db.get(JobMarketplacePublication,job_id)
    return {'published':bool(item and item.published),'expires_at':item.expires_at if item else None,
            'minimum_experience_years':item.minimum_experience_years if item else None}


@router.get("/jobs", dependencies=[Depends(bridge_access)])
def published_jobs(after: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=200),
                   db: Session = Depends(get_db)):
    rows = db.execute(select(JobRequisition, Organization, JobMarketplacePublication)
        .join(Organization, Organization.id == JobRequisition.organization_id)
        .join(JobMarketplacePublication, JobMarketplacePublication.job_id == JobRequisition.id)
        .where(JobRequisition.id > after, JobRequisition.status == "open", Organization.status == "active",
               JobMarketplacePublication.published.is_(True),
               or_(JobMarketplacePublication.expires_at.is_(None),
                   JobMarketplacePublication.expires_at > datetime.now(timezone.utc)))
        .order_by(JobRequisition.id).limit(limit)).all()
    items = [{"id": str(job.id), "organization_slug": organization.slug, "company": organization.name,
              "job_code": job.job_code, "title": job.title, "location": job.location,
              "work_arrangement": job.work_arrangement, "employment_type": job.employment_type,
              "description": job.description, "skills": job.skills_json or [],
              "responsibilities": job.responsibilities_json or [], "requirements": job.requirements_json or [],
              "minimum_experience_years": publication.minimum_experience_years,
              "compensation_min": job.compensation_min, "compensation_max": job.compensation_max,
              "compensation_currency": job.compensation_currency} for job, organization, publication in rows]
    return {"items": items, "next_cursor": rows[-1][0].id if len(rows) == limit else None}
