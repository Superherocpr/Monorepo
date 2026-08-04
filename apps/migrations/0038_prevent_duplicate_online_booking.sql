-- 0038_prevent_duplicate_online_booking.sql
--
-- Fixes THREAT-047 — a customer could pay for and be booked into the same
-- session twice. book_spot only ever checked total capacity against
-- max_capacity; it never checked whether the calling customer already held
-- an active booking for that session, and no DB constraint caught it either.
-- A customer unsure their first payment went through (slow network, closed
-- the tab too early) could simply restart the booking flow and pay again —
-- two PayPal charges, two bookings, no refund.
--
-- Scope: booking_source = 'online' AND cancelled = false only.
--   - Invoice-sourced bookings (mark_invoice_paid, migration 0016) legitimately
--     insert multiple rows with the SAME (session_id, customer_id) pair, since
--     customer_id is set to invoice.instructor_id once per student slot on the
--     invoice — a blanket unique constraint would break that flow.
--   - Cancelled bookings don't count, so a customer can cancel and rebook.
--   - manual/rollcall bookings are admin-driven with their own explicit-reason
--     flow (see /api/customers/[id]/add-booking) and are out of scope here.

create unique index if not exists bookings_online_session_customer_unique
  on bookings (session_id, customer_id)
  where booking_source = 'online' and cancelled = false;

-- Recreate book_spot to explicitly reject a duplicate online booking attempt
-- with a stable error code, so callers can show a clean message instead of a
-- raw unique-violation error surfacing from the INSERT.
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
  v_existing_id uuid;
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

  -- Guard against paying/booking twice for the same session (THREAT-047).
  -- Scoped to the online self-serve flow — invoice bookings intentionally
  -- reuse (session_id, customer_id) once per student slot on the invoice.
  if p_booking_source = 'online' then
    select id into v_existing_id
    from bookings
    where session_id = p_session_id
      and customer_id = p_customer_id
      and booking_source = 'online'
      and cancelled = false
    limit 1;

    if found then
      raise exception 'already_booked' using errcode = 'P0001';
    end if;
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
