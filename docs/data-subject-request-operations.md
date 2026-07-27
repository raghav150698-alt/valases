# Data-subject request operations

Apply `docs/sql/20260727_data_subject_requests.sql` once in every existing
regional Supabase project before deploying the API version that requires the
table. Fresh regional bootstraps create it automatically.

Administrators manage requests from **Administration > Data Requests**.

## Workflow

1. Record the company, request type, candidate email, requestor name, and intake
   notes.
2. Verify identity through the organization's approved process and record the
   evidence reference in the action reason.
3. Review the request scope, legal obligations, active applications, active
   assessment invitations, and legal holds.
4. Approve or reject with a documented reason.
5. Execute an approved request by typing its exact request reference.

Access and export requests produce a JSON package scoped to the selected
organization. Deletion requests anonymize matching hiring and assessment
records and clear submission/proctor payloads. Deletion is refused when:

- an organization-wide legal hold is active;
- a matching hiring application is active; or
- a matching assessment invitation is issued or started.

Every workflow transition and execution writes an organization audit event.
Completed deletion cases replace the candidate email and requestor name with a
minimal redacted case record.

## Operating controls

- Keep downloaded exports in approved encrypted storage and delete them after
  delivery and evidence retention requirements are satisfied.
- Never send an export before independently authenticating the requestor.
- Require privacy or legal review before overriding a hold or closing an active
  recruitment record.
- Review overdue cases daily. The default due date is 30 days and may need a
  shorter jurisdiction-specific deadline.
- Counsel must approve regional notices, exemptions, appeal language, and
  identity-verification procedures before launch.
