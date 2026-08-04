-- Migration: 0026_open_opportunities
-- Adds the cancel → open opportunity → claim feature for class_sessions:
--   1. Cancellation metadata columns (also fixes a bug in the pre-existing manual
--      cancel flow, which overwrote `notes` with the cancellation reason instead
--      of using a dedicated column)
--   2. A partial index supporting the "find open opportunities" query used by
--      the instructor dashboard widget and the unclaimed-opportunity escalation job
--   3. A cron job that pings the app every 30 minutes to notify super_admins about
--      cancelled sessions that are still unclaimed within 48 hours of starting

-- ── 1. Cancellation metadata columns ────────────────────────────────────────────
ALTER TABLE class_sessions
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES profiles(id),
  ADD COLUMN cancellation_reason text,
  -- Idempotency marker: prevents the 48-hour escalation job from re-notifying
  -- super_admins about the same still-unclaimed session on every cron run.
  ADD COLUMN unclaimed_escalation_sent_at timestamptz;

-- ── 2. Partial index for the open-opportunities query ───────────────────────────
-- Both the instructor dashboard widget and the escalation cron filter on exactly
-- this predicate (status = 'cancelled' AND instructor_id IS NULL), then range-scan
-- by starts_at.
CREATE INDEX idx_class_sessions_open_opportunities
  ON class_sessions (starts_at)
  WHERE status = 'cancelled' AND instructor_id IS NULL;

-- ── 3. Scheduled unclaimed-opportunity escalation job ───────────────────────────
--
-- BEFORE RUNNING:
--   1. Enable pg_net   in the Supabase dashboard → Database → Extensions.
--   2. Enable pg_cron  in the Supabase dashboard → Database → Extensions.
--   3. Ensure system_settings has rows for 'app_url' and 'cron_secret'
--      (inserted by migration 0007 / social feed cron setup).
--
-- HOW IT WORKS:
--   Fires every 30 minutes. The /api/sessions/notify-unclaimed-opportunities route
--   finds cancelled, still-unassigned sessions starting within 48 hours that
--   haven't been escalated yet, emails all super_admins a digest, and marks them
--   escalated. Pure notification — it never changes session state itself.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('notify-unclaimed-opportunities')
where exists (
  select 1 from cron.job where jobname = 'notify-unclaimed-opportunities'
);

select cron.schedule(
  'notify-unclaimed-opportunities',
  '*/30 * * * *',
  $$
    select net.http_post(
      url     := (select value from system_settings where key = 'app_url') || '/api/sessions/notify-unclaimed-opportunities',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from system_settings where key = 'cron_secret')
      ),
      body    := '{}'::jsonb
    )
  $$
);
