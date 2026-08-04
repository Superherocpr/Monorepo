-- Migration 0046: Revoke public REST access to stock management SECURITY DEFINER functions
--
-- decrement_stock_if_available and restore_stock were deferred from 0045 because
-- orders/confirm called them via createClient() (user role). That route has now
-- been switched to createAdminClient() (service role), which bypasses this grant.
--
-- Revoking EXECUTE prevents any direct REST API call to /rest/v1/rpc/<name>,
-- which could otherwise manipulate stock counts without going through the
-- PayPal-verified checkout flow.

REVOKE EXECUTE
  ON FUNCTION public.decrement_stock_if_available(uuid, integer)
  FROM anon, authenticated;

REVOKE EXECUTE
  ON FUNCTION public.restore_stock(uuid, integer)
  FROM anon, authenticated;
