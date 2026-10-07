# Valases Production Deployment

This folder prepares the app for one-server launch and later horizontal scaling.

## First server

Recommended first machine: Hetzner `CX43` or equivalent x86 server.

Install Docker and Docker Compose, then from this folder:

```bash
cp .env.production.example .env.production
# edit .env.production with real domain, secrets, Firebase, Bunny/S3, SMTP
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

For an existing database, apply the product-event outbox migration before restarting the API (run from the `deploy` directory):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../app/db/migrations/20260901_product_event_outbox.sql
```

Caddy terminates HTTPS and routes traffic to the FastAPI app. Postgres remains the transactional source of truth. Redis 8 provides shared rate limiting across app replicas, while ClickHouse stores privacy-minimized request analytics with automatic 90-day retention.

Redis and ClickHouse are private Docker-network services; their ports are not published to the internet. Generate separate strong passwords for `REDIS_PASSWORD` and `CLICKHOUSE_PASSWORD`. The API fails open to its local limiter if Redis is unavailable, and ClickHouse ingestion is buffered in a bounded queue so analytics cannot interrupt an assessment.

The `product-event-worker` relays lifecycle events using a transactional Postgres outbox and Redis Streams, then acknowledges them only after ClickHouse accepts the batch. Identifiers are HMAC-pseudonymized before ClickHouse ingestion and event properties reject names, emails, tokens, answers, URLs, recordings, and other content fields. Set `ANALYTICS_ID_HASH_KEY` to a separate 64-character secret when available; the worker otherwise uses the existing JWT signing secret.

Useful checks:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
curl https://your-domain.com/health
```

The health response includes `redis` and `clickhouse` dependency states. To verify analytics after generating a few API requests:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec clickhouse clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT count() FROM valases_analytics.request_events"
```

For local development only, expose Redis and ClickHouse on loopback by adding the override file. Neither port becomes reachable from another machine:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.local-infra.yml up -d redis clickhouse
```

## Desktop tool test: GnuCash

The repo includes a local-only Linux desktop accounting tool for assessment testing:

- service: `gnucash-desktop`
- local URL: `http://127.0.0.1:16080/vnc.html?autoconnect=1&resize=remote&path=websockify`

This runs a real desktop application in its own container and streams it into the browser through noVNC.

Start it only when you want to review the desktop tool:

```bash
docker compose --profile desktop-tools --env-file .env.production -f docker-compose.prod.yml up -d --build gnucash-desktop
```

Security notes for this proof-of-concept:

- the desktop app runs in a separate container
- the browser endpoint binds only to `127.0.0.1`
- it is not exposed through Caddy or the public app domain
- the container is disposable and intended for local review sessions

Before public candidate use, add session-bound access control and a dedicated remote-session gateway.

## Scaling later

### Hiring automation worker

The production compose file includes a separate `hiring-automation-worker` service. It runs the persisted hiring reminder sweep every 15 minutes and can be replaced by Cloud Scheduler, ECS scheduled tasks, Kubernetes CronJobs, or another managed scheduler. It requires at least one active admin service user because the sweep uses the same organization permission boundary as the admin “Run now” action.

The worker only sends assessment-expiry, interview, and onboarding-manager reminders. It never changes candidate stages or makes hiring decisions. Delivery keys are stored in Postgres, so restarting the worker does not resend an already-recorded reminder.

When traffic grows, keep the same public domain and put multiple app servers behind a load balancer:

```text
Users -> Load Balancer -> App Server 1
                       -> App Server 2
                       -> App Server 3
```

All app servers must share:

- one Postgres database
- one object storage bucket/zone for proctor evidence and media
- the same environment secrets
- the same proctor model bundle under `data/proctoring/models`

Do not store production media only on a single app server once multiple servers are active.

## AI/proctor model

The image includes the current proctor model files and ML dependencies. For launch, keep `ENABLE_AI_REVIEW=false` or use only light/manual-review AI flows. Move heavy image/video scoring to a separate worker server when proctored concurrency grows.
