# Cashfree billing launch runbook

Valases uses Cashfree Hosted Checkout. Card, bank, and UPI credentials are entered
on Cashfree's checkout; Valases does not collect or store payment-instrument data.
Prices are selected on the server, payment state is verified server-to-server, and
signed webhooks are processed idempotently.

## 1. Apply the schema

Run `docs/sql/20260729_organization_billing.sql` in the Supabase SQL Editor for
both the Tokyo and Mumbai projects. Run it once per project before deploying the
backend that contains this change.

## 2. Create the merchant account

Complete Cashfree merchant onboarding and KYC. Use sandbox credentials first.
After Cashfree activates production payments, obtain the production App ID and
secret from the Cashfree merchant dashboard.

Do not put either credential in a `VITE_` variable or in the candidate Vercel
projects. They are server-only secrets.

## 3. Configure each recruiter backend

Set these on the `valases` and `valases_mumbai` Vercel projects:

```text
BILLING_PROVIDER=cashfree
BILLING_PLAN_CATALOG_JSON={"launch":{"name":"Launch","monthly_amount_minor":99900,"currency":"INR","description":"Core hiring workspace with usage-based assessments"},"growth":{"name":"Growth","monthly_amount_minor":499900,"currency":"INR","description":"Expanded team access, reporting, and integrations"}}
BILLING_RETURN_URL=https://<regional-recruiter-domain>/assessment/
CASHFREE_APP_ID=<server-only-app-id>
CASHFREE_SECRET_KEY=<server-only-secret>
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_API_VERSION=2025-01-01
```

The amount is expressed in minor units: `99900` is INR 999.00. Change the plan
catalog before launch if commercial pricing changes.

For production, change `CASHFREE_ENVIRONMENT` to `production`. Production
security intentionally blocks a Cashfree-enabled deployment that still says
`sandbox`.

## 4. Configure domains and webhooks

Whitelist both recruiter domains in Cashfree. The backend supplies this payment
notification URL for every order:

```text
https://<regional-backend-domain>/billing/webhooks/cashfree
```

Enable payment success, payment failed, and user-dropped events in the Cashfree
dashboard. Configure both Tokyo and Mumbai backend URLs if the merchant dashboard
requires an explicit webhook allowlist.

## 5. Test before production

1. Sign in as an organization owner.
2. Open Settings, then Billing.
3. Start a sandbox checkout and complete a Cashfree test payment.
4. Confirm that the organization becomes active and the order shows paid.
5. Open the receipt from the payment history.
6. Refresh and replay the webhook from Cashfree; the billing period must not
   extend a second time.
7. Test a failed payment and confirm that access is not activated.
8. Switch to production credentials and environment, redeploy, and repeat with a
   low-value real transaction followed by a refund from the Cashfree dashboard.

## Operational notes

- Only organization owners and users with `billing.manage` can start or inspect
  billing.
- The browser never determines the amount or marks an order paid.
- Webhook signatures are verified against the unmodified request body.
- Only a signed or server-fetched paid state activates a plan.
- Raw webhook payloads are not retained; Valases stores a SHA-256 digest and
  minimal transaction references for audit and reconciliation.
- Current checkout renewals are organization-initiated monthly payments. Cashfree
  Subscription/AutoPay mandates should be enabled as a separate rollout after the
  merchant account is approved and mandate terms are finalized.

