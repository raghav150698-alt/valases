# Certora MVP Backend (FastAPI)

This scaffold implements your 6 core layers:

1. User/provider onboarding with KYC/business docs and admin approval
2. Course publishing (modules, lessons, resources, live/recorded links)
3. Exam creation (MCQ single/multiple, rules, publish flow)
4. AI review layer (difficulty, clarity, duplication, coverage, readiness)
5. Test delivery (enrollment, attempts, autosave answers, result generation)
6. Certification (issue, verify, revoke)

## Stack

- FastAPI
- SQLAlchemy
- PostgreSQL (recommended) or SQLite for local dev
- Firebase Auth (ID token verification on backend)

Current mode defaults:

- Firebase auth enabled (`AUTH_MODE=firebase`)
- AI review disabled (`ENABLE_AI_REVIEW=false`)

## Quick Start

1. Create environment and install packages:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Optional (local/offline proctoring model feature extraction stack):

```bash
pip install -r requirements-ml.txt
```

2. Configure `.env` (copy from `.env.example`).

3. Run API:

```bash
uvicorn app.main:app --reload
```

4. Open Swagger:

`http://localhost:8000/docs`

5. Open frontend:

`http://localhost:8000/`

Assessment React app (new migration target):

```bash
cd app/web_assessment_react
npm install
npm run build
```

Then open:

`http://localhost:8000/assessment`

## Firebase Auth Setup

Required env variables:

- `FIREBASE_SERVICE_ACCOUNT_PATH` for local file-based runs
- `FIREBASE_SERVICE_ACCOUNT_JSON` for Vercel/serverless deployments
- `FIREBASE_PROJECT_ID`
- `FIREBASE_WEB_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_APP_ID`
- `FIREBASE_STORAGE_BUCKET`

For Vercel:

- add `FIREBASE_WEB_API_KEY` from Firebase Project Settings -> Web App config
- add `FIREBASE_SERVICE_ACCOUNT_JSON` as the full JSON string of the Firebase service account
- do not commit real Firebase secrets into the repository

Frontend login options:

- Email/password signup/login
- Google popup login
- Signup includes account type selection (`student` or `provider`)
- After signup, frontend calls `POST /auth/register-role`

API auth:

- Send Firebase ID token as Bearer token:
  - `Authorization: Bearer <firebase_id_token>`

Local QA role switching:

- `ALLOW_DEV_ROLE_OVERRIDE=true` enables `X-Dev-Role: admin|provider|student`
- This is for local development only; disable in production

## Frontend Flow

`http://localhost:8000/` now includes:

1. Auth page:
- Register new user with:
  - full name
  - email/password
  - account type (`student` or `provider`)
- Login with email/password or Google
- Public course list visible without login (`/courses/public`)

2. Student portal:
- Loads published courses
- Shows empty state when no courses are live
- Supports enroll action

3. Provider portal:
- Provider onboarding form (type, display name, description)
- Course creation form
- Provider course list refresh

4. Admin portal:
- Home with `Analytics`:
  - onboarded providers
  - students
  - enrolled courses
  - issued certificates
  - pass percentage
- Tools:
  - `Reports & Compliants` (count + details)
  - `Approvals` (pending student/provider cards + approve/reject)
  - `Billing & Payments` (placeholder panel)
  - CSV export buttons for reports, compliants, and pending approvals

Current UX focus:
- Admin-first console is prioritized.
- Non-admin accounts can log in, but are shown a restricted placeholder view in this phase.

## Admin Ops Additions

- Audit logs endpoint: `GET /admin/audit-logs?page=1&page_size=20`
- Moderation endpoints now support pagination/filtering:
  - `GET /admin/reports?page=1&page_size=20&status=open&search=...`
  - `GET /admin/complaints?page=1&page_size=20&status=open&search=...`
- Export endpoints:
  - `GET /admin/reports/export.csv`
  - `GET /admin/complaints/export.csv`
  - `GET /admin/approvals/export.csv`
- Optional SMTP notifications on approval decisions.
  - Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SENDER`

## Role Model

- `student`
- `provider`
- `admin`

## Core API Groups

- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`
- `POST /provider/profile`
- `POST /provider/documents`
- `GET /provider/status`
- `POST /courses`
- `PUT /courses/{course_id}`
- `POST /courses/{course_id}/modules`
- `POST /courses/modules/{module_id}/lessons`
- `POST /courses/lessons/{lesson_id}/resources`
- `POST /courses/{course_id}/publish`
- `POST /exams`
- `POST /exams/{exam_id}/questions`
- `POST /exams/{exam_id}/ai-review/request`
- `GET /exams/{exam_id}/ai-review`
- `POST /exams/{exam_id}/publish`
- `POST /student/enroll`
- `POST /student/exams/{exam_id}/attempts/start`
- `POST /student/attempts/{attempt_id}/answers`
- `POST /student/attempts/{attempt_id}/events`
- `POST /student/attempts/{attempt_id}/submit`
- `GET /student/attempts/{attempt_id}/result`
- `POST /certificates/generate/{result_id}`
- `GET /certificates/verify/{certificate_id}`
- `POST /certificates/{certificate_id}/revoke`
- `GET /admin/providers/pending`
- `POST /admin/providers/{provider_id}/decision`
- `GET /admin/documents/pending`
- `POST /admin/documents/{document_id}/review`
- `GET /admin/exams/review`
- `POST /admin/exams/{exam_id}/certification-approval`

## AI Review and Rule Engine Defaults

- Minimum 25 questions
- Minimum pass score 60%
- Maximum 70% easy questions
- At least 3 syllabus areas covered
- No more than 10% duplicate-like questions
- No more than 10% ambiguous/flagged questions

## Notes

- AI endpoints are currently disabled by default for MVP speed.
- Set `ENABLE_AI_REVIEW=true` later to enable AI review checks.
- Replace `app/services/ai_review.py` with async worker + OpenAI calls in Phase 2.
- Certificate PDF generation is placeholder-ready (`pdf_url` field exists).

## Migrate Local Data To Cloud DB

If your local `certora.db` has test data and production is empty, run this one-time migration:

```bash
python scripts/migrate_sqlite_to_database.py --target-url "<POSTGRES_DATABASE_URL>" --replace --sync-rules
```

What it does:

- copies all SQL tables from local SQLite into target DB
- preserves IDs and relationships
- optionally replaces target data first (`--replace`)
- applies account rule sync and Firebase custom claim sync (`--sync-rules`)

Environment required for Firebase claim sync:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
