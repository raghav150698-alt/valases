# Production Scaling Plan

## Decision

Start with one x86 server, preferably Hetzner `CX43`:

- app/API
- Caddy reverse proxy
- local Postgres for initial launch
- light proctor AI/manual-review support

Do not buy multiple app servers before launch. Build the deployment so a second server can be added quickly.

## Capacity Guidance

One `CX43` should be treated as:

- good for product completion and launch
- likely fine for normal active users and light exams
- not a guarantee for 150 simultaneous webcam-heavy AI-proctored exams

For live exams, keep proctor AI controlled:

- log proctor events immediately
- save evidence to shared/object storage
- run heavy AI scoring after submission or in background
- do not train models on the live app server during exams

## Growth Path

1. Launch: `1x CX43`.
2. Consistent 50-100 concurrent proctored users: monitor CPU, RAM, disk IO, DB latency.
3. Approaching 150 concurrent proctored users: add load balancer and second app server.
4. Heavy AI review: add a separate worker server.
5. 300+ concurrent proctored users: multiple app servers, worker pool, managed/separate Postgres, object storage.

## Target Architecture

```text
Users
  |
  v
Load Balancer / Caddy / Hetzner LB
  |
  +--> App Server 1
  +--> App Server 2
  +--> App Server 3
          |
          v
      Shared Postgres
          |
          v
      Object Storage
```

Future AI worker:

```text
App Servers -> Queue -> AI Worker Server -> Postgres/Object Storage
```

## Requirements Before Adding More App Servers

- Postgres must be shared, not local SQLite.
- Media/evidence must be in Bunny/S3/R2/Firebase Storage, not only local disk.
- App instances must be stateless except temporary cache.
- All app servers must use the same `JWT_SECRET_KEY`.
- All app servers must have the same Firebase/object-storage credentials.
- Proctor model files must be deployed consistently or worker-only.

## Current AI Model State

The current proctor model is gaze-aware and uses `landmark_v1` features. It is useful for manual review support, not automatic punishment.

Current best model from the last local training cycle:

- model: XGBoost
- precision: about 0.9409
- recall: about 0.5627
- false positive rate: about 0.0683
- auto deduction: disabled

More self data is still needed for looking away, side glance, mobile phone, multiple person, reading aloud, and clean baseline sessions.
