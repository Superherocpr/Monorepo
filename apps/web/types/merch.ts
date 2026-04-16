/**
 * TypeScript interfaces for merchandise database tables.
 * Covers: products, product_variants, orders, order_items, stock_adjustments.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/**
 * A merchandise catalog item from the `products` table.
 */
export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  active: boolean;
  low_stock_threshold: number;
  created_at: string;
}

/**
 * A per-size stock record for a product from the `product_variants` table.
 * stock_quantity is decremented atomically via the decrement_stock Supabase RPC.
 */
export interface ProductVariant {
  id: string;
  product_id: string;
  size: string;
  stock_quantity: number;
  created_at: string;
}

/**
 * A product with its variants joined in.
 * Used on the merch page and admin merch management.
 */
export interface ProductWithVariants extends Product {
  product_variants: ProductVariant[];
}

/** Order status values for orders.status enum. */
export type OrderStatus =
  | "pending"
  | "paid"
  | "shipped"
  | "delivered"
  | "cancelled";

/**
 * A customer's merch order from the `orders` table.
 */
export interface Order {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total_amount: number;
  paypal_transaction_id: string | null;
  shipping_name: string;
  shipping_address: string;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  tracking_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A line item within an order from the `order_items` table.
 * price_at_purchase is a snapshot — not derived from current product price.
 */
export interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string;
  quantity: number;
  price_at_purchase: number;
  created_at: string;
}

/**
 * An audit log entry for manual stock changes from the `stock_adjustments` table.
 */
export interface StockAdjustment {
  id: string;
  variant_id: string;
  adjusted_by: string;
  previous_quantity: number;
  new_quantity: number;
  notes: string | null;
  created_at: string;
}
