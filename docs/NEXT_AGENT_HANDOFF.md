# Next Agent Handoff

Date: 2026-07-05

## Project

Main project path:

```text
D:\Lenovo\certora
```

Do not erase existing app files, built frontend assets, model artifacts, local datasets, or generated exports.

## What Was Added For Deployment

New deployment assets:

- `Dockerfile`
- `.dockerignore`
- `deploy/Caddyfile`
- `deploy/docker-compose.prod.yml`
- `deploy/.env.production.example`
- `deploy/README.md`
- `docs/production_scaling_plan.md`
- `docs/NEXT_AGENT_HANDOFF.md`

These are additive only. They do not replace existing app/runtime code.

## Recommended First Server

Start with one x86 `CX43` server:

- 8 vCPU
- 16 GB RAM
- 160 GB disk

Use it for product completion and initial launch. Add a second app server only after traffic is real or consistent.

## Production Shape

First launch:

```text
Caddy -> FastAPI app -> Postgres
```

Later:

```text
Load Balancer -> App Servers -> Shared Postgres/Object Storage
App Servers -> Queue -> AI Worker Server
```

## AI Model Notes

The proctor model was retrained locally before this handoff. Important files:

- `data/proctoring/models/supervised/supervised_bundle.joblib`
- `data/proctoring/models/supervised/evaluation_report.json`
- `data/proctoring/models/supervised/deduction_rules.json`
- `data/proctoring/models/mediapipe/face_landmarker.task`

The feature extractor was updated to support MediaPipe Tasks API, because the installed MediaPipe version does not expose the old `mp.solutions.face_mesh` API.

The model is `landmark_v1` and uses 22 face/gaze features. The exported bundle now contains reloadable models only:

- logistic
- xgboost

CNN is diagnostic-only in training because the app scoring path expects `predict_proba` compatible models.

Docker status:

- The production Docker image copies `data/proctoring/models` into `/app/data/proctoring/models`.
- The Docker runtime was tested and can load the proctor bundle.
- `requirements-ml.txt` is pinned to the training runtime versions:
  - `numpy==2.1.3`
  - `joblib==1.4.2`
  - `scikit-learn==1.5.2`
  - `xgboost==2.1.1`
  - `opencv-python-headless==4.10.0.84`
- Docker app status was verified healthy with `https://localhost/health`.
- Local Docker also maps `localhost:1506` to the Caddy web gateway for convenience. Caddy currently redirects HTTP on `1506` to `https://localhost`.
- Local Docker auth is currently set to `APP_ENV=development` and `AUTH_MODE=dummy` in `deploy/.env.production` because Firebase credentials are not filled yet. Test logins can use any password with valid emails such as `provider@example.com`, `student@example.com`, or `admin@example.com`.
- Frontend routes tested through Docker/Caddy:
  - `/`
  - `/assessment`
  - `/stream-player`

Custom assessment tools should be opened from the Docker-served app routes, not from desktop applications:

- Excel/spreadsheet: `/assessment?tool=excel&embedded=1`
- Coding/VS Code-style assessment: `/assessment?tool=coding&embedded=1`

The custom tool launcher in `app/web/assets/app.js` routes Excel/spreadsheet and coding/VS Code aliases to those paths. The React assessment app embeds the Excel simulator and Monaco-based coding environment from `app/web_assessment_react/src/app/App.tsx`.

Full-screen assessment/tool behavior:

- Recruiter custom tools open as server-hosted full-screen routes. Only the tool UI is visible after launch.
- Embedded Excel/coding tool routes include an `Exit Assessment Server` control. Browser security may block closing a tab that was not script-opened, so the fallback leaves the app by navigating to `about:blank`.
- Issued candidate assessments also use a full-screen fixed assessment layer. The candidate exit button is now `Exit Assessment Server`, clears local candidate assessment state, and leaves the server view.

Issued candidate link/session rules:

