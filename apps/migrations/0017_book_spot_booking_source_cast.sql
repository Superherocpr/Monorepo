-- 0017_book_spot_booking_source_cast.sql
--
-- Fix: add explicit ::booking_source cast in the book_spot INSERT.
--
-- The p_booking_source parameter is declared as `text` (so callers can pass a
-- plain string over the PostgREST JSON API), but the bookings.booking_source
-- column is a user-defined enum.  PostgreSQL does NOT implicitly cast text to
-- enum inside PL/pgSQL, so every call to book_spot was raising:
--   "column booking_source is of type booking_source but expression is of type text"
--
-- Fix: cast p_booking_source::booking_source at the INSERT site.
-- All other logic is identical to migration 0014.

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
  -- Exclude 'paid' invoices because their seats already exist in bookings
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

  -- Cast p_booking_source to the booking_source enum explicitly.
  -- PostgreSQL does not implicitly cast text to a user-defined enum in PL/pgSQL.
  insert into bookings (session_id, customer_id, booking_source, invoice_id, cancelled)
  values (p_session_id, p_customer_id, p_booking_source::booking_source, p_invoice_id, false)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

grant execute on function book_spot(uuid, uuid, text, uuid) to anon, authenticated, service_role;
