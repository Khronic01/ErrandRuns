-- Errand Runs Lagos: core schema (PRD v1, "Platform design")
-- Money is stored in kobo (bigint). ₦1 = 100 kobo, matching Paystack.
-- Domains: orders, pricing, dispatch, tracking, payments & payouts,
-- runners, zones, notifications (later), audit.

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Internal helpers live in "app", which is never exposed through the API.
create schema if not exists app;

-- ---------------------------------------------------------------- enums
create type public.product as enum ('run', 'send');

create type public.task_type as enum (
  'buy_and_bring', 'collect', 'drop_and_submit', 'queue_and_wait', 'multi_stop',
  'send'  -- Send (A-to-B delivery) uses this single task type
);

create type public.job_status as enum (
  'quoted', 'paid', 'assigned', 'picked_up', 'on_the_way', 'completed',
  'needs_ops', 'customer_approval',          -- holding states
  'cancelled', 'failed'                      -- terminal exceptions
);

create type public.failure_reason as enum (
  'customer_unreachable', 'wrong_address', 'item_unavailable',
  'runner_issue', 'safety_issue', 'other'
);

create type public.item_size as enum ('envelope', 'small_bag', 'medium_box');
create type public.runner_status as enum ('applied', 'in_review', 'verified', 'suspended', 'rejected');
create type public.vehicle as enum ('bike', 'foot');
create type public.staff_role as enum ('agent', 'ops_lead', 'finance', 'admin');
create type public.actor_role as enum ('customer', 'runner', 'ops', 'system');
create type public.change_kind as enum ('substitution', 'extra_stop', 'extra_wait', 'budget_topup');
create type public.change_status as enum ('pending', 'approved', 'declined', 'withdrawn');
create type public.proof_kind as enum ('photo', 'receipt', 'stamped_copy', 'timestamped_photo');
create type public.offer_response as enum ('pending', 'accepted', 'declined', 'expired', 'withdrawn');
create type public.price_table_status as enum ('draft', 'active', 'retired');
create type public.payment_kind as enum ('charge', 'topup', 'refund');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'amount_mismatch');
create type public.transfer_status as enum ('pending', 'sent', 'failed', 'reconciled');

-- ---------------------------------------------------------------- people
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  phone       text not null unique,
  full_name   text,
  email       text,
  created_at  timestamptz not null default now()
);

