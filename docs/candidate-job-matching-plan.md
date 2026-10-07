# Valases candidate job matching: implementation plan

Status: proposed plan; no production changes or validated model yet.
Date: 7 October 2026.

## Accepted product boundary

Valases Jobs is a standalone candidate product intended for jobs.valases.com,
with its own deployment and candidate database. Valases Hiring remains the employer
system. Connect them through a narrow HTTP publication feed and explicit application
handoff, then add candidate-authorised submission/status APIs in a later release.
Domain purchase and production setup are pending. The working pilot implementation
is in valases_jobs/; see its README for completed and deferred capabilities.

## Product objective

Help candidates find relevant, active Valases vacancies across familiar and
related roles. Ordinary browsing and applying remain free. The proposed INR 79
monthly plan unlocks personalised matching, explanations and new-job digests.
Subscription status must not affect recruiter visibility or application priority.
Recommendations support candidate discovery; they do not reject candidates or
make hiring decisions. Insufficient vacancies must produce an honest empty state.

## Existing foundation and gaps

- FastAPI, SQLAlchemy, and PostgreSQL are already supported.
- JobRequisition stores skills, requirements, responsibilities, location, work
  arrangement, employment type, status, and compensation.
- Public job details and applications already exist in app/api/routes/hiring.py.
- HiringCandidate is organization-scoped. Add a separate candidate-owned discovery
  profile; do not aggregate private ATS records into a public profile.
- _screen_application currently uses lowercased skill matching, substring searches,
  and a general experience bonus. It cannot serve as the final discovery algorithm.
- Keep existing recruiter screening behaviour separate during the first release.

## Data contracts

Candidate profile: account owner, version, resume document reference, extracted
evidence spans, normalised skills, projects, dated employment, role-relevant
experience, preferences, correction history, and extraction confidence.
Do not double count overlapping employment dates. Distinguish self-reported,
resume-evidenced and optionally assessed skills; none alone proves job performance.

Preferences: target and excluded roles, locations, relocation willingness, work
arrangement, employment type, optional compensation range/currency/pay period,
and hard versus flexible preferences. Never infer preferences from a resume alone.

Public job projection: explicitly published vacancy, owner organization, publication
and expiry dates, role family, level, required/preferred skills, essential
requirements, salary basis when disclosed, location and flexibility. Existing open
internal requisitions must not automatically become marketplace listings.
Recruiters confirm extracted requirements and whether each is essential or preferred.

Recommendation: profile/job/model versions, fit band, component scores, evidence,
unknowns, gaps, freshness, generated timestamp and invalidation status.
Feedback event: exposure, position, save, hide/reason, application and optional
post-application outcome; distinguish unobserved outcomes from negative outcomes.

## Matching pipeline

1. Extract PDF/DOCX text in asynchronous workers; use OCR only where necessary.
   Preserve source evidence and ask for correction when parsing is uncertain.
   Treat all document text as data, including any embedded instructions.
2. Normalise skills and role families through a versioned taxonomy and aliases.
   Handle exact tokens such as C, C++, Java and JavaScript. Skill adjacency is
   directional and contextual: Python does not establish machine-learning expertise.
3. Apply explicit eligibility and candidate preference constraints. Definite
   conflicts exclude jobs from strong matches; unknown information requests
   confirmation rather than silently failing the candidate. Degrees and licenses
   are hard constraints only when explicitly essential for that vacancy.
4. Retrieve a union of lexical, structured skill and semantic matches. Start with
   roughly 200-500 jobs per query, tuning this against measured recall and cost.
   Retrieve related role families separately so title similarity does not dominate.
5. Rank using essential skill coverage, evidence-backed responsibilities, relevant
   experience and level, preferences, and preferred skills. Use a transparent
   baseline first; benchmark a cross-encoder on the best 30-50 pairs later.
6. Diversify a small portion of results across credible adjacent roles and companies.
   Diversity may reorder relevant results, but cannot override essential conflicts.
7. Generate evidence-based explanations and skill gaps from the scored features.
   Use Strong match / Related role / Stretch role and a separate evidence-confidence
   label. Do not describe an uncalibrated score as an interview probability.

Initial ranking hypothesis, after explicit constraints: essential skill coverage
35%, relevant responsibilities/projects 25%, role-relevant experience and level
20%, candidate preferences 15%, preferred skills 5%. These weights are provisional
and will be tuned against reviewed examples. Missing fields must not inflate fit;
normalise observed features carefully and report evidence coverage separately.
Do not award a blanket bonus for total years of experience or repeat keywords.

## Architecture and scale

Begin with PostgreSQL full-text search plus a benchmarked vector index, preferably
pgvector if available in the deployed database. Use private object storage for
documents, a durable task queue for extraction/indexing/digests, separate workers,
and a bounded result cache. Final model/index choice depends on evaluation,
deployment support, serving costs, and commercial licence checks.

