# Valases Client Launch Readiness

## Release position

Valases is suitable for controlled design-partner pilots after all P0 gates
below pass. It is not yet ready for an unrestricted enterprise rollout.
Launch approval requires product, security, privacy, operations, and customer
acceptance evidence. A feature is not complete merely because a screen or API
route exists.

Run the automated release gate from a production-configured operator shell:

```powershell
.\.codex-run-venv\Scripts\python.exe scripts\check_launch_readiness.py
```

The command never prints credentials. A non-zero exit code blocks release.

## P0: pilot launch gates

| Area | Current state | Acceptance criteria |
| --- | --- | --- |
| Regional production | Partial | Tokyo and Mumbai each return healthy API, database, recruiter UI, and candidate UI smoke tests |
| Authentication | In progress | Supabase login, first-login concurrency, logout, expiry, disabled users, and administrator provisioning pass |
| Tenant isolation | In progress | Cross-organization read/write tests pass; provision a dedicated non-owner API role, run `docs/sql/tenant-rls-policies.sql`, and enable `DATABASE_TENANT_RLS_ENABLED` |
| Client provisioning | Implemented | Admin creates company and owner in Supabase and Valases atomically with an audit event |
| Candidate invitations | Partial | SMTP delivery, secure links, expiry, resend, revoke, and delivery failure recovery pass |
| Assessment library | Implemented | Tough default assessments for every supported tool are stored in PostgreSQL and can be installed, issued, and versioned |
| Assessment builder | Partial | Recruiter can create, preview, publish, version, duplicate, archive, and validate scoring checkpoints |
| Candidate delivery | In progress | Welcome audio, consent, preflight, full screen, timer, autosave/recovery, idempotent submit, and thank-you flows pass desktop browser testing |
| Deterministic scoring | Implemented | MCQ and tool checkpoints produce explainable scores; candidates never receive immediate results |
| Review workflow | Implemented | Recruiter review shows answers, checkpoints, proctor evidence, score override reason, and final decision audit |
| Proctoring | Pilot only | Gaze, phone, multiple-person, fullscreen, and visibility signals are advisory; false positives are measured and human review remains mandatory |
| Privacy and consent | Partial | Counsel approves candidate notice, consent, retention, accommodation, DPA, and subprocessor list |
| Data retention | Partial | Automated deletion covers attempts, answers, proctor data, object storage, exports, and audit-safe tombstones |
| Security | Partial | ASVS review, threat model, dependency scanning, secret scanning, WAF, MFA, penetration test, and remediation signoff complete |
| Observability | Partial | Central logs, immutable audit export, uptime checks, error alerts, latency alerts, and on-call ownership operate |
| Backup and recovery | External | PITR enabled, 35-day backup policy confirmed, restore drill completed, and RPO/RTO approved |
| Release engineering | In progress | CI passes backend tests and both frontend builds; protected branches and reviewed releases are enabled |
| Client acceptance | Pending | Named client administrators complete onboarding, workflow, accessibility, security, and recovery acceptance tests |

## Feature readiness

| Product feature | Current capability | Work before general availability |
| --- | --- | --- |
| JD creation | Governed role template generation | Approved AI provider, prompt/version registry, evaluation set, human approval, cost and safety controls |
| Resume scanning | Deterministic skills/evidence matching | Private uploads, malware scanning, parsing, deletion, bias evaluation, explanation and appeal controls |
| Voice scheduling | Not implemented | Telephony provider, consent, calendar availability, retries, transcripts, regional recording rules, human fallback |
| AI interviews | Not implemented | Structured question plans, audio/video consent, transcription, rubric scoring, bias testing, accommodations, reviewer override |
| Recommendations | Explainable screening aid | Calibrated model evaluation; never auto-reject or make final employment decisions |
| Compliance | Consent and structured-review guardrails | Jurisdiction packs, configurable workflows, evidence exports, legal review, adverse-action support where applicable |
| ATS integration | Provider inventory only | OAuth, encrypted token vault, webhooks, idempotent sync, reconciliation, permissions and per-provider certification |
| Calendar and meetings | Manual meeting URLs | Google Calendar, Outlook, Teams and timezone-safe rescheduling with webhook recovery |
| Assessments | Core workflow implemented | Builder usability, versioning, larger browser matrix, accessibility and load testing |
| Proctor AI | Local advisory models available | Representative validation data, drift monitoring, model registry, rollback, documented thresholds and reviewer QA |
| Admin console | Companies, users, billing metadata, usage | Support tooling, impersonation-free diagnostics, exports, entitlements, invoices, plan enforcement and audit search |

## P1: enterprise controls

1. SAML/OIDC SSO, MFA policy, SCIM lifecycle, session inventory and revocation.
2. Tenant-aware database role and reviewed PostgreSQL RLS policies.
3. Private candidate-document storage with signed URLs and malware scanning.
4. Distributed edge rate limiting, bot protection and webhook verification.
5. SIEM export, security detections and immutable audit retention.
6. Configurable retention, legal holds, data-subject export and deletion jobs.
7. Billing provider integration, entitlements, usage metering and invoice events.
8. Accessibility audit against WCAG 2.2 AA and accommodation workflows.
9. Performance tests for concurrent proctored sessions and large assessments.
10. Customer-facing status, support, incident communication and SLA procedures.

## P2: advanced product expansion

1. Production ATS connectors: Greenhouse, Lever, Workday, Ashby, BambooHR and SuccessFactors.
2. Google and Microsoft calendar integrations, Teams meetings and rescheduling.
3. Consent-aware voice scheduling with human fallback.
4. Governed AI job descriptions and resume evidence extraction.
5. Structured AI interview assistance with human-controlled scorecards.
6. Analytics for funnel quality, interviewer consistency, assessment validity and adverse impact.
7. Regional routing, customer-selected residency and tested cross-region recovery.

## Launch sequence

1. Close P0 engineering gates and keep advanced AI decisions disabled.
2. Run internal end-to-end and destructive recovery testing.
3. Onboard one design partner in Mumbai with a written pilot scope.
4. Measure authentication reliability, delivery success, completion, false flags, review time and support incidents.
5. Remediate pilot findings before adding the second client.
6. Complete independent security and privacy assurance before enterprise general availability.
