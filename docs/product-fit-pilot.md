# Product-fit workflow pilot

This runner creates deterministic synthetic hiring data through the same HTTP APIs used by the Valases web application. It is resumable and deliberately separates safe data generation from assessment invitations.

It measures API workflow capacity, organization permissions, validation, latency, error rates, and whether the application can hold 100 candidates per employer. It does **not** replace real-user usability testing, browser/media testing, assessment validation, email deliverability testing, or product-market-fit interviews.

## What the phases do

| Phase | Effect |
| --- | --- |
| `plan` | Reads configuration and prints the maximum work. No network calls. |
| `preflight` | Verifies login, organization permissions, and available published assessments. |
| `seed` | Creates or reuses one pilot job, candidates, and applications. No assessment invitations. |
| `screen` | Runs governed screening for the seeded applications. |
| `safe` | Runs preflight, seed, and screen in one resumable command. Recommended first run. |
| `verify` | Reads current workspace state and writes a fresh report. |
| `assessments` | Issues a strictly capped canary set. This can send email and must be explicitly confirmed. |

The script never deletes data, releases offers, sends rejection messages, or creates 300 assessment attempts automatically.

## Prepare the three accounts

1. Create and approve three employer accounts in the target Valases environment.
2. Confirm that each account opens a separate organization and can create jobs, candidates, applications, and assessments.
3. Copy `scripts/product_fit_pilot.example.json` to a local file such as `scripts/product_fit_pilot.local.json`.
4. Keep the default `pilot.valases.com` candidate domain for the safe phase. The pilot runner never sends candidate email during the safe phase. Change it to a controlled inbox domain only when deliberately testing delivery.
5. Set either a token or the email/password variables for every employer. Tokens take precedence.

PowerShell example:

```powershell
$env:VALASES_PILOT_EMPLOYER_1_EMAIL = "pilot1@yourcompany.com"
$env:VALASES_PILOT_EMPLOYER_1_PASSWORD = "use-your-real-password"
$env:VALASES_PILOT_EMPLOYER_2_EMAIL = "pilot2@yourcompany.com"
$env:VALASES_PILOT_EMPLOYER_2_PASSWORD = "use-your-real-password"
$env:VALASES_PILOT_EMPLOYER_3_EMAIL = "pilot3@yourcompany.com"
$env:VALASES_PILOT_EMPLOYER_3_PASSWORD = "use-your-real-password"
```

Do not put passwords or bearer tokens in the JSON file or commit them to Git.

## Run safely

Preview the exact scope:

```powershell
python scripts/run_product_fit_pilot.py --config scripts/product_fit_pilot.local.json --phase plan
```

Create and screen 100 candidates for each of the three employers:

```powershell
python scripts/run_product_fit_pilot.py --config scripts/product_fit_pilot.local.json --phase safe
```

The default throttle is two requests per second. A complete new run makes roughly 900 write requests plus reads, so it can take several minutes. The terminal can remain open; progress and checkpoints are saved after every candidate. If the command is interrupted, run the same command again. Existing pilot jobs, candidates, and applications are reused.

Results are written under `.pilot-runs/`, which is ignored by Git:

- `<run-id>.state.json` contains resumable IDs and, after assessment invitations, temporary candidate credentials.
- `<run-id>.safe.report.json` contains totals, errors, success rate, and p50/p95/max API latency.
- `<run-id>.trace.jsonl` contains one append-only record per API operation, including employer key, deterministic `X-Request-ID`, status, latency, and a bounded error response. Use the request ID to correlate a failed candidate operation with API logs and audit records.

Each candidate also has a durable entry in the state file with its candidate ID, application ID, screening status, assessment issue ID when applicable, and the last error. No passwords or bearer tokens are written by the safe phase.

## Run a small assessment canary

Add the intended published assessment IDs to each employer's `assessment_ids` array in the local configuration. The runner rotates candidates across those assessments and records the selected assessment ID with every invitation.

Start with one candidate per employer. The confirmation must equal the exact maximum number of invitations:

```powershell
python scripts/run_product_fit_pilot.py `
  --config scripts/product_fit_pilot.local.json `
  --phase assessments `
  --assessment-invites-per-employer 1 `
  --confirm-assessment-invites 3
```

Or use the guarded PowerShell wrapper, which prompts for all three passwords and requires the same explicit invitation confirmation:

```powershell
.\scripts\start_300_candidate_pilot.ps1 -Phase Assessments -AssessmentInvitesPerEmployer 1
```

Inspect the three candidate links, email-delivery results, candidate UI, camera/microphone permissions, recording, submission, recruiter report, flagged clips, and source-recording deletion manually. Increase the canary only after those checks pass—for example, three per employer requires `--confirm-assessment-invites 9`.

## Reading the result

Treat these as failures requiring investigation:

- Any employer has fewer than 100 candidate or application records.
- Any candidate record has an `error` value.
- API success is below 99% in a controlled environment.
- p95 latency is consistently above two seconds for list or write endpoints.
- Re-running the same phase creates duplicates.
- One employer can see another employer's pilot records.

Synthetic success proves the workflow and load shape are viable. Product fit must still be tested with employers and candidates completing the UI without assistance and deciding whether they would continue or pay.

## Concurrent assessment and flagged-media load

After the guarded assessment phase has prepared the candidate invitations, run the resumable lifecycle test:

```powershell
.\scripts\start_assessment_load_test.ps1 `
  -CandidatesPerEmployer 100 `
  -Concurrency 60 `
  -Autosaves 2 `
  -FlagPercent 10 `
  -UploadFlagClips `
  -ClipKilobytes 256
```

The runner logs in through the candidate endpoint, loads the assessment, records consent, autosaves, emits a governed proctor signal for the configured percentage, uploads one six-second synthetic camera clip and one six-second synthetic screen clip for each flagged session, and submits. It never uploads full-session recordings and does not call AI grading. Progress is printed every five percent, and the report distinguishes clip uploads from full-session uploads.

The synthetic bytes measure API and storage throughput; a browser canary is still required to confirm that MediaRecorder output can be decoded and played by the recruiter UI. Successful issue submissions are retained in the trace and skipped when the command is resumed.

For a fresh guarded 30-candidate media canary that prepares, issues, uploads and submits in one resumable flow, run:

```powershell
.\scripts\start_flagged_media_canary.ps1
```

Confirm with `MEDIA 30` when prompted. The script uses a separate run ID and does not alter the completed 300-candidate pilot state.
