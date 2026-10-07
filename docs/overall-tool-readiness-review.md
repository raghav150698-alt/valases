# Overall tool readiness review — 7 October 2026

The local demo is suitable for product exploration. This review does not confirm
production readiness or replace live browser and deployment acceptance testing.

Subsequent implementation is recorded in [Assessment banks and free entry tier](assessment-bank-and-free-tier.md).
There are now 30 cases per practical format, versioned source packs and frozen
attempt keys, plus server-enforced free allowances and user-approved confirmed
work-email self setup. New Coding cases require behavioral manual review and
do not award points for keywords. These changes resolve the single-case and
embedded-evidence findings below for the new catalog; the earlier findings are
retained as review history. Independent content calibration, isolated coding
execution, business registry integration and staging acceptance remain open.

Subsequent implementation is recorded in [Assessment banks and free entry tier](assessment-bank-and-free-tier.md).
There are now 30 cases per practical format, versioned source packs and frozen
attempt keys, plus server-enforced free allowances and user-approved confirmed
work-email self setup. New Coding cases require behavioral manual review and
do not award points for keywords. These changes resolve the single-case and
embedded-evidence findings below for the new catalog; the earlier findings are
retained as review history. Independent content calibration, isolated coding
execution, business registry integration and staging acceptance remain open.

## Completed in this review

- Restored Accounting, Coding, 1040 Individual Tax and 1120 Corporate Tax in the
  local demo catalog. Replaced the Excel placeholder with its full catalog task.
- Added **Open tool** to practical assessment rows and detail dialogs in the
  recruiter workspace. Trials use the existing workbenches, capture submissions
  locally, show the reviewer reference after submission, and support restart.
- Seeded the coding editor with the selected task instead of generic starter
  files. The offline demo explicitly disables code execution; it never falls
  through to a live backend or fabricates output.
- Added English and MCQ to the tool filter alongside practical tools.
- Aligned demo integrations with the current calendar-only API catalog, removing
  sample cards for unavailable LinkedIn and Teams connections.
- Added a fixture synchronization command and regression coverage for every
  practical tool, full task metadata, scoring checkpoints and library details.

Demo route: `/assessment/?ui-preview=1` on a local development server. Open
**Assessments**, choose **All tools**, then **Open tool**. Practice work is
discarded when the trial closes or restarts. The demo blocks server mutations.

Refresh practical fixtures after catalog changes:

```powershell
.venv-proctoring/Scripts/python.exe -m scripts.sync_tool_preview_fixtures
```

## Priorities before a broad rollout

| Priority | Finding and evidence | Improvement / acceptance condition |
| --- | --- | --- |
| High | Coding's default rubric uses regex/keyword checkpoints and requires manual review (`default_assessments.py`, `_score_task_submission` in `exams.py`). The issued candidate UI still uses a code textarea, while the separate CodingEnv has an IDE. Production intentionally blocks API-process execution. | Use one candidate coding workspace and a separately isolated execution service with behavioral tests, resource limits and per-attempt files. Verify correct solutions pass and keyword-only incorrect solutions fail. Retain reviewer control. |
| High | Tax and Accounting evidence documents/messages and several case amounts are embedded in their workbench components. Case metadata changes do not replace the full evidence pack. | Version the entire case together: documents, messages, transactions, task, expected values and rubric. Validate their consistency before publication and freeze the version per attempt. Add multiple cases and verify custom tasks never show default-case evidence. |
| High | Local preview excludes invitation authentication, enforced fullscreen, camera proctoring and real delivery. Its successful build cannot prove these flows on deployed browsers. | Complete staging acceptance for invite → login → autosave → refresh/reconnect → submit → review, across every assessment format. Include permission denial, timer expiry, duplicate submit, browser refresh and failed upload. Confirm tenant boundaries and delivery with controlled test accounts. |
| Medium | English has 30 selectable clips, but regional pools draw from four source conversations each and difficulty is not calibrated. Practical defaults also provide one case per format. | Expand distinct speakers and practical case variants; run role-wide pilots and subject-expert reviews of task ambiguity, completion time and scoring consistency. Keep difficulty labels provisional. |
| Medium | Accounting's transaction status and register-period selectors are presently display-only. The register uses fixed case data. | Connect every visible filter to the displayed rows, or remove unavailable choices. Test status/search combinations and ledger/register consistency after edits. |
| Medium | Billing, email, calendar, private media storage and automations depend on deployment configuration and external services. Local fixture tests do not establish their operational readiness. | Verify staging configuration, controlled deliveries, payment webhooks, access-limited media, retry behavior and monitoring. Record actual outcomes rather than treating sample screens as integration evidence. |
| High | Two existing hiring regressions still expect Greenhouse ATS support. The current integration catalog contains no ATS provider, so the retained ATS import endpoint rejects those requests with 422. | Decide whether ATS import is supported product scope. Restore a verified provider integration if it is, or retire the unavailable flow and update its contract tests if it is not. Do not advertise ATS import as working in the meantime. |

## Verification boundary

TypeScript and the local production bundle passed. All 10 demo regression checks
passed, including a new check covering all five practical formats. The broader
assessment workflow, invitation lifecycle, integrity scoring, shared catalog,
hiring, security and billing regression run completed with **38 of 40 passing**.
Both errors were in `tests.api.test_hiring_workspace`, where Greenhouse requests
are rejected by the current integration catalog. Those results prevent an
unqualified "all good to go" recommendation.

No deployment, real invitations, offers or payments were performed. Live
interaction and device acceptance remain unverified.
