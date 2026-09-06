-- Migration: 0066_schema_conversions_rls
--
-- Enables RLS on public.schema_conversions with no policies, closing an
-- anon/authenticated full-DML exposure (INSERT/SELECT/UPDATE/DELETE/TRUNCATE)
-- caught by the Supabase security advisor as an ERROR-level rls_disabled_in_public
-- finding on both staging and production (2026-09-04).
--
-- schema_conversions is an audit log for one-off data migrations (e.g. the
-- floating_session_times conversion logged 2026-08-28). It carries no customer
-- PII, but with RLS off, anyone holding the public anon key could read, forge,
-- or TRUNCATE the migration audit trail via PostgREST/GraphQL — identical
-- exposure class to THREAT-061 (cron_job_expectations), fixed the same way.
--
-- No policies are defined, which denies anon and authenticated entirely;
-- service_role bypasses RLS and is the only intended writer (data-migration
-- scripts run with the service key).

alter table public.schema_conversions enable row level security;
