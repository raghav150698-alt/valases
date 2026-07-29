# Launch security review - 2026-07-29

## Implemented and verified

- Production startup fails closed for invalid auth, host, CORS, database, and
  secret configuration.
- Supabase tokens are verified using the user endpoint or the project's signed
  JWKS, with an explicit algorithm allowlist.
- Valases JWT handling uses PyJWT with the cryptography backend; the vulnerable
  `ecdsa` dependency has been removed.
- Organization permissions protect member, SSO, organization, and billing
  administration.
- Billing prices are server-controlled, amounts use integer minor units, webhook
  signatures are verified, and duplicate payment events are idempotent.
- Database row-level security isolates billing accounts and orders by
  organization.
- CSP, HSTS, trusted-host validation, CORS allowlists, no-store responses, request
  size limits, and production feature flags remain enabled.
- No tracked environment files, database files, service keys, or payment secrets
  were found in the repository sweep.
- Frontend dependency audit: zero high and zero critical advisories.
- Backend requirements audit: no known vulnerabilities.
- Backend tests: 67 passed, 3 skipped.

## Required operator controls before a client launch

- Apply the billing migration in both regional databases.
- Complete Cashfree KYC, production credential setup, domain allowlisting, and a
  real low-value payment/refund test.
- Enable Supabase backup/PITR at the agreed retention level and complete a
  documented restore drill.
- Confirm production environment variables with
  `scripts/check_launch_readiness.py`.
- Put rate limiting behind a shared managed store before a high-volume public
  launch. The current process-local limiter is useful but cannot provide a global
  limit across Vercel function instances.
- Complete an independent penetration test before representing Valases as ready
  for a regulated enterprise deployment.
- Activate and test customer SSO/MFA enforcement when the Supabase plan and
  customer identity-provider metadata are available.

