# Hiring Model Preparation

Valases does not currently train or deploy a model that makes hiring decisions.
The live product uses transparent, deterministic evidence matching and requires
human review for every screening result.

If Valases later evaluates a decision-support model, start with a lawfully
collected and human-reviewed dataset. Never include raw resumes, email
addresses, phone numbers, names, protected-class data, or automatic hiring
outcomes as labels without legal, privacy, and fairness review.

## Input contract

Prepare a UTF-8 CSV with these columns:

```text
job_family,required_skills,candidate_skills,resume_summary,human_review_label
```

`human_review_label` must be one of `strong_match`, `review`, or `not_enough_evidence`.
The script refuses other labels and removes direct-identifier columns when they
are present.

## Run

```powershell
.\.codex-run-venv\Scripts\python.exe ml\hiring\scripts\prepare_review_dataset.py `
  --input .\data\hiring\reviewed-export.csv `
  --output .\data\hiring\prepared-review-dataset.csv
```

The output is an auditable preparation artifact, not a trained model. Store the
source export outside Git and retain the review, consent, and dataset approval
records with it.
