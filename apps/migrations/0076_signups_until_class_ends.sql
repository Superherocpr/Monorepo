-- 0076: keep a class bookable until it ENDS, not until it starts
--
-- The public site used to stop offering a class the moment it began, which turned
-- away late arrivals and walk-ins. The app-level checks (/book listing, team
-- signup links, admin add-booking) now compare ends_at instead. This is the
-- matching database half: the anon read policy is the gate behind a direct
-- PostgREST query, and it must not hide a class the app still lists.
--
-- Only the time comparison changes (starts_at -> ends_at). The other three
-- conditions are carried over verbatim from 0060, including is_private = false,
-- the gate that keeps team/corporate sessions off the public site.
--
-- Same floating-time transformation as 0060 and floatingNow() in
-- apps/web/lib/business-time.ts; the three must stay in step.

drop policy if exists "class_sessions_anon_read_public" on class_sessions;
create policy "class_sessions_anon_read_public" on class_sessions
  for select
  to anon, authenticated
  using (
    status              = 'scheduled'
    and approval_status = 'approved'
    and ends_at         > (now() at time zone 'America/New_York') at time zone 'UTC'
    and is_private      = false
  );
