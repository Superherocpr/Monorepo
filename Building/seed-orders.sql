-- =============================================================================
-- Superhero CPR — Orders Mock Seed (Idempotent)
-- Run in the Supabase SQL editor after main seed.sql.
-- This script inserts mock orders and order_items for dashboard testing.
-- =============================================================================

DO $$
DECLARE
  -- Use existing customer and variant IDs from seed.sql
  cust1 uuid := '44444444-0000-0000-0000-000000000001'::uuid;
  cust2 uuid := '44444444-0000-0000-0000-000000000002'::uuid;
  cust3 uuid := '44444444-0000-0000-0000-000000000003'::uuid;
  v101 uuid := 'ffffffff-0000-0000-0000-000000000101'::uuid; -- T-Shirt XS
  v202 uuid := 'ffffffff-0000-0000-0000-000000000202'::uuid; -- Hoodie M
  v301 uuid := 'ffffffff-0000-0000-0000-000000000301'::uuid; -- Keychain One Size
  v401 uuid := 'ffffffff-0000-0000-0000-000000000401'::uuid; -- Bag Black
  v402 uuid := 'ffffffff-0000-0000-0000-000000000402'::uuid; -- Bag Red
  order1 uuid := 'dddddddd-0000-0000-0000-000000000001'::uuid;
  order2 uuid := 'dddddddd-0000-0000-0000-000000000002'::uuid;
  order3 uuid := 'dddddddd-0000-0000-0000-000000000003'::uuid;
BEGIN
  -- Order 1: Pending, 2 items
  INSERT INTO orders (id, customer_id, status, total_amount, shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip, created_at)
  VALUES (order1, cust1, 'pending', 33.00, 'Test Customer 1', '123 Main St', 'Tampa', 'FL', '33609', now() - interval '2 days')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO order_items (order_id, variant_id, quantity, price_at_purchase)
  VALUES (order1, v101, 1, 25.00), (order1, v301, 1, 8.00);

  -- Order 2: Paid, 1 item
  INSERT INTO orders (id, customer_id, status, total_amount, shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip, tracking_number, created_at)
  VALUES (order2, cust2, 'paid', 55.00, 'Test Customer 2', '456 Oak Ave', 'Tampa', 'FL', '33607', 'TRK123456', now() - interval '5 days')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO order_items (order_id, variant_id, quantity, price_at_purchase)
  VALUES (order2, v202, 1, 55.00);

  -- Order 3: Shipped, 2 items
  INSERT INTO orders (id, customer_id, status, total_amount, shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip, tracking_number, created_at)
  VALUES (order3, cust3, 'shipped', 36.00, 'Test Customer 3', '789 Pine Rd', 'Tampa', 'FL', '33609', 'TRK654321', now() - interval '10 days')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO order_items (order_id, variant_id, quantity, price_at_purchase)
  VALUES (order3, v401, 1, 18.00), (order3, v402, 1, 18.00);
END $$;
