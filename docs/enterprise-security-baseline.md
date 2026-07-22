# Valases Enterprise Security Baseline

## Readiness decision

The current build is hardened for controlled pilot testing, but it is **not yet
approved for a Deloitte-scale enterprise production rollout**. The remaining
items below are release gates, not optional enhancements.

## Controls now enforced

- Production is detected from `APP_ENV=production` or `VERCEL_ENV=production`.
- Unsafe production configuration fails startup instead of silently falling
  back to dummy auth, SQLite, wildcard hosts, weak JWT secrets, or local media.
- Production startup verifies the required schema without running DDL, seeding,
  or account rewrites. Schema changes must run as a controlled release job.
- Supabase identities must be provisioned by a Valases administrator. A token's
  user-editable metadata cannot grant an application role.
- Frozen, banned, deleted, inactive, pending, and rejected accounts remain
  blocked; startup no longer converts them back to approved.
- Legacy signup, local password auth, Firebase break-glass recovery, shared
  Graph workbooks, and API-hosted arbitrary code execution are disabled in the
  production trust boundary.
- Issued-candidate session secrets are stored as SHA-256 digests. Candidate
  submissions, proctor events, request bodies, and evidence uploads are bounded.
- Proctor evidence validates MIME type and file signature. Production upload is
  opt-in and requires private, server-side-encrypted S3 storage.
- The production proctor model is verified against its reviewed SHA-256 digest
  before `joblib` deserialization. Model promotion must update that digest in a
  reviewed release; a mismatched artifact is not loaded.
- Coding previews expire, are size-limited, are never cached, and run in a CSP
  sandbox without `allow-same-origin` or network access.
- API documentation is disabled in production. Sensitive API responses use
  `Cache-Control: no-store`; HSTS, CSP, clickjacking, MIME-sniffing, referrer,
  and permissions headers are applied.
- Browser sessions use tab-scoped session storage instead of persistent local
  storage. CORS is exact-origin and does not allow cookies or wildcard headers.
- MediaPipe and Monaco executable assets are installed from the frozen lockfile
  and served by Valases; candidate pages no longer import JavaScript from a
  public CDN at runtime.
- Direct Python dependencies are pinned, the unused vulnerable `xlsx@0.18.5`
  package is removed, and Dependabot plus PR dependency review are configured.

## Mandatory platform configuration

Set these only in the recruiter/API Vercel project's encrypted environment:

```text
APP_ENV=production
AUTH_MODE=supabase
ALLOW_SELF_SERVICE_SIGNUP=false
ENABLE_LEGACY_PASSWORD_AUTH=false
ENABLE_ADMIN_RECOVERY=false
ENABLE_SERVER_CODE_EXECUTION=false
ENABLE_SHARED_GRAPH_EXCEL=false
ENABLE_PROCTOR_EVIDENCE_UPLOAD=false
ENABLE_STARTUP_DATABASE_MANAGEMENT=false
ENFORCE_PRODUCTION_SECURITY=true
DATABASE_URL=postgresql://... (URL-encode the password)
JWT_SECRET_KEY=<at least 32 random characters>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SECRET_KEY=<server-only secret key>
ADMIN_EMAILS=admin@valases.com
CANDIDATE_APP_BASE_URL=https://valasescandidate.vercel.app
CORS_ALLOW_ORIGINS=https://valasescandidate.vercel.app
TRUSTED_HOSTS=valases.vercel.app
RATE_LIMIT_ENABLED=true
OBJECT_STORAGE_BACKEND=s3
```

Never place `SUPABASE_SECRET_KEY`, database credentials, SMTP credentials, or
storage credentials in the candidate project or in a `VITE_` variable. Rotate
all secrets after personnel changes, suspected disclosure, or an incident.

## Enterprise release gates

1. **Tenant isolation:** add an organization and membership model, tenant IDs on
   every business row, database RLS or equivalent policy enforcement, and a
   least-privilege application database role. Today tenant isolation is mainly
   enforced in FastAPI and the connection role can bypass Supabase RLS.
2. **Enterprise identity:** configure customer SSO (SAML/OIDC), mandatory MFA
   for Valases administrators, SCIM or controlled lifecycle automation, session
   revocation, and periodic access reviews.
3. **Edge abuse controls:** enable Vercel WAF distributed rate limits for auth,
   issued login, submit, and proctor endpoints. The in-process limiter is only a
   defense in depth control and is not global across serverless instances.
4. **Audit and detection:** export authentication, admin, tenant, assessment,
   and proctor events to an immutable SIEM; alert on admin changes, brute force,
   cross-tenant denials, mass exports, and unusual issue volume.
5. **Data governance:** complete a DPIA for camera/gaze/object processing,
   customer DPA, subprocessor inventory, data residency decision, legal consent
   review, deletion SLAs, and tested retention jobs. Keep raw evidence disabled
   until this is approved.
6. **Resilience:** enable Supabase PITR and SSL enforcement, restrict database
   network access where the hosting topology permits, document RPO/RTO, and run
   restore, failover, incident-response, and credential-rotation exercises.
   Replace the legacy startup schema helpers with versioned, reviewed migrations
   before the next schema change; never enable startup database management in
   production or from concurrent serverless functions.
7. **Secure SDLC:** enable GitHub secret scanning, push protection, Dependabot,
   dependency graph, dependency review, and CodeQL default setup. Require branch
   protection, reviewed pull requests, passing checks, and signed releases.
8. **Independent assurance:** complete an OWASP ASVS-based review, external
   penetration test, threat model, privacy/legal review, and remediation signoff.
   Maintain SOC 2 / ISO 27001 control evidence if enterprise procurement asks.
9. **Isolated execution:** run candidate code only in an ephemeral sandbox with
   no platform secrets, no tenant network, strict CPU/memory/process/file limits,
   and disposable storage. Do not re-enable `/tools/coding/run` on the API.

## Release verification

```powershell
.\.codex-run-venv\Scripts\python.exe -m unittest tests.api.test_security_hardening -v
cd app\web_assessment_react
node_modules\.bin\tsc.CMD -b
pnpm install --frozen-lockfile
pnpm audit --prod
```

The registry audit must run in CI or another approved environment with registry
egress. No release may proceed with unresolved critical or high vulnerabilities.
