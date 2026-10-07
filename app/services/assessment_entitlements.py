"""Organization-scoped free allowance, enforced before assessment issuance.

Calendar months are UTC. Invitations reserve allowance; resends do not consume
another unit. Revoked/expired invitations release allowance only before start.
PostgreSQL organization row locks serialize issuance across all recruiters.
"""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select
from app.models.entities import AssessmentIssue, HiringApplication, Organization, OrganizationBillingAccount

FREE_LIMITS = {'candidates':5, 'english_language':5, 'mcq':10}
FREE_TYPES = {'english_language', 'mcq'}


def month_bounds(now=None):
    now = now or datetime.now(timezone.utc)
    start = now.astimezone(timezone.utc).replace(day=1,hour=0,minute=0,second=0,microsecond=0)
    end = start.replace(year=start.year+1,month=1) if start.month==12 else start.replace(month=start.month+1)
    return start,end


def is_paid_assess_account(db, organization_id, now=None):
    account = db.scalar(select(OrganizationBillingAccount).where(OrganizationBillingAccount.organization_id==organization_id))
    if not account or account.status!='active' or account.plan_code in {'free','trial'} or account.monthly_amount_minor<=0:
        return False
    now=now or datetime.now(timezone.utc)
    expires=account.current_period_end
    if expires and (expires.replace(tzinfo=timezone.utc) if expires.tzinfo is None else expires)<=now:
        return False
    # Paid Assess activation is explicit because website Hire and Assess are
    # separate products. Legacy paid accounts can be activated by an admin.
    organization=db.get(Organization, organization_id)
    return bool((organization.settings_json or {}).get('assess_enabled'))


def monthly_usage(db, organization_id, now=None):
    now=now or datetime.now(timezone.utc)
    start,end=month_bounds(now)
    rows=db.execute(select(AssessmentIssue, HiringApplication).join(HiringApplication,AssessmentIssue.hiring_application_id==HiringApplication.id).where(HiringApplication.organization_id==organization_id,AssessmentIssue.issued_at>=start,AssessmentIssue.issued_at<end)).all()
    emails=set(); counts={'english_language':0,'mcq':0}
    for issue,application in rows:
        if issue.started_at is None:
            if issue.status=='revoked': continue
            expires=issue.access_expires_at
            if expires and (expires.replace(tzinfo=timezone.utc) if expires.tzinfo is None else expires)<=now: continue
        kind=(issue.result_json or {}).get('_allowance_assessment_type')
        if kind is None:
            from app.models.entities import Exam
            exam=db.get(Exam,issue.exam_id)
            kind=str(exam.assessment_type) if exam else ''
        if kind not in counts: continue
        emails.add(issue.candidate_email.strip().lower())
        counts[kind]+=1
    used={'candidates':len(emails),**counts}
    return {'month':start.strftime('%Y-%m'),'timezone':'UTC','resets_at':end.isoformat(),
            'limits':dict(FREE_LIMITS),'used':used,'remaining':{key:max(0,FREE_LIMITS[key]-value) for key,value in used.items()},
            'paid_assess_enabled':is_paid_assess_account(db,organization_id,now), '_candidate_emails':emails}


def public_usage(db, organization_id, now=None):
    result=monthly_usage(db,organization_id,now)
    result.pop('_candidate_emails',None)
    return result


def require_issue_allowance(db, organization_id, assessment_type, candidate_email, now=None):
    db.scalar(select(Organization).where(Organization.id==organization_id).with_for_update())
    usage=monthly_usage(db,organization_id,now)
    if usage['paid_assess_enabled']: return usage
    if assessment_type not in FREE_TYPES:
        raise HTTPException(status_code=402,detail={'code':'paid_assess_required','message':'Tax, Accounting, Coding and Excel require a paid plan with Assess activated.','usage':{key:value for key,value in usage.items() if not key.startswith('_')}})
    email=candidate_email.strip().lower()
    if (email not in usage['_candidate_emails'] and usage['used']['candidates']>=5) or usage['used'][assessment_type]>=FREE_LIMITS[assessment_type]:
        raise HTTPException(status_code=402,detail={'code':'free_monthly_limit_reached','message':'Your free monthly allowance is exhausted. Upgrade or wait for the next calendar month.','usage':{key:value for key,value in usage.items() if not key.startswith('_')}})
    return usage


def reserve_resent_invitation(db, organization_id, exam, issue, now=None):
    """Keep a live reservation; recheck quota when reviving a released invite."""
    if issue.started_at is not None:
        raise HTTPException(status_code=409, detail='A started assessment cannot be reset by resending its invitation.')
    now = now or datetime.now(timezone.utc)
    start, end = month_bounds(now)
    issued = issue.issued_at.replace(tzinfo=timezone.utc) if issue.issued_at.tzinfo is None else issue.issued_at
    expiry = issue.access_expires_at
    expiry = expiry.replace(tzinfo=timezone.utc) if expiry and expiry.tzinfo is None else expiry
    reserved = issue.status == 'issued' and start <= issued < end and (expiry is None or expiry > now)
    if not reserved:
        require_issue_allowance(db, organization_id, str(exam.assessment_type), issue.candidate_email, now)
        issue.issued_at = now
