# Outreach agents

These backend routes are protected by the existing Valases administrator login. They do not change the public Valases website.

## Configuration

Set these Vercel environment variables:

- `OUTREACH_OPENAI_API_KEY` and `OUTREACH_OPENAI_MODEL` for public-web lead research.
- Existing `SMTP_*` values for outbound email.
- `OUTREACH_MAILING_ADDRESS`, required before sending.
- `OUTREACH_ALERT_EMAIL` for owner escalations.
- `OUTREACH_ENABLED=false` initially, then `true` after you have reviewed the first campaign.
- `CRON_SECRET` for the Vercel scheduled send job.
- `OUTREACH_WEBHOOK_SECRET` for your inbound-email provider's webhook.
- Optional `OUTREACH_BOOKING_URL` for a scheduling link.

Run `docs/outreach-agents-migration.sql` once against the production PostgreSQL database before deploying the routes.

## Workflow

1. As an existing Valases admin, call `POST /api/admin/outreach/research/cpa-tax`.
2. Inspect `GET /api/admin/outreach/leads`; each record includes its public hiring evidence and source URL.
3. Approve an individual lead using `POST /api/admin/outreach/leads/{id}/approve`. This queues its personalized Valases email.
4. The Vercel cron invokes `GET /api/admin/outreach/cron/send` daily. It sends only approved, queued emails and respects the daily cap.
5. Forward inbound email events to `POST /api/admin/outreach/inbound` using `Authorization: Bearer OUTREACH_WEBHOOK_SECRET`. Declines and opt-outs suppress the lead; pricing, security, contracts, and meeting requests send an owner alert.
