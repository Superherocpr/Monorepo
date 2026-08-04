-- Migration 0044: Enable RLS on contact_notes
--
-- contact_notes was created in 0043 without RLS, leaving it fully open to
-- anon/authenticated via PostgREST with no policy at all.
--
-- All app access goes through createAdminClient() (service-role), which bypasses
-- RLS regardless of policies — confirmed by inspecting the sole caller:
-- app/api/contact/[id]/notes/route.ts (GET + POST both use createAdminClient).
-- Role-gating is enforced at the API layer via requireApiRole(["manager","super_admin"]).
--
-- Enabling RLS with no policies default-denies anon/authenticated while leaving
-- service-role access untouched — mirrors the pattern used for class_requests (0027).

ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;