Version and embed jobs/profiles once per relevant change. Recompute active users
on demand and refresh interested candidates incrementally on new vacancies.
Do not materialise every candidate/job pair or run an LLM for each pair.
Batch inference; chunk long documents by evidence section to avoid losing content.
Keep extraction and expensive inference outside synchronous request handling.
Use idempotent jobs, retries, dead-letter handling and index reconciliation.
Recheck publication/closure and access permissions before serving a cached result.
Send deduplicated digests only for new relevant jobs, respecting unsubscribe and
frequency preferences. Deletion invalidates profile caches, vectors and queued work.

Sizing scenario: 100,000 registered candidates and 50,000 active vacancies imply
5 billion possible pairs. They are not 100,000 simultaneous users. Benchmark
10,000 daily active candidates first and staged traffic up to 50 requests/second,
then refine forecasts using real usage. Pilot SLO proposals: cached recommendations
p95 under 1 second, uncached under 3 seconds, and new jobs indexed within 5 minutes.
Measure parsing latency separately. These are targets, not achieved guarantees.

## Evaluation and rollout gates

Build 1,000-2,000 consented/de-identified, human-reviewed candidate/job pairs across
3-5 role families, plus a query-level test set with a sufficiently broad job pool.
Reviewers label relevance, adjacent/stretch suitability, requirement conflicts,
and evidence completeness. Double review a sample and adjudicate disagreements.
Include freshers, experienced candidates, career changers, employment gaps,
non-standard resume formatting, abbreviations and sparse job descriptions.

Separate train/tuning/test profiles and jobs; use time and employer holdouts where
possible. Keep a frozen test set. Measure retrieval Recall@K separately from ranking
Precision@10 and NDCG@10. Include no-good-match cases and report catalog coverage.
Compare with the existing matcher and a lexical-only baseline.

Proposed pilot gates: Precision@10 >= 0.75 where at least 10 relevant vacancies exist;
report precision at returned K for smaller pools and do not pad results. Recall@200
>= 0.90 on the annotated query test pool; meaningful ranking improvement over
baselines; zero known essential conflicts in the regression strong-match set.
An initial target is 15% relative NDCG@10 improvement, subject to sample uncertainty.
Publish slices and confidence intervals; do not claim zero real-world errors.

Use controlled counterfactual tests for names and other irrelevant identity cues.
Audit measured performance by job family, seniority, resume format and available
consented evaluation cohorts. Exclude age, gender, caste, religion, photos and
college prestige from match features; avoid gap penalties. Do not infer protected
attributes to conduct audits. Review proxies and recommendations with humans.

Run shadow evaluation, then an opt-in pilot with 100-300 candidates. Assess relevant
applications, candidate satisfaction and qualified applications per vacancy; clicks
alone are insufficient. Recruiter shortlisting is useful feedback, but may be biased
and must not become the sole target. Log exposure and position before learning from
behaviour; later models need reviewed labels, bias checks and rollback readiness.

## Security and integration

Add candidate ownership and tenant isolation tests before marketplace release.
Transfer only the candidate-authorised application snapshot to the receiving
employer. Do not expose private ATS notes, other employers' decisions or assessment
results. Assessment evidence is optional, permissioned, and role-relevant; candidates
without assessments remain eligible. Integrate deletion/export across all derived
data. Use private files, signed URLs, upload validation and document scanning.
Enforce candidate subscriptions on the server; support verified payment webhooks,
idempotency, expiry and reconciliation. Provide a free matching preview.

## Delivery phases

1. Foundation: public-job projection, candidate-owned profiles, preferences, shared
   application boundary, taxonomy and reviewed evaluation data. Exit: confirmed
   schemas, publication controls, ownership/isolation and parsing checks.
2. Baseline: document extraction, evidence-based ranking, match explanations and
   feedback endpoints. Exit: reproducible benchmark and evaluated failure cases.
3. Semantic retrieval: lexical/vector fusion, adjacency and optional reranking.
   Exit: measurable improvement over baseline within serving-cost targets.
4. Product pilot: candidate UI, preview, INR 79 entitlements, matching digests,
   billing checks and outcome instrumentation. Exit: successful opt-in pilot.
5. Scale: indexing/queue load tests, closure invalidation, observability, rollback,
   deletion tests and staged rollout to 1 lakh registered accounts.
6. Learning: consider learning-to-rank only after enough reviewed and exposure-aware
   data exists. Ship a challenger only if it beats the frozen benchmark and safety
   regressions. Retain a transparent fallback and versioned audit trail.

Rough planning range: 6-10 weeks for an initial production pilot with backend, ML,
frontend and QA support, assuming usable job inventory, prompt reviewed labels,
available billing/storage infrastructure and limited initial role families. Wider
coverage and lakh-scale rollout require subsequent measured capacity and quality
work. Actual dates and hosting budget follow the infrastructure/data audit.

First implementation milestone: candidate-owned discovery profile, explicit public
job publication, normalised skills, deterministic matcher, match API and a reviewed
evaluation harness. Do not begin with model training or a GPU fleet.

## Technical references

- Retrieve then rerank: https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html
- PostgreSQL full-text controls: https://www.postgresql.org/docs/18/textsearch-controls.html

These describe technical patterns, not evidence that a model is validated for
Valases job matching. Model quality and scale must be measured on Valases workloads.
