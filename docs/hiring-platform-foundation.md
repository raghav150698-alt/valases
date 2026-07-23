# Valases Hiring Platform Foundation

## What is now available

The recruiter workspace is an organization-scoped hiring operations product.
It includes a requisition workspace, candidate directory, application pipeline,
structured interviews, scorecards, audit events, compliance checks, and an
integration inventory. Each record is associated with an organization and every
write is recorded with an actor where one is available.

The initial recruiter experience is deliberately work-focused:

- Define a role with a job code, skills, requirements, hiring plan, and draft
  description.
- Capture candidate consent, contact data, structured skills, and a resume
  summary.
- Add a candidate to a role and move the application through the controlled
  hiring stages.
- Run a transparent evidence screen that compares stated skills and resume text
  against the role requirements.
- Schedule structured interviews and save comparable scorecards.
- Run consent and review guardrail checks before advancing a decision.

## Screening policy

The current screening service is deterministic by design. It returns matched
skills, skills that still need verification, a match score, limitations, and a
required human-review flag. It never makes an automatic rejection, offer, or
hiring decision. This keeps the first release explainable and usable before a
validated AI model exists.

Do not train or deploy a candidate-ranking model from scraped resumes. Before
introducing a learned model, Valases needs a lawful data source, documented
consent/retention basis, representative labels, bias testing, model cards,
appeal/review workflow, and customer approval. The preparation script in
`ml/hiring/scripts/prepare_review_dataset.py` only validates and de-identifies
a human-reviewed export. It does not train or deploy a model.

## Required database migration

Production startup intentionally does not create these tables. Apply the
reviewed migration once through the Supabase SQL Editor:

1. Open the Valases Supabase project.
2. Go to **SQL Editor** and create a new query.
3. Paste the full contents of
   `app/db/migrations/20260724_enterprise_hiring.sql`.
4. Run the query and retain the execution record with the release evidence.
5. Redeploy the recruiter/API Vercel project.
6. Open `/health`. A healthy deployment must report a reachable database.

The migration uses server-side database access. Do not enable broad RLS policies
for these tables until the API is moved to a tenant-aware least-privilege role;
an incomplete RLS configuration can cause incorrect cross-tenant behavior.

## Documents and Supabase Storage

The first release supports resume text so customer documents do not need to be
uploaded before the core workflow is usable. When document upload is enabled,
use a private Supabase Storage bucket named `candidate-documents` with no public
URL, a server-side upload API, malware scanning, short-lived signed download
URLs, retention controls, and organization-prefixed object keys. Never expose a
Supabase service key or write policy in the browser.

The current production upload abstraction is private S3. A Supabase Storage
adapter should be introduced as a separately tested release after the bucket,
retention period, and DPA requirements are confirmed.

## Integration boundary

The integration screen stores only connection status, approved account name,
and sync scope. It does not accept API tokens or ATS passwords. Each live ATS,
calendar, or voice-scheduling connector needs a provider-specific OAuth client,
redirect URI, encrypted token storage, scoped permissions, webhook signature
verification, idempotency keys, and audit logging before sync is enabled.

## Next customer inputs

Before enabling documents or live connectors, Valases needs the following from
the customer administrator:

- A confirmed data residency region, retention schedule, and candidate privacy
  notice/DPA requirements.
- The private storage bucket decision and approved file types/size limits.
- The first ATS/calendar provider, OAuth application credentials, redirect URI,
  and approved sync scope.
- A defined hiring scorecard for each job family, including who may make the
  final decision.
