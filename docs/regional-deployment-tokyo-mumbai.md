# Tokyo and Mumbai Regional Deployment

Valases runs one isolated deployment per data region. Tokyo and Mumbai use the
same application source but never share a database, Supabase project, storage
bucket, or server secret. A customer is assigned a region during onboarding and
is not moved automatically based on IP address.

## Current regions

| Region | Supabase region | Deployment setting |
| --- | --- | --- |
| Tokyo | ap-northeast-1 | `DEPLOYMENT_REGION=tokyo` |
| Mumbai | ap-south-1 | `DEPLOYMENT_REGION=mumbai` |

## Deployment layout

Keep the existing `Valases` and `Valases_candidate` Vercel projects connected
to Tokyo. Create two additional Vercel projects from the same repository for
Mumbai, for example `Valases_IN` and `Valases_candidate_IN`.

Each API/recruiter project has its own regional values for `DATABASE_URL`,
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
`VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. Use the normal
variable names inside each project; never store both regions' secrets in one
Vercel project.

Each candidate project points only to its paired API deployment through
`VITE_API_BASE_URL`.

## Release sequence

1. Keep Tokyo unchanged and live.
2. Bootstrap the fresh Mumbai project with `scripts/bootstrap_fresh_region.py`.
   This creates the complete application schema, including the hiring tables
   and default assessments; do not run the hiring-only SQL migration first on
   an empty database.
3. Deploy the recruiter/API source to the Mumbai Vercel project with
   `DEPLOYMENT_REGION=mumbai`.
4. Verify `/health` returns `"region":"mumbai"` and a ready database.
5. Deploy the candidate source to its Mumbai Vercel project, pointing at the
   Mumbai API URL.
6. Create Mumbai-resident organizations only through the Mumbai admin console.

Do not copy Tokyo candidate data into Mumbai without an approved migration,
customer contract review, and a deletion plan for the source copy.
