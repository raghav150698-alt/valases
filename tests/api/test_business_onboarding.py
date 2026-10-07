import unittest
from unittest.mock import patch, Mock
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.core.config import Settings
from app.models.entities import Base, User, UserApproval, UserRole, ApprovalStatus
from app.api.routes.auth import me_context
from app.services.supabase_auth import verify_supabase_token
from app.services.business_onboarding import verified_business_email


class BusinessOnboardingTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.settings = Settings(_env_file=None,auth_mode='supabase',allow_self_service_signup=False,
            allow_employer_self_service_signup=True,supabase_url='https://test.supabase.co',supabase_publishable_key='test')
        self.payload = {'uid':'verified-test','email':'owner@workcompany.example','name':'Owner','role':'',
                        '_server_verified_email':True}

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def context(self):
        with patch('app.api.routes.auth.get_settings',return_value=self.settings), \
             patch('app.api.routes.auth.verify_supabase_token',return_value=self.payload), \
             patch('app.api.routes.auth._safe_sync_claims'):
            return me_context(token='unused-test-token',db=self.db)

    def test_verified_work_email_gets_provider_role_and_free_workspace_without_admin_approval(self):
        result=self.context()
        self.assertEqual(result['role'],UserRole.PROVIDER)
        self.assertEqual(result['approval_status'],ApprovalStatus.APPROVED)
        self.assertIsNone(result['verification_status'])
        from app.api.routes.hiring import hiring_workspace
        user=self.db.get(User,result['id'])
        workspace=hiring_workspace(organization_id=None,db=self.db,current_user=user)
        from app.services.assessment_entitlements import public_usage
        allowance=public_usage(self.db,workspace['organization']['id'])
        self.assertFalse(allowance['paid_assess_enabled'])
        self.assertEqual(allowance['remaining'],{'candidates':5,'english_language':5,'mcq':10})

    def test_unconfirmed_personal_and_disabled_onboarding_cannot_provision(self):
        for email,verified in [('owner@workcompany.example',False),('owner@gmail.com',True)]:
            self.payload.update(email=email,_server_verified_email=verified)
            with self.assertRaises(HTTPException) as error:self.context()
            self.assertEqual(error.exception.status_code,403)
        self.payload.update(email='owner@workcompany.example',_server_verified_email=True)
        self.settings.allow_employer_self_service_signup=False
        with self.assertRaises(HTTPException):self.context()
        self.assertIsNone(self.db.scalar(select(User)))

    def test_existing_pending_or_banned_user_is_not_auto_approved(self):
        user=User(email=self.payload['email'],full_name='Owner',password_hash='unused',role=UserRole.PROVIDER,is_active=True)
        self.db.add(user);self.db.flush()
        self.db.add(UserApproval(user_id=user.id,status=ApprovalStatus.PENDING));self.db.commit()
        self.assertEqual(self.context()['approval_status'],ApprovalStatus.PENDING)
        user.account_state='banned';self.db.commit()
        with self.assertRaises(HTTPException):self.context()

    def test_user_editable_email_verified_metadata_is_not_accepted(self):
        payload={'email':'owner@workcompany.example','user_metadata':{'email_verified':True}}
        self.assertFalse(verified_business_email(payload,self.settings))
        response=Mock(status_code=200)
        response.json.return_value={'id':'test','email':payload['email'],'user_metadata':{'email_verified':True}}
        with patch('app.services.supabase_auth.httpx.get',return_value=response):
            verified=verify_supabase_token('test',self.settings)
        self.assertFalse(verified['_server_verified_email'])
        response.json.return_value['email_confirmed_at']='2026-10-07T00:00:00Z'
        with patch('app.services.supabase_auth.httpx.get',return_value=response):
            self.assertTrue(verify_supabase_token('test',self.settings)['_server_verified_email'])

    def test_another_work_mailbox_does_not_join_existing_organization(self):
        from app.api.routes.hiring import hiring_workspace
        first=self.context()
        first_workspace=hiring_workspace(organization_id=None,db=self.db,current_user=self.db.get(User,first['id']))
        self.payload.update(uid='second',email='second@workcompany.example')
        second=self.context()
        second_workspace=hiring_workspace(organization_id=None,db=self.db,current_user=self.db.get(User,second['id']))
        self.assertNotEqual(first_workspace['organization']['id'],second_workspace['organization']['id'])

    def test_declared_legal_and_brand_names_create_company_profile_without_registry_claim(self):
        from app.api.routes.hiring import hiring_workspace
        self.payload['user_metadata']={'business_profile': {'legal_name':'Green House Pvt Ltd',
            'brand_name':'Uncut Trees','country':'India','website':'https://uncuttrees.com',
            'admin_email':'imposter@other.example','registry_status':'verified'}}
        result=self.context()
        workspace=hiring_workspace(organization_id=None,db=self.db,current_user=self.db.get(User,result['id']))
        company=workspace['organization']
        self.assertEqual(company['name'],'Uncut Trees')
        self.assertEqual(company['legal_name'],'Green House Pvt Ltd')
        self.assertEqual(company['business_profile']['admin_email'],self.payload['email'])
        self.assertEqual(company['business_profile']['work_email_status'],'confirmed')
        self.assertEqual(company['business_profile']['registry_status'],'not_checked')
        self.assertEqual(company['business_profile']['website'],'https://uncuttrees.com')
        self.payload['user_metadata']['business_profile']['brand_name']='Changed metadata'
        self.context()
        repeated=hiring_workspace(organization_id=None,db=self.db,current_user=self.db.get(User,result['id']))
        self.assertEqual(repeated['organization']['name'],'Uncut Trees')
        self.assertEqual(repeated['organization']['id'],company['id'])

    def test_invalid_declared_company_profile_is_rejected(self):
        self.payload['user_metadata']={'business_profile':{'legal_name':' ','brand_name':'Trees','country':'India'}}
        with self.assertRaises(HTTPException) as error:self.context()
        self.assertEqual(error.exception.status_code,422)
        self.db.rollback()
        self.assertIsNone(self.db.scalar(select(User)))

    def test_api_authentication_entry_point_also_saves_business_details(self):
        from app.api.deps import get_current_user
        from app.models.entities import Organization
        self.payload['user_metadata']={'business_profile':{'legal_name':'Green House Pvt Ltd','brand_name':'Uncut Trees','country':'India'}}
        with patch('app.api.deps.get_settings',return_value=self.settings),patch('app.api.deps.verify_supabase_token',return_value=self.payload):
            user=get_current_user(token='test',db=self.db,x_dummy_user_id=None,x_dummy_role=None,x_dummy_email=None,x_dummy_name=None)
        organization=self.db.scalar(select(Organization).where(Organization.created_by_user_id==user.id))
        self.assertEqual(organization.name,'Uncut Trees')
        self.assertEqual(organization.legal_name,'Green House Pvt Ltd')

    def test_local_legacy_signup_does_not_claim_email_confirmation(self):
        from app.api.routes.auth import signup
        from app.schemas import SignupRequest
        from app.models.entities import Organization
        self.settings.allow_self_service_signup=True
        with patch('app.api.routes.auth.get_settings',return_value=self.settings),patch('app.api.routes.auth.hash_password',return_value='test-hash'):
            user=signup(SignupRequest(email='local@company.example',full_name='Local Admin',password='test-password-long',role=UserRole.PROVIDER,
                business_profile={'legal_name':'Green House Pvt Ltd','brand_name':'Uncut Trees','country':'India'}),db=self.db)
        organization=self.db.scalar(select(Organization).where(Organization.created_by_user_id==user.id))
        self.assertEqual(organization.name,'Uncut Trees')
        self.assertEqual(organization.settings_json['business_profile']['work_email_status'],'not_confirmed')

    def test_company_profile_edits_preserve_confirmed_email_and_reset_registry_check(self):
        from app.api.routes.hiring import hiring_workspace,update_organization_profile,OrganizationProfileUpdate
        from app.models.entities import Organization
        self.payload['user_metadata']={'business_profile':{'legal_name':'Green House Pvt Ltd','brand_name':'Uncut Trees','country':'India'}}
        user=self.db.get(User,self.context()['id'])
        company=hiring_workspace(organization_id=None,db=self.db,current_user=user)['organization']
        organization=self.db.get(Organization,company['id'])
        organization.settings_json={**organization.settings_json,'business_profile':{**organization.settings_json['business_profile'],'registry_status':'verified'}}
        self.db.commit()
        result=update_organization_profile(OrganizationProfileUpdate(name='Uncut Trees',legal_name='Green House Services Pvt Ltd',country='India',website='https://uncuttrees.com'),organization_id=company['id'],db=self.db,current_user=user)
        self.assertEqual(result['legal_name'],'Green House Services Pvt Ltd')
        self.assertEqual(result['business_profile']['registry_status'],'not_checked')
        self.assertEqual(result['business_profile']['admin_email'],self.payload['email'])
        self.assertEqual(result['business_profile']['work_email_status'],'confirmed')
        with self.assertRaises(HTTPException):
            update_organization_profile(OrganizationProfileUpdate(name='Uncut Trees',website='javascript:alert(1)'),organization_id=company['id'],db=self.db,current_user=user)
        self.db.rollback()

    def test_new_employer_can_issue_multiple_free_mcqs_and_paid_tools_are_blocked(self):
        from app.api.routes.hiring import hiring_workspace
        from app.api.routes.exams import list_published_assessment_catalog, issue_assessment_to_candidate, IssueAssessmentRequest
        from app.models.entities import HiringCandidate, HiringApplication, AssessmentIssue
        from starlette.requests import Request
        user=self.db.get(User,self.context()['id'])
        workspace=hiring_workspace(organization_id=None,db=self.db,current_user=user)
        rows=list_published_assessment_catalog(q='',duration='all',sort='latest',db=self.db,current_user=user)
        mcq=next(row for row in rows if row['assessment_type']=='mcq')
        tax=next(row for row in rows if row['assessment_type']=='tax_simulator')
        candidate=HiringCandidate(organization_id=workspace['organization']['id'],first_name='Candidate',email='candidate@example.com')
        self.db.add(candidate);self.db.flush()
        application=HiringApplication(organization_id=workspace['organization']['id'],job_id=1,candidate_id=candidate.id,stage='screening',status='active')
        self.db.add(application);self.db.commit()
        payload=IssueAssessmentRequest(application_id=application.id,candidate_name='Candidate',candidate_email=candidate.email,send_email=False)
        request=Request({'type':'http','method':'POST','scheme':'http','server':('localhost',5173),'path':'/','headers':[]})
        with patch('app.api.routes.exams.get_settings',return_value=self.settings):
            issue_assessment_to_candidate(mcq['exam_id'],payload,request,db=self.db,current_user=user)
            self.assertEqual(application.stage,'assessment')
            issue_assessment_to_candidate(mcq['exam_id'],payload,request,db=self.db,current_user=user)
            with self.assertRaises(HTTPException) as error:
                issue_assessment_to_candidate(tax['exam_id'],payload,request,db=self.db,current_user=user)
        self.assertEqual(error.exception.status_code,402)
        self.assertEqual(len(list(self.db.scalars(select(AssessmentIssue)))),2)
