-- Adds per-instructor payment routing preference to profiles.
-- Defaults to 'instructor' — route online booking payments to the instructor's
-- connected PayPal account when available.
alter table profiles
  add column payment_routing text not null default 'instructor'
  check (payment_routing in ('instructor', 'business'));

comment on column profiles.payment_routing is
  'Controls where online booking payments are routed. instructor = use instructor PayPal if available, business = always use business PayPal.';
