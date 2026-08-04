-- Migration 0027: Enable RLS on class_requests (THREAT-045)
--
-- class_requests was created by migration 0025, after 0023/0024 rolled RLS out
-- to every table that existed at that time — it was missed, leaving it fully
-- open to anon/authenticated via PostgREST with no policy at all.
--
-- All application access to this table goes through createAdminClient()
-- (service-role), which bypasses RLS regardless of policies — confirmed by
-- grepping every caller (app/api/class-requests/**, dashboard/class-requests
-- page). So the fix mirrors the existing pattern used for invoices, payments,
-- and invoice_activity_log: enable RLS with zero policies, which default-denies
-- anon/authenticated while leaving service-role access untouched.

ALTER TABLE class_requests ENABLE ROW LEVEL SECURITY;