- Candidate assessment login is link-only. `/exams/issued/login` now rejects direct email/password login and tells the candidate to open the recruiter email link.
- Recruiter-issued links use `/?issued_key=...` and authenticate through `/exams/issued/key/{access_key}/login`.
- Issued candidate tokens now include a per-login `session_token`.
- `assessment_issues` now has `active_session_token` and `active_session_started_at` columns. On each link login, the latest session token becomes active; older browser sessions are rejected by `/exams/issued/me` and `/exams/issued/submit`.
- This gives one active candidate assessment session at a time. A refresh/re-login can continue by becoming the latest active session, while any previous open tab is invalidated.

Current model quality is not enough for automatic score deductions:

- chosen model: xgboost
- precision: about 0.9409
- recall: about 0.5627
- false positive rate: about 0.0683
- auto deduction: false

Need more self data for:

- clean normal sessions
- looking away
- side glance
- mobile phone
- multiple person
- reading aloud
- diverse lighting/background/identity

## Important Deployment Caveats

- Use Postgres in production.
- Do not use SQLite for multi-server deployment.
- Keep evidence/media in Bunny/S3/R2/Firebase Storage before adding multiple app servers.
- Keep AI review light on the first app server.
- Move heavy AI/proctor processing to a separate worker server later.
- Do not train the model on the live app server during exams.

## First Deploy Steps

On the server:

```bash
cd /opt/certora/deploy
cp .env.production.example .env.production
# fill real secrets/domain/storage/Firebase values
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Then verify:

```bash
curl https://your-domain.com/health
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
```

## Continue From Here

Next useful implementation work:

1. Add a real background queue/worker for proctor evidence scoring.
2. Add production backup scripts for Postgres.
3. Add object-storage-only media mode before multi-server traffic.
4. Add a load-test script for 50/100/150 concurrent exam users.
5. Add monitoring/alerts for CPU, RAM, disk, request latency, and failed uploads.

## 2026-07-09 Screen Gaze Update

This repo now includes a dedicated browser-usable screen-looking model trained from the self-collected gaze folders.

New files and outputs:

- `ml/proctoring/scripts/train_screen_gaze_model.py`
- `data/proctoring/models/screen_gaze/screen_gaze_bundle.joblib`
- `data/proctoring/models/screen_gaze/screen_gaze_metrics.json`
- `data/proctoring/models/screen_gaze/screen_gaze_training_rows.csv`
- `app/web/assets/generated/screen_gaze_model.json`

Frontend wiring added:

- `app/web/assets/app.js`
- `app/web/index.html`
- `app/web/assets/styles.css`

Behavior:

- Uses neutral face calibration as the per-user baseline.
- Predicts:
  - `text_area`
  - `top_left_non_text`
  - `top_center_non_text`
  - `top_right_non_text`
  - `left_non_text`
  - `right_non_text`
  - `bottom_left_non_text`
  - `bottom_center_non_text`
  - `bottom_right_non_text`
  - `away`
- Small live overlay now shows:
  - `On screen`
  - `Borderline pass`
  - `Suspect`

Latest training result from `screen_gaze_metrics.json`:

- frame validation accuracy: `0.953125`
- frame validation macro F1: `0.9465244755244756`
- screen-vs-away accuracy: `0.96875`
- holdout rows: `64`
- train rows: `256`
- source count: `31`

Important caveat:

- These numbers are frame-level, not strong cross-session validation.
- Each named screen zone currently has only one main source video.
- Good enough for live testing and tuning.
- Not enough to claim production-grade gaze accuracy across people, devices, heights, glasses, and lighting.

Training command:

```powershell
.\.venv-proctoring\Scripts\python.exe ml\proctoring\scripts\train_screen_gaze_model.py `
  --input-root data\proctoring\raw\self_collection_v1 `
  --output-dir data\proctoring\models\screen_gaze `
  --browser-model-out app\web\assets\generated\screen_gaze_model.json
```

Data guidance for the next agent:

- Do not manually mark the eyeball. This pipeline uses MediaPipe face and iris landmarks automatically.
- The best next gains will come from:
  - more `TEXT AREA` videos
  - more repeated screen-zone clips on different days
  - stronger looking-away angle variety
  - glasses and no-glasses data
  - brighter and dimmer lighting
  - slightly different laptop distances and camera heights
