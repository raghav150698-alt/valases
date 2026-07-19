# Assessment Standalone (Recruiter + Candidate)

This is a standalone assessment product extracted from the larger platform.

## What it does

- Recruiter signup/login
- Recruiter can:
  - Create custom assessments
  - Choose catalog assessments
  - Issue assessments to candidate name + email
- Candidate receives credentials (SMTP or local outbox log), logs in, and takes assessment
- Recruiter sees issued status and candidate result in dashboard

## Run

1. Create and activate a venv (recommended).
2. Install dependencies:

```powershell
cd D:\certora\assessment_standalone
python -m pip install -r .\requirements.txt
```

3. Start server:

```powershell
cd D:\certora\assessment_standalone
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8010 --reload
```

4. Open:

- [http://127.0.0.1:8010](http://127.0.0.1:8010)

## Email behavior

- If SMTP env vars are set, real email is sent.
- Otherwise credentials are written to:
  - `D:\certora\assessment_standalone\data\outbox_emails.log`

## Optional SMTP env vars

- `ASSESSMENT_SMTP_HOST`
- `ASSESSMENT_SMTP_PORT` (default `587`)
- `ASSESSMENT_SMTP_USER`
- `ASSESSMENT_SMTP_PASS`
- `ASSESSMENT_FROM_EMAIL`

## Mandatory defaults included

- Minimum pass score enforced: `70%`
- Secure hashed passwords for recruiter/candidate credentials
- Candidate assessment can only be submitted once
- Recruiter can only issue their own custom templates (plus shared catalog)
