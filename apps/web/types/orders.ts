/**
 * TypeScript interfaces for the customer orders dashboard view.
 * Covers the joined shape returned by /dashboard/orders queries.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/**
 * A customer's merch order with all related data joined in.
 * Used on the /dashboard/orders page.
 */
export interface OrderRecord {
  id: string;
  status: "pending" | "paid" | "shipped" | "delivered" | "cancelled";
  total_amount: number;
  tracking_number: string | null;
  shipping_name: string;
  shipping_address: string;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  created_at: string;
  order_items: {
    id: string;
    quantity: number;
    price_at_purchase: number;
    product_variants: {
      size: string;
      products: {
        name: string;
        image_url: string | null;
      };
    };
  }[];
}

/**
 * Full order record with joined customer and items — used on the admin orders page.
 * The `profiles` field is the customer, joined via the customer_id foreign key.
 */
export interface AdminOrderRecord {
  id: string;
  status: "pending" | "paid" | "shipped" | "delivered" | "cancelled";
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
  profiles: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  };
  order_items: {
    id: string;
    quantity: number;
    price_at_purchase: number;
    product_variants: {
      size: string;
      products: {
        name: string;
        image_url: string | null;
      };
    };
  }[];
}

/**
 * Minimal order shape used in the dashboard recent order widget.
 */
export interface RecentOrderWidget {
  id: string;
  status: "pending" | "paid" | "shipped" | "delivered" | "cancelled";
  total_amount: number;
  tracking_number: string | null;
  created_at: string;
  order_items: {
    quantity: number;
    price_at_purchase: number;
    product_variants: {
      size: string;
      products: { name: string };
    };
  }[];
}