create table public.staff (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        public.staff_role not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.runners (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  full_name         text not null,
  phone             text not null unique,
  vehicle           public.vehicle not null default 'bike',
  plate             text,
  home_address      text,
  photo_path        text,          -- storage: runner-docs
  id_doc_type       text,          -- NIN slip or other accepted ID
  id_doc_path       text,
  selfie_path       text,
  guarantor         jsonb not null default '{}'::jsonb,  -- name, phone, id_doc_path, contacted_at
  bank              jsonb not null default '{}'::jsonb,  -- bank_code, account_name, paystack recipient code
  status            public.runner_status not null default 'applied',
  status_note       text,
  online            boolean not null default false,
  last_seen_at      timestamptz,
  current_location  extensions.geography(point, 4326),
  verified_at       timestamptz,
  verified_by       uuid references auth.users (id),
  created_at        timestamptz not null default now()
);
create index runners_location_idx on public.runners using gist (current_location);

-- ---------------------------------------------------------------- zones
create table public.zones (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  area        extensions.geography(multipolygon, 4326) not null,
  active      boolean not null default false,  -- switching a zone on is an ops action
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index zones_area_idx on public.zones using gist (area);

create table public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  name        text,
  reason      text not null check (reason in ('outside_zone', 'companion', 'other')),
  location    extensions.geography(point, 4326),
  note        text,
  created_at  timestamptz not null default now()
);

create table public.prohibited_items (
  id          uuid primary key default gen_random_uuid(),
  term        text not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- pricing (versioned)
create table public.price_tables (
  id                      uuid primary key default gen_random_uuid(),
  version                 int not null unique,
  status                  public.price_table_status not null default 'draft',
  note                    text,
  -- customer-facing add-ons
  stop_fee_kobo           bigint not null default 0,
  peak_surcharge_kobo     bigint not null default 0,
  peak_windows            jsonb not null default '[]'::jsonb,  -- [{"dow":[1,2,3,4,5],"start":"07:00","end":"10:00"}]
  free_wait_minutes       int not null default 10,
  wait_fee_per_10min_kobo bigint not null default 0,
  round_to_kobo           bigint not null default 5000,       -- prices rounded up to ₦50
  promise_window_minutes  int not null default 120,           -- quoted delivery window from payment
  -- cost side (never shown to customers)
  runner_share            numeric(5,4) not null default 0.55,
  payment_fee_rate        numeric(6,5) not null default 0.015,
  payment_fee_flat_kobo   bigint not null default 10000,      -- ₦100
  payment_fee_flat_from_kobo bigint not null default 250000,  -- flat fee applies from ₦2,500
  payment_fee_cap_kobo    bigint not null default 200000,     -- ₦2,000
  ops_cost_per_job_kobo   bigint not null default 40000,
  contingency_rate        numeric(5,4) not null default 0.05,
  margin_floor            numeric(5,4) not null default 0.20,
  -- policy
  cancel_fee_rate         numeric(5,4) not null default 0.30,
  item_value_cap_kobo     bigint not null default 10000000,   -- ₦100,000
  created_by              uuid references auth.users (id),
  created_at              timestamptz not null default now(),
  activated_at            timestamptz
);
-- Only one active price table at a time.
create unique index price_tables_one_active on public.price_tables (status) where status = 'active';

create table public.zone_fares (
  price_table_id  uuid not null references public.price_tables (id) on delete cascade,
  from_zone_id    uuid not null references public.zones (id),
  to_zone_id      uuid not null references public.zones (id),
  fare_kobo       bigint not null check (fare_kobo >= 0),
  primary key (price_table_id, from_zone_id, to_zone_id)
);

create table public.task_fees (
  price_table_id  uuid not null references public.price_tables (id) on delete cascade,
  task_type       public.task_type not null,
  fee_kobo        bigint not null check (fee_kobo >= 0),
  primary key (price_table_id, task_type)
);

create table public.size_fees (
  price_table_id  uuid not null references public.price_tables (id) on delete cascade,
  size            public.item_size not null,
  fee_kobo        bigint not null check (fee_kobo >= 0),
  primary key (price_table_id, size)
);

-- ---------------------------------------------------------------- orders
create table public.jobs (
  id                    uuid primary key default gen_random_uuid(),
  ref                   text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  product               public.product not null,
  task_type             public.task_type not null,
  status                public.job_status not null default 'quoted',
  previous_status       public.job_status,            -- where a holding state returns to
  customer_id           uuid not null references auth.users (id),  -- the payer
  recipient_name        text,
  recipient_phone       text,                          -- recipient may differ from payer (diaspora)
  details               jsonb not null default '{}'::jsonb,  -- shopping list, substitution rule, ticket no., max wait, what to submit
  item_size             public.item_size,
  item_value_kobo       bigint not null default 0,
  item_budget_kobo      bigint not null default 0,     -- Buy & bring; never revenue
  price_kobo            bigint not null,               -- service price the customer pays
  extras_kobo           bigint not null default 0,     -- approved mid-job add-ons
  quote                 jsonb not null,                -- customer-visible breakdown at quote time
  price_table_id        uuid not null references public.price_tables (id),
  runner_id             uuid references public.runners (user_id),
  created_via           text not null default 'app' check (created_via in ('app', 'ops_whatsapp')),
  created_by            uuid references auth.users (id),
  scheduled_for         timestamptz,                   -- booked same day; null = on demand
  promised_by           timestamptz,                   -- end of the quoted window
  payment_ref           text unique,                   -- Paystack reference
  tracking_token        text unique,
  failure_reason        public.failure_reason,
  failure_note          text,
  cancellation_fee_kobo bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  paid_at               timestamptz,
  assigned_at           timestamptz,
  completed_at          timestamptz,
  closed_at             timestamptz,
  constraint jobs_send_shape check ((product = 'send') = (task_type = 'send'))
);
create index jobs_status_idx on public.jobs (status);
create index jobs_customer_idx on public.jobs (customer_id, created_at desc);
create index jobs_runner_idx on public.jobs (runner_id, status);

-- Internal economics, stamped at quote time and frozen at payment. Staff only.
create table public.job_economics (
  job_id              uuid primary key references public.jobs (id) on delete cascade,
  price_table_version int not null,
  price_kobo          bigint not null,
  runner_pay_kobo     bigint not null,
  payment_fee_kobo    bigint not null,
  ops_cost_kobo       bigint not null,
  contingency_kobo    bigint not null,
  contribution_kobo   bigint not null,
  contribution_rate   numeric(6,4) not null,
  floor_applied       boolean not null default false,
  frozen_at           timestamptz
);

create table public.job_secrets (
  job_id        uuid primary key references public.jobs (id) on delete cascade,
  handover_otp  text not null   -- shown to customer/recipient only; runner collects it at handover
);

create table public.job_stops (
  job_id          uuid not null references public.jobs (id) on delete cascade,
  seq             int not null check (seq between 1 and 3),   -- up to 3 stops (PRD)
  kind            text not null check (kind in ('pickup', 'store', 'dropoff', 'office', 'queue')),
  address         text not null,
  landmark        text,
  location        extensions.geography(point, 4326) not null,
  zone_id         uuid not null references public.zones (id),
  contact_name    text,
  contact_phone   text,
  note            text,
  arrived_at      timestamptz,
  done_at         timestamptz,
  primary key (job_id, seq)
);

-- Append-only timeline: every state change, change request, call, adjustment.
create table public.job_events (
  id           bigint generated always as identity primary key,
  job_id       uuid not null references public.jobs (id) on delete cascade,
  kind         text not null,                -- transition | change_request | change_decision | offer | assignment | price_adjust | note | proof | emergency
  from_status  public.job_status,
  to_status    public.job_status,
  actor_id     uuid,
  actor_role   public.actor_role not null,
  reason       text,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index job_events_job_idx on public.job_events (job_id, id);

create table public.change_requests (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  kind          public.change_kind not null,
  amount_kobo   bigint not null default 0 check (amount_kobo >= 0),
  note          text not null,
  status        public.change_status not null default 'pending',
  raised_by     uuid not null,
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create unique index change_requests_one_pending on public.change_requests (job_id) where status = 'pending';

create table public.proofs (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  stop_seq      int,
  kind          public.proof_kind not null,
  storage_path  text not null,
  created_by    uuid not null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- dispatch
create table public.offers (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  runner_id     uuid not null references public.runners (user_id),
  earnings_kobo bigint not null,
  offered_by    uuid,
  offered_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  response      public.offer_response not null default 'pending',
  responded_at  timestamptz
);
create index offers_runner_idx on public.offers (runner_id, response);
create unique index offers_one_pending_per_job on public.offers (job_id) where response = 'pending';

-- ---------------------------------------------------------------- tracking
create table public.location_events (
  id            bigint generated always as identity primary key,
  runner_id     uuid not null references public.runners (user_id),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  location      extensions.geography(point, 4326) not null,
  accuracy_m    real,
  recorded_at   timestamptz not null,       -- device time (buffered points arrive late)
  received_at   timestamptz not null default now()
);
create index location_events_job_idx on public.location_events (job_id, recorded_at desc);

-- ---------------------------------------------------------------- money
-- Order, payment, float and payout are separate records linked by job id.
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id),
  kind            public.payment_kind not null,
  provider        text not null default 'paystack',
  provider_ref    text unique,
  amount_kobo     bigint not null,
  status          public.payment_status not null default 'pending',
  reason          text,
  raw             jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index payments_job_idx on public.payments (job_id);

-- Webhook de-duplication: a payment confirmed twice still creates one paid job.
create table public.payment_events (
  provider          text not null default 'paystack',
  provider_event_id text not null,
  received_at       timestamptz not null default now(),
  primary key (provider, provider_event_id)
);

create table public.job_floats (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs (id),
  runner_id           uuid not null references public.runners (user_id),
  amount_kobo         bigint not null check (amount_kobo > 0),
  transfer_ref        text unique,
  status              public.transfer_status not null default 'pending',
  receipt_amount_kobo bigint,
  sent_by             uuid,
  created_at          timestamptz not null default now(),
  reconciled_at       timestamptz
);

create table public.runner_earnings (
  job_id        uuid primary key references public.jobs (id),
  runner_id     uuid not null references public.runners (user_id),
  base_kobo     bigint not null,
  wait_kobo     bigint not null default 0,
  tip_kobo      bigint not null default 0,
  payout_id     uuid,
  created_at    timestamptz not null default now()
);

create table public.payouts (
  id            uuid primary key default gen_random_uuid(),
  runner_id     uuid not null references public.runners (user_id),
  period_start  date not null,
  period_end    date not null,
  amount_kobo   bigint not null,
  transfer_ref  text unique,
  status        public.transfer_status not null default 'pending',
  created_by    uuid,
  created_at    timestamptz not null default now()
);
alter table public.runner_earnings
  add constraint runner_earnings_payout_fk foreign key (payout_id) references public.payouts (id);

create table public.wallet_entries (
  id            bigint generated always as identity primary key,
  customer_id   uuid not null references auth.users (id),
  job_id        uuid references public.jobs (id),
  amount_kobo   bigint not null,                -- + credit, - spend
  reason        text not null,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create table public.ratings (
  job_id        uuid primary key references public.jobs (id),
  customer_id   uuid not null,
  runner_id     uuid not null,
  stars         int not null check (stars between 1 and 5),
  comment       text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- audit
create table public.audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid,
  actor_role   public.actor_role not null,
  action       text not null,
  entity       text not null,
  entity_id    text,
  reason       text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
