-- Migration 0039: the money path.
--
-- Three tables, and the order between them is the point. `razorpay_events` is
-- the idempotency spine: Razorpay retries a delivery it did not see an OK for,
-- and a retried `payment.captured` that flips a plan twice is a workspace
-- getting two free months and an audit trail that cannot say which one was
-- real. So the event id is the primary key, the insert is the lock, and the
-- plan write happens only when that insert actually inserted.
--
-- `razorpay_payments` is the money as Razorpay says it is — an order, a
-- payment, an amount in paise (never a float, never rupees) — and
-- `hire_success_fees` is the pay-on-hire half of the hybrid model: drafted
-- when a candidate actually joins, not when an offer is typed.

create table if not exists razorpay_events (
  event_id text primary key,
  event_type text not null default '',
  payload_json text not null default '{}',
  received_at timestamptz not null default now(),
  -- Set only when this event changed something. A duplicate delivery is
  -- received_at with applied_at null, which is the honest record of "we saw it
  -- twice and acted once".
  applied_at timestamptz
);
create index if not exists razorpay_events_received_idx on razorpay_events (received_at desc);

create table if not exists razorpay_payments (
  id text primary key,
  org_id text not null,
  user_id text not null default '',
  -- One row per order. Razorpay can tell us about the same order several times;
  -- the unique key is what makes "exactly one payment per order" a fact of the
  -- schema rather than of the code.
  order_id text not null unique,
  payment_id text not null default '',
  plan text not null default 'free',
  amount_paise integer not null default 0,
  currency text not null default 'INR',
  status text not null default 'created',
  event_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists razorpay_payments_org_idx on razorpay_payments (org_id, created_at desc);

-- The success fee is per hire, so the application is the natural key: a
-- candidate who joins, leaves and joins again is one fee, not two.
create table if not exists hire_success_fees (
  id text primary key,
  org_id text not null,
  role_id text not null default '',
  application_id text not null unique,
  candidate_id text not null default '',
  amount_paise integer not null,
  currency text not null default 'INR',
  -- drafted | invoiced | collected | waived
  status text not null default 'drafted',
  order_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hire_success_fees_org_idx on hire_success_fees (org_id, created_at desc);
