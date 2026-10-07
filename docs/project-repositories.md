# Product repositories

Each product is published independently:

- Hiring Tool: https://github.com/raghav150698-alt/valases
- Website: https://github.com/raghav150698-alt/valases_website
- Job Portal: https://github.com/raghav150698-alt/valases-job-portal

The Hiring Tool repository owns recruiter-side job publication, bridge APIs,
recruiter database migrations and their tests. The Job Portal repository owns
candidate accounts, public browsing, matching, payments, email workers and its
separate database. Communication uses the authenticated bridge API; the portal
imports no Hiring Tool application code.

Clone the Job Portal separately. Its repository contains the `valases_jobs`
Python package, a root Dockerfile, requirements, deployment instructions and
local preview script. Run commands from that repository root.

The local `valases_jobs/` and `valases_website/` folders are excluded from Hiring
Tool commits. Local credentials, databases, dependency folders, build output and
large training checkpoints are excluded from publication.
