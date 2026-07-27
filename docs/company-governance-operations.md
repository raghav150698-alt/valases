# Company governance operations

Administrator-created companies now receive both a recruiter profile and an
organization owner membership. Retention schedules and organization-wide legal
holds are maintained from **Administration > Governance**.

## Backfill existing companies

Preview companies that do not have an organization:

```powershell
.\.codex-run-venv\Scripts\python.exe scripts\backfill_company_organizations.py
```

Backfill only reviewed company IDs:

```powershell
.\.codex-run-venv\Scripts\python.exe scripts\backfill_company_organizations.py --apply --provider-id 12
```

Repeat the preview and reviewed apply command against Tokyo and Mumbai
separately. Do not use `--all-active` until legacy provider records have been
reviewed.

## Retention execution

Preview one company's eligible records:

```powershell
.\.codex-run-venv\Scripts\python.exe scripts\run_organization_retention.py --provider-id 12
```

Execute only after privacy or legal approval:

```powershell
.\.codex-run-venv\Scripts\python.exe scripts\run_organization_retention.py --provider-id 12 --execute --confirm-provider-id 12
```

Execution refuses to proceed while the organization-wide legal hold is active.
Eligible closed hiring candidates are anonymized, expired terminal assessment
invitations are anonymized, and associated submission and proctor payloads are
cleared. A minimal tenant audit event records counts without retaining deleted
content.

The existing proctor-session cleanup remains separate:

```powershell
.\.codex-run-venv\Scripts\python.exe scripts\run_proctor_retention_cleanup.py --days 30
```

Run retention from a controlled operator environment with database backups,
change approval, logs, and post-run verification. Never schedule destructive
execution until customer policy, legal holds, and regional requirements have
been reviewed.
