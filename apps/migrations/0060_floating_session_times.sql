-- 0060_floating_session_times.sql
--
-- Converts class_sessions.starts_at / ends_at from true UTC instants to
-- *floating* wall-clock times, and updates the anon read policy to match.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- A class is an in-person event at a fixed venue. A 9:00 AM class is at 9:00 AM
-- for everyone who attends it; the viewer's location is irrelevant. Storing a
-- real instant meant every surface re-derived a local time from it, and any
-- surface running in a different timezone rendered a different number.
--
-- That is exactly what a customer reported: the booking-confirmation email
-- showed 1:00 PM for a 9:00 AM class, because /book renders in the student's
-- browser (Eastern) while the confirmation email renders on a UTC server.
--
-- After this migration the stored value IS the wall clock. "9:00 AM" is stored
-- as 09:00:00Z and read back verbatim everywhere, with no conversion. The app
-- side of this contract lives in apps/web/lib/business-time.ts.
--
-- ── The conversion ───────────────────────────────────────────────────────────
-- Every existing row was written by staff in Florida, so its stored instant is
-- the Eastern wall clock shifted to UTC. To recover the wall clock:
--
--   (starts_at AT TIME ZONE 'America/New_York')  -- timestamptz -> ET wall clock
--                AT TIME ZONE 'UTC'              -- that wall clock, labelled UTC
--
-- Postgres resolves the correct EDT/EST offset per row from its own tzdata, so
-- this is DST-correct with no offset arithmetic and no assumption that every
-- row shares one offset.
--
-- Verified against production before writing (26 rows): every row lands on a
-- clean wall-clock time — 08:00, 09:00, 09:30, 15:00, 17:30 — which is what a
-- human-scheduled class looks like, and confirms the direction of the shift.
--
-- ── Idempotency ──────────────────────────────────────────────────────────────
-- This migration is NOT idempotent: running the UPDATE twice would shift times
-- a second time. It is guarded below so a re-run is a no-op.
--
-- No explicit BEGIN/COMMIT — the migration runner wraps each file in its own
-- transaction, matching every other migration in this directory.

-- Guard: a marker row records that the conversion has run. If it is already
-- present, skip the UPDATE entirely rather than double-shifting every session.
create table if not exists schema_conversions (
  name        text primary key,
  applied_at  timestamptz not null default now(),
  notes       text
);

comment on table schema_conversions is
  'One row per non-idempotent data conversion, so re-running its migration is a safe no-op.';

do $$
declare
  converted_count int;
begin
  if exists (select 1 from schema_conversions where name = 'floating_session_times') then
    raise notice '0060: floating_session_times already applied — skipping conversion.';
    return;
  end if;

  update class_sessions
  set starts_at = (starts_at at time zone 'America/New_York') at time zone 'UTC',
      ends_at   = (ends_at   at time zone 'America/New_York') at time zone 'UTC';

  get diagnostics converted_count = row_count;

  insert into schema_conversions (name, notes)
  values (
    'floating_session_times',
    format('Converted %s class_sessions rows from America/New_York instants to floating wall-clock times.', converted_count)
  );

  raise notice '0060: converted % class_sessions rows to floating wall-clock times.', converted_count;
end $$;

-- ── Anon read policy ─────────────────────────────────────────────────────────
-- starts_at is now a floating wall clock, so comparing it against now() (a true
-- UTC instant) would mark a class past by the length of the UTC offset — a
-- 9:00 AM Eastern class would disappear from /book at 5:00 AM, four hours before
-- it starts. Compare against the business wall clock instead, which is the same
-- transformation applied to now() that the rows themselves received.
--
-- This mirrors floatingNow() in apps/web/lib/business-time.ts; the two must stay
-- in step. Only the starts_at comparison changes here — the other three
-- conditions are carried over verbatim from 0055 (which added is_private, the
-- gate that keeps team/corporate sessions off the public site).

drop policy if exists "class_sessions_anon_read_public" on class_sessions;
create policy "class_sessions_anon_read_public" on class_sessions
  for select
  to anon, authenticated
  using (
    status              = 'scheduled'
    and approval_status = 'approved'
    and starts_at       > (now() at time zone 'America/New_York') at time zone 'UTC'
    and is_private      = false
  );
