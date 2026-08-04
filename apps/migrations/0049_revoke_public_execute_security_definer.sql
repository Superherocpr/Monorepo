-- Migration 0049: Actually revoke public REST access to SECURITY DEFINER functions
--
-- Migrations 0045 and 0046 intended to stop anon/authenticated callers reaching
-- these functions through Supabase's REST endpoint (/rest/v1/rpc/<name>). Both
-- used:
--
--     REVOKE EXECUTE ON FUNCTION ... FROM anon, authenticated;
--
-- which is a no-op here. PostgreSQL grants EXECUTE to PUBLIC by default on every
-- new function, and anon/authenticated hold the privilege *through PUBLIC* rather
-- than through a direct grant. Revoking a grant they never individually had
-- changed nothing, and the ACL still read:
--
--     {=X/postgres,postgres=X/postgres,service_role=X/postgres}
--      ^^^ this leading "=X" is the PUBLIC grant
--
-- Verified on staging before writing this migration: has_function_privilege(
-- 'anon', oid, 'EXECUTE') returned true for every function below, so the
-- protection those two migrations describe was never actually in effect.
--
-- The fix is to revoke from PUBLIC. service_role keeps its own explicit grant, so
-- every server-side route using createAdminClient() is unaffected.
--
-- Each function is called exclusively via createAdminClient() (service role),
-- confirmed in the route code:
--   book_spot                          — bookings/confirm, confirm-free, dev/book-free
--   mark_invoice_paid                  — lib/invoice-actions.ts
--   regenerate_instructor_access_codes — not called by any route
--   reserve_instructor_payout_batch    — payouts/create
--   reserve_payout_retry_batch         — payouts/retry
--   decrement_stock_if_available       — orders/confirm (admin client since 0046)
--   restore_stock                      — orders/confirm (admin client since 0046)
--
-- Driven by a lookup over pg_proc rather than hard-coded signatures because the
-- function set differs between environments (mark_invoice_paid is absent from
-- staging), and a missing function must not abort the whole migration.

DO $$
DECLARE
  v_target text;
  v_func record;
  v_targets text[] := ARRAY[
    'book_spot',
    'mark_invoice_paid',
    'regenerate_instructor_access_codes',
    'reserve_instructor_payout_batch',
    'reserve_payout_retry_batch',
    'decrement_stock_if_available',
    'restore_stock'
  ];
BEGIN
  FOREACH v_target IN ARRAY v_targets LOOP
    FOR v_func IN
      SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_target
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_func.signature);
      -- Re-assert the grant the server-side routes rely on, so a later
      -- CREATE OR REPLACE cannot leave a route without access.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_func.signature);
      RAISE NOTICE 'Locked down %', v_func.signature;
    END LOOP;
  END LOOP;
END $$;

-- NOTE: every future SECURITY DEFINER function in the public schema needs
--   REVOKE EXECUTE ON FUNCTION <name>(<args>) FROM PUBLIC;
-- in its own migration. Revoking from anon/authenticated alone does nothing.
-- To audit at any time:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and has_function_privilege('anon', p.oid, 'EXECUTE');
