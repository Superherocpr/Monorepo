-- 0013_atomic_concurrency.sql
-- Atomic-concurrency helpers used by the booking and merch checkout flows.
-- Run this in Supabase SQL editor (or psql) once per environment.
--
-- Fixes (see Building/threats.md):
--   THREAT-006 — racy booking confirm (check → insert without locking)
--   THREAT-010 — racy stock decrement (check → decrement without locking)
--
-- Both functions are SECURITY DEFINER so anon/PayPal-callback paths can call
-- them without RLS bypass on the underlying tables.

-- ---------------------------------------------------------------------------
-- book_spot(p_session_id, p_customer_id, p_booking_source, p_invoice_id)
-- Atomically:
--   1. Locks the class_sessions row.
--   2. Verifies the session is approved and not cancelled.
--   3. Counts active bookings + active invoice student slots.
--   4. If capacity remains, inserts a new bookings row.
-- Returns the new booking id on success.
-- Raises an exception with a stable code on contention or capacity failure.
-- ---------------------------------------------------------------------------
create or replace function book_spot(
  p_session_id uuid,
  p_customer_id uuid,
  p_booking_source text default 'online',
  p_invoice_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_status text;
  v_approval text;
  v_taken int;
  v_booking_id uuid;
begin
  -- Lock the session row for the duration of this transaction.
  select max_capacity, status, approval_status
    into v_capacity, v_status, v_approval
  from class_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'cancelled' or v_approval <> 'approved' then
    raise exception 'session_unavailable' using errcode = 'P0001';
  end if;

  -- Active bookings + active invoice student slots
  select
    coalesce((select count(*) from bookings
              where session_id = p_session_id and cancelled = false), 0) +
    coalesce((select sum(student_count) from invoices
              where class_session_id = p_session_id and status <> 'cancelled'), 0)
    into v_taken;

  if v_taken >= v_capacity then
    raise exception 'session_full' using errcode = 'P0001';
  end if;

  insert into bookings (session_id, customer_id, booking_source, invoice_id, cancelled)
  values (p_session_id, p_customer_id, p_booking_source, p_invoice_id, false)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function book_spot(uuid, uuid, text, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- decrement_stock_if_available(p_variant_id, p_amount)
-- Atomically locks the variant row and decrements stock_quantity only if
-- enough stock is available. Returns true on success, false on insufficient
-- stock. Use this in merch checkout to prevent over-selling.
-- ---------------------------------------------------------------------------
create or replace function decrement_stock_if_available(
  p_variant_id uuid,
  p_amount int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock int;
begin
  select stock_quantity into v_stock
  from product_variants
  where id = p_variant_id
  for update;

  if not found then
    return false;
  end if;

  if v_stock < p_amount then
    return false;
  end if;

  update product_variants
     set stock_quantity = stock_quantity - p_amount
   where id = p_variant_id;

  return true;
end;
$$;

grant execute on function decrement_stock_if_available(uuid, int) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- restore_stock(p_variant_id, p_amount)
-- Adds units back to stock_quantity. Used to roll back a successful
-- decrement_stock_if_available when a downstream step (e.g. order insert,
-- PayPal capture verification) fails partway through merch checkout.
-- ---------------------------------------------------------------------------
create or replace function restore_stock(
  p_variant_id uuid,
  p_amount int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update product_variants
     set stock_quantity = stock_quantity + p_amount
   where id = p_variant_id;
end;
$$;

grant execute on function restore_stock(uuid, int) to anon, authenticated, service_role;
