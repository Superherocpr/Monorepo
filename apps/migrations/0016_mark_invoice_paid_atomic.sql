-- 0016_mark_invoice_paid_atomic.sql
-- Atomic mark-paid helper for the invoice payment flow.
-- Run this in Supabase SQL editor (or psql) once per environment.
--
-- Fixes (see Building/threats.md):
--   THREAT-038 — TOCTOU race on mark-paid booking insert
--     Two concurrent requests for the same invoice could both read status='sent',
--     both pass the check, and both insert booking rows — double-booking spots.
--
-- The function acquires a row-level lock on the invoices row before reading
-- status, so only one caller can proceed through the check at a time.
-- All mutations run in the same transaction and are rolled back together
-- on any error.

-- ---------------------------------------------------------------------------
-- mark_invoice_paid(p_invoice_id, p_actor_id)
-- Atomically:
--   1. Locks the invoices row (SELECT FOR UPDATE).
--   2. Verifies the invoice exists and has status = 'sent'.
--      Raises a stable exception code on failure so the caller can return
--      a clean error without leaking internal state.
--   3. Sets invoice status = 'paid', paid_at = now().
--   4. Inserts one bookings row per student slot
--      (booking_source = 'invoice', customer_id = invoice.instructor_id).
--   5. Inserts an invoice_activity_log row for the action.
-- Returns a jsonb result with { success: true, paid_at: <timestamp> }.
-- ---------------------------------------------------------------------------
create or replace function mark_invoice_paid(
  p_invoice_id uuid,
  p_actor_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice  invoices%rowtype;
  v_paid_at  timestamptz := now();
begin
  -- Lock the invoice row. This prevents concurrent calls from both reading
  -- status='sent', both inserting bookings, and both updating to 'paid'.
  select * into v_invoice
  from invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice_not_found' using errcode = 'P0002';
  end if;

  if v_invoice.status <> 'sent' then
    -- Invoice has already been paid, cancelled, or is in an unexpected state.
    raise exception 'invoice_not_sent' using errcode = 'P0001';
  end if;

  -- Mark the invoice as paid
  update invoices
  set status  = 'paid',
      paid_at = v_paid_at
  where id = p_invoice_id;

  -- Insert one booking row per student slot.
  -- customer_id is the instructor who owns the invoice — they are acting as
  -- the booking agent for the group. booking_source distinguishes these from
  -- online bookings so roll-call and roster flows are not confused.
  insert into bookings (session_id, customer_id, invoice_id, booking_source, created_by)
  select
    v_invoice.class_session_id,
    v_invoice.instructor_id,
    p_invoice_id,
    'invoice',
    p_actor_id
  from generate_series(1, v_invoice.student_count);

  -- Audit log
  insert into invoice_activity_log (invoice_id, actor_id, action)
  values (p_invoice_id, p_actor_id, 'marked_paid');

  return jsonb_build_object('success', true, 'paid_at', v_paid_at);
end;
$$;

-- Grant to service_role only — this function is called from a server-side
-- API route using the admin client (service role key). It should NOT be
-- callable by anon or authenticated users directly.
grant execute on function mark_invoice_paid(uuid, uuid) to service_role;
