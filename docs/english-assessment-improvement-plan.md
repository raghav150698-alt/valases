# English assessment improvement plan

Scope: US and UK English, across all role groups. Preserve one random recording
per attempt and the candidate's frozen questions and scoring key. No deployment
or candidate invitations are part of this implementation.

Current progress: 36 audio files are stored locally; 30 are selectable across
separate regional pools (15 US, 15 UK). Twenty-four new spontaneous excerpts and
144 matching questions were added, with six questions per excerpt. All 36 files
pass uniqueness, duration and full-decoding checks. EdAcc excerpts from the same
source WAV do not overlap. Recruiter summaries show both clip and source-session
counts, and players label mixed accents. The official EdAcc archive checksum was
verified. Independent listening review, real participant observations and live
browser/device acceptance remain open.

## 1. Content controls and recruiter visibility — implement now

- Validate recording IDs, regional tags, source credits, transcript evidence and
  matching questions. Validate stored audio duration and decoding with ffprobe.
- Display regional pool size, duration range, estimated question difficulty,
  natural versus scripted content, and calibration status in recruiter previews.
- Keep the current content usable for exploration; explicitly label it as pilot
  content. Do not describe it as calibrated or ready for large cohorts.
- Add an audit command which produces a reproducible JSON report of content gaps.
- Verify regional selection, restart, frozen resume, answer sanitisation, scoring,
  and provisioning using automated checks.

## 2. Natural recording expansion — source investigation, then content review

Target 20–30 distinct recordings per region before a large cohort rollout. This
is an editorial target, not a claim about current storage. Prefer 120–210 second
recordings with comparable speech rate and six questions: two detail, two purpose
or attitude, and two inference questions. Preserve natural turns and complete
sentences. Avoid specialist knowledge as a prerequisite for general screening.

Review regional accents using documented speaker backgrounds and listening review.
For general US/UK assessments prefer region-consistent speakers; mixed workplace
recordings must be explicitly labelled. Confirm redistribution rights, retain
attribution and transcript provenance, and write original assessment questions.
Do not activate content solely because a download or transcription succeeds.

Current inventory: 36 audio files. The regional pools contain 28 spontaneous
excerpts and 2 scripted VOA dialogues. Six mixed/unclassified AMI excerpts remain
outside regional selection. Each pool draws from four source conversations, so
additional speaker diversity and the longer-term 20–30 recordings per-region
target remain open. The new US material uses clearly labelled American-accent
and international speaker pairs; exclusive US accents have not been claimed.
The user's requested minimum of 30 selectable files is met locally.

## 3. All-role pilot and calibration — requires actual participant evidence

Recruit participants across customer support, sales, operations, finance,
engineering, administration and other role groups. Use shared general workplace
tasks. Record role group only for aggregate comparisons, not scoring adjustment.
Include a range of English proficiency and both assessment regions. Start with
20–30 participants per region for UX discovery; expand the sample before making
claims about equivalence, fairness or pass thresholds.

Capture section completion time, audio failures, microphone permission failures,
interrupted-session recovery, answer accuracy per question and recording,
candidate feedback, and reviewer agreement for writing and speaking. Remove
ambiguous items, compare recordings, and flag differences by role and proficiency.
Retain the 20/20/30/30 skill weights; do not change pass thresholds on anecdotal
feedback. Have language assessors independently review a sample of responses.

Use docs/english-pilot-observations.csv for observations and run
`python scripts/analyze_english_pilot.py docs/english-pilot-observations.csv`.
Use anonymous participant codes without names, emails or employee IDs. Log
failures as 0/1, durations in minutes and objective skill scores as percentages.
Record failed attempts too; document why any observation is excluded. The command
groups descriptive results by region, role group and recording and never changes
thresholds or claims calibration. The template currently has zero participants.

## 4. Live candidate acceptance — before production rollout

Run real issued sessions with invitation sign-in and configured backend/storage:
headphone output, microphone allow/deny, recording upload failure and retry,
audio loading failure, interrupted session/resume, expiry, submission, and
recruiter review. Test desktop Chrome/Edge and a narrow viewport. Confirm no
answer keys or full bank reach candidate responses. Observe rather than assume
the once-only playback and recording rules under interruption.

The invitation-free preview and automated checks do not establish live media,
proctoring or browser-device reliability. Browser validation is currently
restricted in this session. Record remaining checks explicitly.

## Completion criteria

Content audit has no structural or media errors. Recruiters can inspect pool
limitations before issuing. Natural regional pools meet the editorial target,
with reviewed questions. The all-role pilot produces reviewed evidence and
documented revisions. Live acceptance checks pass before deployment.
