-- Migration 0037: Booking add-on purchases
--
-- Final tier of the add-ons feature: a customer's purchased add-ons for a
-- specific booking. price_at_booking snapshots the addon's price at purchase
-- time — same convention as invoices.amount_per_student — so later catalog
-- price changes never rewrite historical purchases.
--
-- addon_id uses ON DELETE RESTRICT (unlike the CASCADE junctions in migrations
-- 0035/0036) because this is a financial record: an addon with purchase
-- history must not be deletable. The admin DELETE route checks this before
-- attempting the delete so staff get a friendly error instead of a DB
-- constraint violation.
--
-- All access is via service-role (server-side only); no public RLS policies yet.
-- RLS is enabled to prevent anon/authenticated role bypass.

create table booking_addons (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references bookings(id) on delete cascade,
  addon_id         uuid not null references addons(id) on delete restrict,
  price_at_booking numeric(10, 2) not null check (price_at_booking >= 0),
  created_at       timestamptz not null default now(),

  constraint booking_addons_unique unique (booking_id, addon_id)
);

create index on booking_addons (booking_id);
create index on booking_addons (addon_id);

alter table booking_addons enable row level security;
