-- 0055_team_bookings.sql
--
-- Team / corporate bookings: a staff-created class plus a shareable signup link.
--
-- Flow this supports:
--   1. A corporate inquiry arrives via "Request a Class" on /book.
--   2. An admin/manager (or an instructor, for their own classes) creates the
--      class and a team_bookings row from /admin/sessions/new.
--   3. Staff hand the resulting /team/<share_token> link to the company contact,
--      who distributes it to their own employees.
--   4. Each employee signs up through the link with a real account, so RollCall
--      sees correct names on class day. The same page shows who has signed up.
--
-- Two payment modes:
--   'company'  — flat total, the contact receives a PayPal invoice; employees
--                sign up free and may do so before that invoice clears.
--   'per_seat' — each employee pays the staff-quoted per-seat price at signup.
--
-- Design note — bookings created through a team link deliberately keep
-- booking_source = 'online'. That is what makes the existing duplicate-booking
-- protection apply for free: both book_spot's 'already_booked' guard and the
-- bookings_online_session_customer_unique partial index (migration 0038) are
-- scoped to booking_source = 'online'. Team bookings are instead identified by
-- the new bookings.team_booking_id column, so no enum value and no change to
-- book_spot is required.

-- ---------------------------------------------------------------------------
-- 1. team_bookings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_bookings (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES class_sessions(id),
  company_name      text NOT NULL,
  contact_name      text NOT NULL,
  contact_email     text NOT NULL,
  contact_phone     text,
  -- 'company' = flat total billed to the company; 'per_seat' = employee pays.
  payment_mode      text NOT NULL,
  -- Set for payment_mode = 'per_seat'. The authoritative per-employee price,
  -- overriding class_types.price for signups made through this link.
  price_per_seat    numeric(10,2),
  -- Set for payment_mode = 'company'. Flat amount, no per-head breakdown.
  total_price       numeric(10,2),
  -- The invoice raised against the company. Null in per_seat mode.
  invoice_id        uuid REFERENCES invoices(id),
  -- Unguessable bearer credential in the public /team/<token> URL.
  share_token       text NOT NULL,
  -- Staff member who created it. Drives the cancellation phone number shown on
  -- the public page: an instructor-created booking shows that instructor's phone.
  created_by        uuid NOT NULL REFERENCES profiles(id),
  -- Set when created via "Convert to team booking" from a class request.
  class_request_id  uuid REFERENCES class_requests(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT team_bookings_share_token_key UNIQUE (share_token),
  CONSTRAINT team_bookings_payment_mode_check
    CHECK (payment_mode IN ('company', 'per_seat')),
  -- Each mode must carry its own price and only its own price.
  CONSTRAINT team_bookings_price_shape_check CHECK (
    (payment_mode = 'per_seat' AND price_per_seat IS NOT NULL AND total_price IS NULL)
    OR
    (payment_mode = 'company' AND total_price IS NOT NULL AND price_per_seat IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS team_bookings_session_id_idx ON team_bookings (session_id);
CREATE INDEX IF NOT EXISTS team_bookings_invoice_id_idx ON team_bookings (invoice_id);

-- RLS on with zero policies — every read/write goes through a server-side API
-- route using createAdminClient() (service role), matching the promo_codes /
-- addons / session_addons convention. The public page reads by share_token via
-- an API route that re-verifies the token, never by direct anon query.
ALTER TABLE team_bookings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. bookings.team_booking_id
-- ---------------------------------------------------------------------------
-- Marks a booking as having been made through a team link. Nullable and purely
-- additive: booking_source stays 'online' so existing duplicate-prevention,
-- capacity counting, roster, and RollCall logic all continue to apply unchanged.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS team_booking_id uuid REFERENCES team_bookings(id);

CREATE INDEX IF NOT EXISTS bookings_team_booking_id_idx
  ON bookings (team_booking_id)
  WHERE team_booking_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. class_sessions.is_private
-- ---------------------------------------------------------------------------
-- A private session never appears on the public schedule — it is reachable only
-- through its team link. Without this, a corporate class would be listed on
-- /book and members of the public could take the company's seats.

ALTER TABLE class_sessions
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

-- The anon read policy is the second half of that gate: app-level queries filter
-- is_private, and so must the policy, or a direct PostgREST query would still
-- expose private sessions. Mirrors the original policy from 0023_enable_rls.sql
-- with the added is_private = false condition.

DROP POLICY IF EXISTS "class_sessions_anon_read_public" ON class_sessions;
CREATE POLICY "class_sessions_anon_read_public" ON class_sessions
  FOR SELECT
  TO anon, authenticated
  USING (
    status          = 'scheduled'
    AND approval_status = 'approved'
    AND starts_at   > now()
    AND is_private  = false
  );

-- ---------------------------------------------------------------------------
-- 4. mark_invoice_paid — skip placeholder seats for team invoices
-- ---------------------------------------------------------------------------
-- The original (0016) inserts one anonymous bookings row per student_count the
-- moment an invoice is marked paid, because in the classic group-invoice flow
-- no real attendee records exist. A team booking is the opposite case: real,
-- named employee bookings are created as people sign up through the link, often
-- before the company's invoice clears. Running the placeholder insert as well
-- would double the class headcount and could overfill the session.
--
-- Team invoices are additionally written with student_count = 0 so they never
-- consume capacity in book_spot's
--   sum(student_count) from invoices where status not in ('cancelled','paid')
-- subquery while unpaid. The guard below is the explicit, primary protection —
-- it does not rely on that value being 0.
--
-- Everything else about this function is unchanged from 0016: row lock, status
-- check, stable error codes, paid stamp, and the activity log entry.

CREATE OR REPLACE FUNCTION mark_invoice_paid(
  p_invoice_id uuid,
  p_actor_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_invoice  invoices%rowtype;
  v_paid_at  timestamptz := now();
  v_is_team  boolean;
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

  -- Is this invoice backing a team booking?
  select exists (
    select 1 from team_bookings where invoice_id = p_invoice_id
  ) into v_is_team;

  if not v_is_team then
    -- Classic group/individual invoice: insert one booking row per student slot.
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
  end if;

  -- Audit log
  insert into invoice_activity_log (invoice_id, actor_id, action)
  values (p_invoice_id, p_actor_id, 'marked_paid');

  return jsonb_build_object('success', true, 'paid_at', v_paid_at);
end;
$$;

-- Grant to service_role only — this function is called from a server-side
-- API route using the admin client (service role key). It should NOT be
-- callable by anon or authenticated users directly. REVOKE FROM PUBLIC is
-- required as well: revoking from anon/authenticated alone is a silent no-op
-- while PUBLIC still holds EXECUTE (see 0049).
REVOKE ALL ON FUNCTION mark_invoice_paid(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_invoice_paid(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(uuid, uuid) TO service_role;
