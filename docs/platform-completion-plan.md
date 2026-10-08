# Platform completion plan — 8 October 2026

## Decision

Continue building before buying the Valases domain. Hosting/DNS are not the only
remaining work. The chosen stack is Vercel, Supabase PostgreSQL and Zoho
ZeptoMail for application emails, with Zoho Mail for team inboxes. Bunny Storage
may hold optimized files later; it does not replace the PostgreSQL database.
Website, Hiring Tool and Job Portal remain separate repositories.

## Completed in this pass

- Job Portal: authenticated finite scheduled tasks for catalog sync, encrypted
  email outbox delivery, daily digest creation, payment reconciliation and
  expired-session/token cleanup. Persistent worker remains an alternative.
- Task authentication is independent from candidate sessions; PostgreSQL task
  locks skip overlapping runs. Provider/database timeouts and atomic catalog
  publication limit serverless risk. No external schedules are provisioned.
- Hiring Tool: organization SMTP test refuses missing/unreadable channel
  configuration instead of silently testing platform fallback credentials.
  SMTP/network errors return controlled actionable errors. Saving SMTP settings
  invalidates the previous successful test timestamp. The form accepts provider
  SMTP usernames that are not email addresses and distinguishes saved/untested
  settings from a successfully sent test.
- No actual email, payment, migration or production configuration was performed.

## Engineering and acceptance sequence

| Order | Work | Completion evidence | Needs domain? |
| --- | --- | --- | --- |
| 1 | Candidate and recruiter workflow acceptance | Self setup, team permissions, issuing each format, randomized frozen case, autosave/reconnect, submit, reviewer decisions and free limits all verified | No; local/temporary staging origin works |
| 2 | Candidate file storage audit across Hiring Tool | Inventory every upload path; bound size/type, discard unnecessary originals, optimize required media before durable storage, preserve scoring evidence, implement retention/export/deletion | No; actual private provider storage test needs credentials |
| 3 | Assessment quality | EA/CPA review of both tax banks, English speaker/naturalness and difficulty review, answer-key checks and completion-time pilots across roles | No; subject reviewers required |
| 4 | Coding scope | Keep correctness explicitly manual until isolated execution and validated behavioral tests exist; do not advertise automatic execution | No; runner isolation and service design needed for automatic mode |
| 5 | Paid-plan completeness | Test monthly entitlements and align deployment overrides with website; implement or clearly exclude annual checkout and paid assessment rate-card metering | No for implementation; sandbox credentials for checkout tests |
| 6 | Integration contract cleanup | Resolve existing Greenhouse test/catalog mismatch according to supported scope; verify calendar behavior and application handoff | No for contract cleanup; provider access for live integration |
| 7 | Serverless scheduling acceptance | Run all scheduled tasks against PostgreSQL, overlapping invocations, scheduler failures, catalog freshness, mail retry/backlog and payment replay | No; temporary HTTPS deployment and service credentials required |
| 8 | Operational release | Schema migration, tenant isolation, restore drill, retention runs, controlled email/payment tests, error alerts and operator/support notices | Some external configuration and qualified review required |
| 9 | Custom-domain cutover | DNS, HTTPS origins, Supabase redirect allowlists, verified email sender, production merchant setup and final smoke tests | Yes for Valases-branded launch |

## Boundaries and known gaps

Existing local tests and builds are implementation evidence, not live acceptance.
Tax exercises reference 2025 rules and are not official IRS/EA examination
questions. Coding cases require behavioral manual review. English has 30
selectable recordings but needs independent naturalness/difficulty review.
Annual commercial terms and all paid format-rate metering are not implemented
by the free quota service. GSTIN/business ownership verification remains a
separate optional integration; mailbox verification proves email control only.

The older readiness documents include enterprise expansion beyond the initial
pilot (for example SSO, AI interviews and broad ATS coverage). Those are not
automatically prerequisites for a scoped pilot. Core access control, truthful
feature availability, reliable candidate submission and safe data handling are.

## Current verification

- Standalone Job Portal: 47 automated tests pass; frontend JavaScript syntax
  passes. Scheduled task provider calls are mocked and PostgreSQL overlap needs
  live validation.
- Hiring Tool: four new targeted SMTP tests cover missing configuration,
  controlled provider failures, successful channel-specific delivery recording
  and invalidation after settings change; all pass. Recruiter TypeScript build
  passes. No messages sent.

Job Portal deployment instructions live in its own repository at
`valases_jobs/deploy/VERCEL.md`. Use Supabase session pooling for the scheduler
because its advisory locks span transaction commits. Configure a scheduler
before disabling preview; a successful Vercel build does not prove readiness.
