# Recruiter and Candidate Deployment

Valases uses one repository, one API, and one database with two independently built frontend surfaces.

## Project 1: Recruiter and API

Use the existing Vercel project with the repository root as its Root Directory. The checked-in root `vercel.json` builds the recruiter frontend and serves the FastAPI API.

Required production variables:

```text
APP_ENV=production
AUTH_MODE=supabase
APP_BASE_URL=https://<recruiter-project>.vercel.app
CANDIDATE_APP_BASE_URL=https://<candidate-project>.vercel.app
CORS_ALLOW_ORIGINS=https://<candidate-project>.vercel.app
VITE_CANDIDATE_APP_URL=https://<candidate-project>.vercel.app
DATABASE_URL=<Supabase Postgres connection string>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Keep SMTP and other existing server-only variables on this project. Never add `DATABASE_URL`, SMTP credentials, or a Supabase secret/service-role key to the candidate project.

## Project 2: Candidate

Import the same GitHub repository as a second Vercel project and configure:

```text
Root Directory: app/web_assessment_react
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build:candidate
Output Directory: dist-candidate
```

Candidate project variables:

```text
VITE_APP_SURFACE=candidate
VITE_API_BASE_URL=https://<recruiter-project>.vercel.app
```

The candidate build intentionally excludes recruiter authentication, assessment creation, answer-key review, and recruiter workspace components. Its API access is limited by issued assessment tokens. The API project must list the exact candidate origin in `CORS_ALLOW_ORIGINS`.

For local candidate UI development, run `npm run dev:candidate` and open `/candidate.html?issued_key=<test-key>` on the displayed port.

## Deployment Order

1. Create and deploy the candidate Vercel project.
2. Copy its production URL into the recruiter project's `CANDIDATE_APP_BASE_URL`, `VITE_CANDIDATE_APP_URL`, and `CORS_ALLOW_ORIGINS` variables.
3. Redeploy the recruiter/API project.
4. Issue a new test assessment. Existing email links retain the URL generated when they were issued.

Production issuance fails closed when `CANDIDATE_APP_BASE_URL` is absent or invalid, preventing candidate links from opening the recruiter workspace.
