-- Migration: 0063_student_documents_cleanup_cron
--
-- Adds a daily cron job that purges student_documents rows older than 30 days.
-- S3 objects in the student-documents/ prefix are cleaned up by an S3 lifecycle
-- rule (30-day expiry on both superherocpr-assets-prod and -staging), so no S3
-- calls are needed here — this sweep is for the DB rows only.
--
-- The 30-day window is intentional: files are a temporary backup for instructors
-- in case Enrollware injection fails. Once Enrollware has the documents, the
-- copies here are redundant. A month is long enough to catch any missed injection.
--
-- Uses the same logged pattern as regenerate_access_codes_logged (migration 0057)
-- so the job appears in cron_health() alongside all other scheduled work.

-- ── 1. Cleanup function ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_expired_student_documents_logged()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  started      timestamptz := clock_timestamp();
  rows_deleted integer;
BEGIN
  DELETE FROM public.student_documents
  WHERE created_at < now() - interval '30 days';

  GET DIAGNOSTICS rows_deleted = ROW_COUNT;

  INSERT INTO public.cron_run_log (job_name, ok, duration_ms, records_touched)
  VALUES (
    'purge-expired-student-documents',
    true,
    (extract(epoch from (clock_timestamp() - started)) * 1000)::integer,
    rows_deleted
  );
EXCEPTION WHEN others THEN
  INSERT INTO public.cron_run_log (job_name, ok, duration_ms, error_message)
  VALUES (
    'purge-expired-student-documents',
    false,
    (extract(epoch from (clock_timestamp() - started)) * 1000)::integer,
    sqlerrm
  );
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_expired_student_documents_logged() FROM public;
REVOKE ALL ON FUNCTION public.delete_expired_student_documents_logged() FROM anon;
REVOKE ALL ON FUNCTION public.delete_expired_student_documents_logged() FROM authenticated;

-- ── 2. Register with cron_health() expectations ───────────────────────────────
INSERT INTO public.cron_job_expectations (job_name, max_gap_minutes, note)
VALUES (
  'purge-expired-student-documents',
  1500,
  'Daily 02:00 UTC — deletes student_documents rows older than 30 days; S3 objects are handled separately by an S3 lifecycle rule'
)
ON CONFLICT (job_name) DO UPDATE
  SET max_gap_minutes = excluded.max_gap_minutes,
      note            = excluded.note;

-- ── 3. Schedule ───────────────────────────────────────────────────────────────
SELECT cron.unschedule('purge-expired-student-documents')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-student-documents');

SELECT cron.schedule(
  'purge-expired-student-documents',
  '0 2 * * *',
  'SELECT public.delete_expired_student_documents_logged()'
);
