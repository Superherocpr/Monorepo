-- Migration 0030: Promo codes
--
-- Creates two tables:
--   promo_codes          — the code itself, discount type/value, expiry, active flag
--   promo_code_sessions  — junction: which class_sessions each code applies to
--
-- Also adds 'promo' to the payment_type enum for $0 promo-code bookings.
--
-- Discount types:
--   fixed   — subtract a flat dollar amount (discount_value = USD amount)
--   percent — subtract N% of the session price (discount_value = 0–100)
--   free    — 100% off; discount_value is ignored (stored as 0)
--
-- All access is via service-role (server-side only); no public RLS policies needed.
-- RLS is enabled to prevent anon/authenticated role bypass.

-- Add 'promo' to the payment_type enum so confirm-free can record $0 payments distinctly.
alter type payment_type add value if not exists 'promo';

create type promo_discount_type as enum ('fixed', 'percent', 'free');

create table promo_codes (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  discount_type    promo_discount_type not null,
  discount_value   numeric(10, 2) not null default 0 check (discount_value >= 0),
  expires_at       timestamptz,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,

  constraint promo_codes_code_unique unique (code),
  -- percent codes must be 0–100
  constraint promo_codes_percent_range check (
    discount_type <> 'percent' or (discount_value >= 0 and discount_value <= 100)
  )
);

create table promo_code_sessions (
  id            uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes(id) on delete cascade,
  session_id    uuid not null references class_sessions(id) on delete cascade,
  constraint promo_code_sessions_unique unique (promo_code_id, session_id)
);

create index on promo_code_sessions (session_id);
create index on promo_code_sessions (promo_code_id);

alter table promo_codes enable row level security;
alter table promo_code_sessions enable row level security;
