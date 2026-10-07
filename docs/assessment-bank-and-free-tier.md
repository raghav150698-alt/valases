# Assessment banks and free entry tier — 7 October 2026

The local catalog contains 30 original advanced cases each for individual 1040,
corporate 1120, Accounting, Coding and Excel. Both MCQ templates contain 30
questions. English has two regional templates and 30 selectable recordings,
15 US and 15 UK; six other stored recordings are excluded from selection.

English assigns one recording from the chosen regional pool. Practical tools
assign one complete case, including evidence, workpaper, expected values and
rubric. The first candidate login freezes the selected task and answer key in
the issue record. Resuming and reviewer scoring use that snapshot even if the
catalog changes. Recruiter previews select locally and restart with another
case, without consuming allowances or issuing invitations.

Tax cases use 2025 federal rules and explicitly stated scope. Each requires
source-document interpretation, multi-step calculations, supported diagnostics
and a reviewer handoff. They are original hiring exercises referencing IRS
instructions, not official IRS/EA examination questions or complete filings
covering every schedule. Independent EA/CPA review of facts, answer keys,
rounding, difficulty and legal updates remains pending. The 1040 cases exclude
NIIT, AMT and additional Medicare tax, while testing self-employment tax, QBI,
passive losses, capital losses and itemization. Corporate cases cover M-1,
charitable limits, capital losses, DRD, post-2017 NOL and section 382 limits.

Coding has 30 distinct problem contracts and requires behavioral manual review.
An isolated execution service and independently validated hidden tests remain
necessary before advertising automatic coding correctness. Excel has 30 varied
datasets for the existing 24-output FP&A model; these are dataset variants,
not 30 separate model designs. Accounting has 30 close-case variants using
linked evidence and nine reconciled outputs. Final decisions remain human reviewed.

## Free allowance contract

- Five unique candidates **assessed** per organization per UTC calendar month.
  A candidate is identified by normalized email; multiple assessments for the
  same person count as one candidate. This is the working interpretation of
  “five candidates hiring per month,” not a limit on hires or contacts imported.
- Five English attempts and ten MCQ attempts per month. The ten MCQs allow
  multiple assessments for the same candidate within the five-candidate cap.
- Issuing an invitation reserves allowance. A live invitation resend consumes
  no additional attempt. Revoked or expired invitations release their reservation
  only before start. Reviving a released invitation checks the cap again.
- No rollover. Recruiter trials are unmetered. Team members share the allowance.
- Tax, Accounting, Coding and Excel require an active paid billing period and
  separately activated Assess terms. Enforcement is on the server issuance route,
  including organization row locking on PostgreSQL, not only hidden UI controls.

Paid website prices in `valases_website/pricing.html` are preserved: Hire Core
$149/month and Hire Growth $349/month; annual introductory pricing remains
$99 then $119 for Core and $249 then $299 for Growth, with a 12-month commitment.
The existing first-month 30-attempt paid offer still requires an agreed format
allocation. Backend default monthly catalog now matches those USD monthly
prices. Existing environment overrides and contracts are not rewritten. Annual
contract checkout, paid format metering/rate cards and the negotiated launch
allowance are not implemented by the free quota service.

Admin-only `PUT /billing/organizations/{id}/assess-activation` records activation
and its reason in an audit event. It does not itself create a paid subscription.
`GET /billing/organization/allowance` exposes totals and remaining allowance,
never candidate emails. Ordinary recruiters can see their organization’s usage.

## Employer self setup and business verification

The user explicitly approved confirmed company-domain email self setup after
automatic review initially blocked changing provision-only access. Supabase
signup and server-side provisioning are now implemented, enabled through
`ALLOW_EMPLOYER_SELF_SERVICE_SIGNUP`. Legacy signup remains disabled. Existing
pending approvals and banned accounts are not automatically approved. Enable
Supabase email confirmation and its allowed redirect URL in the auth project's
configuration before staging acceptance; no auth-provider setting was changed.

Onboarding verifies work-mailbox control through Supabase’s server
user response (`email_confirmed_at`), never user-editable metadata. New verified
employers get only the limited free tier; neither an email domain nor an
MX record proves incorporation or ownership. Do not automatically join users
to an existing organization based on matching domain. Keep bans, inactive
accounts, roles and existing organization approvals intact. Personal-email and
non-GST businesses need an explicit alternate/manual route.

Cashfree’s [GSTIN verification API](https://www.cashfree.com/docs/api-reference/vrs/v2/gstin/verify-gstin)
can return legal/trade names, registration status and address. The documented
request is `POST /verification/gstin` with `GSTIN` and `business_name`, using
server-side `x-client-id` / `x-client-secret`. Obtain Secure ID/verification
credentials and pricing separately from the payment gateway. Require a valid,
active registration and compare business identity; a valid GSTIN still does
not prove the requester controls that business. Show distinct mailbox-control
and registry-verification statuses rather than a single misleading badge.
No paid lookup, real business verification or external account purchase was
performed. Existing generic verification configuration is not a plug-and-play
Cashfree adapter. Format-only and skipped checks must not become verified badges.

Recommended later rollout: keep confirmed domain email sufficient for the free
tier, then request registry verification when the employer upgrades or requests
a verified-business badge. Use GSTIN for GST-registered Indian businesses,
CIN/MCA records for incorporated companies, and Udyam or a reviewed registration
document where applicable. Cashfree documents [Udyam verification](https://www.cashfree.com/docs/api-reference/vrs/v2/udyam/verify-udyam)
and [CIN/GST KYB services](https://www.cashfree.com/kyb-solutions/); verify current
coverage and pricing before integrating. International businesses need their
country's registry or manual document review. Add a separate proof-of-control
step such as domain DNS verification or reviewed authority documents before
asserting organizational ownership. Do not make GST mandatory for every employer.

## Local validation and remaining launch checks

The regression suite checks all bank counts, selection coverage, frozen scoring
keys, hidden candidate answer keys, full-score workpapers, blank answers,
spreadsheet formula results, monthly caps, organization isolation, expiry and
resend behavior. Local demo tests cover all tool previews and mutation blocking.
TypeScript and production builds must pass for both recruiter and candidate.

Two existing Greenhouse tests still fail because the live integration catalog
supports calendar providers only. Browser/device staging acceptance, delivery,
business registry integration, subject-expert validation and paid Assess
commercial enforcement remain launch work. Nothing was deployed by this change.

Validation completed: 44 targeted Python tests passed, 11 local demo regressions
passed, and all 720 Excel outputs evaluated through HyperFormula matched their
keys. TypeScript and recruiter/candidate production builds passed. The new
employer test provisions a confirmed work-email account, issues two MCQs to the
same candidate with delivery disabled, and verifies Tax issuance is rejected.
Website HTML and JSON-LD parse; all six public paid rates remain intact.
