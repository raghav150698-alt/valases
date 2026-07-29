-- Run once in every regional Supabase project before deploying billing code.
-- Money is stored in minor units (paise/cents); payment card data never enters Valases.

create table if not exists public.organization_billing_accounts (
  id bigserial primary key,
  organization_id bigint not null unique references public.organizations(id),
  provider varchar(30) not null default 'cashfree',
  plan_code varchar(40) not null default 'trial',
  status varchar(30) not null default 'trialing',
  currency varchar(8) not null default 'INR',
  monthly_amount_minor integer not null default 0 check (monthly_amount_minor >= 0),
  billing_email varchar(320),
  billing_phone varchar(24),
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_organization_billing_accounts_status
  on public.organization_billing_accounts (status);

create table if not exists public.billing_orders (
  id varchar(64) primary key,
  organization_id bigint not null references public.organizations(id),
  created_by_user_id bigint references public.users(id),
  provider varchar(30) not null default 'cashfree',
  provider_order_id varchar(160) unique,
  provider_payment_id varchar(160),
  receipt_number varchar(80) unique,
  plan_code varchar(40) not null,
  description varchar(240) not null,
  amount_minor integer not null check (amount_minor > 0),
  currency varchar(8) not null default 'INR',
  status varchar(30) not null default 'created',
  payment_session_id text,
  provider_payload_json jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_billing_orders_organization_created
  on public.billing_orders (organization_id, created_at desc);
create index if not exists ix_billing_orders_status
  on public.billing_orders (status);
create index if not exists ix_billing_orders_provider_payment
  on public.billing_orders (provider_payment_id);

create table if not exists public.billing_webhook_events (
  id bigserial primary key,
  provider varchar(30) not null,
  event_key varchar(180) not null unique,
  event_type varchar(100) not null,
  payload_sha256 varchar(64) not null,
  processing_status varchar(30) not null default 'received',
  error_code varchar(100),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists ix_billing_webhook_events_received
  on public.billing_webhook_events (received_at desc);
create index if not exists ix_billing_webhook_events_status
  on public.billing_webhook_events (processing_status);

alter table public.organization_billing_accounts enable row level security;
alter table public.billing_orders enable row level security;
alter table public.billing_webhook_events enable row level security;

-- The backend connection must use a role that can set app.organization_id.
drop policy if exists organization_billing_account_isolation on public.organization_billing_accounts;
create policy organization_billing_account_isolation on public.organization_billing_accounts
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::bigint)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::bigint);

drop policy if exists billing_order_isolation on public.billing_orders;
create policy billing_order_isolation on public.billing_orders
  using (organization_id = nullif(current_setting('app.organization_id', true), '')::bigint)
  with check (organization_id = nullif(current_setting('app.organization_id', true), '')::bigint);

-- Webhook events contain hashes and processing metadata only. Access remains
-- limited to the backend service role; no browser-facing policy is created.
