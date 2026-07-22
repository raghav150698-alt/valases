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

Caddy terminates HTTPS and routes traffic to the FastAPI app. Postgres runs as a local service for the first launch. Redis is included for future queues/rate-limit/session work.

Useful checks:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
curl https://your-domain.com/health
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
