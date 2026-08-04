-- ============================================================================
-- 0014_book_spot_paid_exclusion.sql
-- ----------------------------------------------------------------------------
-- Fixes a double-count bug in the `book_spot` RPC introduced by the
-- mark-paid flow.
--
-- BUG:
--   When an invoice is marked paid (`/api/invoices/mark-paid`), the route:
--     1. Inserts one `bookings` row per student on the invoice, and
--     2. Updates the invoice's `status` to `'paid'`.
--
--   The previous `book_spot` definition (migration 0013) counted seats as:
--     active bookings  +  sum(student_count) WHERE status <> 'cancelled'
--
--   Because `'paid'` is not `'cancelled'`, paid invoices kept being counted
--   AND their newly-created bookings were ALSO counted — inflating the
--   session's apparent occupancy by `student_count` per paid invoice, and
--   blocking legitimate new bookings.
--
-- FIX:
--   Recreate `book_spot` so the invoice-students contribution excludes BOTH
--   `'cancelled'` (seats released) AND `'paid'` (seats now live in
--   `bookings`). All other behaviour — row lock, status/approval check,
--   capacity check, exception sentinels with stable errcodes — is preserved
--   verbatim from migration 0013.
-- ============================================================================

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

  -- Active bookings + active invoice student slots.
  -- Exclude `'paid'` invoices because their seats already exist in `bookings`
  -- (the mark-paid flow inserts one bookings row per student on the invoice).
  -- Without this exclusion, paid invoices would be double-counted.
  select
    coalesce((select count(*) from bookings
              where session_id = p_session_id and cancelled = false), 0) +
    coalesce((select sum(student_count) from invoices
              where class_session_id = p_session_id
                and status not in ('cancelled', 'paid')), 0)
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

