-- Migration 0045: Revoke public REST access to sensitive SECURITY DEFINER functions
--
-- Supabase exposes all public-schema functions to anon/authenticated via
-- /rest/v1/rpc/<name>. These four functions should only be called from our
-- server-side API routes via the service-role client (which bypasses this grant).
-- Revoking EXECUTE prevents direct REST API abuse without touching app behavior.
--
-- book_spot              — all callers use createAdminClient(); anon caller could
--                          book spots without paying (bypass PayPal flow)
-- mark_invoice_paid      — all callers use createAdminClient(); anon caller could
--                          mark any invoice paid (critical: bypasses PayPal webhook)
-- reserve_instructor_payout_batch — all callers use adminClient; has an internal
--                          super_admin check but should not be REST-callable at all
-- regenerate_instructor_access_codes — not called by any app route; anon caller
--                          could reset all instructor access codes at will
--
-- decrement_stock_if_available and restore_stock are deferred: orders/confirm
-- calls them via createClient() (user role) and must be migrated to the admin
-- client before those grants can be safely revoked.

REVOKE EXECUTE
  ON FUNCTION public.book_spot(uuid, uuid, text, uuid)
  FROM anon, authenticated;

REVOKE EXECUTE
  ON FUNCTION public.mark_invoice_paid(uuid, uuid)
  FROM anon, authenticated;

REVOKE EXECUTE
  ON FUNCTION public.reserve_instructor_payout_batch(uuid)
  FROM anon, authenticated;

REVOKE EXECUTE
  ON FUNCTION public.regenerate_instructor_access_codes()
  FROM anon, authenticated;
